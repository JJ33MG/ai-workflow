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
      "Rewrite the title and 13 tags of the live Etsy listings with the weakest signal (fewest favourites and orders per day; input: listingCount, 3-10). " +
      "Free, done automatically, measured after 14 days against the untouched listings and undone if the signal dropped.",
    auto: true,
  },
  {
    id: "etsy_niche_focus",
    businesses: ["etsy-pod"],
    description:
      "Tell the Etsy agent which gift niches to design more mugs for (input: niches, 1-5, e.g. based on favourites and orders). " +
      "Free, done automatically through the shared brain; judged at the next review.",
    auto: true,
  },
  {
    id: "campaign",
    businesses: "any",
    description:
      "Start a seasonal campaign (input: campaign {name, direction, from, until} with dates YYYY-MM-DD): while it runs, the business's " +
      "agents follow the direction (themes to design, seasonal search terms, order-by dates to mention). Plan holidays 2-4 weeks ahead. Free.",
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

// ---------- campaigns ----------

/**
 * A seasonal push (Black Friday, Christmas, Mother's Day …): while it runs, the business's agents
 * follow its direction (what to design, which search terms, what to say in descriptions).
 */
export interface Campaign {
  id: string;
  businessId: string;
  name: string;
  direction: string;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  until: string;
  createdAt: string;
}

const CAMPAIGNS_KEY = "marketing.campaigns";
export const getCampaigns = async () => (await getSetting<Campaign[]>(CAMPAIGNS_KEY)) ?? [];

const dayOf = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: config.timezone }); // YYYY-MM-DD
export const todayIso = (now = new Date()) => dayOf(now);

export async function activeCampaigns(businessId: string, now = new Date()): Promise<Campaign[]> {
  const today = dayOf(now);
  return (await getCampaigns()).filter((c) => c.businessId === businessId && c.from <= today && today <= c.until);
}

/** Adds a campaign; one that ended more than 60 days ago is dropped to keep the list short. */
export async function addCampaign(c: Omit<Campaign, "id" | "createdAt">, now = new Date()): Promise<Campaign> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.from) || !/^\d{4}-\d{2}-\d{2}$/.test(c.until) || c.until < c.from) {
    throw new Error("Campaign dates must be YYYY-MM-DD and until must not be before from");
  }
  const cutoff = dayOf(new Date(now.getTime() - 60 * DAY));
  const campaign: Campaign = { ...c, id: `c${now.getTime().toString(36)}`, createdAt: now.toISOString() };
  const list = (await getCampaigns()).filter((x) => x.until >= cutoff);
  await setSetting(CAMPAIGNS_KEY, [...list, campaign]);
  return campaign;
}

/** One line per running campaign, for prompts. */
export async function campaignBrief(businessId: string, now = new Date()): Promise<string> {
  const active = await activeCampaigns(businessId, now);
  return active.length
    ? `Running campaigns (follow them):\n${active.map((c) => `- ${c.name} (until ${c.until}): ${c.direction}`).join("\n")}`
    : "No campaign running.";
}

// ---------- numbers ----------

/**
 * Etsy's API has no visit counts (Jarne sees visits and ad clicks only in Etsy itself). What it does
 * give per listing: favourites, and our own orders. An order counts as much as several favourites.
 */
export const ORDER_WEIGHT = 5;

export interface ListingStat {
  id: string;
  etsyListingId: string;
  title: string;
  niche: string;
  tags: string[];
  favorites: number;
  orders: number;
  /** favourites + ORDER_WEIGHT × orders */
  signal: number;
  ageDays: number;
  signalPerDay: number;
  source: string;
}

/** Units sold per Etsy listing id, from the recorded Etsy receipts. */
export async function ordersByEtsyListing(): Promise<Map<string, number>> {
  const sales = await db.sale.findMany({ where: { source: "etsy" }, select: { data: true } });
  const sold = new Map<string, number>();
  for (const s of sales) {
    const tx = (s.data as { transactions?: { listing_id: number; quantity: number }[] } | null)?.transactions ?? [];
    for (const t of tx) sold.set(String(t.listing_id), (sold.get(String(t.listing_id)) ?? 0) + t.quantity);
  }
  return sold;
}

/** The signal of each Etsy listing right now, for measuring plays. */
export async function signalByEtsyListing(etsyListingIds: string[]): Promise<Record<string, number>> {
  const [rows, orders] = await Promise.all([
    db.listing.findMany({ where: { etsyListingId: { in: etsyListingIds }, status: "active" }, select: { etsyListingId: true, favorites: true } }),
    ordersByEtsyListing(),
  ]);
  return Object.fromEntries(rows.map((r) => [r.etsyListingId!, r.favorites + ORDER_WEIGHT * (orders.get(r.etsyListingId!) ?? 0)]));
}

