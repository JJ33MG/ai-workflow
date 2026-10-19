import { db } from "../db.js";

type Level = "info" | "warn" | "error";

export interface AgentLogger {
  info(message: string, data?: unknown, taskId?: string): Promise<void>;
  warn(message: string, data?: unknown, taskId?: string): Promise<void>;
  error(message: string, data?: unknown, taskId?: string): Promise<void>;
}

/** Every log line is mirrored to stdout and written to the Log table. */
export function agentLogger(agentId: string): AgentLogger {
  const write = async (level: Level, message: string, data?: unknown, taskId?: string) => {
    const line = `[${new Date().toISOString()}] [${agentId}] ${level.toUpperCase()} ${message}`;
    (level === "error" ? console.error : console.log)(line);
    try {
      await db.log.create({
        data: { agentId, level, message, data: toJson(data), taskId },
      });
    } catch (err) {
      console.error(`[logger] failed to persist log for ${agentId}:`, err);
    }
  };
  return {
    info: (m, d, t) => write("info", m, d, t),
    warn: (m, d, t) => write("warn", m, d, t),
    error: (m, d, t) => write("error", m, d, t),
  };
}

function toJson(data: unknown) {
  if (data === undefined) return undefined;
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack };
  return JSON.parse(JSON.stringify(data));
}
