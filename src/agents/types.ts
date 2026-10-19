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
  /** Which business (or "All businesses") the agent works for; shown on the dashboard. */
  business: string;
  description: string;
  /** Integrations the agent needs, by health-check id (see lib/health.ts). */
  dependsOn: string[];
  handlers: Record<string, TaskHandler>;
  /** Plain-language description of each task type, keyed like `handlers`. */
  taskInfo: Record<string, string>;
}
