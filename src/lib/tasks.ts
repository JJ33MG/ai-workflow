import type { AgentDefinition } from "../agents/types.js";
import { db } from "../db.js";
import { agentLogger } from "./logger.js";

export async function enqueue(
  agentId: string,
  type: string,
  payload: Record<string, unknown> = {},
  opts: { runAfter?: Date; maxAttempts?: number } = {},
) {
  return db.task.create({
    data: { agentId, type, payload: payload as object, runAfter: opts.runAfter, maxAttempts: opts.maxAttempts },
  });
}

/** Enqueue unless the same job is already waiting or running (used by cron). */
export async function enqueueOnce(agentId: string, type: string, payload: Record<string, unknown> = {}) {
  const existing = await db.task.findFirst({
    where: { agentId, type, status: { in: ["pending", "running"] } },
  });
  return existing ?? enqueue(agentId, type, payload);
}

export async function runPendingTasks(agents: Map<string, AgentDefinition>, limit = 10): Promise<number> {
  const due = await db.task.findMany({
    where: { status: "pending", runAfter: { lte: new Date() } },
    orderBy: { runAfter: "asc" },
    take: limit,
  });
  let ran = 0;
  for (const task of due) {
    // Claim atomically so two workers never run the same task.
    const claimed = await db.task.updateMany({
      where: { id: task.id, status: "pending" },
      data: { status: "running", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    await runTask(agents, task.id, task.agentId, task.type, task.payload as Record<string, unknown>);
    ran++;
  }
  return ran;
}

async function runTask(
  agents: Map<string, AgentDefinition>,
  taskId: string,
  agentId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  const log = agentLogger(agentId);
  const agent = agents.get(agentId);
  const handler = agent?.handlers[type];
  if (!handler) {
    await db.task.update({
      where: { id: taskId },
      data: { status: "escalated", error: `No handler for ${agentId}:${type}`, finishedAt: new Date() },
    });
    await log.error(`No handler for task type "${type}"`, undefined, taskId);
    return;
  }

  await db.agent.update({ where: { id: agentId }, data: { status: "running" } });
  try {
    const result = await handler(payload, { taskId, log });
    await db.task.update({
      where: { id: taskId },
      data: { status: "done", result: toJson(result), error: null, finishedAt: new Date() },
    });
    await db.agent.update({
      where: { id: agentId },
      data: { status: "idle", lastRunAt: new Date(), lastError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.task.update({ where: { id: taskId }, data: { status: "failed", error: message } });
    await db.agent.update({
      where: { id: agentId },
      data: { status: "error", lastRunAt: new Date(), lastError: message },
    });
    await log.error(`Task ${type} failed: ${message}`, err, taskId);
  }
}

function toJson(value: unknown) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
