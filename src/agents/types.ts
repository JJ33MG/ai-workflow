import type { AgentLogger } from "../lib/logger.js";

export interface TaskContext {
  taskId?: string;
  log: AgentLogger;
}

export type TaskHandler = (payload: Record<string, unknown>, ctx: TaskContext) => Promise<unknown>;

export interface AgentDefinition {
  id: string;
  name: string;
  phase: number;
  handlers: Record<string, TaskHandler>;
}
