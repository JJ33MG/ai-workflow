// Scout: every day new business ideas, ways to earn more, trends and improvements to the Brain itself,
// researched on the live web and shaped by Jarne's earlier votes. It never spends money and never
// changes code: "Build it" marks an idea for Claude Code to build in a session.
import { z } from "zod";
import { BUSINESSES } from "../businesses.js";
import { planWithStatus } from "../brain.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { askJson, askResearch } from "../lib/claude.js";
import { IDEA_KINDS, formatIdea, ideaButtons, tasteDigest } from "../lib/ideas.js";
import { notify } from "../lib/telegram.js";
import { collectBriefingData, formatBriefing } from "./ceo.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "scout";

const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      kind: z.enum(IDEA_KINDS),
      title: z.string(),
      summary: z.string(),
      whyNow: z.string(),
      money: z.string(),
      cost: z.string(),
      effort: z.string(),
      firstStep: z.string(),
      risks: z.string(),
      outsideBox: z.boolean(),
      sourceUrls: z.array(z.string()),
    }),
  ),
});

const ABOUT_JARNE =
  "Jarne is a Belgian solo founder living in Prague. He runs an 'AI Agency Brain': Claude agents that run online businesses for him. " +
  "He has little time and a small budget, wants passive income that agents can run, and does not want his personal identity linked " +
  "to the shops. Rules: no fake reviews, fake users, spam, trademark copying or anything that risks an account ban; spending money " +
  "always needs his approval.";

/** What the Brain does today, for the researcher: businesses, numbers, open steps and the last ideas. */
async function brainSnapshot(): Promise<string> {
  const [briefing, plan, recent] = await Promise.all([
    collectBriefingData(),
    planWithStatus(),
    db.idea.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { title: true } }),
  ]);
  const businesses = BUSINESSES.map((b) => `- ${b.name} (${b.kind}${b.parked ? ", parked" : ""}): ${b.description}`).join("\n");
  const open = plan.filter((p) => p.status !== "done").map((p) => `- [${p.owner}] ${p.phase}: ${p.title}`).join("\n");
  return [
    `Businesses:\n${businesses}`,
    `Today's numbers and agents:\n${formatBriefing(briefing)}`,
    `Open steps in the plan:\n${open}`,
    `Ideas already proposed (do not repeat):\n${recent.map((r) => `- ${r.title}`).join("\n") || "- none yet"}`,
  ].join("\n\n");
}

async function decidedTaste(): Promise<string> {
  const decided = await db.idea.findMany({
    where: { status: { in: ["build", "later", "no", "done"] } },
    orderBy: { decidedAt: "desc" },
    take: 30,
    select: { title: true, status: true, feedback: true },
  });
  return tasteDigest(decided);
}

type Mode = { origin: "daily" | "weekly" | "topic"; count: number; focus: string };

