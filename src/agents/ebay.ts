// eBay as a second shop window for the physical products: the agent lists the best live Etsy
// products on ebay.com (free shipping, prices that keep the shop's profit rule), turns eBay orders
// into Printful orders, and sends the tracking number back to eBay. Digital downloads and
// personalized items stay on Etsy (eBay has no downloads and no checkout text field).
import { z } from "zod";
import { config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import * as ebay from "../integrations/ebay.js";
import * as etsy from "../integrations/etsy.js";
import * as printful from "../integrations/printful.js";
import { registerApprovalExecutor, requestApproval } from "../lib/approvals.js";
import { recordCost } from "../lib/budget.js";
import { productType } from "../lib/catalog.js";
import { askJson } from "../lib/claude.js";
import { designUrl } from "../lib/design.js";
import { toEurCents } from "../lib/money.js";
import { ebayPriceFor } from "../lib/pricing.js";
import { enqueue, enqueueOnce } from "../lib/tasks.js";
import { MIN_SALE_PROFIT_CENTS, PRICING_KEY, RULE_SALE, type ListingVariant, type PricingRow } from "./etsyPod.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "ebay";
const APPROVED_KEY = "ebay.approved";
const POLICIES_KEY = "ebay.policies";
const CATEGORIES_KEY = "ebay.categories";
const LISTINGS_KEY = "ebay.listings";
const SHIPPED_KEY = "ebay.shipped";
const BRAND = "All You Can Wish";
/**
 * Units on offer per variant; topped up after every sale (made to order, so never really out). eBay counts every
 * unit against a new seller's monthly limit, so it stays 1.
 */
export const EBAY_STOCK = 1;
const STOCK = EBAY_STOCK;
const LIMIT_KEY = "ebay.limitUntil";

/** eBay's monthly selling limit for the account (error 25002): retrying before next month is pointless. */
export const isSellingLimit = (err: unknown) => err instanceof ebay.EbayError && err.errors.some((e) => e.errorId === 25002);

/** Midnight UTC on the first day of the next month (eBay's limits are per calendar month). */
export const nextMonthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

/** True when eBay shows the listing as ACTIVE (published offers can still be held back). */
export const isLive = (offers: ebay.OfferInfo[]) => offers.some((o) => o.status === "PUBLISHED" && o.listing?.listingStatus === "ACTIVE");

/** What eBay holds for the account: offers per status, and listing ids per listing state. */
export function summarizeOffers(offers: ebay.OfferInfo[]) {
  const byStatus: Record<string, number> = {};
  const listings: Record<string, string[]> = {};
  for (const o of offers) {
    byStatus[o.status ?? "UNKNOWN"] = (byStatus[o.status ?? "UNKNOWN"] ?? 0) + 1;
    const id = o.listing?.listingId;
    if (id) {
      const state = o.listing?.listingStatus ?? "UNKNOWN";
      listings[state] ??= [];
      if (!listings[state].includes(id)) listings[state].push(id);
    }
  }
  return { offers: offers.length, byStatus, listings };
}
/** Apparel on eBay: the first colour, every size. Each size counts against the 70 items a month a new seller may list. */
const MAX_EBAY_COLORS = 1;

export function ebayVariants<T extends { color: string | null }>(variants: T[]): T[] {
  const colors = [...new Set(variants.map((v) => v.color).filter((c): c is string => !!c))];
  if (colors.length <= MAX_EBAY_COLORS) return variants;
  const keep = new Set(colors.slice(0, MAX_EBAY_COLORS));
  return variants.filter((v) => !v.color || keep.has(v.color));
}
/** Listings that use the fewest of the month's items first (a mug before a hoodie in every size); then the most favourited. */
export function byFewestItems<T extends { favorites: number | null; variants: unknown }>(listings: T[]): T[] {
  const items = (l: T) => ebayVariants(((l.variants as { color: string | null }[] | null) ?? [])).length || 99;
  return [...listings].sort((a, b) => items(a) - items(b) || (b.favorites ?? 0) - (a.favorites ?? 0));
}
const SHIPMENT_WINDOW_DAYS = 45;

/** What eBay's category search is asked per product type. */
const CATEGORY_QUERY: Record<string, string> = {
  mug: "ceramic coffee mug",
  "mug-black": "ceramic coffee mug",
  "mug-color": "ceramic coffee mug",
  tshirt: "graphic t-shirt",
  hoodie: "pullover hoodie",
  sweatshirt: "crewneck sweatshirt",
  tote: "canvas tote bag",
  poster: "art poster print",
};

interface CategoryInfo {
  id: string;
  name: string;
  aspects: Record<string, string[]>;
}

interface EbayListingRef {
  groupKey: string | null;
  offerIds: string[];
  ebayListingId: string;
  /** sku → the Printful variant and print file it orders. */
  skus: Record<string, { variantId: number; file: string; placement: string }>;
}

export const skuFor = (listingId: string, variantId: number) => `EB-${variantId}-${listingId.slice(-10)}`;

/** eBay requires a Color item specific: the variant's colour, else the product's own colour. */
const OWN_COLOR: Record<string, string> = { mug: "White", "mug-black": "Black", "mug-color": "White", tshirt: "White", hoodie: "Black", sweatshirt: "Black", tote: "Beige", poster: "Multicolor" };
export const colorAspect = (typeId: string, variantColor: string | null | undefined) => variantColor || OWN_COLOR[typeId] || "Multicolor";

/** eBay titles are at most 80 characters: cut at a word, never mid-word. */
export function ebayTitle(title: string): string {
  if (title.length <= 80) return title;
  const cut = title.slice(0, 80);
  return cut.slice(0, Math.max(40, cut.lastIndexOf(" "))).replace(/[\s,|·-]+$/, "");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function ebayDescription(description: string): string {
  const paragraphs = description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    // Etsy-only wording does not belong on eBay.
    .filter((p) => !/personalization box|etsy/i.test(p));
  return (
    paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("") +
    "<p>Made to order and shipped from the United States by our print-on-demand partner. Free shipping.</p>"
  );
}

/** Printful's cost to a US buyer per product type and size, from the latest pricing report. */
async function usCosts(): Promise<Map<string, number>> {
  const report = await getSetting<{ rows: PricingRow[] }>(PRICING_KEY);
  const costs = new Map<string, number>();
  for (const r of report?.rows ?? []) {
    if (r.market !== "VS") continue;
    costs.set(`${r.type}|${r.size}`, r.printfulCents);
    costs.set(`${r.type}|*`, Math.max(costs.get(`${r.type}|*`) ?? 0, r.printfulCents));
  }
  return costs;
}

const AspectsSchema = z.object({ aspects: z.array(z.object({ name: z.string(), value: z.string() })) });

/** The eBay category of a product type with its required item specifics filled in (looked up once). */
async function categoryFor(typeId: string, log: TaskContext["log"], taskId?: string): Promise<CategoryInfo | null> {
  const cache = (await getSetting<Record<string, CategoryInfo>>(CATEGORIES_KEY)) ?? {};
  if (cache[typeId]) return cache[typeId];
  const def = productType(typeId);
  const query = CATEGORY_QUERY[typeId];
  if (!def || !query) return null;
  const cat = await ebay.suggestCategory(query);
  if (!cat) return null;
  const required = (await ebay.categoryAspects(cat.id)).filter((a) => a.required && !["Size", "Color", "Brand"].includes(a.name));
  let filled: Record<string, string[]> = {};
  if (required.length) {
    const { aspects } = await askJson({
      agentId: ID,
      purpose: "ebay_aspects",
      model: config.kdp.reviewModel,
      effort: "low",
      maxTokens: 1500,
      schema: AspectsSchema,
      system: "You fill in eBay item specifics truthfully from the product facts. When allowed values are given, use one of them exactly.",
      prompt:
        `Product: ${def.noun}. Facts: ${def.facts}\neBay category: ${cat.name}\nFill these required item specifics:\n` +
        required.map((a) => `- ${a.name}${a.freeText ? "" : ` (one of: ${a.values.join(", ")})`}`).join("\n"),
    });
    filled = Object.fromEntries(aspects.filter((a) => required.some((r) => r.name === a.name) && a.value).map((a) => [a.name, [a.value]]));
  }
  const info: CategoryInfo = { id: cat.id, name: cat.name, aspects: { Brand: [BRAND], ...filled } };
  cache[typeId] = info;
  await setSetting(CATEGORIES_KEY, cache);
  await log.info(`eBay-categorie voor ${def.label}: ${cat.name}`, info, taskId);
  return info;
}

async function setup(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (config.dryRun || !ebay.isEbayConfigured() || !(await ebay.isEbayConnected())) return { skipped: "dry run or eBay not connected" };
  const privileges = await ebay.getPrivileges().catch(() => null);
  if (privileges) await log.info(ebay.privilegeLine(privileges), privileges, taskId);
  await ebay.optInToBusinessPolicies();
  const policies = await ebay.ensurePolicies();
  await ebay.ensureLocation();
  await setSetting(POLICIES_KEY, policies);
  await log.info("eBay ingesteld: verzendbeleid (gratis verzending), betaal- en retourbeleid en de verzendlocatie (Printful VS)", policies, taskId);
  await enqueueOnce(ID, "ebay_list");
  return policies;
}

/**
 * Lists the best live Etsy products on eBay, up to EBAY_MAX_LISTINGS, and ends eBay listings whose
 * Etsy listing is gone. Asks Jarne once before the first listing (a new platform).
 */
async function list(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (config.dryRun || !ebay.isEbayConfigured() || !(await ebay.isEbayConnected())) return { skipped: "dry run or eBay not connected" };
  if (!(await getSetting<boolean>(APPROVED_KEY))) {
    const open = await db.approval.count({ where: { kind: "ebay_start", status: "pending" } });
    if (!open) {
      await requestApproval({
        agentId: ID,
        kind: "ebay_start",
        title: "Starten met verkopen op eBay",
        details:
          `De bot zet je beste Etsy-producten (mokken, hoodies, posters…) op ebay.com, maximaal ${config.ebay.maxListings} tegelijk, met gratis verzending ` +
          "en prijzen die ook daar minstens €5 winst laten bij 20% korting. Bestellingen gaan automatisch naar Printful. Listen is gratis (eBay geeft 250 gratis listings per maand).",
      });
    }
    return { waitingForApproval: true };
  }
  const policies = await getSetting<{ fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string }>(POLICIES_KEY);
  if (!policies) {
    await enqueueOnce(ID, "ebay_setup");
    return { waiting: "ebay_setup" };
  }
  const costs = await usCosts();
  if (!costs.size) {
    await enqueueOnce("etsy-pod", "pricing_report");
    throw new Error("Nog geen prijscheck met Printful-kosten voor de VS: pricing_report is gestart, probeer daarna opnieuw.");
  }

  const limitUntil = await getSetting<string>(LIMIT_KEY);
  const waiting = Boolean(limitUntil && new Date(limitUntil) > new Date());
  const refs = (await getSetting<Record<string, EbayListingRef>>(LISTINGS_KEY)) ?? {};
  // End eBay listings whose Etsy product is no longer for sale.
  const listed = await db.listing.findMany({ where: { id: { in: Object.keys(refs) } }, select: { id: true, status: true, title: true } });
  let ended = 0;
  for (const l of listed) {
    if (l.status === "active") continue;
    const ref = refs[l.id];
    try {
      if (ref.groupKey) await ebay.withdrawGroup(ref.groupKey);
      else for (const o of ref.offerIds) await ebay.withdrawOffer(o);
    } catch (err) {
      await log.warn(`eBay-listing beëindigen mislukt (${l.title}): ${(err as Error).message}`, undefined, taskId);
      continue;
    }
    delete refs[l.id];
    ended++;
  }

  const room = waiting ? 0 : config.ebay.maxListings - Object.keys(refs).length;
  const pool = room > 0
    ? await db.listing.findMany({
        where: {
          source: "agent",
          supplier: "printful", // eBay orders go to Printful; Printify garments are fulfilled by Printify on Etsy only
          status: "active",
          personalized: false,
          etsyListingId: { not: null },
          id: { notIn: Object.keys(refs) },
          productType: { in: Object.keys(CATEGORY_QUERY) },
        },
        orderBy: [{ favorites: "desc" }, { createdAt: "desc" }],
      })
    : [];
  const candidates = byFewestItems(pool).slice(0, Math.max(0, Math.min(room, config.ebay.maxNewPerRun)));

  const added: string[] = [];
  for (const listing of candidates) {
    try {
      const variants = ebayVariants((listing.variants as ListingVariant[] | null) ?? []);
      const cat = await categoryFor(listing.productType, log, taskId);
      if (!variants.length || !cat) continue;
      const imageUrls = (await etsy.getListingImageUrls(listing.etsyListingId!)).slice(0, 12);
      if (!imageUrls.length) continue;
      const title = ebayTitle(listing.title);
      const description = ebayDescription(listing.description);
      const skus: EbayListingRef["skus"] = {};
      const offerIds: string[] = [];
      const multi = variants.length > 1;
      const varies: Record<string, string[]> = {};
      if (new Set(variants.map((v) => v.size)).size > 1) varies.Size = [...new Set(variants.map((v) => v.size))];
      if (new Set(variants.map((v) => v.color)).size > 1) varies.Color = [...new Set(variants.map((v) => v.color ?? ""))];

      for (const v of variants) {
        const sku = skuFor(listing.id, v.variantId);
        const cost = costs.get(`${listing.productType}|${v.size}`) ?? costs.get(`${listing.productType}|*`);
        if (!cost) throw new Error(`geen Printful-kosten voor ${listing.productType} ${v.size}`);
        const aspects: Record<string, string[]> = { ...cat.aspects };
        if (v.size) aspects.Size = [v.size];
        aspects.Color = [colorAspect(listing.productType, v.color)];
        await ebay.putInventoryItem(sku, { title, description, aspects, imageUrls, quantity: STOCK });
        offerIds.push(
          await ebay.upsertOffer({
            sku,
            categoryId: cat.id,
            description,
            priceCents: ebayPriceFor(cost, config.budget.usdToEur, MIN_SALE_PROFIT_CENTS, RULE_SALE),
            quantity: STOCK,
            policies,
          }),
        );
        skus[sku] = { variantId: v.variantId, file: v.file, placement: v.placement };
      }
      let ebayListingId: string;
      let groupKey: string | null = null;
      if (multi) {
        groupKey = `AYCW-${listing.id}`;
        // A colour that does not vary is a shared item specific of the whole group.
        const groupAspects = varies.Color ? cat.aspects : { ...cat.aspects, Color: [colorAspect(listing.productType, variants[0].color)] };
        await ebay.putInventoryGroup(groupKey, { title, description, imageUrls, aspects: groupAspects, skus: Object.keys(skus), varies });
        ebayListingId = await ebay.publishGroup(groupKey);
      } else {
        ebayListingId = await ebay.publishOffer(offerIds[0]);
      }
      // eBay can accept a publish and still hold the listing back: check it is really live before going on.
      if (!isLive(await ebay.offersForSku(Object.keys(skus)[0]).catch(() => []))) {
        const until = nextMonthStart(new Date()).toISOString();
        await setSetting(LIMIT_KEY, until);
        await log.warn(`eBay nam ${title} aan maar zet hem niet live (listing ${ebayListingId}): nieuwe listings stoppen tot ${until.slice(0, 10)}. Kijk in Seller Hub bij Inactive waarom.`, undefined, taskId);
        break;
      }
      refs[listing.id] = { groupKey, offerIds, ebayListingId, skus };
      await setSetting(LISTINGS_KEY, refs);
      added.push(title);
    } catch (err) {
      if (isSellingLimit(err)) {
        // The month's limit is reached: stop here and try again on the 1st, not on every run.
        const until = nextMonthStart(new Date()).toISOString();
        await setSetting(LIMIT_KEY, until);
        await log.warn(`eBay-verkooplimiet van deze maand bereikt: nieuwe listings wachten tot ${until.slice(0, 10)}. Vraag eBay om een hogere limiet om eerder verder te gaan.`, undefined, taskId);
        break;
      }
      await log.warn(`Niet op eBay gezet: ${listing.title}: ${(err as Error).message}`, undefined, taskId);
    }
    if (taskId) await db.task.update({ where: { id: taskId }, data: { status: "running" } });
  }
  await setSetting(LISTINGS_KEY, refs);
  if (added.length || ended) {
    await log.info(
      `eBay: ${added.length} product(en) gelist${ended ? `, ${ended} beëindigd (niet meer op Etsy)` : ""}. Nu ${Object.keys(refs).length} van max. ${config.ebay.maxListings}.` +
        (added.length ? `\n${added.join("\n")}` : ""),
      undefined,
      taskId,
    );
  }
  // Refresh what the dashboard shows about eBay.
  await enqueueOnce(ID, "ebay_check");
  return { added: added.length, ended, total: Object.keys(refs).length };
}

/** Asks eBay what it really holds: the selling limit, and every offer with its listing state. */
async function check(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!ebay.isEbayConfigured() || !(await ebay.isEbayConnected())) return { skipped: "eBay not connected" };
  const privileges = await ebay.getPrivileges().catch(() => null);
  const offers: ebay.OfferInfo[] = [];
  for (const sku of await ebay.allInventorySkus()) offers.push(...(await ebay.offersForSku(sku)));
  const summary = summarizeOffers(offers);
  // Kept for the dashboard: what is live, and eBay's limit.
  await setSetting("ebay.status", {
    at: new Date().toISOString(),
    live: summary.listings.ACTIVE?.length ?? 0,
    offers: summary.offers,
    limit: privileges?.sellingLimit ? { quantity: privileges.sellingLimit.quantity ?? null, amount: privileges.sellingLimit.amount ? `${privileges.sellingLimit.amount.value} ${privileges.sellingLimit.amount.currency}` : null } : null,
  });
  const refs = (await getSetting<Record<string, EbayListingRef>>(LISTINGS_KEY)) ?? {};
  const states = Object.entries(summary.listings).map(([state, ids]) => `${ids.length} ${state}`).join(", ") || "geen";
  await log.info(
    `eBay-check: ${summary.offers} aanbieding(en) (${Object.entries(summary.byStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "geen"}); listings: ${states}. ` +
      `De Brain kent ${Object.keys(refs).length} listing(s).` + (privileges ? ` ${ebay.privilegeLine(privileges)}.` : ""),
    { ...summary, privileges, known: Object.values(refs).map((r) => r.ebayListingId) },
    taskId,
  );
  return summary;
}

/** New paid eBay orders become sales and Printful orders (one task per order, so each can be retried). */
async function syncOrders(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!ebay.isEbayConfigured() || !(await ebay.isEbayConnected())) return { skipped: "eBay not connected" };
  let added = 0;
  for (const o of await ebay.getOpenOrders()) {
    const exists = await db.sale.findUnique({ where: { source_externalId: { source: "ebay", externalId: o.orderId } } });
    if (exists) continue;
    await db.sale.create({
      data: {
        agentId: ID,
        source: "ebay",
        externalId: o.orderId,
        amountCents: Math.round(Number(o.pricingSummary.total.value) * 100),
        currency: o.pricingSummary.total.currency,
        occurredAt: new Date(o.creationDate),
        data: o as unknown as object,
      },
    });
    await enqueue(ID, "ebay_fulfil", { orderId: o.orderId });
    added++;
  }
  if (added) await log.info(`${added} nieuwe eBay-bestelling(en)`, undefined, taskId);
  return { newOrders: added };
}

