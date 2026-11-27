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
  if (!isRoutifyConfigured(c)) throw new Error("RoamGem is niet ingesteld: zet ROUTIFY_URL en ROUTIFY_STATS_TOKEN in Railway.");
  const res = await fetchImpl(`${c.url.replace(/\/+$/, "")}/api/stats`, {
    headers: { "x-stats-token": c.statsToken },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new Error("RoamGem weigert de sleutel: ROUTIFY_STATS_TOKEN moet gelijk zijn aan STATS_TOKEN van RoamGem.");
  if (!res.ok) throw new Error(`RoamGem-cijfers ophalen mislukt (HTTP ${res.status}).`);
  const body = (await res.json().catch(() => null)) as RoutifyStats | null;
  if (!isStats(body)) throw new Error("RoamGem gaf een onverwacht antwoord op /api/stats.");
  return body;
}

export const routifyLine = (s: RoutifyStats) =>
  `RoamGem: ${s.users.last7d} nieuwe gebruikers, ${s.trips.last7d} trips, ${s.plus} Plus, ${s.affiliateClicks.last7d} affiliate-kliks deze week`;

const isCount = (n: unknown) => typeof n === "number" && Number.isFinite(n);

function isStats(b: unknown): b is RoutifyStats {
  const s = b as RoutifyStats | null;
  return Boolean(
    s &&
      typeof s.generatedAt === "string" &&
      isCount(s.users?.total) && isCount(s.users?.last7d) &&
      isCount(s.trips?.total) && isCount(s.trips?.last7d) &&
      isCount(s.plus) &&
      isCount(s.affiliateClicks?.last7d) && typeof s.affiliateClicks?.byPartner === "object" &&
      isCount(s.community?.pending) && isCount(s.community?.approved),
  );
}

export type PrizeWinner = { userId: string; name: string; points: number };

const base = (c: RoutifyConfig) => c.url.replace(/\/+$/, "");

/** The explorer of a month (YYYY-MM) on RoamGem, or null when nobody scored. */
export async function fetchPrizeWinner(month: string, c: RoutifyConfig = config.routify, fetchImpl: typeof fetch = fetch): Promise<PrizeWinner | null> {
  if (!isRoutifyConfigured(c)) throw new Error("RoamGem is niet ingesteld: zet ROUTIFY_URL en ROUTIFY_STATS_TOKEN in Railway.");
  const res = await fetchImpl(`${base(c)}/api/community/prize?month=${encodeURIComponent(month)}`, { headers: { "x-stats-token": c.statsToken }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`RoamGem-winnaar ophalen mislukt (HTTP ${res.status}).`);
  const body = (await res.json().catch(() => null)) as { winner?: PrizeWinner | null } | null;
  return body?.winner ?? null;
}

/** Gives the winner a year of Plus (RoamGem grants each month only once). */
export async function grantPrize(userId: string, month: string, c: RoutifyConfig = config.routify, fetchImpl: typeof fetch = fetch): Promise<{ granted: boolean }> {
  const res = await fetchImpl(`${base(c)}/api/community/prize/grant`, {
    method: "POST",
    headers: { "x-stats-token": c.statsToken, "content-type": "application/json" },
    body: JSON.stringify({ userId, month }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Prijs toekennen mislukt (HTTP ${res.status}).`);
  return (await res.json()) as { granted: boolean };
}
