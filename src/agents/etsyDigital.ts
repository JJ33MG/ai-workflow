// Digital downloads for the Etsy shop: coloring page bundles, kids' activity packs and undated
// planners. Each product is planned for a season or buyer, every page is drawn and checked like
// the coloring books, then the PDFs (US Letter and A4), the listing photos and the Etsy draft are
// made. Publishing waits for Jarne's review, like every other listing.
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db.js";
import * as etsy from "../integrations/etsy.js";
import { requestApproval } from "../lib/approvals.js";
import { BudgetExceededError, apiSpendTodayCents } from "../lib/budget.js";
import { askJson, askText } from "../lib/claude.js";
import { catalogEntry } from "../lib/catalogSetup.js";
import { inkedEdges } from "../lib/coloring.js";
import { sanitizeSvg, saveDesign } from "../lib/design.js";
import { DIGITAL_KINDS, buildDownloadFiles, digitalType, listingPhotos, type DigitalKind } from "../lib/digital.js";
import { findTaxonomyId } from "../lib/etsySetup.js";
import { campaignBrief, todayIso } from "../lib/marketing.js";
import { enqueueOnce } from "../lib/tasks.js";
import sharp from "sharp";
import { decodeEntities, normaliseListing, withAiDisclosure } from "./etsyPod.js";
import { drawPage } from "./kdpColoring.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "etsy-digital";
const KINDS = Object.keys(DIGITAL_KINDS) as DigitalKind[];
/** Fail the product when fewer pages than this share pass review. */
const MIN_SHARE_OF_PAGES = 0.75;
const PARALLEL_PAGES = 3;
/** What one product may cost in Claude calls at most; it only starts when that much budget is left today. */
const PRODUCT_BUDGET_CENTS = 200;

const PlanSchema = z.object({
  theme: z.string(),
  audience: z.string(),
  title: z.string(),
  coverTitle: z.string(),
  coverSubtitle: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  accent: z.string(),
  pages: z.array(z.object({ title: z.string(), brief: z.string() })),
});
type Plan = z.infer<typeof PlanSchema>;

/** Which kind to make today: Jarne's choice, else a daily rotation. */
export function kindFor(payload: Record<string, unknown>, now = new Date()): DigitalKind {
  if (typeof payload.kind === "string" && KINDS.includes(payload.kind as DigitalKind)) return payload.kind as DigitalKind;
  const day = Math.floor(now.getTime() / 86_400_000);
  return KINDS[day % KINDS.length];
}

const KIND_BRIEF: Record<DigitalKind, string> = {
  coloring:
    "A bundle of coloring pages for young children (ages 3-8) around one theme parents search for: a season or holiday, animals, " +
    "vehicles, dinosaurs, princesses-without-trademarks, space. Each page brief is one simple, friendly subject (e.g. 'a smiling snowman with a scarf').",
  activity:
    "A printable activity pack for kids (ages 4-10) around one occasion or theme: e.g. a Christmas scavenger hunt, Christmas bingo, " +
    "'would you rather' cards, a letter-to-Santa template, a winter break activity pack, a road trip game pack. Each page is one complete activity " +
    "with clear instructions for parents and kids, and enough room to write or draw. No answer keys that need real-world facts.",
  planner:
    "An UNDATED printable planner or tracker set for adults: e.g. a budget planner, a habit and goal tracker, a fitness and meal planner, " +
    "a reading journal, a New Year reset kit. Never print a year's dates or weekday grids with numbers: every date field is a blank line " +
    "('Month: ____', 'Week of: ____') so it works for any year. Each page is one useful sheet (e.g. 'Monthly budget', 'Habit tracker 31 days').",
};

