// Integration tests against a real PostgreSQL. Skipped unless TEST_DATABASE_URL is set:
//   TEST_DATABASE_URL=postgresql://... npm test
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("with database", async () => {
  const { db } = await import("../src/db.js");
  const { agents, syncAgents } = await import("../src/agents/index.js");
  const { enqueue, runPendingTasks } = await import("../src/lib/tasks.js");
  const { decide, registerApprovalExecutor, requestApproval } = await import("../src/lib/approvals.js");
  const { collectBriefingData } = await import("../src/agents/ceo.js");
  const { BudgetExceededError, assertApiBudget } = await import("../src/lib/budget.js");

  beforeAll(syncAgents);
  beforeEach(async () => {
    for (const t of ["task", "log", "sale", "cost", "approval", "knowledge", "chatMessage"] as const) {
      await (db[t] as { deleteMany: () => Promise<unknown> }).deleteMany();
    }
  });

  it("retries a failed task, then escalates after maxAttempts", async () => {
    let calls = 0;
    const flaky = new Map(agents);
    flaky.set("etsy-pod", {
      ...agents.get("etsy-pod")!,
      handlers: {
        boom: async () => {
          calls++;
          throw new Error("nope");
        },
      },
    });
    const task = await enqueue("etsy-pod", "boom", {}, { maxAttempts: 2 });

    await runPendingTasks(flaky);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("failed");

    await agents.get("debug")!.handlers.check({}, { log: { info: async () => {}, warn: async () => {}, error: async () => {} } });
    const retried = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(retried.status).toBe("pending");
    await db.task.update({ where: { id: task.id }, data: { runAfter: new Date() } });

    await runPendingTasks(flaky);
    await agents.get("debug")!.handlers.check({}, { log: { info: async () => {}, warn: async () => {}, error: async () => {} } });
    const final = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(final.status).toBe("escalated");
    expect(calls).toBe(2);
    expect(await db.log.count({ where: { level: "error" } })).toBe(2);
  });

  it("runs an approval executor exactly once", async () => {
    let runs = 0;
    registerApprovalExecutor("test_kind", async () => {
      runs++;
      return "ok";
    });
    const a = await requestApproval({ agentId: "ceo", kind: "test_kind", title: "Test", details: "d" });
    expect(await decide(a.id, true)).toContain("Goedgekeurd en uitgevoerd");
    expect(await decide(a.id, true)).toContain("Al uitgevoerd");
    expect(runs).toBe(1);
  });

  it("builds briefing numbers from sales and costs", async () => {
    await db.sale.create({
      data: { agentId: "etsy-pod", source: "etsy", externalId: "1", amountCents: 2000, currency: "EUR", occurredAt: new Date() },
    });
    await db.cost.create({ data: { agentId: "ceo", category: "claude_api", amountCents: 50, currency: "EUR" } });
    const d = await collectBriefingData();
    expect(d.revenue.monthToDate).toBe(2000);
    expect(d.costs.monthToDate).toBe(50);
    expect(d.agents.map((a) => a.id).sort()).toEqual(["ceo", "debug", "etsy-pod", "kdp-coloring"]);
  });

  it("shows an escalated task on the dashboard with its fix", async () => {
    const { buildDashboard } = await import("../src/dashboard.js");
    await db.agent.updateMany({ data: { enabled: true, status: "idle" } });
    await db.task.create({
      data: {
        agentId: "etsy-pod",
        type: "fulfil_receipt",
        status: "escalated",
        attempts: 3,
        error: "Printful POST /orders failed: 400 Variant not available",
      },
    });
    const d = await buildDashboard();
    const etsy = d.agents.find((a) => a.id === "etsy-pod")!;
    expect(etsy.health).toBe("failing");
    expect(etsy.error).toContain("Variant not available");
    expect(d.problems).toHaveLength(1);
    expect(d.problems[0].state).toBe("needs-you");
    expect(d.problems[0].guide.id).toBe("printful-order");
    expect(d.overall.status).toBe("error");
    expect(d.chart).toHaveLength(14);
  });

  it("lets chat start only allowed jobs, never money-spending ones", async () => {
    const { toolsFor } = await import("../src/chat.js");
    const start = (agentId: string) => toolsFor(agentId).find((t) => t.definition.name === "start_task")!;

    await expect(start("etsy-pod").run({ agent: "etsy-pod", task: "create_listings", count: 50 })).resolves.toContain("Queued");
    const queued = await db.task.findFirstOrThrow({ where: { agentId: "etsy-pod", type: "create_listings" } });
    expect(queued.payload).toEqual({ count: 20 }); // capped

    await start("etsy-pod").run({ agent: "etsy-pod", task: "create_listings", count: 1, instructions: "  dentists  " });
    const directed = await db.task.findFirstOrThrow({ where: { type: "create_listings" }, orderBy: { createdAt: "desc" } });
    expect(directed.payload).toEqual({ count: 1, instructions: "dentists" });

    await expect(start("etsy-pod").run({ agent: "etsy-pod", task: "publish_listings" })).rejects.toThrow(/Not allowed/);
    await expect(start("etsy-pod").run({ agent: "ceo", task: "briefing" })).rejects.toThrow(/Not allowed/);
    // The CEO works company-wide and may start other agents' jobs.
    await expect(start("ceo").run({ agent: "etsy-pod", task: "sync_sales" })).resolves.toContain("Queued");
  });

  it("saves chat notes to the shared brain", async () => {
    const { toolsFor } = await import("../src/chat.js");
    const save = toolsFor("ceo").find((t) => t.definition.name === "save_to_brain")!;
    await save.run({ kind: "note", title: "Focus", body: "Etsy first" });
    const row = await db.knowledge.findFirstOrThrow({ where: { title: "Focus" } });
    expect(row.agentId).toBe("ceo");
  });

  it("refuses chat without a Claude key", async () => {
    const { sendChat, ChatUnavailableError } = await import("../src/chat.js");
    await expect(sendChat("ceo", "hi")).rejects.toBeInstanceOf(ChatUnavailableError);
  });

  it("summarises businesses, including planned ones", async () => {
    const { buildDashboard, buildBusinessDetail } = await import("../src/dashboard.js");
    await db.sale.create({
      data: { agentId: "etsy-pod", source: "etsy", externalId: "b1", amountCents: 1799, currency: "EUR", occurredAt: new Date() },
    });
    const d = await buildDashboard();
    const etsy = d.businesses.find((b) => b.id === "etsy-pod")!;
    expect(etsy.stage).toBe("earning");
    expect(etsy.revenueMonth).toBe(1799);
    expect(d.businesses.find((b) => b.id === "cartoon-content")!.stage).toBe("planned");
    expect(d.businesses.find((b) => b.id === "kdp-coloring")!.stage).toBe("setting-up"); // has an agent, no sales yet
    expect(d.businesses.find((b) => b.id === "roadgem")!.stage).toBe("parked");
    const detail = await buildBusinessDetail("etsy-pod");
    expect(detail!.series).toHaveLength(30);
    expect(detail!.series.at(-1)!.revenue).toBe(1799);
    expect(await buildBusinessDetail("nope")).toBeNull();
  });

  it("shows every part of the company on the brain map with a real status", async () => {
    const { buildDashboard } = await import("../src/dashboard.js");
    const { db: _db } = await import("../src/db.js");
    await _db.setting.deleteMany({ where: { key: "plan.status" } });
    const d = await buildDashboard();
    const node = (id: string) => d.brain.nodes.find((n) => n.id === id)!;
    expect(node("svc:database").status.state).toBe("live");
    expect(node("svc:claude").status.state).toBe("error"); // tests run without a key
    expect(node("svc:kdp").status.state).toBe("off");
    expect(node("biz:roadgem").status.state).toBe("parked");
    expect(node("svc:server").status.label).toBe("Niet online");
    for (const [a, b] of d.brain.edges) {
      expect(d.brain.nodes.some((n) => n.id === a)).toBe(true);
      expect(d.brain.nodes.some((n) => n.id === b)).toBe(true);
    }
  });

  it("lets Jarne tick off only his own plan steps, and the map follows", async () => {
    const { setPlanStatus } = await import("../src/brain.js");
    const { buildDashboard } = await import("../src/dashboard.js");
    const { db: _db } = await import("../src/db.js");
    await _db.setting.deleteMany({ where: { key: "plan.status" } });
    await setPlanStatus("kdp-account", "done");
    const d = await buildDashboard();
    expect(d.plan.find((p) => p.id === "kdp-account")!.status).toBe("done");
    expect(d.brain.nodes.find((n) => n.id === "svc:kdp")!.status.state).toBe("manual");
    await expect(setPlanStatus("core", "todo")).rejects.toThrow(/systeem/);
    await expect(setPlanStatus("nope", "done")).rejects.toThrow(/Onbekende/);
    await _db.setting.deleteMany({ where: { key: "plan.status" } });
  });

  it("syncs the Etsy shop's listings: adds new, updates known, ends removed", async () => {
    const { upsertEtsyListings } = await import("../src/agents/etsyPod.js");
    const { db: _db } = await import("../src/db.js");
    await _db.listing.deleteMany({ where: { etsyListingId: { not: null } } }); // start from an empty shop
    const mug = (id: number, title: string) => ({
      listing_id: id,
      title,
      description: "d",
      tags: ["mug"],
      state: "active",
      url: "https://etsy.com/listing/" + id,
      price: { amount: 2199, divisor: 100, currency_code: "USD" },
    });
    const image = async () => "https://i.etsystatic.com/x.jpg";

    expect(await upsertEtsyListings([mug(9001, "Bee mug"), mug(9002, "Baker mug")], image)).toEqual({ added: 2, updated: 0, ended: 0 });
    expect(await upsertEtsyListings([mug(9001, "Bee mug v2")], image)).toEqual({ added: 0, updated: 1, ended: 1 });

    const bee = await _db.listing.findUniqueOrThrow({ where: { etsyListingId: "9001" } });
    expect(bee).toMatchObject({ title: "Bee mug v2", source: "etsy", status: "active", priceCents: 2199, currency: "USD" });
    expect(bee.printfulVariant).toBeNull(); // Printful's own Etsy integration fulfils these, never the agent
    expect((await _db.listing.findUniqueOrThrow({ where: { etsyListingId: "9002" } })).status).toBe("ended");
    await _db.listing.deleteMany({ where: { etsyListingId: { in: ["9001", "9002"] } } });
  });

  it("blocks Claude calls once the daily budget is spent", async () => {
    await db.cost.create({ data: { agentId: "ceo", category: "claude_api", amountCents: 100_000, currency: "EUR" } });
    await expect(assertApiBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
