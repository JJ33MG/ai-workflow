// Etsy Stats and Etsy Ads exports Jarne uploads on the dashboard. Etsy's API has no visit or Ads numbers,
// so these uploads are how the marketing agent learns them: the facts are stored, written to the shared
// memory, and the marketing strategy is reviewed with them straight away.
import { z } from "zod";
import { db, getSetting, setSetting } from "../db.js";
import { type Attachment, attachmentBlocks } from "./attachments.js";
import { askJson } from "./claude.js";
import { enqueue } from "./tasks.js";

export const STATS_KEY = "etsy.stats";

const StatsSchema = z.object({
  period: z.string(),
  visits: z.number().nullable(),
  orders: z.number().nullable(),
  revenueEur: z.number().nullable(),
  conversionPct: z.number().nullable(),
  sources: z.array(z.object({ name: z.string(), visits: z.number() })),
  ads: z.object({
    on: z.boolean().nullable(),
    since: z.string().nullable(),
    dailyBudgetEur: z.number().nullable(),
    spendEur: z.number().nullable(),
    clicks: z.number().nullable(),
    views: z.number().nullable(),
    orders: z.number().nullable(),
  }),
  topListings: z.array(z.object({ title: z.string(), visits: z.number().nullable(), favorites: z.number().nullable(), orders: z.number().nullable() })),
  facts: z.array(z.string()),
});
export type EtsyStats = z.infer<typeof StatsSchema> & { uploadedAt: string; files: string[]; note: string };

/** Reads an upload (files and/or Jarne's note), stores it, writes the facts to the shared memory and starts a strategy review. */
export async function importEtsyStats(files: Attachment[], note: string): Promise<EtsyStats> {
  const blocks = await attachmentBlocks(files);
  const stats = await askJson({
    agentId: "marketing",
    purpose: "etsy_stats_import",
    effort: "low",
    schema: StatsSchema,
    blocks,
    system:
      "You read Etsy Stats and Etsy Ads exports (CSV, screenshots, PDF) for a small Etsy shop and extract the numbers exactly as shown. " +
      "Use null when a number is not in the files. Never guess. 'facts' are 3 to 8 short Dutch sentences a marketing lead must know " +
      "(e.g. 'Etsy Ads staan aan sinds 17 november, €2 per dag', 'Etsy-zoekopdrachten: 0 bezoeken in november'). " +
      "Jarne's own note is true and wins over older assumptions.",
    prompt: `Jarne's note: ${note || "(none)"}\nFiles: ${files.map((f) => f.name).join(", ") || "(none)"}`,
  });
  const saved: EtsyStats = { ...stats, uploadedAt: new Date().toISOString(), files: files.map((f) => f.name), note };
  const history = (await getSetting<EtsyStats[]>(`${STATS_KEY}.history`)) ?? [];
  await setSetting(STATS_KEY, saved);
  await setSetting(`${STATS_KEY}.history`, [saved, ...history].slice(0, 24));
  // The shared memory every agent reads: one entry per fact, the newest upload replaces the previous one.
  await db.knowledge.deleteMany({ where: { kind: "etsy_stats" } });
  for (const fact of stats.facts) {
    await db.knowledge.create({ data: { agentId: "marketing", kind: "etsy_stats", title: fact.slice(0, 120), body: `${fact} (Etsy-cijfers van ${stats.period}, geüpload ${saved.uploadedAt.slice(0, 10)})`, tags: ["etsy", "stats", "ads"], score: 3 } });
  }
  await enqueue("marketing", "marketing_review", { instructions: `Nieuwe Etsy-cijfers van Jarne (${stats.period}). Pas de strategie hierop aan: ${stats.facts.join(" ")}` });
  return saved;
}

/** The latest upload as one line for the marketing prompt. */
export async function latestStatsBrief(): Promise<string> {
  const s = await getSetting<EtsyStats>(STATS_KEY);
  if (!s) return "Jarne has not uploaded Etsy Stats or Ads numbers yet.";
  return `Jarne's latest Etsy Stats/Ads upload (${s.period}, uploaded ${s.uploadedAt.slice(0, 10)}): ${JSON.stringify({ visits: s.visits, orders: s.orders, sources: s.sources, ads: s.ads, facts: s.facts })}`;
}