/** Rules for typographic pages (activity packs and planners), US Letter at 300 dpi. */
const DOC_RULES =
  "You design one page of a printable sold on Etsy. Output one standalone SVG document and nothing else. " +
  'Use viewBox="0 0 2550 3300" (US Letter at 300 dpi) and a white background. Keep every element at least 150 units from every edge. ' +
  "Clean, modern and printer-friendly: mostly black or dark grey text and thin lines, with one accent colour (given) used sparingly for headings and small shapes. " +
  "No large filled areas (they waste ink), no photos, no clip-art scenes; one or two simple icons drawn with lines are fine. " +
  "A clear page title at the top (font-size 110–150), short instructions where useful (font-size 50–60), and generous fill-in space: lines, boxes, " +
  "checkboxes or tables sized for handwriting (rows at least 90 units tall). Body text never smaller than 45. " +
  "Use only generic font families (serif, sans-serif). Every word spelled correctly with real spaces; never put text on a curve, never rotate text. " +
  "No brand names, logos, trademarked characters or phrases. Use only <text>, <tspan>, <path>, <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>, <g>. " +
  "You cannot measure text: keep each line short (at most about 40 characters at font-size 60) and split longer text over several lines.";

const ReviewSchema = z.object({ ok: z.boolean(), problems: z.array(z.string()) });

async function reviewDocPage(png: Buffer, page: Plan["pages"][number], kind: DigitalKind) {
  const small = await sharp(png).resize(900, 1200, { fit: "inside" }).png().toBuffer();
  return askJson({
    agentId: ID,
    purpose: "digital_page_review",
    model: config.kdp.reviewModel,
    effort: "low",
    maxTokens: 2000,
    schema: ReviewSchema,
    images: [small],
    system: "You check printable pages before they are sold on Etsy. Be strict: a buyer who prints a sloppy page leaves a bad review.",
    prompt:
      `This should be the ${kind === "planner" ? "planner" : "kids' activity"} page "${page.title}": ${page.brief}\n` +
      "Reject it (ok=false) and list each problem if: any word is misspelled or words run together; text overlaps text, lines or boxes, or runs " +
      "outside its box; anything is cut off at the edge; the page is hard to use (too little room to write, unclear instructions, confusing layout); " +
      "it looks amateurish or unbalanced; it shows a real year's dates or numbered calendar days; or it uses brands or trademarked characters.",
  });
}

const DOC_SIZE = { width: 2550, height: 3300 };

async function drawDocPage(page: Plan["pages"][number], plan: Plan, kind: DigitalKind): Promise<Buffer | null> {
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const svg = sanitizeSvg(
      await askText({
        agentId: ID,
        purpose: "digital_page_svg",
        effort: "medium",
        system: DOC_RULES,
        prompt:
          `Product: ${plan.title} (${plan.theme}, for ${plan.audience}). Accent colour: ${plan.accent}.\n` +
          `Page: "${page.title}". What it contains: ${page.brief}${feedback}`,
      }),
    );
    const png = await sharp(Buffer.from(svg), { density: 300 })
      .resize(DOC_SIZE.width, DOC_SIZE.height, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    const edges = await inkedEdges(png);
    const verdict = edges.length ? { ok: false, problems: [`content runs off the ${edges.join(" and ")} edge`] } : await reviewDocPage(png, page, kind);
    if (verdict.ok) return png;
    feedback = `\n\nA reviewer rejected your previous version: ${verdict.problems.join("; ")}. Draw it again, simpler, avoiding every one of these problems.`;
  }
  return null;
}

