import cron from "node-cron";
import { agents } from "./agents/index.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { enqueueOnce, runPendingTasks } from "./lib/tasks.js";

const SCHEDULE: { cron: string; agentId: string; type: string }[] = [
  { cron: "0 7 * * *", agentId: "ceo", type: "briefing" }, // 07:00 Prague
  { cron: "*/30 * * * *", agentId: "debug", type: "check" },
  { cron: "0 10 * * *", agentId: "etsy-pod", type: "create_listings" },
  { cron: "15 * * * *", agentId: "etsy-pod", type: "sync_sales" },
];

export function startScheduler(): () => void {
  const jobs = SCHEDULE.map((s) =>
    cron.schedule(
      s.cron,
      async () => {
        const agent = await db.agent.findUnique({ where: { id: s.agentId } });
        if (agent?.enabled) await enqueueOnce(s.agentId, s.type);
      },
      { timezone: config.timezone, name: `${s.agentId}:${s.type}` },
    ),
  );

  // Worker: drain the task queue every 15 seconds, one batch at a time.
  let busy = false;
  const worker = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runPendingTasks(agents);
    } catch (err) {
      console.error("[worker] error:", err);
    } finally {
      busy = false;
    }
  }, 15_000);

  return () => {
    jobs.forEach((j) => j.stop());
    clearInterval(worker);
  };
}
