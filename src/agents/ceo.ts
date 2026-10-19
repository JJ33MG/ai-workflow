import { config } from "../config.js";
import { db } from "../db.js";
import { askText, isClaudeConfigured } from "../lib/claude.js";
import { formatEur, startOfDay, startOfMonth, toEurCents } from "../lib/money.js";
import { notify } from "../lib/telegram.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "ceo";
export const MONTHLY_GOAL_CENTS = 10_000_00;

export interface BriefingData {
  date: string;
  revenue: { yesterday: number; monthToDate: number };
  costs: { yesterday: number; monthToDate: number };
  agents: { id: string; name: string; status: string; done: number; failed: number; highlights: string[] }[];
  incidents: { task: string; error: string; fixed: boolean }[];
  opportunities: string[];
  approvals: { id: string; title: string; amount?: string }[];
}

const sumEur = (rows: { amountCents: number; currency: string }[]) =>
  rows.reduce((s, r) => s + toEurCents(r.amountCents, r.currency), 0);

export async function collectBriefingData(now = new Date()): Promise<BriefingData> {
  const tz = config.timezone;
  const today = startOfDay(now, tz);
  const yesterday = startOfDay(new Date(today.getTime() - 12 * 3600 * 1000), tz);
  const month = startOfMonth(now, tz);
  const range = (from: Date, to: Date) => ({ gte: from, lt: to });

  const [salesY, salesM, costsY, costsM] = await Promise.all([
    db.sale.findMany({ where: { occurredAt: range(yesterday, today) } }),
    db.sale.findMany({ where: { occurredAt: { gte: month, lte: now } } }),
    db.cost.findMany({ where: { occurredAt: range(yesterday, today) } }),
    db.cost.findMany({ where: { occurredAt: { gte: month, lte: now } } }),
  ]);

  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const agents = await db.agent.findMany({ orderBy: [{ phase: "asc" }, { id: "asc" }] });
  const agentRows = await Promise.all(
    agents.map(async (a) => {
      const [done, failed, logs] = await Promise.all([
        db.task.count({ where: { agentId: a.id, status: "done", finishedAt: { gte: since } } }),
        db.task.count({ where: { agentId: a.id, status: { in: ["failed", "escalated"] }, updatedAt: { gte: since } } }),
        db.log.findMany({
          where: { agentId: a.id, level: "info", createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);
      return { id: a.id, name: a.name, status: a.status, done, failed, highlights: logs.map((l) => l.message) };
    }),
  );

  // A task that failed at least once but ended "done" was fixed by a retry.
  const troubled = await db.task.findMany({
    where: { updatedAt: { gte: since }, OR: [{ status: "escalated" }, { status: "done", attempts: { gt: 1 } }] },
  });
  const incidents = troubled.map((t) => ({
    task: `${t.agentId}:${t.type}`,
    error: t.error ?? "failed before succeeding on retry",
    fixed: t.status === "done",
  }));

  const opportunities = (
    await db.knowledge.findMany({ where: { kind: "opportunity", createdAt: { gte: since } }, take: 5 })
  ).map((k) => `${k.title}: ${k.body}`);

  const approvals = (await db.approval.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } })).map(
    (a) => ({
      id: a.id,
      title: a.title,
      amount: a.amountCents != null && a.currency ? formatEur(toEurCents(a.amountCents, a.currency)) : undefined,
    }),
  );

  return {
    date: new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "full" }).format(now),
    revenue: { yesterday: sumEur(salesY), monthToDate: sumEur(salesM) },
    costs: { yesterday: sumEur(costsY), monthToDate: sumEur(costsM) },
    agents: agentRows,
    incidents,
    opportunities,
    approvals,
  };
}

export function formatBriefing(d: BriefingData, focus?: string): string {
  const net = d.revenue.monthToDate - d.costs.monthToDate;
  const pct = Math.max(0, Math.round((net / MONTHLY_GOAL_CENTS) * 100));
  const lines = [
    `☀️ Morning briefing — ${d.date}`,
    "",
    "💰 Money",
    `Revenue: ${formatEur(d.revenue.yesterday)} yesterday · ${formatEur(d.revenue.monthToDate)} this month`,
    `Costs: ${formatEur(d.costs.yesterday)} yesterday · ${formatEur(d.costs.monthToDate)} this month`,
    `Net this month: ${formatEur(net)} — ${pct}% of €10,000`,
    "",
    "🤖 Agents (last 24h)",
    ...d.agents.map(
      (a) =>
        `• ${a.name}: ${a.done} done, ${a.failed} failed${a.status === "error" ? " ⚠️" : ""}` +
        (a.highlights.length ? `\n  ${a.highlights.slice(0, 3).join("\n  ")}` : ""),
    ),
    "",
    "🛠 What broke",
    ...(d.incidents.length
      ? d.incidents.map((i) => `• ${i.task}: ${i.error} — ${i.fixed ? "fixed ✅" : "NOT fixed ❌"}`)
      : ["Nothing."]),
    "",
    "🔭 New opportunities",
    ...(d.opportunities.length ? d.opportunities.map((o) => `• ${o}`) : ["None yet (Scout Agent arrives in Phase 2)."]),
    "",
    "✋ Decisions needed",
    ...(d.approvals.length
      ? d.approvals.map((a) => `• ${a.title}${a.amount ? ` (${a.amount})` : ""} → /approve ${a.id} or /reject ${a.id}`)
      : ["None."]),
  ];
  if (focus) lines.push("", "🎯 CEO focus for today", focus);
  return lines.join("\n");
}

async function briefing(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const data = await collectBriefingData();
  let focus: string | undefined;
  if (isClaudeConfigured()) {
    try {
      focus = await askText({
        agentId: ID,
        purpose: "ceo_focus",
        effort: "medium",
        maxTokens: 4000,
        system:
          "You are the CEO agent of a small set of AI-run online businesses aiming for €10,000/month net profit. " +
          "Principles: cash first; one business earning before the next starts; human approval for money and risk. " +
          "Given yesterday's data, write 2–4 short bullet points (plain text, starting with •) on what to focus on today. Be specific and honest; no filler.",
        prompt: JSON.stringify(data),
      });
    } catch (err) {
      await log.warn(`CEO focus skipped: ${(err as Error).message}`, undefined, taskId);
    }
  }
  const text = formatBriefing(data, focus);
  await notify(text);
  await log.info("Morning briefing sent", undefined, taskId);
  return { length: text.length };
}

export const ceoAgent: AgentDefinition = {
  id: ID,
  name: "CEO Agent",
  phase: 1,
  business: "All businesses",
  description: "Reads every agent's logs, sales and costs and sends Jarne one morning briefing with today's focus.",
  dependsOn: ["database", "claude", "telegram"],
  handlers: { briefing },
  taskInfo: {
    briefing: "Collect revenue, costs, agent activity, incidents and pending decisions; send the Telegram briefing",
  },
};
