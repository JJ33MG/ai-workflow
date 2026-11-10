// Marketing building blocks: the tactics the marketing agent can use per business, the numbers
// it looks at, and how a play is measured. The agent itself is in src/agents/marketing.ts.
import { BUSINESSES, businessById, type BusinessDefinition } from "../businesses.js";
import { config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import { startOfDay, toEurCents } from "./money.js";

const DAY = 24 * 60 * 60 * 1000;

export interface Tactic {
  id: string;
  /** Businesses it works for; "any" = every business. */
  businesses: string[] | "any";
  /** Shown to Claude when it plans, and on the dashboard. */
  description: string;
  /** The agent carries it out itself (always free). Otherwise it becomes a to-do for Jarne. */
  auto: boolean;
}

export const TACTICS: Tactic[] = [
  {
    id: "etsy_seo_refresh",
    businesses: ["etsy-pod"],
    description:
      "Rewrite the title and 13 tags of the live Etsy listings with the fewest views per day (input: listingCount, 3-10). " +
      "Free, done automatically, measured after 14 days against the untouched listings and undone if views dropped.",
    auto: true,
  },
  {
    id: "etsy_niche_focus",
    businesses: ["etsy-pod"],
    description:
      "Tell the Etsy agent which gift niches to design more mugs for (input: niches, 1-5, e.g. based on views and favourites). " +
      "Free, done automatically through the shared brain; judged at the next review.",
    auto: true,
  },
  {
    id: "manual",
    businesses: "any",
    description:
      "A step Jarne does himself (e.g. Etsy Ads with a small daily budget, Amazon ads, a social post, a shop banner; Pinterest, Facebook and Instagram posting is automatic once connected). " +
      "Give clear step-by-step instructions and any cost. Anything that costs money is always manual and Jarne's decision.",
    auto: false,
  },
];

export const tacticsFor = (businessId: string) =>
  TACTICS.filter((t) => t.businesses === "any" || t.businesses.includes(businessId));

/** Businesses the marketing agent works for: started (an agent works for it) and not parked. */
export function marketedBusinesses(agentBusinessIds: (string | null)[]): BusinessDefinition[] {
  return BUSINESSES.filter((b) => !b.parked && agentBusinessIds.includes(b.id));
}

// ---------- strategy ----------

export interface Strategy {
  summary: string;
  focus: string[];
  channels: { name: string; role: string; when: "now" | "later" }[];
  updatedAt: string;
}

const strategyKey = (businessId: string) => `marketing.strategy.${businessId}`;
export const getStrategy = (businessId: string) => getSetting<Strategy>(strategyKey(businessId));
export const saveStrategy = (businessId: string, s: Strategy) => setSetting(strategyKey(businessId), s);

// ---------- numbers ----------

export interface ListingStat {
  id: string;
  etsyListingId: string;
  title: string;
  niche: string;
  tags: string[];
  views: number;
  favorites: number;
  ageDays: number;
  viewsPerDay: number;
  source: string;
}

/** Live Etsy listings with their view rate, lowest first. */
export async function liveListingStats(now = new Date()): Promise<ListingStat[]> {
  const rows = await db.listing.findMany({ where: { status: "active", etsyListingId: { not: null } } });
  return rows
    .map((l) => {
      const ageDays = Math.max(1, (now.getTime() - l.createdAt.getTime()) / DAY);
      return {
        id: l.id,
        etsyListingId: l.etsyListingId!,
        title: l.title,
        niche: l.niche,
        tags: l.tags,
        views: l.views,
        favorites: l.favorites,
        ageDays: Math.round(ageDays),
        viewsPerDay: l.views / ageDays,
        source: l.source,
      };
    })
    .sort((a, b) => a.viewsPerDay - b.viewsPerDay);
}

/** The numbers Claude sees for one business when it plans. */
export async function businessMetrics(businessId: string, teamAgentIds: string[], now = new Date()) {
  const from = startOfDay(new Date(now.getTime() - 29 * DAY), config.timezone);
  const [sales, costs] = await Promise.all([
    db.sale.findMany({ where: { agentId: { in: teamAgentIds }, occurredAt: { gte: from } } }),
    db.cost.findMany({ where: { agentId: { in: teamAgentIds }, occurredAt: { gte: from } } }),
  ]);
  const base = {
    last30Days: {
      sales: sales.length,
      revenueEurCents: Math.round(sales.reduce((n, s) => n + toEurCents(s.amountCents, s.currency), 0)),
      costsEurCents: Math.round(costs.reduce((n, c) => n + toEurCents(c.amountCents, c.currency), 0)),
    },
  };

  if (businessId === "etsy-pod") {
    const stats = await liveListingStats(now);
    const drafts = await db.listing.count({ where: { status: { in: ["draft", "uploaded"] } } });
    const byNiche = new Map<string, { listings: number; views: number; favorites: number }>();
    for (const s of stats) {
      const n = byNiche.get(s.niche) ?? { listings: 0, views: 0, favorites: 0 };
      n.listings++;
      n.views += s.views;
      n.favorites += s.favorites;
      byNiche.set(s.niche, n);
    }
    // Per platform: how many listings were shared, and whether they get more Etsy visits than the rest.
    const posts = await db.socialPost.findMany({ where: { businessId }, select: { platform: true, refId: true } });
    const rate = (xs: ListingStat[]) => (xs.length ? Math.round((xs.reduce((n, s) => n + s.viewsPerDay, 0) / xs.length) * 100) / 100 : null);
    const social = Object.fromEntries(
      [...new Set(posts.map((p) => p.platform))].map((platform) => {
        const shared = new Set(posts.filter((p) => p.platform === platform).map((p) => p.refId));
        return [
          platform,
          {
            sharedListings: shared.size,
            avgViewsPerDayShared: rate(stats.filter((s) => shared.has(s.id))),
            avgViewsPerDayNotShared: rate(stats.filter((s) => !shared.has(s.id))),
          },
        ];
      }),
    );
    const brief = (s: ListingStat) => ({ title: s.title, niche: s.niche, views: s.views, favorites: s.favorites, ageDays: s.ageDays });
    return {
      ...base,
      liveListings: stats.length,
      draftsNotLive: drafts,
      totalViews: stats.reduce((n, s) => n + s.views, 0),
      totalFavorites: stats.reduce((n, s) => n + s.favorites, 0),
      bestListings: [...stats].reverse().slice(0, 5).map(brief),
      weakestListings: stats.slice(0, 5).map(brief),
      social,
      socialNote: "Pinterest, Facebook and Instagram post daily by themselves once connected; no play needed for them.",
      niches: [...byNiche.entries()].map(([niche, n]) => ({ niche, ...n })).sort((a, b) => b.views - a.views).slice(0, 15),
    };
  }

  if (businessId === "kdp-coloring") {
    const books = await db.coloringBook.findMany({ select: { title: true, theme: true, status: true } });
    return { ...base, books, note: "Amazon has no API for sales or page views; sales are not tracked yet." };
  }

  return base;
}

// ---------- measuring ----------

// A type (not an interface) so it can be stored as JSON by Prisma.
export type ViewSnapshot = {
  listingId: string;
  views: number;
  ageDays: number;
};

/**
 * Lift of the changed listings over the untouched ones (the control). Rates are views per day
 * before the change (over the listing's life) and after it (since the change). Comparing with
 * the control takes out what happened to the whole shop (season, an Etsy algorithm change).
 */
export function computeLift(
  target: { before: ViewSnapshot[]; viewsNow: Record<string, number> },
  control: { before: ViewSnapshot[]; viewsNow: Record<string, number> },
  daysSince: number,
): { liftPct: number | null; targetViewsAfter: number; controlViewsAfter: number } {
  const ratio = (g: typeof target) => {
    let before = 0;
    let after = 0;
    let viewsAfter = 0;
    for (const s of g.before) {
      const now = g.viewsNow[s.listingId];
      if (now === undefined) continue; // listing ended
      before += s.views / Math.max(1, s.ageDays);
      after += Math.max(0, now - s.views) / Math.max(1, daysSince);
      viewsAfter += Math.max(0, now - s.views);
    }
    return { r: before > 0 ? after / before : null, viewsAfter };
  };
  const t = ratio(target);
  const c = ratio(control);
  if (t.r === null) return { liftPct: null, targetViewsAfter: t.viewsAfter, controlViewsAfter: c.viewsAfter };
  const lift = c.r ? t.r / c.r - 1 : t.r - 1;
  return { liftPct: Math.round(lift * 1000) / 10, targetViewsAfter: t.viewsAfter, controlViewsAfter: c.viewsAfter };
}

/** Too few views say nothing; otherwise ±20% counts as a real change. */
export function verdictFor(liftPct: number | null, viewsAfter: number): "worked" | "no_effect" | "worse" | "unclear" {
  if (liftPct === null || viewsAfter < 20) return "unclear";
  if (liftPct >= 20) return "worked";
  if (liftPct <= -20) return "worse";
  return "no_effect";
}

export const MEASURE_AFTER_DAYS = 14;

/** Plays that worked in other businesses: what the agent may adapt for this one. */
export async function provenElsewhere(businessId: string) {
  const plays = await db.marketingPlay.findMany({
    where: { verdict: "worked", businessId: { not: businessId } },
    orderBy: { measuredAt: "desc" },
    take: 10,
  });
  return plays.map((p) => ({
    id: p.id,
    business: businessById(p.businessId)?.name ?? p.businessId,
    tactic: p.tactic,
    title: p.title,
    why: p.why,
    liftPct: p.liftPct,
    note: p.note,
  }));
}
