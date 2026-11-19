import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import * as etsy from "../integrations/etsy.js";
import * as printful from "../integrations/printful.js";
import { registerApprovalExecutor, requestApproval } from "../lib/approvals.js";
import { recordCost } from "../lib/budget.js";
import { askJson, askText } from "../lib/claude.js";
import { PRINTABLE, buildInventory, productType, skuFor, variantFromSku } from "../lib/catalog.js";
import { catalogEntry, enabledTypes, findCatalog, type CatalogEntry, type CatalogVariant } from "../lib/catalogSetup.js";
import { DesignLayoutError, designUrl, designsDir, getPrintSize, prepareDesign, renderPrintFile, renderPrintable, sanitizeSvg, saveDesign, sideSize } from "../lib/design.js";
import { startOfDay, toEurCents } from "../lib/money.js";
import { findEtsySetup, mostUsedId, saveReturnPolicy } from "../lib/etsySetup.js";
import { campaignBrief, todayIso } from "../lib/marketing.js";
import { maxDiscountPct, saleProfit } from "../lib/pricing.js";
import { findPrintfulSetup } from "../lib/printfulSetup.js";
import { MAX_PHOTOS, ffmpegAvailable, makeListingVideo } from "../lib/video.js";
import {
  MAX_NAME_CHARS,
  PERSONALIZATION_EXTRA_CENTS,
  PERSONALIZATION_QUESTION,
  exampleName,
  checkName,
  designText,
  fitName,
  intendedText,
  personalizationOf,
  personalizationCard,
  templateProblems,
} from "../lib/personalize.js";
import { enqueue, enqueueOnce } from "../lib/tasks.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "etsy-pod";
const ETSY_LISTING_FEE_USD_CENTS = 20;
const RECEIPTS_CURSOR = "etsy.receipts.since";

const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      niche: z.string(),
      /** One listing per product, each with the text that suits that product. */
      listings: z.array(
        z.object({
          product: z.string(),
          slogan: z.string(),
          designBrief: z.string(),
          title: z.string(),
          description: z.string(),
          tags: z.array(z.string()),
        }),
      ),
    }),
  ),
});
type Idea = z.infer<typeof IdeasSchema>["ideas"][number];
type ListingText = Idea["listings"][number];
/** What one design is drawn from. */
type DesignInput = { slogan: string; niche: string; designBrief: string; personalized?: boolean };

/** Same text (ignoring case, spaces and punctuation) = same design, so it is drawn once. */
export const sloganKey = (slogan: string) => slogan.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Etsy limits: title ≤ 140 chars, ≤ 13 tags of ≤ 20 chars each. */
export function normaliseListing<T extends { title: string; tags: string[] }>(l: T): T {
  const tags = [...new Set(l.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()))]
    .filter((t) => t.length > 0 && t.length <= 20)
    .slice(0, 13);
  return { ...l, title: l.title.slice(0, 140).trim(), tags };
}

/**
 * Etsy requires sellers to say in the description when an item was created with AI (Creativity
 * Standards). Every listing gets this paragraph; MARKER finds it so it is never added twice.
 */
export const AI_DISCLOSURE_MARKER = "AI design tools";
export const AI_DISCLOSURE =
  "About this design: it was created by our shop with the help of AI design tools, then reviewed and finalized by us. " +
  "It is printed and shipped by our print-on-demand production partner.";
export const AI_DISCLOSURE_DIGITAL =
  "About this design: it was created by our shop with the help of AI design tools, then reviewed and finalized by us. " +
  "This is a digital download: no physical item is shipped.";

/** The description with the AI disclosure at the end, unless it already has one. */
export function withAiDisclosure(description: string, digital = false): string {
  if (description.includes(AI_DISCLOSURE_MARKER)) return description;
  return `${description.trimEnd()}\n\n${digital ? AI_DISCLOSURE_DIGITAL : AI_DISCLOSURE}`;
}

/** Etsy's API returns text with HTML entities (&#39;, &amp;); stored and sent back as plain text. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** A variant a listing sells, with the print file made for it. Stored on Listing.variants. */
export interface ListingVariant extends CatalogVariant {
  sku: string;
  file: string;
}

/** A file of a printable wall-art listing, stored on Listing.variants. */
export interface DigitalFile {
  name: string;
  width: number;
  height: number;
  file: string;
}

/** Product types the agent can make now; without a catalog (not looked up yet) only the white mug. */
function availableTypes(): CatalogEntry[] {
  const enabled = enabledTypes();
  if (enabled.length) return enabled;
  const size = getPrintSize();
  return [
    {
      typeId: "mug",
      label: "Witte mok",
      enabled: true,
      productId: printful.pf.productId,
      layout: "mug-wrap",
      taxonomyId: etsy.es.taxonomyId,
      shippingProfileId: etsy.es.shippingProfileId,
      shippingProfileTitle: null,
      variants: printful.pf.variantId
        ? [{ variantId: printful.pf.variantId, size: "11 oz", color: null, ink: "dark", priceCents: etsy.es.priceCents, costUsd: 0, placement: printful.pf.placement, width: size.width, height: size.height }]
        : [],
    },
  ];
}

/** Renders the print files a listing needs (one per placement, print size and ink) and returns its variants. */
async function renderVariants(svg: string, entry: CatalogEntry, listingId: string): Promise<ListingVariant[]> {
  const files = new Map<string, string>();
  const out: ListingVariant[] = [];
  for (const v of entry.variants) {
    const key = `${v.placement}-${v.width}x${v.height}-${v.ink}`;
    let file = files.get(key);
    if (!file) {
      file = await saveDesign(await renderPrintFile(svg, entry.layout, v.width, v.height, v.ink), `${listingId}-${key}`);
      files.set(key, file);
    }
    out.push({ ...v, sku: skuFor(v.variantId), file });
  }
  return out;
}

async function knowledgeDigest(): Promise<string> {
  const rows = await db.knowledge.findMany({
    where: { kind: { in: ["niche", "product", "lesson"] } },
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    take: 30,
  });
  const recent = await db.listing.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { niche: true, title: true },
  });
  return [
    "Shared knowledge (best first):",
    ...rows.map((k) => `- [${k.kind}, score ${k.score}] ${k.title}: ${k.body}`),
    "",
    "Recently created listings (avoid duplicates):",
    ...recent.map((l) => `- ${l.niche}: ${l.title}`),
  ].join("\n");
}

