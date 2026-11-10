// Marketing Agent: one strategy per business, small experiments ("plays") to get more visitors
// and sales, measured against the untouched part of the business. What works in one business is
// offered to the others. Anything that costs money becomes a to-do for Jarne, never an action.
import { z } from "zod";
import { businessById } from "../businesses.js";
import { config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import * as etsy from "../integrations/etsy.js";
import * as meta from "../integrations/meta.js";
import * as pinterest from "../integrations/pinterest.js";
import { registerApprovalExecutor, requestApproval } from "../lib/approvals.js";
import { askJson } from "../lib/claude.js";
import {
  MEASURE_AFTER_DAYS,
  businessMetrics,
  computeLift,
  getStrategy,
  liveListingStats,
  marketedBusinesses,
  provenElsewhere,
  saveStrategy,
  tacticsFor,
  verdictFor,
  type ViewSnapshot,
} from "../lib/marketing.js";
import { notify } from "../lib/telegram.js";
import { enqueue } from "../lib/tasks.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "marketing";
const DAY = 24 * 60 * 60 * 1000;
const MAX_NEW_PLAYS = 3;
const MIN_LISTING_AGE_DAYS = 7;

const ReviewSchema = z.object({
  strategy: z.object({
    summary: z.string(),
    focus: z.array(z.string()),
    channels: z.array(z.object({ name: z.string(), role: z.string(), when: z.enum(["now", "later"]) })),
  }),
  plays: z.array(
    z.object({
      tactic: z.string(),
      title: z.string(),
      why: z.string(),
      instructions: z.string(),
      listingCount: z.number().int().nullable(),
      niches: z.array(z.string()),
      copiedFrom: z.string().nullable(),
    }),
  ),
  verdicts: z.array(z.object({ playId: z.string(), verdict: z.enum(["worked", "no_effect", "worse", "unclear"]), note: z.string() })),
});

const SeoSchema = z.object({
  listings: z.array(z.object({ etsyListingId: z.string(), title: z.string(), tags: z.array(z.string()) })),
});

/** Agents that work for a business, keyed by business id. Imported lazily to avoid an import cycle. */
async function teams(): Promise<Map<string, string[]>> {
  const { agents } = await import("./index.js");
  const map = new Map<string, string[]>();
  for (const a of agents.values()) {
    if (!a.businessId) continue;
    map.set(a.businessId, [...(map.get(a.businessId) ?? []), a.id]);
  }
  return map;
}

// ---------- weekly review ----------

async function marketingReview(payload: Record<string, unknown>, ctx: TaskContext) {
  const { log, taskId } = ctx;
  const measured = await measurePlays({}, ctx);
  const team = await teams();
  const only = typeof payload.businessId === "string" ? payload.businessId : null;
  const instructions = typeof payload.instructions === "string" ? payload.instructions.slice(0, 500) : "";
  const businesses = marketedBusinesses([...team.keys()]).filter((b) => !only || b.id === only);

  const summaries: string[] = [];
  for (const b of businesses) {
    const tactics = tacticsFor(b.id);
    const [strategy, metrics, history, proven] = await Promise.all([
      getStrategy(b.id),
      businessMetrics(b.id, team.get(b.id) ?? []),
      db.marketingPlay.findMany({ where: { businessId: b.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      provenElsewhere(b.id),
    ]);
    const open = history.filter((p) => p.status === "running" || p.status === "todo");
    const toJudge = history.filter(
      (p) => p.status === "running" && p.tactic !== "etsy_seo_refresh" && p.startedAt && Date.now() - p.startedAt.getTime() > MEASURE_AFTER_DAYS * DAY,
    );

    const review = await askJson({
      agentId: ID,
      purpose: "marketing_review",
      effort: "medium",
      maxTokens: 12000,
      schema: ReviewSchema,
      system:
        "You are the marketing lead of a small online company run by AI agents for its owner, Jarne. Each business gets its own strategy, " +
        "fitted to where it sells and how far along it is. You grow visitors and sales with small, measurable experiments (plays), " +
        "learn from the results, and reuse what worked in another business when it fits. Be concrete and honest: a new Etsy shop with few " +
        "listings mostly needs more good listings and better search terms; don't promise quick wins. Never propose anything against a " +
        "platform's rules (fake reviews, keyword stuffing, trademarks, spam). Only use tactics from the list for this business. Anything " +
        "that costs money must be a 'manual' play with the cost stated, so Jarne decides. Write strategy, titles, reasons and instructions " +
        "in Dutch for Jarne; listing texts stay in the shop's language.",
      prompt: [
        `Business: ${b.name} (${b.kind}). ${b.description} Sells on: ${b.channels.join(", ")}.`,
        `Current strategy: ${strategy ? JSON.stringify(strategy) : "none yet: write the first one."}`,
        `Numbers: ${JSON.stringify(metrics)}`,
        `Tactics you can use here: ${JSON.stringify(tactics.map((t) => ({ id: t.id, auto: t.auto, description: t.description })))}`,
        `Plays so far (newest first): ${JSON.stringify(
          history.map((p) => ({ id: p.id, tactic: p.tactic, title: p.title, status: p.status, verdict: p.verdict, liftPct: p.liftPct, note: p.note })),
        )}`,
        `Worked in other businesses (adapt only if it fits; set copiedFrom to its id): ${JSON.stringify(proven)}`,
        toJudge.length
          ? `Judge these running plays from the numbers (verdicts): ${JSON.stringify(toJudge.map((p) => ({ id: p.id, title: p.title, why: p.why })))}`
          : "No plays to judge (verdicts: []).",
        instructions ? `Jarne's direction for this review: ${instructions}` : "",
        `Propose at most ${MAX_NEW_PLAYS} new plays; ${open.length} are still open, so propose fewer if that is plenty. ` +
          "listingCount only for etsy_seo_refresh (else null); niches only for etsy_niche_focus (else []).",
      ].join("\n\n"),
    });

    await saveStrategy(b.id, { ...review.strategy, updatedAt: new Date().toISOString() });

    for (const v of review.verdicts) {
      const play = toJudge.find((p) => p.id === v.playId);
      if (!play) continue;
      await db.marketingPlay.update({
        where: { id: play.id },
        data: { status: "measured", verdict: v.verdict, note: v.note, measuredAt: new Date() },
      });
    }

    const allowed = new Map(tactics.map((t) => [t.id, t]));
    let created = 0;
    for (const p of review.plays.slice(0, MAX_NEW_PLAYS)) {
      const tactic = allowed.get(p.tactic);
      if (!tactic) continue; // Claude picked a tactic this business doesn't have
      const play = await db.marketingPlay.create({
        data: {
          businessId: b.id,
          tactic: tactic.id,
          title: p.title,
          why: p.why,
          instructions: p.instructions,
          status: tactic.auto ? "proposed" : "todo",
          input: { listingCount: p.listingCount, niches: p.niches },
          copiedFrom: p.copiedFrom && proven.some((x) => x.id === p.copiedFrom) ? p.copiedFrom : null,
        },
      });
      if (tactic.auto) await enqueue(ID, "run_play", { playId: play.id });
      created++;
    }
    summaries.push(`${b.name}: ${review.strategy.focus.slice(0, 2).join("; ")} (${created} nieuwe actie(s))`);
    await log.info(`Marketing ${b.name}: strategie bijgewerkt, ${created} nieuwe actie(s)`, { focus: review.strategy.focus }, taskId);
  }

  if (summaries.length) await notify(`📣 Marketing, deze week\n${summaries.map((s) => `• ${s}`).join("\n")}\n\nTo-do's voor jou staan op het dashboard bij Bedrijven.`);
  return { businesses: businesses.map((b) => b.id), measured };
}

// ---------- carrying out a play ----------

async function runPlay(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const play = await db.marketingPlay.findUniqueOrThrow({ where: { id: String(payload.playId) } });
  if (play.status !== "proposed") return { skipped: `play is ${play.status}` }; // safe to re-run
  const input = (play.input ?? {}) as { listingCount?: number | null; niches?: string[] };
  const skip = async (note: string) => {
    await db.marketingPlay.update({ where: { id: play.id }, data: { status: "skipped", note } });
    await log.info(`Marketing-actie overgeslagen: ${play.title} (${note})`, undefined, taskId);
    return { skipped: note };
  };

  if (play.tactic === "etsy_niche_focus") {
    const niches = (input.niches ?? []).slice(0, 5);
    if (!niches.length) return skip("geen niches opgegeven");
    for (const niche of niches) {
      await db.knowledge.create({
        data: { agentId: ID, kind: "niche", title: niche, body: `Marketing: maak hier meer mokken voor. ${play.why}`, tags: ["marketing", play.id], score: 2 },
      });
    }
    await db.marketingPlay.update({ where: { id: play.id }, data: { status: "running", startedAt: new Date(), baseline: { niches } } });
    await log.info(`Marketing: de Etsy-agent ontwerpt voortaan meer voor ${niches.join(", ")}`, undefined, taskId);
    return { niches };
  }

  if (play.tactic === "etsy_seo_refresh") {
    if (config.dryRun || !etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return skip("dry run of Etsy niet gekoppeld");
    const eligible = (await liveListingStats()).filter((s) => s.ageDays >= MIN_LISTING_AGE_DAYS);
    const count = Math.min(10, Math.max(3, input.listingCount ?? 5));
    if (eligible.length < count + 3) return skip(`te weinig listings ouder dan ${MIN_LISTING_AGE_DAYS} dagen om te meten`);
    // Never touch a listing that is already part of a running SEO play.
    const busy = new Set(
      (await db.marketingPlay.findMany({ where: { tactic: "etsy_seo_refresh", status: "running" }, select: { baseline: true } })).flatMap(
        (p) => ((p.baseline as { target?: ViewSnapshot[] } | null)?.target ?? []).map((t) => t.listingId),
      ),
    );
    const free = eligible.filter((s) => !busy.has(s.etsyListingId));
    const targets = free.slice(0, count);
    const control = free.slice(count);
    if (targets.length < 3 || control.length < 3) return skip("te weinig vrije listings om te meten");

    const { listings } = await askJson({
      agentId: ID,
      purpose: "marketing_seo",
      effort: "medium",
      schema: SeoSchema,
      system:
        "You improve Etsy search visibility for print-on-demand gift mugs. For each listing write a new title and exactly 13 tags. " +
        "Title: at most 140 characters, the main search phrase a buyer types first, then gift occasion and recipient, natural and readable, " +
        "no keyword lists, no repeated words, no ALL CAPS, no trademarks. Tags: 13, each at most 20 characters, multi-word phrases buyers search, " +
        "no repeats of each other, no trademarks. Keep it truthful to the product. Write in the language of the current title.",
      prompt: `Listings with the fewest views (current title, tags, niche):\n${JSON.stringify(
        targets.map((t) => ({ etsyListingId: t.etsyListingId, title: t.title, tags: t.tags, niche: t.niche })),
      )}`,
    });

    const changed: { listingId: string; oldTitle: string; oldTags: string[] }[] = [];
    for (const t of targets) {
      const next = listings.find((l) => l.etsyListingId === t.etsyListingId);
      if (!next) continue;
      const title = next.title.replace(/\s+/g, " ").trim().slice(0, 140);
      const tags = [...new Set(next.tags.map((x) => x.trim().toLowerCase()).filter((x) => x && x.length <= 20))].slice(0, 13);
      if (!title || tags.length < 5) continue;
      await etsy.updateListingSeo(t.etsyListingId, title, tags);
      await db.listing.update({ where: { id: t.id }, data: { title, tags } });
      changed.push({ listingId: t.etsyListingId, oldTitle: t.title, oldTags: t.tags });
    }
    if (!changed.length) return skip("Claude gaf geen bruikbare nieuwe titels");
    const snap = (s: { etsyListingId: string; views: number; ageDays: number }): ViewSnapshot => ({
      listingId: s.etsyListingId,
      views: s.views,
      ageDays: s.ageDays,
    });
    const changedIds = new Set(changed.map((c) => c.listingId));
    await db.marketingPlay.update({
      where: { id: play.id },
      data: {
        status: "running",
        startedAt: new Date(),
        baseline: {
          target: targets.filter((t) => changedIds.has(t.etsyListingId)).map(snap),
          control: control.map(snap),
          previous: changed,
        },
      },
    });
    await log.info(`Marketing: titels en tags vernieuwd voor ${changed.length} listing(s); meting over ${MEASURE_AFTER_DAYS} dagen`, { listings: [...changedIds] }, taskId);
    return { changed: changed.length };
  }

  return skip(`tactiek ${play.tactic} doet de agent niet zelf`);
}

// ---------- measuring ----------

/** Measures SEO plays after MEASURE_AFTER_DAYS. Worse than the control: the old titles and tags go back. */
async function measurePlays(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const due = await db.marketingPlay.findMany({
    where: { tactic: "etsy_seo_refresh", status: "running", startedAt: { lt: new Date(Date.now() - MEASURE_AFTER_DAYS * DAY) } },
  });
  for (const play of due) {
    const base = play.baseline as unknown as {
      target: ViewSnapshot[];
      control: ViewSnapshot[];
      previous: { listingId: string; oldTitle: string; oldTags: string[] }[];
    };
    const ids = [...base.target, ...base.control].map((s) => s.listingId);
    const rows = await db.listing.findMany({ where: { etsyListingId: { in: ids }, status: "active" }, select: { etsyListingId: true, views: true } });
    const viewsNow = Object.fromEntries(rows.map((r) => [r.etsyListingId!, r.views]));
    const daysSince = (Date.now() - play.startedAt!.getTime()) / DAY;
    const lift = computeLift({ before: base.target, viewsNow }, { before: base.control, viewsNow }, daysSince);
    const verdict = verdictFor(lift.liftPct, lift.targetViewsAfter);

    let note = `${lift.targetViewsAfter} bezoeken op de aangepaste listings, ${lift.controlViewsAfter} op de rest`;
    if (verdict === "worse" && !config.dryRun) {
      for (const p of base.previous) {
        await etsy.updateListingSeo(p.listingId, p.oldTitle, p.oldTags).catch(() => undefined);
        await db.listing.updateMany({ where: { etsyListingId: p.listingId }, data: { title: p.oldTitle, tags: p.oldTags } });
      }
      note += "; oude titels en tags teruggezet";
    }
    await db.marketingPlay.update({
      where: { id: play.id },
      data: { status: "measured", verdict, liftPct: lift.liftPct, result: lift, note, measuredAt: new Date() },
    });
    if (verdict === "worked") {
      // The shared brain: other agents and the next reviews read this.
      await db.knowledge.create({
        data: {
          agentId: ID,
          kind: "lesson",
          title: `Marketing werkt: ${play.title}`,
          body: `${businessById(play.businessId)?.name}: ${play.why} Resultaat: +${lift.liftPct}% bezoeken t.o.v. de rest.`,
          tags: ["marketing", play.businessId, play.tactic],
          score: Math.min(5, (lift.liftPct ?? 0) / 20),
        },
      });
    }
    await log.info(`Marketing gemeten: ${play.title}: ${verdict}${lift.liftPct !== null ? ` (${lift.liftPct}%)` : ""}`, lift, taskId);
  }
  return { measured: due.length };
}

// ---------- Pinterest ----------

const PinSchema = z.object({
  pins: z.array(
    z.object({
      listingId: z.string(),
      board: z.string(),
      title: z.string(),
      description: z.string(),
      altText: z.string(),
    }),
  ),
});

const MAX_BOARDS = 20;

/**
 * A new platform needs Jarne's go-ahead once (company rule). Returns true when it is given; otherwise
 * asks for it (once) and returns false. Approving starts `task` right away.
 */
async function platformApproved(platform: string, label: string, details: string, task: string): Promise<boolean> {
  if (await getSetting<boolean>(`social.approved.${platform}`)) return true;
  const pending = await db.approval.findMany({ where: { kind: "social_start", status: "pending" }, select: { payload: true } });
  if (!pending.some((a) => (a.payload as { platform?: string } | null)?.platform === platform)) {
    await requestApproval({ agentId: ID, kind: "social_start", title: `Marketing-agent laten posten op ${label}`, details, payload: { platform, task } });
  }
  return false;
}

registerApprovalExecutor("social_start", async (p) => {
  const platform = String(p.platform);
  await setSetting(`social.approved.${platform}`, true);
  await enqueue(ID, String(p.task));
  return `${platform} staat aan: de eerste posts worden nu geplaatst, daarna elke dag.`;
});

/**
 * Pins a few live Etsy listings a day, each linking to its listing. Never pins a listing twice.
 */
async function pinterestPins(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!pinterest.isPinterestConfigured() || !(await pinterest.isPinterestConnected())) return { skipped: "Pinterest niet gekoppeld" };
  if (config.dryRun) return { skipped: "dry run" };
  const approved = await platformApproved(
    "pinterest",
    "Pinterest",
    `Elke dag ${config.pinterest.pinsPerDay} pins van je live Etsy-listings, met een link naar de listing. Gratis.`,
    "pinterest_pins",
  );
  if (!approved) return { skipped: "wacht op akkoord" };

  const pinned = new Set((await db.socialPost.findMany({ where: { platform: "pinterest" }, select: { refId: true } })).map((p) => p.refId));
  const count = Math.min(10, Math.max(1, Number(payload.count) || config.pinterest.pinsPerDay));
  // Most-favourited first: proven interest; then the newest.
  const candidates = (await db.listing.findMany({ where: { status: "active", etsyListingId: { not: null } }, orderBy: [{ favorites: "desc" }, { createdAt: "desc" }] }))
    .filter((l) => !pinned.has(l.id))
    .slice(0, count);
  if (!candidates.length) return { pinned: 0, note: "alle live listings zijn al gepind" };

  const boards = await pinterest.listBoards();
  const { pins } = await askJson({
    agentId: ID,
    purpose: "pinterest_pins",
    effort: "low",
    schema: PinSchema,
    system:
      "You write Pinterest pins that send people to Etsy gift products. Pinterest is a search engine: people search for gift ideas. " +
      "Title: at most 100 characters, the search phrase first (e.g. 'Funny Gift for Nurses'), no clickbait, no ALL CAPS. " +
      "Description: 2-3 natural sentences with the phrases people search (recipient, occasion, product), at most 450 characters, 2-4 hashtags at the end. " +
      "Alt text: what the photo shows, for people who can't see it. Board: a short searchable board name grouping similar gifts " +
      "(e.g. 'Gifts for Nurses', 'Funny Coffee Mugs'); reuse an existing board when it fits. Write in the language of the listing.",
    prompt: `Existing boards: ${JSON.stringify(boards.map((b) => b.name))}
Listings:
${JSON.stringify(
      candidates.map((l) => ({ listingId: l.id, title: l.title, niche: l.niche, tags: l.tags })),
    )}`,
  });

  let done = 0;
  for (const l of candidates) {
    const pin = pins.find((p) => p.listingId === l.id);
    if (!pin) continue;
    const imageUrl = await etsy.getLargeImageUrl(l.etsyListingId!).catch(() => null);
    if (!imageUrl) continue;
    let board = boards.find((b) => pinterest.sameBoard(b.name, pin.board));
    if (!board) {
      if (boards.length >= MAX_BOARDS) board = boards[0];
      else {
        board = await pinterest.createBoard(pin.board.slice(0, 50), `${pin.board}: gift ideas from our shop.`);
        boards.push(board);
      }
    }
    const link = `https://www.etsy.com/listing/${l.etsyListingId}`;
    const created = await pinterest.createPin({ boardId: board.id, title: pin.title, description: pin.description, altText: pin.altText, link, imageUrl });
    await db.socialPost.create({
      data: { platform: "pinterest", businessId: "etsy-pod", refId: l.id, externalId: created.id, board: board.name, title: pin.title, link },
    });
    done++;
  }
  await log.info(`Pinterest: ${done} pin(s) geplaatst`, undefined, taskId);
  return { pinned: done };
}

// ---------- Instagram + Facebook ----------

const MetaSchema = z.object({
  posts: z.array(z.object({ listingId: z.string(), facebook: z.string(), instagram: z.string() })),
});

/**
 * One post a day (by default) on the Facebook Page and on Instagram, each about a live listing that
 * platform hasn't shown yet. Facebook gets the link; Instagram points to the link in the bio.
 */
async function metaPosts(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const c = await meta.metaConnection();
  if (!meta.isMetaConfigured() || !c) return { skipped: "Instagram/Facebook niet gekoppeld" };
  if (config.dryRun) return { skipped: "dry run" };
  const platforms = c.instagramId ? "Facebook en Instagram" : "Facebook";
  const approved = await platformApproved(
    "meta",
    platforms,
    `Elke dag ${config.meta.postsPerDay} post(s) op ${platforms} over een live Etsy-listing, met de productfoto. Gratis.`,
    "meta_posts",
  );
  if (!approved) return { skipped: "wacht op akkoord" };

  const wanted = ["facebook", ...(c.instagramId ? ["instagram"] : [])];
  const posted = await db.socialPost.findMany({ where: { platform: { in: wanted } }, select: { platform: true, refId: true } });
  const done = (platform: string, id: string) => posted.some((p) => p.platform === platform && p.refId === id);
  const count = Math.min(5, Math.max(1, Number(payload.count) || config.meta.postsPerDay));
  const candidates = (await db.listing.findMany({ where: { status: "active", etsyListingId: { not: null } }, orderBy: [{ favorites: "desc" }, { createdAt: "desc" }] }))
    .filter((l) => wanted.some((w) => !done(w, l.id)))
    .slice(0, count);
  if (!candidates.length) return { posted: 0, note: "alle live listings zijn al gedeeld" };

  const { posts } = await askJson({
    agentId: ID,
    purpose: "meta_posts",
    effort: "low",
    schema: MetaSchema,
    system:
      "You write social posts that make people want a gift from a small Etsy shop. Warm, short, human; a relatable line about the recipient " +
      "(their job or hobby), then what the product is and who it's a perfect gift for. No fake urgency, no ALL CAPS, at most 2 emoji. " +
      "Facebook: 2-4 sentences and end with the listing link given to you. Instagram: 2-4 sentences, then 'Link in bio', then 8-12 relevant " +
      "hashtags on one line; never a URL. Write in the language of the listing.",
    prompt: JSON.stringify(
      candidates.map((l) => ({ listingId: l.id, title: l.title, niche: l.niche, tags: l.tags, link: `https://www.etsy.com/listing/${l.etsyListingId}` })),
    ),
  });

  let made = 0;
  for (const l of candidates) {
    const text = posts.find((p) => p.listingId === l.id);
    const imageUrl = text && (await etsy.getLargeImageUrl(l.etsyListingId!).catch(() => null));
    if (!text || !imageUrl) continue;
    const link = `https://www.etsy.com/listing/${l.etsyListingId}`;
    for (const platform of wanted) {
      if (done(platform, l.id)) continue;
      try {
        const externalId =
          platform === "facebook" ? await meta.postToFacebook(c, imageUrl, text.facebook) : await meta.postToInstagram(c, imageUrl, text.instagram);
        await db.socialPost.create({ data: { platform, businessId: "etsy-pod", refId: l.id, externalId, title: l.title, link } });
        made++;
      } catch (err) {
        // One platform failing (e.g. Instagram refusing the photo's shape) must not stop the other.
        await log.warn(`${platform} post mislukt voor ${l.title}: ${(err as Error).message}`, undefined, taskId);
      }
    }
  }
  await log.info(`${platforms}: ${made} post(s) geplaatst`, undefined, taskId);
  return { posted: made };
}

export const marketingAgent: AgentDefinition = {
  id: ID,
  name: "Marketing-agent",
  phase: 1,
  businessId: null,
  description:
    "Maakt per bedrijf een eigen marketingstrategie, voert kleine experimenten uit, meet ze en neemt over wat werkt naar de andere bedrijven.",
  dependsOn: ["database", "claude"],
  chatTasks: ["marketing_review", "measure_plays", "pinterest_pins", "meta_posts"],
  taskInfo: {
    marketing_review: "Per bedrijf de cijfers bekijken, de strategie bijwerken en nieuwe marketingacties kiezen (elke maandag)",
    run_play: "Een marketingactie uitvoeren: titels en tags vernieuwen of de Etsy-agent op niches richten (gratis)",
    measure_plays: "Marketingacties na 14 dagen meten tegen de rest; wat slechter doet wordt teruggedraaid",
    pinterest_pins: "Elke dag een paar live Etsy-listings pinnen op Pinterest, met een link naar de listing (gratis)",
    meta_posts: "Elke dag een post op Facebook en Instagram over een live Etsy-listing (gratis)",
  },
  handlers: { marketing_review: marketingReview, run_play: runPlay, measure_plays: measurePlays, pinterest_pins: pinterestPins, meta_posts: metaPosts },
};
