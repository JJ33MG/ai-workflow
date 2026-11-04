import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import * as etsy from "../integrations/etsy.js";
import * as printful from "../integrations/printful.js";
import { registerApprovalExecutor, requestApproval } from "../lib/approvals.js";
import { recordCost } from "../lib/budget.js";
import { askJson, askText } from "../lib/claude.js";
import { DesignLayoutError, designUrl, designsDir, prepareDesign, sanitizeSvg, saveDesign, sideSize } from "../lib/design.js";
import { toEurCents } from "../lib/money.js";
import { findPrintfulSetup } from "../lib/printfulSetup.js";
import { enqueue } from "../lib/tasks.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "etsy-pod";
const ETSY_LISTING_FEE_USD_CENTS = 20;
const RECEIPTS_CURSOR = "etsy.receipts.since";

const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      niche: z.string(),
      slogan: z.string(),
      designBrief: z.string(),
      title: z.string(),
      description: z.string(),
      tags: z.array(z.string()),
    }),
  ),
});
type Idea = z.infer<typeof IdeasSchema>["ideas"][number];

/** Etsy limits: title ≤ 140 chars, ≤ 13 tags of ≤ 20 chars each. */
export function normaliseIdea(idea: Idea): Idea {
  const tags = [...new Set(idea.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()))]
    .filter((t) => t.length > 0 && t.length <= 20)
    .slice(0, 13);
  return { ...idea, title: idea.title.slice(0, 140).trim(), tags };
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
  const digest = await knowledgeDigest();

  const { ideas } = await askJson({
    agentId: ID,
    purpose: "pod_ideas",
    schema: IdeasSchema,
    effort: "medium",
    system:
      "You run a print-on-demand Etsy shop selling typography designs on 11oz white mugs. " +
      "You pick specific, under-served gift niches (professions, hobbies, life events) where buyers search for funny or heartfelt mugs. " +
      "Never use trademarks, brand names, celebrities, song lyrics, film quotes or copyrighted characters. " +
      "Write titles and descriptions for real buyers, not keyword lists. Descriptions must state that the mug is printed on demand by a production partner.",
    prompt:
      `${digest}\n\n${instructions ? `Jarne's direction for this batch (follow it): ${instructions}\n\n` : ""}` +
      `Propose ${count} new mug designs. For each give: niche, slogan (the exact text printed on the mug, max ~8 words), ` +
      "designBrief (layout and typographic style), title (≤140 chars), description (3 short paragraphs including size 11oz, dishwasher and microwave safe), " +
      "and 13 Etsy tags (each ≤20 chars).",
  });

  const created: string[] = [];
  for (const raw of ideas.slice(0, count)) {
    const idea = normaliseIdea(raw);
    try {
      const { svg, png } = await designWithRetry(idea);
      const listing = await db.listing.create({
        data: {
          niche: idea.niche,
          title: idea.title,
          description: idea.description,
          tags: idea.tags,
          priceCents: config.pod.priceCents,
          currency: config.pod.currency,
          designSvg: svg,
          designFile: "",
          printfulVariant: printful.pf.variantId || null,
        },
      });
      const file = await saveDesign(png, listing.id);
      await db.listing.update({ where: { id: listing.id }, data: { designFile: file } });
      created.push(listing.id);
      await log.info(`Draft design created: ${idea.title}`, { listingId: listing.id, niche: idea.niche }, taskId);
    } catch (err) {
      await log.warn(`Skipped idea "${idea.title}": ${(err as Error).message}`, undefined, taskId);
    }
  }

  if (created.length > 0) await enqueue(ID, "upload_listings", { listingIds: created });
  return { created: created.length };
}

const DESIGN_ATTEMPTS = 2;

/**
 * Asks Claude for one side of the mug, renders it and checks nothing is cut off.
 * Claude can't measure rendered text, so a layout miss is sent back once as feedback.
 */
async function designWithRetry(idea: Idea): Promise<{ svg: string; png: Buffer }> {
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
          "You are a typography designer. Output one standalone SVG document and nothing else. " +
          `It is one side of a mug: use viewBox="0 0 ${side.width} ${side.height}" and a transparent background; ` +
          "the same design is printed on the other side automatically, so draw it once. " +
          "Use only <text>, <tspan>, <path>, <rect>, <circle>, <line>, <polygon>, <g>, <defs>, <use href=\"#id\"> and gradients. " +
          "Use only generic font families (serif, sans-serif, monospace). No images, links, scripts or external references. " +
          "Dark ink colours that print well on a white mug. Keep icons and ornaments clear of the letters, never on top of them. " +
          `Keep every element inside x ${mx}–${side.width - mx} and y ${my}–${side.height - my}. ` +
          "You cannot measure text, so size it conservatively: a line of N characters needs a font-size of at most " +
          `${Math.round(((side.width - 2 * mx) / 0.62) / 10)}0/N for sans-serif capitals; split long slogans over more lines.`,
        prompt: `Slogan: "${idea.slogan}"\nNiche: ${idea.niche}\nBrief: ${idea.designBrief}${feedback}`,
      }),
    );
    try {
      return { svg, png: await prepareDesign(svg) };
    } catch (err) {
      if (!(err instanceof DesignLayoutError) || attempt >= DESIGN_ATTEMPTS) throw err;
      feedback =
        `\n\nYour previous version was cut off at the ${err.edges.join(" and ")} edge. ` +
        "Make the text smaller or split it over more lines, and keep clear of the margins.";
    }
  }
}