/** The Printful order lines for an eBay order, from the SKU map made when listing. */
export function ebayOrderItems(order: ebay.EbayOrder, refs: Record<string, EbayListingRef>) {
  const items: { variantId: number; quantity: number; fileUrl: string; placement: string }[] = [];
  for (const li of order.lineItems) {
    const hit = Object.values(refs).map((r) => r.skus[li.sku ?? ""]).find(Boolean);
    if (!hit) throw new Error(`Onbekend artikel "${li.title}" (SKU ${li.sku ?? "-"}) in eBay-bestelling ${order.orderId}: verwerk deze bestelling met de hand`);
    items.push({ variantId: hit.variantId, quantity: li.quantity, fileUrl: designUrl(hit.file), placement: hit.placement });
  }
  return items;
}

async function fulfil(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const orderId = String(payload.orderId);
  const sale = await db.sale.findUniqueOrThrow({ where: { source_externalId: { source: "ebay", externalId: orderId } } });
  const order = sale.data as unknown as ebay.EbayOrder;
  // Safe to re-run: an order Printful already has is not made twice.
  if (await printful.getOrderByExternalId(`ebay-${orderId}`)) return { exists: true };
  const items = ebayOrderItems(order, (await getSetting<Record<string, EbayListingRef>>(LISTINGS_KEY)) ?? {});
  const to = order.fulfillmentStartInstructions[0]?.shippingStep?.shipTo;
  if (!to) throw new Error(`eBay-bestelling ${orderId} heeft geen verzendadres`);
  if (config.dryRun || !printful.isPrintfulConfigured()) {
    await log.warn(`Dry run: eBay-bestelling ${orderId} moet met de hand verwerkt worden`, { items }, taskId);
    return { dryRun: true };
  }
  const draft = await printful.createDraftOrder({
    externalId: `ebay-${orderId}`,
    recipient: {
      name: to.fullName,
      address1: to.contactAddress.addressLine1,
      address2: to.contactAddress.addressLine2,
      city: to.contactAddress.city,
      state_code: to.contactAddress.stateOrProvince,
      country_code: to.contactAddress.countryCode,
      zip: to.contactAddress.postalCode,
    },
    items,
  });
  const costCents = Math.round(Number(draft.costs.total) * 100);
  const currency = draft.costs.currency;
  if (toEurCents(costCents, currency) > config.budget.approvalLimitCents) {
    await requestApproval({
      agentId: ID,
      kind: "printful_order_confirm",
      title: `Printful-bestelling bevestigen voor eBay-bestelling ${orderId}`,
      details: `Conceptbestelling ${draft.id} ligt boven de limiet voor automatisch goedkeuren.`,
      amountCents: costCents,
      currency,
      payload: { orderId: draft.id, costCents, currency, receiptId: `eBay ${orderId}` },
    });
    return { orderId: draft.id, confirmed: false };
  }
  await printful.confirmOrder(draft.id);
  await recordCost({ agentId: ID, category: "printful", amountCents: costCents, currency, note: `Printful order ${draft.id} (eBay ${orderId})` });
  await log.info(`Printful-bestelling ${draft.id} geplaatst voor eBay-bestelling ${orderId}`, undefined, taskId);
  return { orderId: draft.id, confirmed: true };
}