/** Live Etsy listings with their signal rate, weakest first. */
export async function liveListingStats(now = new Date()): Promise<ListingStat[]> {
  const [rows, orders] = await Promise.all([
    db.listing.findMany({ where: { status: "active", etsyListingId: { not: null } } }),
    ordersByEtsyListing(),
  ]);
  return rows
    .map((l) => {
      const ageDays = Math.max(1, (now.getTime() - l.createdAt.getTime()) / DAY);
      const sold = orders.get(l.etsyListingId!) ?? 0;
      const signal = l.favorites + ORDER_WEIGHT * sold;
      return {
        id: l.id,
        etsyListingId: l.etsyListingId!,
        title: l.title,
        niche: l.niche,
        tags: l.tags,
        favorites: l.favorites,
        orders: sold,
        signal,
        ageDays: Math.round(ageDays),
        signalPerDay: signal / ageDays,
        source: l.source,
      };
    })
    .sort((a, b) => a.signalPerDay - b.signalPerDay);
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
    const byNiche = new Map<string, { listings: number; favorites: number; orders: number }>();
    for (const s of stats) {
      const n = byNiche.get(s.niche) ?? { listings: 0, favorites: 0, orders: 0 };
      n.listings++;
      n.orders += s.orders;
      n.favorites += s.favorites;
      byNiche.set(s.niche, n);
    }
    // Per platform: how many listings were shared, and whether they get more Etsy visits than the rest.
    const posts = await db.socialPost.findMany({ where: { businessId }, select: { platform: true, refId: true } });
    const rate = (xs: ListingStat[]) => (xs.length ? Math.round((xs.reduce((n, s) => n + s.signalPerDay, 0) / xs.length) * 100) / 100 : null);
    const social = Object.fromEntries(
      [...new Set(posts.map((p) => p.platform))].map((platform) => {
        const shared = new Set(posts.filter((p) => p.platform === platform).map((p) => p.refId));
        return [
          platform,
          {
            sharedListings: shared.size,
            avgSignalPerDayShared: rate(stats.filter((s) => shared.has(s.id))),
            avgSignalPerDayNotShared: rate(stats.filter((s) => !shared.has(s.id))),
          },
        ];
      }),
    );
    const brief = (s: ListingStat) => ({ title: s.title, niche: s.niche, favorites: s.favorites, orders: s.orders, ageDays: s.ageDays });
    return {
      ...base,
      liveListings: stats.length,
      draftsNotLive: drafts,
      visits: "not available: Etsy's API has no visit counts; Jarne sees visits and Etsy Ads clicks only in Etsy itself",
      totalOrders: stats.reduce((n, s) => n + s.orders, 0),
      totalFavorites: stats.reduce((n, s) => n + s.favorites, 0),
      bestListings: [...stats].reverse().slice(0, 5).map(brief),
      weakestListings: stats.slice(0, 5).map(brief),
      social,
      socialNote: "Pinterest, Facebook and Instagram post daily by themselves once connected; no play needed for them.",
      niches: [...byNiche.entries()].map(([niche, n]) => ({ niche, ...n })).sort((a, b) => b.favorites + ORDER_WEIGHT * b.orders - (a.favorites + ORDER_WEIGHT * a.orders)).slice(0, 15),
    };
  }

  if (businessId === "kdp-coloring") {
    const books = await db.coloringBook.findMany({ select: { title: true, theme: true, status: true } });
    return { ...base, books, note: "Amazon has no API for sales or page views; sales are not tracked yet." };
  }

  return base;
}

// ---------- measuring ----------

// A type (not an interface) so it can be stored as JSON by Prisma. `views` holds the listing's
// signal (favourites + ORDER_WEIGHT × orders); the name stays for plays saved before the change.
export type ViewSnapshot = {
  listingId: string;
  views: number;
  ageDays: number;
};

/**
 * Lift of the changed listings over the untouched ones (the control). Rates are signal per day
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

/** Too few favourites and orders say nothing; otherwise ±20% counts as a real change. */
export const MIN_SIGNAL = 5;
export function verdictFor(liftPct: number | null, signalAfter: number): "worked" | "no_effect" | "worse" | "unclear" {
  if (liftPct === null || signalAfter < MIN_SIGNAL) return "unclear";
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
