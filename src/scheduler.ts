import cron, { type ScheduledTask } from "node-cron";
import { agents } from "./agents/index.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { enqueueOnce, runPendingTasks } from "./lib/tasks.js";

export interface ScheduleEntry {
  cron: string;
  agentId: string;
  type: string;
  label: string;
  /** If the last successful run is older than this, the job counts as stale. */
  staleAfterMin: number;
}

export const SCHEDULE: ScheduleEntry[] = [
  { cron: "0 7 * * *", agentId: "ceo", type: "briefing", label: "Daily at 07:00", staleAfterMin: 26 * 60 },
  { cron: "*/30 * * * *", agentId: "debug", type: "check", label: "Every 30 minutes", staleAfterMin: 70 },
  { cron: "0 10 * * *", agentId: "etsy-pod", type: "create_listings", label: "Daily at 10:00", staleAfterMin: 26 * 60 },
  { cron: "15 * * * *", agentId: "etsy-pod", type: "sync_sales", label: "Hourly at :15", staleAfterMin: 130 },
];

/** Live state of this process, read by the dashboard. */
export const schedulerState = {
  startedAt: null as Date | null,
  lastWorkerTickAt: null as Date | null,
  jobs: new Map<string, ScheduledTask>(),
};

export function nextRunOf(agentId: string, type: string): Date | null {
  return schedulerState.jobs.get(`${agentId}:${type}`)?.getNextRun() ?? null;
}

export function startScheduler(): () => void {
  schedulerState.startedAt = new Date();
  for (const s of SCHEDULE) {
    const job = cron.schedule(
      s.cron,
      async () => {
        const agent = await db.agent.findUnique({ where: { id: s.agentId } });
        if (agent?.enabled) await enqueueOnce(s.agentId, s.type);
      },
      { timezone: config.timezone, name: `${s.agentId}:${s.type}` },
    );
    schedulerState.jobs.set(`${s.agentId}:${s.type}`, job);
  }

  // Worker: drain the task queue every 15 seconds, one batch at a time.
  let busy = false;
  const worker = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runPendingTasks(agents);
      schedulerState.lastWorkerTickAt = new Date();
    } catch (err) {
      console.error("[worker] error:", err);
    } finally {
      busy = false;
    }
  }, 15_000);

  return () => {
    schedulerState.jobs.forEach((j) => j.stop());
    schedulerState.jobs.clear();
    clearInterval(worker);
  };
}
