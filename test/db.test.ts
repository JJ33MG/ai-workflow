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
    for (const t of ["task", "log", "sale", "cost", "approval", "knowledge"] as const) {
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

  it("blocks Claude calls once the daily budget is spent", async () => {
    await db.cost.create({ data: { agentId: "ceo", category: "claude_api", amountCents: 100_000, currency: "EUR" } });
    await expect(assertApiBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