/** Sends Printful's tracking number to eBay once an order ships. */
async function syncShipments(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (config.dryRun || !printful.hasPrintfulToken() || !ebay.isEbayConfigured() || !(await ebay.isEbayConnected())) return { skipped: "not connected" };
  const shipped = new Set((await getSetting<string[]>(SHIPPED_KEY)) ?? []);
  const sales = await db.sale.findMany({ where: { source: "ebay", occurredAt: { gte: new Date(Date.now() - SHIPMENT_WINDOW_DAYS * 86_400_000) } } });
  let marked = 0;
  for (const sale of sales) {
    if (shipped.has(sale.externalId)) continue;
    const pf = await printful.getOrderByExternalId(`ebay-${sale.externalId}`);
    const shipment = pf?.shipments?.find((s) => s.tracking_number);
    if (!shipment) continue;
    const order = sale.data as unknown as ebay.EbayOrder;
    await ebay.addShipment(sale.externalId, order.lineItems.map((li) => ({ lineItemId: li.lineItemId, quantity: li.quantity })), shipment.carrier.toUpperCase(), shipment.tracking_number);
    shipped.add(sale.externalId);
    await setSetting(SHIPPED_KEY, [...shipped]);
    await log.info(`eBay-bestelling ${sale.externalId} verzonden: track & trace ${shipment.tracking_number} staat op eBay`, undefined, taskId);
    marked++;
  }
  return { marked };
}

