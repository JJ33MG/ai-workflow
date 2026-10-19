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
    expect(await decide(a.id, true)).toContain("Approved and done");
    expect(await decide(a.id, true)).toContain("Already executed");
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
    expect(d.agents.map((a) => a.id).sort()).toEqual(["ceo", "debug", "etsy-pod"]);
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
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(sendChat("ceo", "hi")).rejects.toBeInstanceOf(ChatUnavailableError);
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
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
    const detail = await buildBusinessDetail("etsy-pod");
    expect(detail!.series).toHaveLength(30);
    expect(detail!.series.at(-1)!.revenue).toBe(1799);
    expect(await buildBusinessDetail("nope")).toBeNull();
  });

  it("blocks Claude calls once the daily budget is spent", async () => {
    await db.cost.create({ data: { agentId: "ceo", category: "claude_api", amountCents: 100_000, currency: "EUR" } });
    await expect(assertApiBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
