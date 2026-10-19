import { config } from "../config.js";
import { db } from "../db.js";
import { apiSpendTodayCents } from "../lib/budget.js";
import { askText, isClaudeConfigured } from "../lib/claude.js";
import { notify } from "../lib/telegram.js";
import { diagnose } from "../lib/troubleshoot.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "debug";
const STUCK_AFTER_MS = 30 * 60 * 1000;

/** Exponential backoff: 2, 4, 8 … minutes, capped at 1 hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(2 ** attempts, 60) * 60 * 1000;
}

async function check(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const now = Date.now();

  // 1. Tasks stuck in "running" (crash or restart mid-task) count as failed.
  const stuck = await db.task.updateMany({
    where: { status: "running", updatedAt: { lt: new Date(now - STUCK_AFTER_MS) }, id: { not: taskId } },
    data: { status: "failed", error: "Stuck in running state (process restart or hang)" },
  });

  // 2. Retry what can be retried, escalate the rest.
  const failed = await db.task.findMany({ where: { status: "failed" } });
  const escalated: typeof failed = [];
  let retried = 0;
  for (const task of failed) {
    if (task.attempts < task.maxAttempts) {
      await db.task.update({
        where: { id: task.id },
        data: { status: "pending", runAfter: new Date(now + retryDelayMs(task.attempts)) },
      });
      retried++;
    } else {
      await db.task.update({ where: { id: task.id }, data: { status: "escalated", finishedAt: new Date() } });
      escalated.push(task);
    }
  }

  // 3. Mark error logs as seen so they are counted once.
  const errors = await db.log.updateMany({ where: { level: "error", resolved: false }, data: { resolved: true } });

  // 4. Budget early warning.
  const spent = await apiSpendTodayCents();
  const budgetWarning = spent >= config.budget.dailyApiCapCents * 0.8;

  if (escalated.length > 0) {
    let diagnosis = "";
    if (isClaudeConfigured()) {
      try {
        diagnosis = await askText({
          agentId: ID,
          purpose: "debug_diagnosis",
          effort: "low",
          maxTokens: 2000,
          system:
            "You are the on-call engineer for a set of automated e-commerce agents (Etsy, Printful, Telegram, Claude API). " +
            "For each failed task give the most likely cause and the concrete fix in one or two lines. Plain text, no markdown.",
          prompt: escalated.map((t) => `${t.agentId}:${t.type} → ${t.error}`).join("\n"),
        });
      } catch (err) {
        await log.warn(`Could not get diagnosis: ${(err as Error).message}`, undefined, taskId);
      }
    }
    await notify(
      `🔴 ${escalated.length} task(s) failed ${escalated[0].maxAttempts}× and need you:\n` +
        escalated
          .map((t) => {
            const guide = diagnose(t.error);
            const hint = guide.id === "unknown" ? "" : `\n  → ${guide.title}: ${guide.fix[0]}`;
            return `• ${t.agentId}:${t.type} — ${t.error}${hint}`;
          })
          .join("\n") +
        (diagnosis ? `\n\nLikely fix:\n${diagnosis}` : ""),
    );
  }
  if (budgetWarning) {
    await log.warn(`API spend today is ${spent.toFixed(1)} of ${config.budget.dailyApiCapCents} cents`, undefined, taskId);
  }

  const summary = { stuck: stuck.count, retried, escalated: escalated.length, newErrors: errors.count, budgetWarning };
  if (stuck.count || retried || escalated.length) await log.info("Health check", summary, taskId);
  return summary;
}

export const debugAgent: AgentDefinition = {
  id: ID,
  name: "Debug Agent",
  phase: 1,
  business: "All businesses",
  description: "Watches every agent: retries failed tasks, escalates what keeps failing and watches the API budget.",
  dependsOn: ["database", "telegram"],
  handlers: { check },
  taskInfo: {
    check: "Retry failed tasks with backoff, unstick hung tasks, escalate repeated failures with a likely fix",
  },
};
