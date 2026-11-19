// Routify (the road-trip app, repo roadgem) publishes its numbers at GET /api/stats,
// guarded by the x-stats-token header. Set ROUTIFY_URL and ROUTIFY_STATS_TOKEN in Railway.
import { config } from "../config.js";

export interface RoutifyStats {
  generatedAt: string;
  users: { total: number; last7d: number };
  trips: { total: number; last7d: number };
  plus: number;
  affiliateClicks: { last7d: number; byPartner: Record<string, number> };
  community: { pending: number; approved: number };
}

export interface RoutifyConfig {
  url: string;
  statsToken: string;
}

export const isRoutifyConfigured = (c: RoutifyConfig = config.routify) => Boolean(c.url && c.statsToken);

export async function fetchRoutifyStats(c: RoutifyConfig = config.routify, fetchImpl: typeof fetch = fetch): Promise<RoutifyStats> {
  if (!isRoutifyConfigured(c)) throw new Error("Routify is niet ingesteld: zet ROUTIFY_URL en ROUTIFY_STATS_TOKEN in Railway.");
  const res = await fetchImpl(`${c.url.replace(/\/+$/, "")}/api/stats`, { headers: { "x-stats-token": c.statsToken } });
  if (res.status === 401) throw new Error("Routify weigert de sleutel: ROUTIFY_STATS_TOKEN moet gelijk zijn aan STATS_TOKEN van Routify.");
  if (!res.ok) throw new Error(`Routify-cijfers ophalen mislukt (HTTP ${res.status}).`);
  return (await res.json()) as RoutifyStats;
}

export const routifyLine = (s: RoutifyStats) =>
  `Routify: ${s.users.last7d} nieuwe gebruikers, ${s.trips.last7d} trips, ${s.plus} Plus, ${s.affiliateClicks.last7d} affiliate-kliks deze week`;