async function scout(mode: Mode, { log, taskId }: TaskContext) {
  const [snapshot, taste] = await Promise.all([brainSnapshot(), decidedTaste()]);
  const today = new Date().toISOString().slice(0, 10);

  const research = await askResearch({
    agentId: ID,
    purpose: `scout_research_${mode.origin}`,
    effort: "medium",
    maxSearches: 8,
    system:
      `You are Scout, the opportunity researcher of Jarne's AI Agency Brain. ${ABOUT_JARNE} ` +
      "Research on the live web and write concise notes with facts, numbers and dates. Prefer recent sources (last 3 months).",
    prompt:
      `Today: ${today}.\n\n${snapshot}\n\nJarne's earlier votes (learn his taste from them):\n${taste}\n\n` +
      `Research task: ${mode.focus}`,
  });

  const { ideas } = await askJson({
    agentId: ID,
    purpose: `scout_ideas_${mode.origin}`,
    effort: "medium",
    schema: IdeasSchema,
    system:
      `You are Scout. ${ABOUT_JARNE} Turn research notes into concrete, honest ideas Jarne can act on. ` +
      "Kinds: new_business (a new business the agents could run), grow (earn more from an existing business), " +
      "brain (make the Brain itself better: automate something manual, fix what keeps failing, a new agent or integration), " +
      "trend (a timely trend or season to ride). Be specific and realistic about money (a range), cost, effort (low/medium/high) " +
      "and risks; never promise income. The first step is something Jarne or the agents can do this week. " +
      "Write in Dutch, short sentences. sourceUrls only from the research notes.",
    prompt:
      `Research notes:\n${research.text}\n\nSources found:\n${research.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}\n\n` +
      `Write exactly ${mode.count} ideas. ${mode.origin === "daily" ? "Mix the kinds; exactly one has outsideBox=true: something Jarne would not think of himself." : ""}` +
      `\nJarne's votes so far:\n${taste}`,
  });

  const known = new Set(research.sources.map((s) => s.url));
  const created = [];
  for (const i of ideas.slice(0, mode.count)) {
    const sources = i.sourceUrls
      .filter((u) => known.has(u))
      .slice(0, 5)
      .map((url) => ({ url, title: research.sources.find((s) => s.url === url)?.title ?? "" }));
    created.push(
      await db.idea.create({
        data: {
          kind: i.kind,
          title: i.title,
          summary: i.summary,
          whyNow: i.whyNow,
          money: i.money,
          cost: i.cost,
          effort: i.effort,
          firstStep: i.firstStep,
          risks: i.risks,
          outsideBox: i.outsideBox,
          sources,
          origin: mode.origin,
        },
      }),
    );
  }

  const header =
    mode.origin === "weekly" ? "🔧 Scout: wekelijkse Brain-review" : mode.origin === "topic" ? `🔎 Scout: ${mode.focus.slice(0, 80)}` : "💡 Scout: ideeën van vandaag";
  await notify(`${header}\n${created.length} idee(ën). Tik per idee: Bouwen, Later of Nee. Alles staat ook op het dashboard onder Ideeën.`);
  for (const [n, idea] of created.entries()) {
    await notify(formatIdea({ ...idea, sources: idea.sources as { url: string; title?: string }[] }, n + 1), ideaButtons(idea.id));
  }
  await log.info(`Scout: ${created.length} idee(ën) (${mode.origin}): ${created.map((c) => c.title).join(" · ")}`, undefined, taskId);
  return { ideas: created.length };
}

const DAILY_FOCUS =
  "Find today's best opportunities: (1) trends and seasons 4-8 weeks ahead that fit Jarne's businesses (Etsy print-on-demand, " +
  "Routify road trips, eBay), (2) new platforms, tools or earning models a solo founder with AI agents could add, (3) what successful " +
  "sellers or apps in these spaces do now that Jarne doesn't, (4) one surprising, outside-the-box opportunity from a field he has not considered.";

const WEEKLY_FOCUS =
  "Review the Brain itself. From the numbers, agents, failures and open steps above: what is slow, what keeps failing, what does " +
  "Jarne still do by hand, which agent or integration is missing? Look on the web for tools, APIs or practices that would fix it. " +
  "Propose the 3 improvements with the biggest effect (kind 'brain' mostly).";

export const scoutAgent: AgentDefinition = {
  id: ID,
  name: "Scout",
  phase: 1,
  businessId: null,
  description:
    "Zoekt elke dag op het web naar trends, nieuwe bedrijven en manieren om meer te verdienen, en stelt verbeteringen aan de Brain voor. Leert van jouw stemmen.",
  dependsOn: ["database", "claude", "telegram"],
  handlers: {
    daily_ideas: (_p, ctx) => scout({ origin: "daily", count: config.scout.ideasPerDay, focus: DAILY_FOCUS }, ctx),
    weekly_review: (_p, ctx) => scout({ origin: "weekly", count: 3, focus: WEEKLY_FOCUS }, ctx),
    think_about: (p, ctx) => {
      const raw = typeof p.topic === "string" ? p.topic : typeof p.instructions === "string" ? p.instructions : "";
      const topic = raw.trim().slice(0, 500);
      if (!topic) return Promise.resolve({ skipped: "geen onderwerp" });
      return scout({ origin: "topic", count: 3, focus: `Jarne asked: "${topic}". Research it and propose 3 concrete ideas.` }, ctx);
    },
  },
  taskInfo: {
    daily_ideas: "Elke ochtend 3 ideeën: trends, nieuwe bedrijven, meer verdienen en één buiten de lijntjes, met bronnen (ongeveer €0,30)",
    weekly_review: "Elke zondag: wat is traag, gaat mis of doe je nog met de hand, en de 3 beste verbeteringen aan de Brain",
    think_about: "Op jouw vraag over één onderwerp nadenken en 3 ideeën geven (in chat: zeg waarover)",
  },
  chatTasks: ["daily_ideas", "think_about"],
  maxAttempts: { daily_ideas: 2, weekly_review: 2, think_about: 2 },
};