/** Runs `fn` over items with at most `limit` in flight, keeping input order in the result. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

let taxonomyCache: Map<DigitalKind, number | null> | null = null;
async function taxonomyFor(kind: DigitalKind): Promise<number | null> {
  if (!taxonomyCache) {
    const tree = await etsy.getTaxonomy();
    taxonomyCache = new Map(KINDS.map((k) => [k, DIGITAL_KINDS[k].taxonomy.map((n) => findTaxonomyId(tree, n)).find((id) => id) ?? null]));
  }
  return taxonomyCache.get(kind) ?? catalogEntry("printable")?.taxonomyId ?? null;
}

const accentOf = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim() : "#b3262e");

async function createDigital(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const left = config.budget.dailyApiCapCents - (await apiSpendTodayCents());
  if (left < PRODUCT_BUDGET_CENTS) {
    throw new Error(`Not enough Claude budget left today for a download product (€${(left / 100).toFixed(2)} left, one needs up to €${(PRODUCT_BUDGET_CENTS / 100).toFixed(2)}). It runs again tomorrow.`);
  }
  const kind = kindFor(payload);
  const info = DIGITAL_KINDS[kind];
  const instructions = typeof payload.instructions === "string" ? payload.instructions.slice(0, 500) : "";
  const recent = await db.listing.findMany({
    where: { productType: { startsWith: "digital-" } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { niche: true, title: true },
  });

  const raw = await askJson({
    agentId: ID,
    purpose: "digital_plan",
    effort: "medium",
    schema: PlanSchema,
    system:
      "You plan digital downloads for the Etsy shop 'All You Can Wish'. You pick what buyers search for right now (season, holidays, " +
      "back to school, New Year) and make it genuinely useful and good-looking. Never use trademarks, brand names or characters from films, shows or games.",
    prompt:
      `Today: ${todayIso()}.\n${await campaignBrief("etsy-pod")}\n\n` +
      (recent.length ? `Downloads we already made (make something different):\n${recent.map((r) => `- ${r.niche}: ${r.title}`).join("\n")}\n\n` : "") +
      (instructions ? `Jarne's direction (follow it): ${instructions}\n\n` : "") +
      `Plan one ${info.noun.toLowerCase()} product. ${KIND_BRIEF[kind]}\n` +
      `Give: theme; audience (who it is for, e.g. 'kids 3-8'); title (≤140 chars, starts with the search phrase, says it is a printable or ` +
      `instant download); coverTitle (≤36 chars, for the photo); coverSubtitle (≤40 chars, e.g. '${info.pages} pages · ages 3-8'); ` +
      `description (3 short paragraphs for a buyer: what is inside, who it is for, and that it is an instant PDF download in US Letter and A4, ` +
      `nothing shipped, for personal use); 13 Etsy tags (each ≤20 chars); accent (one hex colour that suits the theme, dark enough for white text); ` +
      `and exactly ${info.pages} pages, each with a short title and a brief of what it shows.`,
  });
  const plan: Plan = { ...normaliseListing(raw), accent: accentOf(raw.accent), pages: raw.pages.slice(0, info.pages) };

  const listing = await db.listing.create({
    data: {
      niche: plan.theme,
      title: decodeEntities(plan.title),
      description: withAiDisclosure(plan.description, true),
      tags: plan.tags,
      productType: digitalType(kind),
      priceCents: info.priceCents,
      currency: etsy.es.currency,
      designSvg: "",
      designFile: "",
      status: "drawing",
    },
  });
  await log.info(`Download gepland: ${plan.title} (${plan.pages.length} pagina's)`, { listingId: listing.id, kind }, taskId);

  try {
    const drawn = await mapLimited(plan.pages, PARALLEL_PAGES, async (page) => {
      const png = await (kind === "coloring"
        ? drawPage(page.brief, plan.theme, plan.audience.replace(/[^0-9-]/g, "") || "3-8").then((r) => r?.png ?? null)
        : drawDocPage(page, plan, kind)
      ).catch(async (err: Error) => {
        if (err instanceof BudgetExceededError) throw err;
        await log.warn(`Pagina "${page.title}" mislukt: ${err.message}`, undefined, taskId);
        return null;
      });
      if (taskId) await db.task.update({ where: { id: taskId }, data: { status: "running" } });
      return { title: page.title, png };
    });
    const good = drawn.filter((d): d is { title: string; png: Buffer } => d.png !== null);
    if (good.length < Math.ceil(plan.pages.length * MIN_SHARE_OF_PAGES)) {
      throw new Error(`Only ${good.length} of ${plan.pages.length} pages passed review; not enough for a good product`);
    }

    const pages = good.map((g) => g.png);
    const files = await buildDownloadFiles(pages, plan.title);
    const photos = await listingPhotos({
      coverTitle: plan.coverTitle,
      coverSubtitle: plan.coverSubtitle.replace(/\d+\s+pages/i, `${pages.length} pages`),
      accent: plan.accent,
      pages,
      pageTitles: good.map((g) => g.title),
    });
    const cover = await saveDesign(photos[0], `${listing.id}-cover`);

    if (config.dryRun || !etsy.isEtsyConfigured()) {
      // "ready", not "draft": a draft would be picked up by the mug/shirt uploader.
      await db.listing.update({ where: { id: listing.id }, data: { status: "ready", designFile: cover } });
      await log.info(`Dry run: ${plan.title} blijft lokaal`, undefined, taskId);
      return { listingId: listing.id, dryRun: true };
    }

    const draft = await etsy.createDraftListing({
      title: listing.title,
      description: listing.description,
      priceCents: info.priceCents,
      tags: plan.tags,
      taxonomyId: (await taxonomyFor(kind)) ?? undefined,
      digital: true,
    });
    const etsyId = String(draft.listing_id);
    await db.listing.update({ where: { id: listing.id }, data: { etsyListingId: etsyId, designFile: cover } });
    for (const [i, photo] of photos.entries()) await etsy.uploadListingImage(etsyId, photo, i + 1);
    const slug = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-+$/, "");
    for (const [i, f] of files.entries()) await etsy.uploadListingFile(etsyId, f.data, `${slug}-${f.name}.pdf`, i + 1, "application/pdf");

    await db.listing.update({
      where: { id: listing.id },
      data: { status: "uploaded", variants: files.map((f) => ({ name: f.name, bytes: f.data.length })) as unknown as object },
    });
    await requestApproval({
      agentId: ID,
      kind: "etsy_publish",
      title: `Download publiceren: ${plan.coverTitle}`,
      details:
        `${info.noun}, ${pages.length} pagina's, €${(info.priceCents / 100).toFixed(2)}. Het concept staat op Etsy met ${photos.length} foto's en de PDF's ` +
        `(US Letter en A4). Bekijk het eerst (Etsy eist menselijke controle per listing) op ${config.publicUrl}/dashboard/ → Bedrijven → Etsy-winkel.`,
      amountCents: 20,
      currency: "USD",
      payload: { listingIds: [listing.id] },
    });
    await enqueueOnce("etsy-pod", "add_videos");
    await log.info(`Download klaar voor controle: ${plan.title} (${pages.length} pagina's, ${photos.length} foto's)`, { listingId: listing.id }, taskId);
    return { listingId: listing.id, pages: pages.length, rejected: plan.pages.length - pages.length };
  } catch (err) {
    await db.listing.update({ where: { id: listing.id }, data: { status: "failed", error: (err as Error).message } });
    throw err;
  }
}

export const etsyDigitalAgent: AgentDefinition = {
  id: ID,
  name: "Download-agent",
  phase: 1,
  businessId: "etsy-pod",
  description: "Maakt digitale downloads voor de Etsy-winkel: kleurplaten, activiteitenpakketten voor kinderen en planners, met PDF's en verkoopfoto's.",
  dependsOn: ["database", "claude", "etsy"],
  chatTasks: ["create_digital"],
  // Every try plans and draws a whole new product; a failed one is reported, not silently paid for again.
  maxAttempts: { create_digital: 1 },
  handlers: { create_digital: createDigital },
  taskInfo: {
    create_digital:
      "Een digitale download maken en als concept op Etsy zetten: kleurplaten, een activiteitenpakket voor kinderen of een planner " +
      "(kind: coloring, activity of planner; anders om de beurt)",
  },
};