async function createListings(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const count = Number(payload.count ?? config.pod.listingsPerRun);
  const instructions = typeof payload.instructions === "string" ? payload.instructions.slice(0, 500) : "";
  // Personalized: the buyer's name is printed in the design (no printables: a download can't wait for a name).
  const personalized = payload.personalized === true;
  const digest = await knowledgeDigest();
  const types = availableTypes().filter((t) => t.variants.length || t.digital);
  if (!types.length) throw new Error("No product type is ready: run printful_setup and catalog_setup first.");
  const physical = types.filter((t) => !t.digital);
  const printable = personalized ? undefined : types.find((t) => t.digital);
  const perDesign = Math.max(1, Math.min(config.pod.productsPerDesign, physical.length));
  const productList = physical
    .map((t) => {
      const def = productType(t.typeId);
      const prices = t.variants.map((v) => v.priceCents + (personalized ? PERSONALIZATION_EXTRA_CENTS : 0));
      return `- ${t.typeId}: ${def?.noun ?? t.label}. ${def?.facts ?? ""} Price ${Math.min(...prices) / 100}–${Math.max(...prices) / 100} ${etsy.es.currency}.`;
    })
    .join("\n");
  const printableLine = printable
    ? `\n- ${PRINTABLE.id}: ${PRINTABLE.noun}. ${PRINTABLE.facts} Price ${PRINTABLE.priceCents / 100} ${etsy.es.currency}.`
    : "";

  const { ideas } = await askJson({
    agentId: ID,
    purpose: "pod_ideas",
    schema: IdeasSchema,
    effort: "medium",
    system:
      "You run a print-on-demand Etsy shop, 'All you can wish': typography designs on mugs, apparel, totes and posters. " +
      "You pick specific, under-served gift niches (professions, hobbies, life events) where buyers search for funny or heartfelt gifts. " +
      "Never use trademarks, brand names, celebrities, song lyrics, film quotes or copyrighted characters. " +
      "Write titles and descriptions for real buyers, not keyword lists. Each description must state the product facts given, " +
      "that the item is printed on demand by a production partner, and that sizes/colours are chosen from the menu.",
    prompt:
      `Today: ${todayIso()}.\n${await campaignBrief(ID)}\n\n${digest}\n\n${instructions ? `Jarne's direction for this batch (follow it): ${instructions}\n\n` : ""}` +
      `Products you can put a design on:\n${productList}${printableLine}\n\n` +
      (personalized ? PERSONALIZED_BRIEF : "") +
      `Propose ${count} new gift niches. For each give: niche, and listings for ${perDesign} products from the list that suit its buyer ` +
      "(a mug almost always fits; pick apparel, totes and posters when the idea works worn or on a wall). " +
      "Every product gets its OWN text, written for how that product is used: a mug for coffee, mornings and the desk; a T-shirt or hoodie " +
      "as something the buyer proudly wears and says about themselves; a tote for carrying, shopping and the commute; a poster or print " +
      "as a wall piece worth looking at every day. Use the same text on two products only when it genuinely works on both. " +
      "Each listing: product (its id), slogan (the exact printed text for that product, max ~8 words), designBrief (layout and typographic style), " +
      "title (≤140 chars, starts with the search phrase and names the product), description (3 short paragraphs with the product facts) " +
      "and 13 Etsy tags (each ≤20 chars)." +
      (printable
        ? ` Also add one '${PRINTABLE.id}' listing per niche, on top of those products: a printable wall-art download with a wall-worthy text ` +
          "(it may share the poster's text); title starts with the search phrase and says 'Printable Wall Art' or 'Digital Download'."
        : ""),
  });

  const created: string[] = [];
  for (const idea of ideas.slice(0, count)) {
    // A text used on two products is drawn once.
    const drawn = new Map<string, string>();
    const chosen = [
      ...idea.listings.filter((l) => l.product !== PRINTABLE.id).slice(0, perDesign),
      ...idea.listings.filter((l) => l.product === PRINTABLE.id).slice(0, 1),
    ];
    for (const raw of chosen) {
      try {
        const entry = types.find((t) => t.typeId === raw.product);
        if (!entry) continue; // a product that isn't available
        const text: ListingText = normaliseListing(raw);
        const key = sloganKey(raw.slogan);
        let svg = drawn.get(key);
        if (!svg) {
          svg = (await designWithRetry({ slogan: raw.slogan, niche: idea.niche, designBrief: raw.designBrief, personalized }, log, taskId)).svg;
          drawn.set(key, svg);
        }
        if (entry.digital) {
          const listing = await db.listing.create({
            data: {
              niche: idea.niche,
              title: text.title,
              description: withAiDisclosure(text.description, true),
              tags: text.tags,
              productType: PRINTABLE.id,
              priceCents: PRINTABLE.priceCents,
              currency: etsy.es.currency,
              designSvg: svg,
              designFile: "",
            },
          });
          const files: DigitalFile[] = [];
          for (const f of PRINTABLE.formats) {
            const file = await saveDesign(await renderPrintable(svg, f.width, f.height), `${listing.id}-${f.name}`, "jpg");
            files.push({ name: f.name, width: f.width, height: f.height, file });
          }
          await db.listing.update({ where: { id: listing.id }, data: { variants: files as unknown as object, designFile: files[0].file } });
          created.push(listing.id);
          await log.info(`Draft design created: ${text.title}`, { listingId: listing.id, niche: idea.niche, product: PRINTABLE.id }, taskId);
          continue;
        }
        const extra = personalized ? PERSONALIZATION_EXTRA_CENTS : 0;
        const listing = await db.listing.create({
          data: {
            niche: idea.niche,
            title: text.title,
            description: withAiDisclosure(text.description),
            tags: text.tags,
            productType: entry.typeId,
            priceCents: Math.min(...entry.variants.map((v) => v.priceCents)) + extra,
            currency: etsy.es.currency,
            designSvg: svg,
            designFile: "",
            printfulVariant: entry.variants[0].variantId,
            personalized,
          },
        });
        const variants = (await renderVariants(svg, entry, listing.id)).map((v) => ({ ...v, priceCents: v.priceCents + extra }));
        await db.listing.update({ where: { id: listing.id }, data: { variants: variants as unknown as object, designFile: variants[0].file } });
        created.push(listing.id);
        await log.info(`Draft design created: ${text.title}`, { listingId: listing.id, niche: idea.niche, product: entry.typeId }, taskId);
      } catch (err) {
        await log.warn(`Skipped ${raw.product} "${raw.slogan}": ${(err as Error).message}`, undefined, taskId);
      }
    }
  }

  if (created.length > 0) await enqueue(ID, "upload_listings", { listingIds: created });
  // The daily batch is followed by a small personalized one.
  if (payload.personalized === undefined && config.pod.personalizedPerRun > 0) {
    await enqueue(ID, "create_listings", { personalized: true, count: config.pod.personalizedPerRun });
  }
  return { created: created.length, personalized };
}

/** What the idea writer is told when the batch is personalized. */
const PERSONALIZED_BRIEF =
  "THIS BATCH IS PERSONALIZED: the buyer types a name at checkout and it is printed in the design. Pick niches where a name makes " +
  "the gift (grandparents, parents, aunts and uncles, a child, a teacher or nurse by name, a pet, a couple, a team role). " +
  "Every slogan contains the word NAME exactly once, where the buyer's name goes, and NAME stands on its own line, e.g. " +
  "\"This mug belongs to / NAME / hands off\" or \"Best Grandpa Ever / NAME\". Never put NAME in the middle of a sentence. " +
  "Titles start with 'Personalized' or 'Custom Name' plus the search phrase and the product. Each description starts with how it works: " +
  `type the name in the personalization box, up to ${MAX_NAME_CHARS} characters, and it is printed exactly as typed. ` +
  "Use tags such as 'personalized gift', 'custom name mug', 'gift with name'.\n\n";

const DESIGN_ATTEMPTS = 3;

const DesignReviewSchema = z.object({
  textAsRendered: z.string(),
  ok: z.boolean(),
  problems: z.array(z.string()),
});

/** Rules every design must follow; the reviewer checks the rendered result against the same list. */
const DESIGN_RULES =
  "Typography only, set straight and level: never put text on a curve or path, never rotate or tilt words or single letters, " +
  "never use textLength, lengthAdjust or letter squeezing. Every word separated by a real space. " +
  "Nothing smaller than one tenth of the canvas height: tiny captions, coordinates, call signs or fake small print are unreadable on a mug, leave them out. " +
  "At most 3 text sizes and 2 colours; one simple icon at most, beside the text, never behind or touching it. " +
  "Frames, banners and boxes only when every letter stays well inside them with clear space around it; when in doubt, no frame. " +
  "No brand names, logos, characters, celebrities, song lyrics, film or TV quotes, sports teams or trademarked phrases.";

/**
 * A second pair of eyes on the rendered design, as a buyer and a print shop would see it: exact
 * spelling and spacing of the slogan, nothing colliding or cut off, readable on a mug, and no
 * trademark risk. Uses the review model (cheaper than the designer).
 */
export async function reviewDesign(png: Buffer, slogan: string) {
  const small = await sharp(png).flatten({ background: "#ffffff" }).resize(1000, 800, { fit: "inside" }).png().toBuffer();
  return askJson({
    agentId: ID,
    purpose: "pod_design_review",
    model: config.kdp.reviewModel,
    effort: "low",
    maxTokens: 2000,
    schema: DesignReviewSchema,
    images: [small],
    system:
      "You are the quality check of a print shop. Be strict: this design goes on a mug or shirt sold to real customers, and a typo, " +
      "collision or trademark gets the product returned or the shop banned. First write down exactly the text you see (textAsRendered), " +
      "then judge it.",
    prompt:
      `Intended text: "${slogan}"\n\nReject (ok=false) if any of these is true, and list each problem briefly:\n` +
      "- the text differs from the intended text: a misspelling, a missing or extra word, words run together without a space;\n" +
      "- any letter touches or crosses a frame, banner, box, icon, line or other text, or sits outside its frame;\n" +
      "- text is on a curve, rotated, tilted, uneven or squashed;\n" +
      "- any text is too small to read on a mug (tiny captions or small print);\n" +
      "- an icon or ornament is unclear, broken, overlapping, or looks like clip-art gone wrong;\n" +
      "- the layout looks unbalanced or amateurish;\n" +
      "- it names or imitates a brand, character, celebrity, film/TV/song quote or trademarked phrase, or could offend.\n" +
      `Design rules it should follow: ${DESIGN_RULES}`,
  });
}

