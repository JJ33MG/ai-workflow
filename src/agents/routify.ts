// Routify reports in: once a day the Brain reads the app's numbers so the dashboard and the
// morning briefing show users, trips, Plus members and affiliate clicks next to the shops.
import { z } from "zod";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";
import { askJson, askResearch } from "../lib/claude.js";
import { askGrok, isGrokConfigured } from "../lib/grok.js";
import { requestApproval } from "../lib/approvals.js";
import { notify } from "../lib/telegram.js";
import { PLAYBOOK_KEY, PlaybookSchema, VideoPlanSchema, formatVideoPlan, launchPhase, type Playbook } from "../lib/routifyVideos.js";
import { fetchRoutifyStats, isRoutifyConfigured, routifyLine, type RoutifyConfig } from "../integrations/routify.js";
import type { AgentDefinition, TaskContext } from "./types.js";

export const ROUTIFY_STATS_KEY = "routify.stats";

export async function syncRoutifyStats({ log }: Pick<TaskContext, "log">, c: RoutifyConfig = config.routify, fetchImpl: typeof fetch = fetch) {
  // Not set up yet: nothing to read, and not a failure for the Debug Agent to chase.
  if (!isRoutifyConfigured(c)) return { skipped: "Routify is niet ingesteld" };
  const stats = await fetchRoutifyStats(c, fetchImpl);
  await setSetting(ROUTIFY_STATS_KEY, stats);
  await log.info(routifyLine(stats));
  return stats;
}

const ABOUT =
  "Routify is a road-trip planner for Europe (car, electric car, campervan, caravan). It plans the route in seconds, shows real costs per day " +
  "(fuel, tolls, vignettes, low-emission zones), places to sleep, and 'gems' on the way that are checked on Google (real place, rating, photo), " +
  "plus experiences for families, couples and friends. Core message: AI suggests, Routify checks. Free plan, Plus (EUR 9/month or 59/year), Trip pass (EUR 4.99). " +
  "Soft launch mid-December 2026. Accounts are in Routify's name, never the founder's.";

/** Once a week: what goes viral now on TikTok, Reels and Shorts for travel and apps (Grok on X, Claude on the web). */
async function viralResearch({ log, taskId }: TaskContext) {
  let xNotes = "";
  if (isGrokConfigured()) {
    try {
      const g = await askGrok({
        agentId: "routify",
        purpose: "routify_viral_x",
        xDays: 7,
        system: "You scan X for a small app's marketing. Report concrete examples, numbers and dates. Be brief.",
        prompt:
          "Which short videos about road trips, travel planning, vanlife, travel hacks and travel apps went viral this week? " +
          "Give the formats, hooks (first seconds), lengths, sounds and what made them spread. Also what travel-app launch teasers worked.",
      });
      xNotes = g.text;
    } catch (err) {
      await log.warn(`Grok niet gelukt, verder zonder X: ${(err as Error).message.slice(0, 200)}`, undefined, taskId);
    }
  }
  const web = await askResearch({
    agentId: "routify",
    purpose: "routify_viral_web",
    effort: "low",
    maxSearches: 4,
    system: "You research short-form video marketing (TikTok, Instagram Reels, YouTube Shorts). Prefer sources from the last 3 months.",
    prompt: `${ABOUT}\n\n${xNotes ? `What Grok found on X this week:\n${xNotes}\n\n` : ""}Research what makes travel, road-trip and app videos go viral right now: formats, hooks, length, captions, posting times, trends, and what app launch teasers did well.`,
  });
  const playbook = await askJson({
    agentId: "routify",
    purpose: "routify_playbook",
    effort: "medium",
    schema: PlaybookSchema,
    system: `You are the head of short-video marketing for Routify. ${ABOUT} Turn research into a practical playbook in English. No fake reviews, fake accounts, bots or misleading claims.`,
    prompt: `Research notes:\n${web.text}\n\n${xNotes ? `X notes:\n${xNotes}` : ""}\n\nWrite the playbook: 5-8 formats that fit Routify (with why, a real example and how Routify does it), 10 hooks, do's, don'ts, best posting times (Europe), current trends.`,
  });
  await setSetting(PLAYBOOK_KEY, { ...playbook, at: new Date().toISOString() });
  await notify(`📈 Routify viral-playbook bijgewerkt\n${playbook.formats.slice(0, 5).map((f) => `• ${f.name}: ${f.forRoutify}`).join("\n")}\nHooks: ${playbook.hooks.slice(0, 3).join(" | ")}`);
  await log.info(`Viral-playbook: ${playbook.formats.length} formats, ${playbook.hooks.length} hooks`, undefined, taskId);
  return { formats: playbook.formats.length };
}

/** Three video plans in the playbook's formats; each waits for Jarne's approval before anything is made. */
async function videoPlans({ log, taskId }: TaskContext, count = 3) {
  const playbook = await getSetting<Playbook>(PLAYBOOK_KEY);
  const phase = launchPhase();
  const { plans } = await askJson({
    agentId: "routify",
    purpose: "routify_video_plans",
    effort: "medium",
    schema: z.object({ plans: z.array(VideoPlanSchema) }),
    system:
      `You are Routify's short-video director. ${ABOUT} Plan vertical videos (9:16, 12-30 s) that look premium: clean motion, ` +
      "screen recordings of the real app (the globe that draws the route, the day blocks, costs, checked gems), real places and real numbers, " +
      "bold short on-screen text, no talking head needed. Every claim must be true. Hook in the first 1-2 seconds. English on screen.",
    prompt:
      (playbook ? `This week's playbook:\n${JSON.stringify(playbook).slice(0, 6000)}\n\n` : "") +
      (phase === "teaser"
        ? "Phase: TEASER. Routify is not public yet (soft launch mid-December). Announce it: build curiosity, show the app, ask people to follow for the launch. At least one plan uses series 'teaser'."
        : "Phase: LIVE. Send people to plan their trip on Routify.") +
      `\nWrite ${count} different plans, each from a different series (teaser, cost, gems, route, ai-checks, behind).`,
  });
  const made = plans.slice(0, count);
  for (const [i, p] of made.entries()) {
    await requestApproval({ agentId: "routify", kind: "routify_video", title: `Routify-video: ${p.title}`, details: formatVideoPlan(p, i + 1), payload: { plan: p } });
  }
  await log.info(`Routify-video's: ${made.map((p) => p.title).join(" · ")}`, undefined, taskId);
  return { plans: made.length, phase };
}

export const routifyAgent: AgentDefinition = {
  id: "routify",
  name: "Routify",
  phase: 5,
  businessId: "roadgem",
  description: "Leest elke ochtend de cijfers van de Routify-app en maakt de korte video's: wekelijks onderzoek naar wat viraal gaat, en videoplannen die op jouw akkoord wachten.",
  dependsOn: ["routify"],
  handlers: {
    sync_stats: (_p, ctx) => syncRoutifyStats(ctx),
    viral_research: (_p, ctx) => viralResearch(ctx),
    video_plans: (_p, ctx) => videoPlans(ctx),
  },
  taskInfo: {
    sync_stats: "Haalt de cijfers van de afgelopen week op bij Routify.",
    viral_research: "Elke maandag: wat gaat nu viraal op TikTok, Reels en Shorts (Grok op X, Claude op het web) en maakt er een playbook van",
    video_plans: "Ma, wo, vr: 3 videoplannen (hook, scènes per seconde, tekst, caption, hashtags) die op jouw akkoord wachten",
  },
  chatTasks: ["sync_stats", "viral_research", "video_plans"],
  maxAttempts: { viral_research: 2, video_plans: 2 },
};