registerApprovalExecutor("ebay_start", async () => {
  await setSetting(APPROVED_KEY, true);
  await enqueue(ID, "ebay_list");
  return "eBay gestart: de eerste producten worden nu gelist";
});

export const ebayAgent: AgentDefinition = {
  id: ID,
  name: "eBay-agent",
  phase: 1,
  businessId: "etsy-pod",
  description: "Zet de beste fysieke Etsy-producten ook op eBay (ebay.com), verwerkt eBay-bestellingen via Printful en stuurt de track & trace terug.",
  dependsOn: ["database", "ebay", "printful"],
  chatTasks: ["ebay_setup", "ebay_list", "ebay_orders", "ebay_shipments"],
  handlers: { ebay_setup: setup, ebay_list: list, ebay_check: check, ebay_orders: syncOrders, ebay_fulfil: fulfil, ebay_shipments: syncShipments },
  taskInfo: {
    ebay_setup: "Eenmalig: verzend-, betaal- en retourbeleid en de verzendlocatie op eBay aanmaken",
    ebay_list: "De beste live Etsy-producten op eBay zetten (tot de limiet) en eBay-listings beëindigen die niet meer op Etsy staan",
    ebay_check: "Bij eBay navragen wat er echt staat: elke aanbieding, de staat van elke listing en de verkooplimiet",
    ebay_orders: "Nieuwe betaalde eBay-bestellingen ophalen",
    ebay_fulfil: "De Printful-bestelling maken voor een eBay-bestelling",
    ebay_shipments: "Verzonden eBay-bestellingen met track & trace op eBay markeren",
  },
};