/**
 * Asks Claude for one side of the mug, renders it, checks nothing is cut off and has it reviewed.
 * Claude can't see its own rendering, so a layout miss or a failed review is sent back as feedback.
 */
async function designWithRetry(idea: DesignInput, log?: TaskContext["log"], taskId?: string): Promise<{ svg: string; png: Buffer }> {
  const side = sideSize();
  const mx = Math.round(side.width * 0.08);
  const my = Math.round(side.height * 0.08);
  let feedback = "";
  for (let attempt = 1; ; attempt++) {
    const svg = sanitizeSvg(
      await askText({
        agentId: ID,
        purpose: "pod_design_svg",
        effort: "medium",
        system:
          "You are a typography designer for gift products. Output one standalone SVG document and nothing else. " +
          `It is one side of a mug: use viewBox="0 0 ${side.width} ${side.height}" and a transparent background; ` +
          "the same design is printed on the other side automatically, so draw it once. " +
          "Use only <text>, <tspan>, <path>, <rect>, <circle>, <line>, <polygon>, <g>, <defs>, <use href=\"#id\"> and gradients. " +
          "Use only generic font families (serif, sans-serif, monospace). No images, links, scripts or external references. " +
          "Dark ink colours that print well on a white mug. " +
          `Keep every element inside x ${mx}–${side.width - mx} and y ${my}–${side.height - my}. ` +
          "You cannot measure text, so size it conservatively: a line of N characters needs a font-size of at most " +
          `${Math.round(((side.width - 2 * mx) / 0.62) / 10)}0/N for sans-serif capitals; split long slogans over more lines. ` +
          DESIGN_RULES +
          (idea.personalized
            ? ` PERSONALIZED: the word NAME in the slogan is the buyer's name. Draw it as exactly one <text id="personal-name"> element on its own line, ` +
              `with x at the horizontal centre, text-anchor="middle", a numeric font-size attribute and no <tspan> inside. Put a fitting sample ` +
              `first name in it (e.g. Emma, or Grandpa Joe for a grandfather). The name is the hero: the largest or second-largest text. ` +
              `Buyers type up to ${MAX_NAME_CHARS} characters, so give its line room: font-size at most ` +
              `${Math.round((side.width - 2 * mx) / 0.62 / 10)} for 10 capitals (smaller names are fine, long ones are shrunk automatically). ` +
              `Add data-case="upper" to print the name in capitals when that suits the style. Nothing else may depend on the name's length.`
            : ""),
        prompt: `Slogan (print exactly this text${idea.personalized ? ", with NAME replaced by your sample name" : ""}): "${idea.slogan}"\nNiche: ${idea.niche}\nBrief: ${idea.designBrief}${feedback}`,
      }),
    );
    if (idea.personalized) {
      const problems = templateProblems(svg);
      if (!problems.length) {
        // A long name must still fit without becoming tiny.
        try {
          const long = await fitName(svg, "Maximiliaan Jr");
          const size = (s: string) => Number(s.match(/id\s*=\s*["']personal-name["'][^>]*font-size\s*=\s*["']?([\d.]+)/i)?.[1] ?? 0);
          if (size(long) && size(long) < size(svg) * 0.45) problems.push("the name's line is too narrow: a long name becomes tiny. Give the name more width");
        } catch (err) {
          problems.push((err as Error).message);
        }
      }
      if (problems.length) {
        if (attempt >= DESIGN_ATTEMPTS) throw new Error(`Personalized design unusable: ${problems.join("; ")}`);
        feedback = `\n\nYour previous version can't be personalized: ${problems.join("; ")}. Fix exactly these points.`;
        continue;
      }
    }
    let png: Buffer;
    try {
      png = await prepareDesign(svg);
    } catch (err) {
      if (!(err instanceof DesignLayoutError) || attempt >= DESIGN_ATTEMPTS) throw err;
      feedback =
        `\n\nYour previous version was cut off at the ${err.edges.join(" and ")} edge. ` +
        "Make the text smaller or split it over more lines, and keep clear of the margins.";
      continue;
    }
    const intended = idea.personalized ? intendedText(idea.slogan, svg) : idea.slogan;
    const verdict = await reviewDesign(await sharp(Buffer.from(svg), { density: 150 }).png().toBuffer(), intended);
    if (verdict.ok) return { svg, png };
    await log?.info(`Ontwerp afgekeurd (${idea.slogan}): ${verdict.problems.join("; ")}`, { attempt }, taskId);
    if (attempt >= DESIGN_ATTEMPTS) throw new Error(`Design failed the quality check: ${verdict.problems.join("; ")}`);
    feedback =
      `\n\nThe quality check rejected your previous version (it read: "${verdict.textAsRendered}"). Problems: ${verdict.problems.join("; ")}. ` +
      "Draw it again, simpler, and avoid every one of these problems.";
  }
}

const MIN_MUG_PHOTOS = 2;

const MAX_MOCKUPS = 8;

/** Which mockups to make: one variant per colour (up to the type's limit), grouped by print file. */
export function mockupGroups(variants: ListingVariant[], colors: number): { file: string; placement: string; width: number; height: number; variantIds: number[] }[] {
  const perColor: ListingVariant[] = [];
  for (const v of variants) if (!perColor.some((x) => x.color === v.color)) perColor.push(v);
  const groups = new Map<string, { file: string; placement: string; width: number; height: number; variantIds: number[] }>();
  for (const v of perColor.slice(0, Math.max(1, colors))) {
    const g = groups.get(v.file) ?? { file: v.file, placement: v.placement, width: v.width, height: v.height, variantIds: [] };
    g.variantIds.push(v.variantId);
    groups.set(v.file, g);
  }
  return [...groups.values()];
}

/** Uploads Printful product photos to an Etsy listing from `startRank` on. Returns how many were added. */
async function addMockups(
  listing: { title: string; designFile: string; productType: string; variants: unknown },
  etsyId: string,
  startRank: number,
  log: TaskContext["log"],
  taskId?: string,
): Promise<number> {
  if (!printful.isPrintfulConfigured() || config.publicUrl.includes("localhost")) return 0; // Printful needs a public URL
  try {
    const variants = (listing.variants as ListingVariant[] | null) ?? [];
    const entry = catalogEntry(listing.productType);
    let photos: string[];
    if (listing.productType === PRINTABLE.id) {
      photos = (await printableMockups(listing as unknown as { id: string; designSvg: string })).slice(0, 6);
    } else if (variants.length && entry) {
      const groups = mockupGroups(variants, productType(listing.productType)?.mockupColors ?? 1);
      const each = Math.max(2, Math.ceil(MAX_MOCKUPS / groups.length));
      photos = [];
      for (const g of groups) {
        const urls = await printful.generateMockup(designUrl(g.file), { width: g.width, height: g.height }, {
          productId: entry.productId,
          variantIds: g.variantIds,
          placement: g.placement,
        });
        photos.push(...urls.slice(0, each));
      }
      photos = photos.slice(0, MAX_MOCKUPS);
    } else {
      photos = (await printful.generateMockup(designUrl(listing.designFile), getPrintSize())).slice(0, MAX_MOCKUPS);
    }
    let rank = startRank;
    for (const url of photos) {
      const img = Buffer.from(await (await fetch(url)).arrayBuffer());
      await etsy.uploadListingImage(etsyId, img, rank++);
    }
    if (photos.length < MIN_MUG_PHOTOS) {
      await log.warn(`Slechts ${photos.length} productfoto van Printful voor ${listing.title}`, { etsyId }, taskId);
    } else {
      await log.info(`${photos.length} productfoto's geüpload voor ${listing.title}`, { etsyId }, taskId);
    }
    return photos.length;
  } catch (err) {
    await log.warn(`Mockup failed for ${listing.title}: ${(err as Error).message}`, { etsyId }, taskId);
    return 0;
  }
}

/**
 * Listings on Etsy with too few photos (e.g. Printful refused the mockup) get their mug photos
 * added in front of the flat design. Safe to re-run: listings that have enough are skipped.
 */