async function uploadListings(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const ids = (payload.listingIds as string[]) ?? [];
  if (config.dryRun || !etsy.isEtsyConfigured()) {
    await log.info(`Dry run: ${ids.length} listing(s) kept as local drafts`, { ids }, taskId);
    return { uploaded: 0, dryRun: true };
  }

  const uploaded: string[] = [];
  for (const id of ids) {
    const listing = await db.listing.findUniqueOrThrow({ where: { id } });
    if (listing.etsyListingId) continue; // already uploaded on an earlier attempt
    const draft = await etsy.createDraftListing({
      title: listing.title,
      description: listing.description,
      priceCents: listing.priceCents,
      tags: listing.tags,
    });
    const etsyId = String(draft.listing_id);
    await db.listing.update({ where: { id }, data: { etsyListingId: etsyId, status: "uploaded" } });

    // Prefer a Printful mockup (needs a public URL); fall back to the flat design.
    let rank = 1;
    if (printful.isPrintfulConfigured() && !config.publicUrl.includes("localhost")) {
      try {
        for (const url of (await printful.generateMockup(designUrl(listing.designFile))).slice(0, 5)) {
          const img = Buffer.from(await (await fetch(url)).arrayBuffer());
          await etsy.uploadListingImage(etsyId, img, rank++);
        }
      } catch (err) {
        await log.warn(`Mockup failed for ${listing.title}: ${(err as Error).message}`, undefined, taskId);
      }
    }
    const design = await readFile(path.join(designsDir(), listing.designFile));
    await etsy.uploadListingImage(etsyId, design, rank);
    uploaded.push(id);
  }

  if (uploaded.length === 0) return { uploaded: 0 };
  if (config.etsy.autoPublish) {
    await enqueue(ID, "publish_listings", { listingIds: uploaded });
  } else {
    await requestApproval({
      agentId: ID,
      kind: "etsy_publish",
      title: `${uploaded.length} Etsy-listing(s) publiceren`,
      details: `De concepten staan op Etsy. Publiceren kost $0,20 listingkosten per stuk.`,
      amountCents: uploaded.length * ETSY_LISTING_FEE_USD_CENTS,
      currency: "USD",
      payload: { listingIds: uploaded },
    });
  }
  return { uploaded: uploaded.length };
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
      title: l.title.slice(0, 140),
      description: l.description,
      tags: l.tags,
      priceCents: etsy.moneyToCents(l.price),
      currency: l.price.currency_code,
      status: "active",
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
  if (result.added || result.ended) {
    await log.info(`Etsy-winkel bijgewerkt: ${result.added} nieuw, ${result.updated} bijgewerkt, ${result.ended} beëindigd`, result, taskId);
  }
  return result;
}

async function printfulSetup(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!printful.hasPrintfulToken()) return { skipped: "no Printful token" };
  const s = await findPrintfulSetup();
  await log.info(
    `Printful ingesteld: winkel "${s.storeName}", mok product ${s.productId} variant ${s.variantId}, printmaat ${s.printWidth}×${s.printHeight}`,
    s,
    taskId,
  );
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

async function fulfilReceipt(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const receiptId = String(payload.receiptId);
  const sale = await db.sale.findUniqueOrThrow({
    where: { source_externalId: { source: "etsy", externalId: receiptId } },
  });
  const r = sale.data as unknown as etsy.EtsyReceipt;

  const items: { variantId: number; quantity: number; fileUrl: string }[] = [];
  for (const t of r.transactions) {
    const listing = await db.listing.findUnique({ where: { etsyListingId: String(t.listing_id) } });
    if (!listing?.printfulVariant) continue; // not one of ours
    items.push({ variantId: listing.printfulVariant, quantity: t.quantity, fileUrl: designUrl(listing.designFile) });
  }
  if (items.length === 0) return { skipped: "no POD items" };
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

export const etsyPodAgent: AgentDefinition = {
  id: ID,
  name: "Etsy-agent",
  phase: 1,
  businessId: "etsy-pod",
  chatTasks: ["create_listings", "upload_listings", "sync_sales", "sync_listings", "printful_setup"],
  description: "Zoekt cadeau-niches, ontwerpt mokken, zet ze op Etsy en maakt van Etsy-verkopen Printful-bestellingen.",
  dependsOn: ["database", "claude", "etsy", "printful"],
  taskInfo: {
    create_listings: "Niches kiezen, listingteksten schrijven en printklare ontwerpen maken (lokale concepten)",
    upload_listings: "Concepten en mockups naar Etsy uploaden, daarna akkoord vragen om te publiceren",
    publish_listings: "Goedgekeurde concepten live zetten op Etsy (kost $0,20 listingkosten per stuk)",
    sync_sales: "Nieuwe betaalde Etsy-bestellingen ophalen als verkopen",
    sync_listings: "Alle actieve listings van je Etsy-winkel ophalen, ook die je met de hand plaatste",
    printful_setup: "Bij Printful de API-winkel, de 11 oz mok en de exacte printmaat opzoeken en opslaan",
    fulfil_receipt: "De Printful-bestelling maken voor een Etsy-verkoop (automatisch bevestigd onder de uitgavelimiet)",
  },
  handlers: {
    create_listings: createListings,
    upload_listings: uploadListings,
    publish_listings: publishListings,
    sync_sales: syncSales,
    sync_listings: syncListings,
    printful_setup: printfulSetup,
    fulfil_receipt: fulfilReceipt,
  },
};
