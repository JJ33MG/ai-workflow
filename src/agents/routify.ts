// Routify reports in: once a day the Brain reads the app's numbers so the dashboard and the
// morning briefing show users, trips, Plus members and affiliate clicks next to the shops.
import { config } from "../config.js";
import { setSetting } from "../db.js";
import { fetchRoutifyStats, routifyLine, type RoutifyConfig } from "../integrations/routify.js";
import type { AgentDefinition, TaskContext } from "./types.js";

export const ROUTIFY_STATS_KEY = "routify.stats";

export async function syncRoutifyStats({ log }: Pick<TaskContext, "log">, c: RoutifyConfig = config.routify, fetchImpl: typeof fetch = fetch) {
  const stats = await fetchRoutifyStats(c, fetchImpl);
  await setSetting(ROUTIFY_STATS_KEY, stats);
  await log.info(routifyLine(stats));
  return stats;
}

export const routifyAgent: AgentDefinition = {
  id: "routify",
  name: "Routify",
  phase: 5,
  businessId: "roadgem",
  description: "Leest elke ochtend de cijfers van de Routify-app: nieuwe gebruikers, trips, Plus-leden en affiliate-kliks.",
  dependsOn: ["routify"],
  handlers: { sync_stats: (_p, ctx) => syncRoutifyStats(ctx) },
  taskInfo: { sync_stats: "Haalt de cijfers van de afgelopen week op bij Routify." },
  chatTasks: ["sync_stats"],
};