async function addPhotos(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (config.dryRun || !etsy.isEtsyConfigured()) return { skipped: "dry run or Etsy not connected" };
  const listings = await db.listing.findMany({
    where: { source: "agent", etsyListingId: { not: null }, status: { in: ["uploaded", "active"] }, designFile: { not: "" } },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  let fixed = 0;
  for (const listing of listings) {
    const etsyId = listing.etsyListingId!;
    const count = await etsy.getListingImageCount(etsyId).catch(() => null);
    if (count === null || count > MIN_MUG_PHOTOS) continue; // gone from Etsy, or already has the design plus 2 photos
    if ((await addMockups(listing, etsyId, 1, log, taskId)) >= MIN_MUG_PHOTOS) fixed++;
    if (taskId) await db.task.update({ where: { id: taskId }, data: { status: "running" } });
  }
  await log.info(`Foto's aangevuld bij ${fixed} listing(s)`, undefined, taskId);
  // Videos are made from the photos, so they come after them.
  await enqueueOnce(ID, "add_videos");
  return { checked: listings.length, fixed };
}

/**
 * Photos for printable wall art: the design as a framed-style poster, from Printful's poster
 * mockups (when posters are set up), then a preview of the file on white.
 */
async function printableMockups(listing: { id: string; designSvg: string }): Promise<string[]> {
  const poster = catalogEntry("poster");
  const v = poster?.enabled ? poster.variants.find((x) => /18 x 24/.test(x.size)) ?? poster.variants[0] : undefined;
  if (!poster || !v || !printful.isPrintfulConfigured() || config.publicUrl.includes("localhost")) return [];
  const file = await saveDesign(await renderPrintFile(listing.designSvg, "center", v.width, v.height, "dark"), `${listing.id}-poster-mockup`);
  return printful.generateMockup(designUrl(file), { width: v.width, height: v.height }, { productId: poster.productId, variantIds: [v.variantId], placement: v.placement });
}

/** Uploads a printable wall-art listing: a digital draft, its photos and the 5 download files. */
async function uploadPrintable(
  listing: { id: string; title: string; description: string; tags: string[]; designSvg: string; etsyListingId: string | null; variants: unknown },
  log: TaskContext["log"],
  taskId?: string,
): Promise<boolean> {
  const entry = catalogEntry(PRINTABLE.id);
  if (!entry?.enabled || !entry.taxonomyId) {
    await log.warn(`Niet geüpload: ${listing.title} (${entry?.reason ?? "printbare posters staan uit; start catalog_setup"})`, undefined, taskId);
    return false;
  }
  let etsyId = listing.etsyListingId;
  if (!etsyId) {
    const draft = await etsy.createDraftListing({
      title: listing.title,
      description: withAiDisclosure(listing.description, true),
      priceCents: PRINTABLE.priceCents,
      tags: listing.tags,
      taxonomyId: entry.taxonomyId,
      digital: true,
    });
    etsyId = String(draft.listing_id);
    await db.listing.update({ where: { id: listing.id }, data: { etsyListingId: etsyId } });
  }
  let rank = 1;
  try {
    for (const url of (await printableMockups(listing)).slice(0, 6)) {
      await etsy.uploadListingImage(etsyId, Buffer.from(await (await fetch(url)).arrayBuffer()), rank++);
    }
  } catch (err) {
    await log.warn(`Poster mockup failed for ${listing.title}: ${(err as Error).message}`, { etsyId }, taskId);
  }
  const files = (listing.variants as DigitalFile[] | null) ?? [];
  if (!files.length) throw new Error(`No download files for ${listing.title}`);
  const preview = await sharp(await readFile(path.join(designsDir(), files[0].file))).resize(2000).png().toBuffer();
  await etsy.uploadListingImage(etsyId, preview, rank);
  const slug = listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-+$/, "");
  for (const [i, f] of files.entries()) {
    await etsy.uploadListingFile(etsyId, await readFile(path.join(designsDir(), f.file)), `${slug}-${f.name}.jpg`, i + 1);
  }
  await db.listing.update({ where: { id: listing.id }, data: { status: "uploaded", priceCents: PRINTABLE.priceCents, currency: etsy.es.currency } });
  await log.info(`Printbare poster geüpload: ${listing.title} (${rank - 1} foto's, ${files.length} bestanden)`, { etsyId }, taskId);
  return true;
}

async function uploadListings(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  // Without ids (e.g. started from chat): every local draft that never reached Etsy, such as
  // the ones made while DRY_RUN was on.
  const ids =
    (payload.listingIds as string[] | undefined) ??
    (
      await db.listing.findMany({
        where: { source: "agent", status: "draft", etsyListingId: null, designFile: { not: "" } },
        orderBy: { createdAt: "asc" },
        take: 10,
        select: { id: true },
      })
    ).map((l) => l.id);
  if (config.dryRun || !etsy.isEtsyConfigured()) {
    await log.info(`Dry run: ${ids.length} listing(s) kept as local drafts`, { ids }, taskId);
    return { uploaded: 0, dryRun: true };
  }

  if (!etsy.isEtsyListingReady()) {
    throw new Error("Etsy shop settings are not known yet (shipping profile, processing profile, category). Run etsy_setup first.");
  }
  const uploaded: string[] = [];
  for (const id of ids) {
    const listing = await db.listing.findUniqueOrThrow({ where: { id } });
    if (listing.status !== "draft") continue; // already on Etsy
    if (listing.productType === PRINTABLE.id) {
      if (await uploadPrintable(listing, log, taskId)) uploaded.push(id);
      continue;
    }
    const variants = (listing.variants as ListingVariant[] | null) ?? [];
    const entry = catalogEntry(listing.productType);
    if (variants.length && (!entry || !entry.enabled)) {
      await log.warn(`Niet geüpload: ${listing.title} (${entry?.reason ?? `producttype ${listing.productType} staat uit`})`, undefined, taskId);
      continue;
    }
    // A retry resumes a listing that reached Etsy but didn't get its sizes or photos yet.
    let etsyId = listing.etsyListingId;
    if (!etsyId) {
      const draft = await etsy.createDraftListing({
        title: listing.title,
        description: withAiDisclosure(listing.description),
        // The current price, also for drafts made before it changed.
        priceCents: variants.length ? Math.min(...variants.map((v) => v.priceCents)) : etsy.es.priceCents,
        tags: listing.tags,
        taxonomyId: entry?.taxonomyId ?? undefined,
        shippingProfileId: entry?.shippingProfileId ?? undefined,
      });
      etsyId = String(draft.listing_id);
      await db.listing.update({ where: { id }, data: { etsyListingId: etsyId } });
    }
    if (variants.length) await etsy.updateListingInventory(etsyId, buildInventory(variants, etsy.es.readinessStateId));
    if (listing.personalized) await etsy.setListingPersonalization(etsyId, [PERSONALIZATION_QUESTION]);

    // Printful product photos first, then (personalized) the "add any name" photo; the flat design always goes last.
    let rank = 1 + (await addMockups(listing, etsyId, 1, log, taskId));
    if (listing.personalized) {
      try {
        await etsy.uploadListingImage(etsyId, await personalizationCard(listing.designSvg), rank);
        rank++;
      } catch (err) {
        await log.warn(`Naamfoto mislukt voor ${listing.title}: ${(err as Error).message}`, { etsyId }, taskId);
      }
    }
    const design = await readFile(path.join(designsDir(), listing.designFile));
    await etsy.uploadListingImage(etsyId, design, rank);
    await db.listing.update({
      where: { id },
      data: {
        status: "uploaded",
        priceCents: variants.length ? Math.min(...variants.map((v) => v.priceCents)) : etsy.es.priceCents,
        currency: etsy.es.currency,
      },
    });
    uploaded.push(id);
    // Heartbeat: waiting on Printful's rate limit must not make the task look stuck.
    if (taskId) await db.task.update({ where: { id: taskId }, data: { status: "running" } });
  }

  if (uploaded.length === 0) return { uploaded: 0 };
  await enqueueOnce(ID, "add_videos");
  const { now, ask } = await splitForAutoPublish(uploaded);
  if (now.length) await enqueue(ID, "publish_listings", { listingIds: now });
  if (ask.length) {
    await requestApproval({
      agentId: ID,
      kind: "etsy_publish",
      title: `${ask.length} Etsy-listing(s) publiceren`,
      details:
        `De concepten staan op Etsy. Bekijk elk ontwerp eerst (Etsy eist menselijke controle per listing) op ` +
        `${config.publicUrl}/dashboard/ → Bedrijven → Etsy-winkel, en keur ze daar per stuk goed of af. Publiceren kost $0,20 per stuk.`,
      amountCents: ask.length * ETSY_LISTING_FEE_USD_CENTS,
      currency: "USD",
      payload: { listingIds: ask },
    });
  }
  return { uploaded: uploaded.length, publishedNow: now.length, waitingForApproval: ask.length };
}

/** Listings published today (each one is a recorded Etsy listing fee). */
async function publishedToday(): Promise<number> {
  return db.cost.count({ where: { agentId: ID, category: "etsy_fee", occurredAt: { gte: startOfDay(new Date(), config.timezone) } } });
}

/** Which new listings go live right away (within the daily allowance) and which wait for Jarne. */
export async function splitForAutoPublish(ids: string[]): Promise<{ now: string[]; ask: string[] }> {
  if (config.etsy.autoPublish) return { now: ids, ask: [] };
  const room = Math.max(0, config.etsy.autoPublishPerDay - (await publishedToday()));
  return { now: ids.slice(0, room), ask: ids.slice(room) };
}

async function publishListings(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const ids = (payload.listingIds as string[]) ?? [];
  let published = 0;
  for (const id of ids) {
    const listing = await db.listing.findUniqueOrThrow({ where: { id } });
    if (!listing.etsyListingId || listing.status === "active") continue;
    await etsy.activateListing(listing.etsyListingId);
    await db.listing.update({ where: { id }, data: { status: "active" } });
    await recordCost({
      agentId: ID,
      category: "etsy_fee",
      amountCents: ETSY_LISTING_FEE_USD_CENTS,
      currency: "USD",
      note: `Listing fee: ${listing.title}`,
    });
    published++;
  }
  await log.info(`Published ${published} listing(s) on Etsy`, { ids }, taskId);
  return { published };
}

/**
 * Brings the shop's real listings into the system: anything active on Etsy that we don't know yet
 * (for example mugs Jarne placed by hand through Printful) is added, known ones are updated, and
 * listings that are no longer active are marked ended. Orders for listings the agent didn't create
 * are left to Printful's own Etsy integration (fulfilReceipt skips them).
 */
export async function upsertEtsyListings(
  listings: etsy.EtsyListing[],
  imageFor: (listingId: number) => Promise<string | null>,
): Promise<{ added: number; updated: number; ended: number }> {
  let added = 0;
  let updated = 0;
  const activeIds = new Set(listings.map((l) => String(l.listing_id)));
  for (const l of listings) {
    const etsyListingId = String(l.listing_id);
    const fields = {
      title: decodeEntities(l.title).slice(0, 140),
      description: decodeEntities(l.description),
      tags: l.tags.map(decodeEntities),
      priceCents: etsy.moneyToCents(l.price),
      currency: l.price.currency_code,
      status: "active",
      favorites: l.num_favorers ?? 0,
    };
    const known = await db.listing.findUnique({ where: { etsyListingId } });
    if (known) {
      await db.listing.update({ where: { id: known.id }, data: fields });
      updated++;
    } else {
      await db.listing.create({
        data: {
          ...fields,
          etsyListingId,
          niche: "Etsy-winkel",
          source: "etsy",
          designSvg: "",
          designFile: "",
          imageUrl: await imageFor(l.listing_id).catch(() => null),
        },
      });
      added++;
    }
  }
  const gone = await db.listing.updateMany({
    where: { status: "active", etsyListingId: { not: null, notIn: [...activeIds] } },
    data: { status: "ended" },
  });
  return { added, updated, ended: gone.count };
}

async function syncListings(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return { skipped: "etsy not connected" };
  const result = await upsertEtsyListings(await etsy.getActiveListings(), etsy.getMainImageUrl);
  const drafts = await etsy.getListingsByState("draft");
  const reviewed = await settleReviewedDrafts(new Set(drafts.map((l) => String(l.listing_id))));
  if (result.added || result.ended || reviewed.removed || reviewed.closedApprovals) {
    await log.info(
      `Etsy-winkel bijgewerkt: ${result.added} nieuw, ${result.updated} bijgewerkt, ${result.ended} beëindigd, ` +
        `${reviewed.removed} concept(en) verwijderd op Etsy, ${reviewed.closedApprovals} publicatieverzoek(en) afgesloten`,
      { ...result, ...reviewed },
      taskId,
    );
  }
  return { ...result, ...reviewed };
}

/**
 * Drafts Jarne published or deleted by hand on Etsy: a draft that is neither live (the active sync
 * already marked those) nor still a draft was deleted, so it is marked removed. Publish requests
 * whose listings are all no longer waiting are closed, so Telegram stops asking about them.
 */
export async function settleReviewedDrafts(draftIds: Set<string>): Promise<{ removed: number; closedApprovals: number }> {
  const waiting = await db.listing.findMany({ where: { status: "uploaded", etsyListingId: { not: null } } });
  const gone = waiting.filter((l) => !draftIds.has(l.etsyListingId!)).map((l) => l.id);
  if (gone.length) await db.listing.updateMany({ where: { id: { in: gone } }, data: { status: "removed" } });

  let closedApprovals = 0;
  const pending = await db.approval.findMany({ where: { kind: "etsy_publish", status: "pending" } });
  for (const a of pending) {
    const ids = ((a.payload as { listingIds?: string[] }).listingIds ?? []).map(String);
    const stillWaiting = await db.listing.count({ where: { id: { in: ids }, status: "uploaded" } });
    if (stillWaiting > 0) continue;
    await db.approval.update({ where: { id: a.id }, data: { status: "executed", decidedAt: new Date() } });
    closedApprovals++;
  }
  return { removed: gone.length, closedApprovals };
}

/**
 * Puts the shop's return policy on every listing that has none (Etsy requires one on live listings).
 * The policy is the shop's own, or else the one Jarne set on any listing by hand. Safe to re-run.
 */
async function fixReturnPolicy(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return { skipped: "etsy not connected" };
  const listings = [...(await etsy.getListingsByState("active")), ...(await etsy.getListingsByState("draft"))];
  const policyId = (await etsy.getReturnPolicies())[0]?.return_policy_id ?? mostUsedId(listings, "return_policy_id");
  if (!policyId) {
    throw new Error(
      "Geen retourbeleid gevonden in de winkel of op een listing. Zet het retourbeleid één keer met de hand op één listing " +
        "(of maak er één in Shop Manager → Instellingen → Beleid); daarna zet deze taak het op alle andere.",
    );
  }
  await saveReturnPolicy(policyId);
  if (config.dryRun) return { dryRun: true, policyId };
  let fixed = 0;
  for (const l of listings) {
    if (l.return_policy_id) continue;
    await etsy.setListingReturnPolicy(String(l.listing_id), policyId);
    fixed++;
    if (taskId && fixed % 10 === 0) await db.task.update({ where: { id: taskId }, data: { status: "running" } });
  }
  await log.info(`Retourbeleid #${policyId} gezet op ${fixed} listing(s); nieuwe listings krijgen het voortaan ook`, undefined, taskId);
  return { policyId, fixed };
}

/**
 * Daily upkeep after the morning's listings are up: fills in missing product photos, puts the
 * return policy on listings without one, and uploads drafts that never reached Etsy. Each step is
 * its own task, so a failure shows up in Problems with its own reason.
 */
const VIDEOS_PER_RUN = 25;
const VIDEO_FAILS_KEY = "etsy.video.failures";

/**
 * Gives every live and draft listing without a video a short one made from its own photos (Etsy
 * shows it in search). Covers listings placed by hand too. Works in batches: when more are left it
 * queues itself again. A listing that failed twice is skipped. Free on Etsy, safe to re-run.
 */
async function addVideos(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (config.dryRun || !etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return { skipped: "dry run or Etsy not connected" };
  if (!(await ffmpegAvailable())) throw new Error("ffmpeg ontbreekt op de server; het staat in de Dockerfile, dus deploy opnieuw");
  const failures = (await getSetting<Record<string, number>>(VIDEO_FAILS_KEY)) ?? {};
  const listings = [...(await etsy.getListingsByState("active")), ...(await etsy.getListingsByState("draft"))];
  const titles: string[] = [];
  let checked = 0;
  let left = 0;
  for (const l of listings) {
    const id = String(l.listing_id);
    if ((failures[id] ?? 0) >= 2) continue;
    if (titles.length >= VIDEOS_PER_RUN) {
      left++;
      continue;
    }
    checked++;
    try {
      if ((await etsy.getListingVideoCount(id)) > 0) continue;
      const urls = (await etsy.getListingImageUrls(id)).slice(0, MAX_PHOTOS);
      if (!urls.length) continue;
      const photos = await Promise.all(
        urls.map(async (u) => {
          const res = await fetch(u);
          if (!res.ok) throw new Error(`photo download failed: ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        }),
      );
      const video = await makeListingVideo(photos);
      await etsy.uploadListingVideo(id, video, `listing-${id}.mp4`);
      titles.push(decodeEntities(l.title));
    } catch (err) {
      failures[id] = (failures[id] ?? 0) + 1;
      await log.warn(`Video mislukt voor ${decodeEntities(l.title)}: ${(err as Error).message}`, { listingId: id }, taskId);
    }
  }
  await setSetting(VIDEO_FAILS_KEY, failures);
  if (titles.length) {
    await log.info(`Video toegevoegd aan ${titles.length} listing(s)${left ? `, nog ${left} te gaan` : ""}:\n${titles.join("\n")}`, undefined, taskId);
  }
  if (left) await enqueue(ID, "add_videos", {});
  return { added: titles.length, checked, left };
}

/** Test addresses: what an order to each market costs (Printful's tax and shipping depend on the address). */
const PRICING_MARKETS = [
  { country: "US", eu: false, label: "VS", recipient: { name: "Test", address1: "100 Main St", city: "Los Angeles", state_code: "CA", country_code: "US", zip: "90012" } },
  { country: "GB", eu: false, label: "VK", recipient: { name: "Test", address1: "10 High Street", city: "London", country_code: "GB", zip: "SW1A 1AA" } },
  { country: "DE", eu: true, label: "Duitsland", recipient: { name: "Test", address1: "Unter den Linden 1", city: "Berlin", country_code: "DE", zip: "10117" } },
  { country: "BE", eu: true, label: "België", recipient: { name: "Test", address1: "Wetstraat 1", city: "Brussel", country_code: "BE", zip: "1000" } },
];
export const PRICING_KEY = "pricing.report";
const SALE_LEVELS = [0, 0.2, 0.3];
/** A sale must still leave at least this much per item. */
const MIN_SALE_PROFIT_CENTS = 300;

export interface PricingRow {
  type: string;
  label: string;
  size: string;
  market: string;
  priceCents: number;
  shippingChargedCents: number;
  printfulCents: number;
  printfulShippingCents: number;
  printfulVatCents: number;
  profit: Record<string, number>;
  profitOffsiteCents: number;
  maxDiscountPct: number;
}

/**
 * The real profit of every product in every main market: asks Printful what an order would cost
 * (product, shipping, VAT) and reads what the Etsy shipping profile charges the buyer, then works
 * out Etsy's fees, the profit at 0/20/30% off, and the deepest sale that still leaves €3.
 */
async function pricingReport(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!printful.hasPrintfulToken() || !etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return { skipped: "Printful or Etsy not connected" };
  const rows: PricingRow[] = [];
  const problems: string[] = [];
  for (const entry of enabledTypes().filter((e) => !e.digital)) {
    // Printful's price doesn't depend on the design: a simple test print file of the right size will do.
    const files = new Map<string, string>();
    const fileFor = async (v: CatalogVariant) => {
      const key = `${v.placement}-${v.width}x${v.height}`;
      if (!files.has(key)) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400"><text x="500" y="250" font-size="160" text-anchor="middle" font-family="sans-serif">SAMPLE</text></svg>`;
        files.set(key, await saveDesign(await renderPrintFile(svg, entry.layout, v.width, v.height, "dark"), `pricing-sample-${entry.typeId}-${key}`));
      }
      return files.get(key)!;
    };
    const byPrice = [...entry.variants].sort((a, b) => a.priceCents - b.priceCents);
    const picks = [...new Map([byPrice[0], byPrice[byPrice.length - 1]].map((v) => [v.size, v])).values()];
    const destinations = entry.shippingProfileId ? (await etsy.getShippingProfile(entry.shippingProfileId)).shipping_profile_destinations : [];
    for (const v of picks) {
      const file = await fileFor(v);
      for (const m of PRICING_MARKETS) {
        try {
          const c = await printful.estimateCosts({ recipient: m.recipient, items: [{ variantId: v.variantId, quantity: 1, fileUrl: designUrl(file), placement: v.placement }] });
          const toCents = (x: string) => toEurCents(Math.round(Number(x) * 100), c.currency);
          const charged = etsy.shippingCostFor(destinations, m.country, m.eu);
          if (charged === null) {
            problems.push(`${entry.label}: je verzendprofiel "${entry.shippingProfileTitle}" verzendt niet naar ${m.label}`);
            continue;
          }
          const base = { priceCents: v.priceCents, shippingChargedCents: charged, printfulTotalCents: toCents(c.total) };
          rows.push({
            type: entry.typeId,
            label: entry.label,
            size: v.size,
            market: m.label,
            priceCents: v.priceCents,
            shippingChargedCents: charged,
            printfulCents: toCents(c.total),
            printfulShippingCents: toCents(c.shipping),
            printfulVatCents: toCents(c.vat) + toCents(c.tax),
            profit: Object.fromEntries(SALE_LEVELS.map((d) => [`${d * 100}`, saleProfit({ ...base, discountPct: d }).profitCents])),
            profitOffsiteCents: saleProfit({ ...base, offsiteAds: true }).profitCents,
            maxDiscountPct: maxDiscountPct(base, MIN_SALE_PROFIT_CENTS),
          });
        } catch (err) {
          problems.push(`${entry.label} ${v.size} → ${m.label}: ${(err as Error).message}`);
        }
        if (taskId) await db.task.update({ where: { id: taskId }, data: { status: "running" } });
      }
    }
  }
  const printable = saleProfit({ priceCents: PRINTABLE.priceCents, shippingChargedCents: 0, printfulTotalCents: 0 });
  await setSetting(PRICING_KEY, { at: new Date().toISOString(), rows, problems, printableProfitCents: printable.profitCents });

  const eur = (c: number) => `€${(c / 100).toFixed(2)}`;
  const lines = [...new Set(rows.map((r) => r.label))].map((label) => {
    const rs = rows.filter((r) => r.label === label);
    const worst = rs.reduce((a, b) => (a.profit["0"] < b.profit["0"] ? a : b));
    const deepest = Math.min(...rs.map((r) => r.maxDiscountPct));
    return `${label}: winst ${eur(Math.min(...rs.map((r) => r.profit["0"])))}–${eur(Math.max(...rs.map((r) => r.profit["0"])))} (laagst: ${worst.size} naar ${worst.market}), bij 20% korting ${eur(Math.min(...rs.map((r) => r.profit["20"])))}, max. korting voor €3 winst: ${deepest}%`;
  });
  await log.info(
    `Prijscheck: ${rows.length} combinaties doorgerekend met echte Printful-kosten en je Etsy-verzendprijzen\n${lines.join("\n")}` +
      `\nPrintbare poster: ${eur(printable.profitCents)} per verkoop` +
      (problems.length ? `\nLet op:\n${problems.join("\n")}` : ""),
    undefined,
    taskId,
  );
  return { rows: rows.length, problems: problems.length };
}

async function maintenance(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (config.dryRun || !etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return { skipped: "dry run or Etsy not connected" };
  const stuck = await db.listing.count({
    where: { source: "agent", status: "draft", designFile: { not: "" }, createdAt: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
  });
  await enqueueOnce(ID, "add_photos");
  await enqueueOnce(ID, "fix_return_policy");
  await enqueueOnce(ID, "add_ai_disclosure");
  if (stuck) await enqueueOnce(ID, "upload_listings");
  await log.info(`Dagelijks onderhoud gestart: foto's en video's aanvullen, retourbeleid${stuck ? `, ${stuck} vastgelopen concept(en) uploaden` : ""}`, undefined, taskId);
  return { stuckDrafts: stuck };
}

/** Looks up the product range (Printful variants, Etsy categories and shipping profiles) and reports it. */
async function catalogSetup(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!printful.hasPrintfulToken() || !etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) {
    return { skipped: "Printful or Etsy not connected" };
  }
  const entries = await findCatalog();
  const on = entries.filter((e) => e.enabled);
  const lines = entries.map((e) => {
    if (!e.enabled) return `✗ ${e.label}: ${e.reason}`;
    if (e.digital) return `✓ ${e.label}: digitaal, winst ca. €${(estimatedProfitCents(PRINTABLE.priceCents, 0) / 100).toFixed(2)} per verkoop, geen productie of verzending`;
    const margins = e.variants.map((v) => estimatedProfitCents(v.priceCents, v.costUsd));
    return `✓ ${e.label}: ${e.variants.length} varianten, winst ca. €${(Math.min(...margins) / 100).toFixed(2)}–${(Math.max(...margins) / 100).toFixed(2)} per stuk, verzendprofiel "${e.shippingProfileTitle}"`;
  });
  await log.info(`Productaanbod: ${on.length} van ${entries.length} soorten actief\n${lines.join("\n")}`, { entries: entries.map((e) => ({ type: e.typeId, enabled: e.enabled, reason: e.reason })) }, taskId);
  return { enabled: on.map((e) => e.typeId), off: entries.filter((e) => !e.enabled).map((e) => e.typeId) };
}

/** Rough profit per item in EUR cents: price minus Printful's cost and Etsy's fees (6.5% + ~4% payment + €0.30 + $0.20 listing). */
export function estimatedProfitCents(priceCents: number, costUsd: number): number {
  const cost = costUsd * 100 * config.budget.usdToEur;
  const fees = priceCents * 0.105 + 30 + 20 * config.budget.usdToEur;
  return Math.round(priceCents - cost - fees);
}

/**
 * Adds the AI disclosure Etsy requires to every live and draft listing that lacks it, including
 * the designs placed by hand. Free on Etsy, safe to re-run.
 */
async function addAiDisclosure(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (config.dryRun || !etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return { skipped: "dry run or Etsy not connected" };
  const listings = [...(await etsy.getListingsByState("active")), ...(await etsy.getListingsByState("draft"))];
  let added = 0;
  for (const l of listings) {
    const current = decodeEntities(l.description);
    if (current.includes(AI_DISCLOSURE_MARKER)) continue;
    const description = withAiDisclosure(current, l.listing_type === "download");
    await etsy.updateListingDescription(String(l.listing_id), description);
    await db.listing.updateMany({ where: { etsyListingId: String(l.listing_id) }, data: { description } });
    added++;
    if (taskId && added % 10 === 0) await db.task.update({ where: { id: taskId }, data: { status: "running" } });
  }
  await log.info(`AI-vermelding toegevoegd aan ${added} listing(s) (Etsy-regel)`, undefined, taskId);
  return { added, checked: listings.length };
}

async function etsySetup(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return { skipped: "etsy not connected" };
  const s = await findEtsySetup();
  await log.info(
    `Etsy ingesteld: winkel "${s.shopName}" (${s.currency}), prijs ${(s.priceCents / 100).toFixed(2)}, verzendprofiel "${s.shippingProfileTitle}", verwerking ${s.readinessLabel}` +
      (etsy.es.productionPartnerId
        ? `, productiepartner #${etsy.es.productionPartnerId}`
        : ` · let op: geen productiepartner gevonden (Etsy gaf: ${s.partnersSeen?.join(", ") || "geen enkele"})`) +
      (s.returnPolicyId ? "" : " · geen apart retourbeleid gevonden: listings gebruiken het beleid van je winkel"),
    s,
    taskId,
  );
  await enqueueOnce(ID, "catalog_setup");
  return s;
}

async function printfulSetup(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!printful.hasPrintfulToken()) return { skipped: "no Printful token" };
  const s = await findPrintfulSetup();
  await log.info(
    `Printful ingesteld: winkel "${s.storeName}", mok product ${s.productId} variant ${s.variantId}, printmaat ${s.printWidth}×${s.printHeight}`,
    s,
    taskId,
  );
  await enqueueOnce(ID, "catalog_setup");
  return s;
}

async function syncSales(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!etsy.isEtsyConfigured() || !(await etsy.isEtsyConnected())) return { skipped: "etsy not connected" };
  const since = (await getSetting<number>(RECEIPTS_CURSOR)) ?? Math.floor(Date.now() / 1000) - 7 * 86400;
  const receipts = await etsy.getPaidReceiptsSince(since);
  let newSales = 0;
  let cursor = since;
  for (const r of receipts) {
    cursor = Math.max(cursor, r.create_timestamp);
    const exists = await db.sale.findUnique({
      where: { source_externalId: { source: "etsy", externalId: String(r.receipt_id) } },
    });
    if (exists) continue;
    await db.sale.create({
      data: {
        agentId: ID,
        source: "etsy",
        externalId: String(r.receipt_id),
        amountCents: etsy.moneyToCents(r.grandtotal),
        currency: r.grandtotal.currency_code,
        occurredAt: new Date(r.create_timestamp * 1000),
        data: r as unknown as object,
      },
    });
    await enqueue(ID, "fulfil_receipt", { receiptId: String(r.receipt_id) });
    newSales++;
  }
  await setSetting(RECEIPTS_CURSOR, cursor);
  if (newSales > 0) await log.info(`${newSales} new Etsy sale(s)`, undefined, taskId);
  return { newSales };
}

/**
 * Printful order lines for an Etsy receipt. The buyer's size and colour come from the SKU
 * ("PF-<variant>"); listings without variants use their one variant. Listings that aren't ours
 * (placed by hand, fulfilled by Printful's own Etsy integration) are skipped.
 */
export type OrderItem = {
  variantId: number;
  quantity: number;
  fileUrl: string;
  placement?: string;
  /** Personalized listings: the buyer's text and what is needed to draw their own print file. */
  personal?: { transactionId: number; text: string | null; listingId: string; variant: ListingVariant | null };
};

export function orderItemsFor(
  transactions: etsy.EtsyReceipt["transactions"],
  listings: { id?: string; etsyListingId: string | null; printfulVariant: number | null; designFile: string; variants: unknown; title: string; personalized?: boolean }[],
): OrderItem[] {
  const items: OrderItem[] = [];
  for (const t of transactions) {
    const listing = listings.find((l) => l.etsyListingId === String(t.listing_id));
    if (!listing?.printfulVariant) continue; // not one of ours
    const variants = (listing.variants as ListingVariant[] | null) ?? [];
    if (!variants.length) {
      items.push({ variantId: listing.printfulVariant, quantity: t.quantity, fileUrl: designUrl(listing.designFile) });
      continue;
    }
    const wanted = variantFromSku(t.sku);
    const v = variants.find((x) => x.variantId === wanted) ?? (variants.length === 1 ? variants[0] : undefined);
    if (!v) throw new Error(`Unknown size/colour (SKU "${t.sku ?? ""}") for "${listing.title}": fulfil this order by hand`);
    const item: OrderItem = { variantId: v.variantId, quantity: t.quantity, fileUrl: designUrl(v.file), placement: v.placement };
    if (listing.personalized) {
      const raw = personalizationOf(t);
      item.personal = { transactionId: t.transaction_id, text: raw === null ? null : decodeEntities(raw), listingId: listing.id ?? "", variant: v };
    }
    items.push(item);
  }
  return items;
}

const NameModerationSchema = z.object({ ok: z.boolean(), reason: z.string() });

/**
 * Draws the buyer's own print file for a personalized item and checks it like a new design: the text
 * must be printable and decent, and the rendered result must read correctly with nothing cut off.
 * Returns the file URL, or the reason Jarne has to look at it first.
 */
async function personalPrintFile(item: OrderItem, receiptId: string, approvedText: string | undefined): Promise<{ url: string } | { problem: string; preview?: string }> {
  const p = item.personal!;
  const listing = await db.listing.findUniqueOrThrow({ where: { id: p.listingId } });
  const check = approvedText !== undefined ? { ok: true as const, text: approvedText } : checkName(p.text);
  if (!check.ok) return { problem: `${check.reason} (koper typte: "${check.text}")` };
  const entry = catalogEntry(listing.productType);
  if (!p.variant || !entry) return { problem: "het product van deze listing staat niet meer in de catalogus" };

  if (approvedText === undefined) {
    const verdict = await askJson({
      agentId: ID,
      purpose: "pod_name_check",
      model: config.kdp.reviewModel,
      effort: "low",
      maxTokens: 300,
      schema: NameModerationSchema,
      system: "You check text a customer wants printed on a gift. Allow names, nicknames and short friendly words. Refuse insults, slurs, sexual or hateful text, brand names and celebrity names.",
      prompt: `Customer text: "${check.text}"`,
    });
    if (!verdict.ok) return { problem: `de tekst "${check.text}" werd tegengehouden: ${verdict.reason}` };
  }

  const svg = await fitName(listing.designSvg, check.text);
  const v = p.variant;
  const png = await renderPrintFile(svg, entry.layout, v.width, v.height, v.ink);
  const file = await saveDesign(png, `order-${receiptId}-${p.transactionId}-${v.variantId}`);
  const preview = await sharp(Buffer.from(svg), { density: 150 }).png().toBuffer();
  const review = await reviewDesign(preview, designText(svg));
  if (!review.ok) return { problem: `de kwaliteitscontrole keurde de print af: ${review.problems.join("; ")}`, preview: designUrl(file) };
  return { url: designUrl(file) };
}

async function fulfilReceipt(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const receiptId = String(payload.receiptId);
  const sale = await db.sale.findUniqueOrThrow({
    where: { source_externalId: { source: "etsy", externalId: receiptId } },
  });
  const r = sale.data as unknown as etsy.EtsyReceipt;

  const listings = await db.listing.findMany({ where: { etsyListingId: { in: r.transactions.map((t) => String(t.listing_id)) } } });
  const items = orderItemsFor(r.transactions, listings);
  if (items.length === 0) return { skipped: "no POD items" };

  // Personalized items get their own print file with the buyer's name; anything doubtful goes to Jarne first.
  const approvedTexts = (payload.approvedTexts as Record<string, string> | undefined) ?? {};
  for (const item of items.filter((i) => i.personal)) {
    const p = item.personal!;
    const result = await personalPrintFile(item, receiptId, approvedTexts[String(p.transactionId)]);
    if ("url" in result) {
      item.fileUrl = result.url;
      await log.info(`Gepersonaliseerde print gemaakt voor bestelling ${receiptId}: "${p.text}"`, { file: result.url }, taskId);
      continue;
    }
    await requestApproval({
      agentId: ID,
      kind: "personal_text",
      title: `Naam controleren voor Etsy-bestelling ${receiptId}`,
      details:
        `Gepersonaliseerde bestelling: ${result.problem}.` +
        (result.preview ? ` Voorbeeld van de print: ${result.preview}.` : "") +
        ` Goedkeuren = printen zoals de koper het typte ("${p.text ?? ""}"). Afwijzen = niets bestellen; stuur de koper dan een bericht via Etsy.`,
      payload: { receiptId, approvedTexts: { ...approvedTexts, [String(p.transactionId)]: p.text ?? "" } },
    });
    return { waitingForApproval: "personal_text" };
  }
  for (const item of items) delete item.personal;
  if (config.dryRun || !printful.isPrintfulConfigured()) {
    await log.warn(`Dry run: receipt ${receiptId} needs fulfilment by hand`, { items }, taskId);
    return { dryRun: true };
  }

  const order = await printful.createDraftOrder({
    externalId: `etsy-${receiptId}`,
    recipient: {
      name: r.name,
      address1: r.first_line,
      address2: r.second_line ?? undefined,
      city: r.city,
      state_code: r.state ?? undefined,
      country_code: r.country_iso,
      zip: r.zip,
    },
    items,
  });
  const costCents = Math.round(Number(order.costs.total) * 100);
  const currency = order.costs.currency;

  if (toEurCents(costCents, currency) <= config.budget.approvalLimitCents) {
    await confirmPrintfulOrder({ orderId: order.id, costCents, currency, receiptId });
    await log.info(`Printful order ${order.id} confirmed for receipt ${receiptId}`, undefined, taskId);
    return { orderId: order.id, confirmed: true };
  }
  await requestApproval({
    agentId: ID,
    kind: "printful_order_confirm",
    title: `Printful-bestelling bevestigen voor Etsy-bestelling ${receiptId}`,
    details: `Conceptbestelling ${order.id} ligt boven de limiet voor automatisch goedkeuren.`,
    amountCents: costCents,
    currency,
    payload: { orderId: order.id, costCents, currency, receiptId },
  });
  return { orderId: order.id, confirmed: false };
}

async function confirmPrintfulOrder(p: Record<string, unknown>): Promise<string> {
  await printful.confirmOrder(Number(p.orderId));
  await recordCost({
    agentId: ID,
    category: "printful",
    amountCents: Number(p.costCents),
    currency: String(p.currency),
    note: `Printful order ${p.orderId} (Etsy receipt ${p.receiptId})`,
  });
  return `Printful order ${p.orderId} confirmed`;
}

registerApprovalExecutor("etsy_publish", async (p) => {
  await enqueue(ID, "publish_listings", p);
  return "Publishing queued";
});
registerApprovalExecutor("printful_order_confirm", confirmPrintfulOrder);
registerApprovalExecutor("personal_text", async (p) => {
  await enqueue(ID, "fulfil_receipt", { receiptId: p.receiptId, approvedTexts: p.approvedTexts });
  return "Bestelling wordt nu bij Printful geplaatst";
});

export const etsyPodAgent: AgentDefinition = {
  id: ID,
  name: "Etsy-agent",
  phase: 1,
  businessId: "etsy-pod",
  chatTasks: ["create_listings", "upload_listings", "sync_sales", "sync_listings", "printful_setup", "etsy_setup", "add_photos", "fix_return_policy", "catalog_setup", "maintenance", "add_ai_disclosure", "add_videos", "pricing_report"],
  description: "Zoekt cadeau-niches, ontwerpt mokken, zet ze op Etsy en maakt van Etsy-verkopen Printful-bestellingen.",
  dependsOn: ["database", "claude", "etsy", "printful"],
  taskInfo: {
    create_listings: "Niches kiezen en per ontwerp listings maken voor meerdere producten (mok, T-shirt, hoodie, totebag, poster), met printbestanden per maat en kleur. Met personalized: true krijgt het ontwerp een naam die de koper zelf kiest",
    upload_listings: "Concepten en mockups naar Etsy uploaden, daarna akkoord vragen om te publiceren",
    publish_listings: "Goedgekeurde concepten live zetten op Etsy (kost $0,20 listingkosten per stuk)",
    sync_sales: "Nieuwe betaalde Etsy-bestellingen ophalen als verkopen",
    sync_listings: "Alle actieve listings van je Etsy-winkel ophalen, ook die je met de hand plaatste",
    printful_setup: "Bij Printful de API-winkel, de 11 oz mok en de exacte printmaat opzoeken en opslaan",
    etsy_setup: "Bij Etsy de munt, het verzendprofiel, het retourbeleid, de categorie Mokken en de productiepartner opzoeken",
    add_photos: "Listings op Etsy met te weinig mokfoto's aanvullen met Printful-foto's",
    pricing_report: "Echte winst per product en markt doorrekenen (Printful-kosten met verzending en btw, Etsy-verzendprijzen en -kosten), ook bij 20% en 30% korting",
    add_videos: "Elke listing zonder video een korte video geven, gemaakt van de eigen productfoto's (Etsy toont die in de zoekresultaten)",
    add_ai_disclosure: "De AI-vermelding die Etsy verplicht toevoegen aan elke listing die ze nog mist",
    maintenance: "Dagelijks onderhoud: ontbrekende productfoto's en video's aanvullen, retourbeleid op elke listing, vastgelopen concepten alsnog uploaden",
    catalog_setup: "Het productaanbod opzoeken: per product (mokken, T-shirts, hoodies, totebags, posters) de Printful-varianten en de Etsy-categorie en het verzendprofiel",
    fix_return_policy: "Het retourbeleid van de winkel op alle listings zetten die er nog geen hebben (live en concept)",
    fulfil_receipt: "De Printful-bestelling maken voor een Etsy-verkoop (automatisch bevestigd onder de uitgavelimiet)",
  },
  handlers: {
    create_listings: createListings,
    upload_listings: uploadListings,
    publish_listings: publishListings,
    sync_sales: syncSales,
    sync_listings: syncListings,
    printful_setup: printfulSetup,
    etsy_setup: etsySetup,
    fulfil_receipt: fulfilReceipt,
    add_photos: addPhotos,
    fix_return_policy: fixReturnPolicy,
    catalog_setup: catalogSetup,
    maintenance,
    add_ai_disclosure: addAiDisclosure,
    add_videos: addVideos,
    pricing_report: pricingReport,
  },
};
