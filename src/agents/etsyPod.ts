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
import { designUrl, designsDir, renderDesign, sanitizeSvg } from "../lib/design.js";
import { toEurCents } from "../lib/money.js";
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
      `${digest}\n\nPropose ${count} new mug designs. For each give: niche, slogan (the exact text printed on the mug, max ~8 words), ` +
      "designBrief (layout and typographic style), title (≤140 chars), description (3 short paragraphs including size 11oz, dishwasher and microwave safe), " +
      "and 13 Etsy tags (each ≤20 chars).",
  });

  const created: string[] = [];
  for (const raw of ideas.slice(0, count)) {
    const idea = normaliseIdea(raw);
    try {
      const svg = sanitizeSvg(
        await askText({
          agentId: ID,
          purpose: "pod_design_svg",
          effort: "medium",
          system:
            "You are a typography designer. Output one standalone SVG document and nothing else. " +
            `Use viewBox="0 0 ${config.pod.designWidth} ${config.pod.designHeight}", a transparent background, ` +
            "only <text>, <tspan>, <path>, <rect>, <circle>, <line>, <polygon>, <g> and gradients. " +
            "Use only generic font families (serif, sans-serif, monospace). No images, links, scripts or external references. " +
            "Dark ink colours that print well on a white mug. Keep all content inside the viewBox with generous margins.",
          prompt: `Slogan: "${idea.slogan}"\nNiche: ${idea.niche}\nBrief: ${idea.designBrief}`,
        }),
      );
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
          printfulVariant: config.printful.variantId || null,
        },
      });
      const { file } = await renderDesign(svg, listing.id);
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
      title: `Publish ${uploaded.length} Etsy listing(s)`,
      details: `Drafts are on Etsy. Publishing costs $0.20 each in listing fees.`,
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
    title: `Confirm Printful order for Etsy receipt ${receiptId}`,
    details: `Draft order ${order.id} is above the auto-approve limit.`,
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
  name: "Etsy / Print-on-Demand Agent",
  phase: 1,
  businessId: "etsy-pod",
  chatTasks: ["create_listings", "upload_listings", "sync_sales"],
  description: "Finds gift niches, designs typography mugs, lists them on Etsy and turns Etsy sales into Printful orders.",
  dependsOn: ["database", "claude", "etsy", "printful"],
  taskInfo: {
    create_listings: "Pick niches, write listing text and render print-ready designs (local drafts)",
    upload_listings: "Upload drafts and mockups to Etsy, then ask approval to publish",
    publish_listings: "Make approved drafts live on Etsy (pays the $0.20 listing fee)",
    sync_sales: "Import new paid Etsy orders as sales",
    fulfil_receipt: "Create the Printful order for an Etsy sale (auto-confirm under the spend limit)",
  },
  handlers: {
    create_listings: createListings,
    upload_listings: uploadListings,
    publish_listings: publishListings,
    sync_sales: syncSales,
    fulfil_receipt: fulfilReceipt,
  },
};
