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
    for (const t of ["task", "log", "sale", "cost", "approval", "knowledge", "chatMessage", "marketingPlay"] as const) {
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
    expect(d.agents.map((a) => a.id).sort()).toEqual(["ceo", "debug", "etsy-pod", "kdp-coloring", "marketing"]);
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

  it("closes publish requests for drafts Jarne published or deleted on Etsy", async () => {
    const { settleReviewedDrafts } = await import("../src/agents/etsyPod.js");
    await db.listing.deleteMany({ where: { etsyListingId: { in: ["d1", "d2", "d3"] } } });
    const base = { niche: "x", description: "", tags: [], priceCents: 2199, currency: "EUR", designSvg: "", designFile: "" };
    const kept = await db.listing.create({ data: { ...base, title: "Still a draft", etsyListingId: "d1", status: "uploaded" } });
    const deleted = await db.listing.create({ data: { ...base, title: "Deleted", etsyListingId: "d2", status: "uploaded" } });
    const live = await db.listing.create({ data: { ...base, title: "Published by hand", etsyListingId: "d3", status: "active" } });
    const open = await requestApproval({ agentId: "etsy-pod", kind: "etsy_publish", title: "a", details: "", payload: { listingIds: [kept.id, deleted.id] } });
    const done = await requestApproval({ agentId: "etsy-pod", kind: "etsy_publish", title: "b", details: "", payload: { listingIds: [deleted.id, live.id] } });

    expect(await settleReviewedDrafts(new Set(["d1"]))).toEqual({ removed: 1, closedApprovals: 1 });
    expect((await db.listing.findUniqueOrThrow({ where: { id: deleted.id } })).status).toBe("removed");
    expect((await db.approval.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("pending");
    expect((await db.approval.findUniqueOrThrow({ where: { id: done.id } })).status).toBe("executed");
    await db.listing.deleteMany({ where: { etsyListingId: { in: ["d1", "d2", "d3"] } } });
  });

  it("blocks Claude calls once the daily budget is spent", async () => {
    await db.cost.create({ data: { agentId: "ceo", category: "claude_api", amountCents: 100_000, currency: "EUR" } });
    await expect(assertApiBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });
  it("marketing: niche focus feeds the shared brain, and an SEO play is measured and judged", async () => {
    const log = { info: async () => {}, warn: async () => {}, error: async () => {} };
    const marketing = agents.get("marketing")!;

    const focus = await db.marketingPlay.create({
      data: { businessId: "etsy-pod", tactic: "etsy_niche_focus", title: "Meer verpleegkunde", why: "Veel favorieten", input: { niches: ["nurses"] } },
    });
    await marketing.handlers.run_play({ playId: focus.id }, { log });
    expect((await db.marketingPlay.findUniqueOrThrow({ where: { id: focus.id } })).status).toBe("running");
    expect(await db.knowledge.count({ where: { kind: "niche", title: "nurses" } })).toBe(1);
    // Safe to re-run: nothing is added twice.
    await marketing.handlers.run_play({ playId: focus.id }, { log });
    expect(await db.knowledge.count({ where: { kind: "niche", title: "nurses" } })).toBe(1);

    await db.listing.deleteMany({ where: { etsyListingId: { in: ["m1", "m2"] } } });
    const base = { niche: "x", description: "", tags: [], priceCents: 2199, currency: "EUR", designSvg: "", designFile: "", status: "active" };
    await db.listing.create({ data: { ...base, title: "Changed", etsyListingId: "m1", favorites: 38 } });
    await db.listing.create({ data: { ...base, title: "Control", etsyListingId: "m2", favorites: 48 } });
    const seo = await db.marketingPlay.create({
      data: {
        businessId: "etsy-pod",
        tactic: "etsy_seo_refresh",
        title: "Titels vernieuwen",
        why: "Weinig bezoeken",
        status: "running",
        startedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000 - 1000),
        baseline: {
          target: [{ listingId: "m1", views: 10, ageDays: 10 }],
          control: [{ listingId: "m2", views: 20, ageDays: 10 }],
          previous: [{ listingId: "m1", oldTitle: "Old", oldTags: [] }],
        },
      },
    });
    await marketing.handlers.measure_plays({}, { log });
    const measured = await db.marketingPlay.findUniqueOrThrow({ where: { id: seo.id } });
    expect(measured.status).toBe("measured");
    expect(measured.verdict).toBe("worked");
    expect(measured.liftPct).toBeCloseTo(100, 0);
    expect(await db.knowledge.count({ where: { kind: "lesson", tags: { has: "marketing" } } })).toBe(1);
    await db.listing.deleteMany({ where: { etsyListingId: { in: ["m1", "m2"] } } });
  });
  it("publishes up to the daily allowance by itself and asks for the rest", async () => {
    const { splitForAutoPublish } = await import("../src/agents/etsyPod.js");
    const { config } = await import("../src/config.js");
    const before = config.etsy.autoPublishPerDay;
    try {
      config.etsy.autoPublishPerDay = 3;
      await db.cost.create({ data: { agentId: "etsy-pod", category: "etsy_fee", amountCents: 20, currency: "USD" } });
      expect(await splitForAutoPublish(["a", "b", "c", "d"])).toEqual({ now: ["a", "b"], ask: ["c", "d"] });
      config.etsy.autoPublishPerDay = 0;
      expect(await splitForAutoPublish(["a"])).toEqual({ now: [], ask: ["a"] });
    } finally {
      config.etsy.autoPublishPerDay = before;
    }
  });

  it("approves every pending listing publication at once, but nothing else", async () => {
    const { decideAll } = await import("../src/lib/approvals.js");
    await requestApproval({ agentId: "etsy-pod", kind: "etsy_publish", title: "a", details: "" });
    await requestApproval({ agentId: "etsy-pod", kind: "etsy_publish", title: "b", details: "" });
    await requestApproval({ agentId: "etsy-pod", kind: "printful_order_confirm", title: "order", details: "" });
    expect(await decideAll("etsy_publish")).toMatch(/^2 goedgekeurd/);
    expect(await db.approval.count({ where: { status: "pending" } })).toBe(1);
  });
  it("runs a campaign only between its dates, per business", async () => {
    const { addCampaign, activeCampaigns, campaignBrief } = await import("../src/lib/marketing.js");
    const { setSetting } = await import("../src/db.js");
    await setSetting("marketing.campaigns", []);
    await addCampaign({ businessId: "etsy-pod", name: "Kerst", direction: "Christmas gifts", from: "2026-11-20", until: "2026-12-15" }, new Date("2026-11-18T12:00:00Z"));
    expect(await activeCampaigns("etsy-pod", new Date("2026-11-19T12:00:00Z"))).toHaveLength(0);
    expect(await activeCampaigns("etsy-pod", new Date("2026-12-01T12:00:00Z"))).toHaveLength(1);
    expect(await activeCampaigns("kdp-coloring", new Date("2026-12-01T12:00:00Z"))).toHaveLength(0);
    expect(await campaignBrief("etsy-pod", new Date("2026-12-01T12:00:00Z"))).toContain("Kerst (until 2026-12-15): Christmas gifts");
    await expect(addCampaign({ businessId: "etsy-pod", name: "x", direction: "y", from: "2026-12-10", until: "2026-12-01" })).rejects.toThrow();
    await setSetting("marketing.campaigns", []);
  });
  it("gives the CEO an honest advisor persona and a spoken English style for voice messages", async () => {
    const chat = await import("../src/chat.js");
    const prompt = (chat as unknown as { systemPromptForTest?: (a: string, v?: boolean) => string }).systemPromptForTest;
    expect(prompt).toBeTypeOf("function");
    const ceo = prompt!("ceo", true);
    expect(ceo).toContain("Dutch directness");
    expect(ceo).toContain("read aloud");
    expect(ceo).toContain("Speak English.");
    expect(prompt!("etsy-pod")).not.toContain("Dutch directness");
  });
});
