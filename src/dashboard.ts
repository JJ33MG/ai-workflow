import { agents as registry } from "./agents/index.js";
import { MONTHLY_GOAL_CENTS } from "./agents/ceo.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { apiSpendTodayCents } from "./lib/budget.js";
import { runHealthChecks, type CheckStatus, type HealthCheck } from "./lib/health.js";
import { startOfDay, startOfMonth, toEurCents } from "./lib/money.js";
import { allGuides, diagnose } from "./lib/troubleshoot.js";
import { SCHEDULE, nextRunOf, schedulerState } from "./scheduler.js";

export type AgentHealth = "ok" | "running" | "waiting" | "paused" | "retrying" | "stale" | "blocked" | "failing";

const SEVERITY: Record<AgentHealth, CheckStatus> = {
  ok: "ok",
  running: "ok",
  waiting: "off",
  paused: "off",
  retrying: "warn",
  stale: "warn",
  blocked: "error",
  failing: "error",
};

const DAY = 24 * 3600 * 1000;
const dayKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export async function buildDashboard(now = new Date()) {
  const since24h = new Date(now.getTime() - DAY);
  const today = startOfDay(now, config.timezone);
  const month = startOfMonth(now, config.timezone);
  const checks = await runHealthChecks(now);
  const checkById = new Map(checks.map((c) => [c.id, c]));

  // ---- Money ----
  const [salesToday, salesMonth, costsToday, costsMonth] = await Promise.all([
    db.sale.findMany({ where: { occurredAt: { gte: today, lte: now } } }),
    db.sale.findMany({ where: { occurredAt: { gte: month, lte: now } } }),
    db.cost.findMany({ where: { occurredAt: { gte: today, lte: now } } }),
    db.cost.findMany({ where: { occurredAt: { gte: month, lte: now } } }),
  ]);
  const sum = (rows: { amountCents: number; currency: string }[]) =>
    rows.reduce((s, r) => s + toEurCents(r.amountCents, r.currency), 0);
  const money = {
    revenueToday: sum(salesToday),
    revenueMonth: sum(salesMonth),
    costsToday: sum(costsToday),
    costsMonth: sum(costsMonth),
    netMonth: sum(salesMonth) - sum(costsMonth),
    goalMonth: MONTHLY_GOAL_CENTS,
    apiSpentToday: await apiSpendTodayCents(now),
    apiCapToday: config.budget.dailyApiCapCents,
  };

  // ---- Agents ----
  const rows = await db.agent.findMany({ orderBy: [{ phase: "asc" }, { id: "asc" }] });
  const agents = await Promise.all(
    rows.map(async (row) => {
      const def = registry.get(row.id);
      const [done24h, failed24h, open, escalated, lastFailed] = await Promise.all([
        db.task.count({ where: { agentId: row.id, status: "done", finishedAt: { gte: since24h } } }),
        db.task.count({
          where: { agentId: row.id, status: { in: ["failed", "escalated"] }, updatedAt: { gte: since24h } },
        }),
        db.task.count({ where: { agentId: row.id, status: { in: ["pending", "running"] } } }),
        db.task.findFirst({ where: { agentId: row.id, status: "escalated" }, orderBy: { updatedAt: "desc" } }),
        db.task.findFirst({
          where: { agentId: row.id, error: { not: null }, status: { in: ["failed", "pending"] } },
          orderBy: { updatedAt: "desc" },
        }),
      ]);
      const costRows = costsMonth.filter((c) => c.agentId === row.id);

      const tasks = await Promise.all(
        Object.entries(def?.taskInfo ?? {}).map(async ([type, description]) => {
          const sched = SCHEDULE.find((s) => s.agentId === row.id && s.type === type);
          const lastDone = await db.task.findFirst({
            where: { agentId: row.id, type, status: "done" },
            orderBy: { finishedAt: "desc" },
            select: { finishedAt: true },
          });
          const lastSuccessAt = lastDone?.finishedAt ?? null;
          const upFor = schedulerState.startedAt ? now.getTime() - schedulerState.startedAt.getTime() : 0;
          const staleMs = sched ? sched.staleAfterMin * 60_000 : Infinity;
          const stale =
            Boolean(sched) &&
            row.enabled &&
            (lastSuccessAt ? now.getTime() - lastSuccessAt.getTime() > staleMs : upFor > staleMs);
          return {
            type,
            description,
            schedule: sched?.label ?? "On demand",
            nextRunAt: sched ? nextRunOf(row.id, type) : null,
            lastSuccessAt,
            stale,
          };
        }),
      );

      const blockedBy = (def?.dependsOn ?? [])
        .map((id) => checkById.get(id))
        .filter((c): c is HealthCheck => c?.status === "error");

      let health: AgentHealth;
      let reason: string;
      let error: string | null = null;
      if (!row.enabled) [health, reason] = ["paused", "Paused: scheduled jobs are skipped"];
      else if (escalated) {
        [health, reason] = ["failing", `${escalated.type} failed ${escalated.attempts}× and gave up`];
        error = escalated.error;
      }
      else if (blockedBy.length) [health, reason] = ["blocked", `Needs ${blockedBy.map((c) => c.label).join(", ")}: ${blockedBy[0].detail}`];
      else if (lastFailed) {
        [health, reason] = ["retrying", `${lastFailed.type} failed; retrying automatically`];
        error = lastFailed.error;
      }
      else if (row.status === "running") [health, reason] = ["running", "Working on a task right now"];
      else if (tasks.some((t) => t.stale)) [health, reason] = ["stale", `Hasn't completed ${tasks.filter((t) => t.stale).map((t) => t.type).join(", ")} on schedule`];
      else if (!row.lastRunAt) [health, reason] = ["waiting", "Has not run yet; waiting for its first scheduled job"];
      else [health, reason] = ["ok", "Working normally"];

      return {
        id: row.id,
        name: row.name,
        phase: row.phase,
        business: def?.business ?? "Unknown",
        description: def?.description ?? "",
        enabled: row.enabled,
        health,
        severity: SEVERITY[health],
        reason,
        lastRunAt: row.lastRunAt,
        error,
        guide: error ? diagnose(error) : null,
        dependsOn: (def?.dependsOn ?? []).map((id) => ({
          id,
          label: checkById.get(id)?.label ?? id,
          status: checkById.get(id)?.status ?? "off",
        })),
        stats: { done24h, failed24h, open, costMonth: sum(costRows) },
        tasks,
      };
    }),
  );

  // ---- Problems: everything that failed and isn't resolved ----
  const problemTasks = await db.task.findMany({
    where: {
      OR: [{ status: { in: ["failed", "escalated"] } }, { status: "pending", error: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const nameOf = (id: string) => registry.get(id)?.name ?? id;
  const problems = problemTasks.map((t) => ({
    taskId: t.id,
    agentId: t.agentId,
    agentName: nameOf(t.agentId),
    type: t.type,
    state: t.status === "escalated" ? "needs-you" : "retrying",
    attempts: t.attempts,
    maxAttempts: t.maxAttempts,
    error: t.error,
    payload: t.payload,
    firstSeenAt: t.createdAt,
    updatedAt: t.updatedAt,
    nextRetryAt: t.status === "pending" ? t.runAfter : null,
    guide: diagnose(t.error),
  }));

  const recentIssues = (
    await db.log.findMany({
      where: { level: { in: ["error", "warn"] }, createdAt: { gte: new Date(now.getTime() - 2 * DAY) } },
      orderBy: { createdAt: "desc" },
      take: 30,
    })
  ).map((l) => ({
    id: l.id,
    agentId: l.agentId,
    agentName: nameOf(l.agentId),
    level: l.level,
    message: l.message,
    data: l.data,
    taskId: l.taskId,
    createdAt: l.createdAt,
    guide: diagnose(l.message),
  }));

  const activity = (await db.log.findMany({ orderBy: { createdAt: "desc" }, take: 80 })).map((l) => ({
    id: l.id,
    agentId: l.agentId,
    agentName: nameOf(l.agentId),
    level: l.level,
    message: l.message,
    createdAt: l.createdAt,
  }));

  const approvals = await db.approval.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });

  // ---- Task runs per day, last 14 days ----
  const from = startOfDay(new Date(now.getTime() - 13 * DAY), config.timezone);
  const runs = await db.task.findMany({
    where: { updatedAt: { gte: from }, status: { in: ["done", "failed", "escalated", "dismissed"] } },
    select: { status: true, updatedAt: true, finishedAt: true },
  });
  const days = new Map<string, { date: string; done: number; failed: number }>();
  for (let i = 13; i >= 0; i--) {
    const key = dayKey(new Date(now.getTime() - i * DAY));
    days.set(key, { date: key, done: 0, failed: 0 });
  }
  for (const r of runs) {
    const bucket = days.get(dayKey(r.finishedAt ?? r.updatedAt));
    if (!bucket) continue;
    if (r.status === "done") bucket.done++;
    else bucket.failed++;
  }

  // ---- Overall verdict ----
  const errorChecks = checks.filter((c) => c.status === "error");
  const failingAgents = agents.filter((a) => a.severity === "error");
  const needsYou = problems.filter((p) => p.state === "needs-you").length;
  const warnings = checks.filter((c) => c.status === "warn").length + agents.filter((a) => a.severity === "warn").length;
  const overall: { status: CheckStatus; headline: string; items: string[] } =
    errorChecks.length || failingAgents.length || needsYou
      ? {
          status: "error",
          headline: "Something needs your attention",
          items: [
            ...errorChecks.map((c) => `${c.label}: ${c.detail}`),
            ...failingAgents.map((a) => `${a.name}: ${a.reason}${a.error ? ` (${a.error})` : ""}`),
            ...(needsYou ? [`${needsYou} failed task(s) gave up after retrying`] : []),
          ],
        }
      : warnings
        ? { status: "warn", headline: "Running, with warnings", items: [] }
        : { status: "ok", headline: "All systems working", items: [] };

  return {
    generatedAt: now,
    dryRun: config.dryRun,
    timezone: config.timezone,
    serverStartedAt: schedulerState.startedAt,
    overall,
    checks,
    money,
    agents,
    problems,
    recentIssues,
    approvals,
    activity,
    chart: [...days.values()],
    guides: allGuides(),
  };
}

export type DashboardData = Awaited<ReturnType<typeof buildDashboard>>;
