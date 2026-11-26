// Garments through Printify (Jarne, 26 Nov): the catalogue (colours, sizes, print area, shipping per
// garment at a European print provider), making a product from a design, Jarne's approval, publishing
// to Etsy through Printify's own Etsy connection, and linking the Etsy listing back.
// Orders for these listings are fulfilled by Printify itself; the Printful order flow skips them
// (they have no printfulVariant).
import { getSetting, setSetting, db } from "../db.js";
import * as printify from "../integrations/printify.js";
import { requestApproval } from "../lib/approvals.js";
import type { CatalogEntry, CatalogVariant } from "../lib/catalogSetup.js";
import { designUrl, renderPrintFile, saveDesign } from "../lib/design.js";
import { PRINTIFY_PROVIDER, PRINTIFY_TYPES, extraPhotos, inkFor, pickVariants, productBody, retailPrice } from "../lib/printifyCatalog.js";
import * as etsy from "../integrations/etsy.js";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { designsDir } from "../lib/design.js";
import type { TaskContext } from "./types.js";

const CATALOG_KEY = "printify.catalog";
const SETUP_KEY = "printify.setup";
const EU_PRICE_COUNTRY = "DE";
/** Printify print areas are 300 dpi (a T-shirt front is 3402 × 4273 px, about 11 × 14 in). */
const PRINTIFY_DPI = 300;

export interface PrintifyCatalogEntry {
  typeId: string;
  label: string;
  noun: string;
  facts: string;
  blueprintId: number;
  providerId: number;
  placeholder: { width: number; height: number };
  shippingCents: number;
  /** Last known cost per variant (from a product), in cents; 0 until the first product is made. */
  costCents: number;
  variants: { id: number; color: string; size: string }[];
}

let catalog: PrintifyCatalogEntry[] = [];
export const loadPrintifyCatalog = async () => {
  catalog = (await getSetting<PrintifyCatalogEntry[]>(CATALOG_KEY)) ?? [];
  return catalog;
};
export const printifyCatalog = () => catalog;

async function shopId(): Promise<number> {
  const setup = await getSetting<{ shopId: number | null }>(SETUP_KEY);
  if (setup?.shopId) return setup.shopId;
  const shop = (await printify.listShops()).find((s) => /etsy/i.test(s.sales_channel));
  if (!shop) throw new Error("Printify ziet geen Etsy-winkel: koppel Etsy in Printify");
  return shop.id;
}

/** Reads colours, sizes, print area and European shipping per garment and stores the catalogue. */
export async function printifySetup(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  if (!printify.isPrintifyConfigured()) throw new Error("PRINTIFY_API_TOKEN ontbreekt in Railway");
  const old = new Map((await loadPrintifyCatalog()).map((c) => [c.typeId, c.costCents]));
  const out: PrintifyCatalogEntry[] = [];
  const lines: string[] = [];
  for (const t of PRINTIFY_TYPES) {
    const all = await printify.variantsWithPlaceholders(t.blueprintId, PRINTIFY_PROVIDER);
    const picked = pickVariants(all, t.colors, 4);
    if (!picked.length) {
      lines.push(`${t.label}: geen van de gewenste kleuren bij deze drukker`);
      continue;
    }
    const front = all.find((v) => v.id === picked[0].id)?.placeholders.find((p) => p.position === "front");
    if (!front) {
      lines.push(`${t.label}: geen printzone 'front'`);
      continue;
    }
    const ship = await printify.shippingFor(t.blueprintId, PRINTIFY_PROVIDER);
    const ids = new Set(picked.map((p) => p.id));
    const profiles = ship.profiles.filter((p) => p.variant_ids.some((id) => ids.has(id)));
    const eu = profiles.filter((p) => p.countries.includes(EU_PRICE_COUNTRY));
    const shippingCents = Math.max(0, ...(eu.length ? eu : profiles).map((p) => p.first_item.cost));
    out.push({
      typeId: t.typeId,
      label: t.label,
      noun: t.noun,
      facts: t.facts,
      blueprintId: t.blueprintId,
      providerId: PRINTIFY_PROVIDER,
      placeholder: { width: front.width, height: front.height },
      shippingCents,
      costCents: old.get(t.typeId) ?? 0,
      variants: picked,
    });
    lines.push(`${t.label}: ${[...new Set(picked.map((p) => p.color))].join(", ")} · ${picked.length} varianten · printzone ${front.width}×${front.height} · verzending EU €${(shippingCents / 100).toFixed(2)}`);
  }
  await setSetting(CATALOG_KEY, out);
  catalog = out;
  await log.info(`Printify-aanbod klaar:\n${lines.join("\n")}`, undefined, taskId);
  return { types: out.length };
}

/** Printify garments as catalogue entries for the daily design batch (prices are estimates until the first product). */
export function printifyEntries(): (CatalogEntry & { printify: true })[] {
  return catalog.map((c) => {
    const price = c.costCents ? retailPrice(c.costCents + c.shippingCents, c.shippingCents) : c.typeId === "tshirt" ? 2999 : 4499;
    const variants: CatalogVariant[] = c.variants.map((v) => ({
      variantId: v.id,
      size: v.size,
      color: v.color,
      ink: inkFor(v.color),
      priceCents: price,
      costUsd: 0,
      placement: "front",
      width: c.placeholder.width,
      height: c.placeholder.height,
    }));
    return {
      typeId: c.typeId,
      label: c.label,
      enabled: true,
      productId: c.blueprintId,
      layout: "chest" as const,
      taxonomyId: null,
      shippingProfileId: null,
      shippingProfileTitle: null,
      variants,
      printify: true as const,
    };
  });
}

/** Makes one Printify product from a design (not yet on Etsy) and saves it as a listing waiting for approval. */
export async function createPrintifyListing(i: {
  typeId: string;
  niche: string;
  title: string;
  description: string;
  tags: string[];
  svg: string;
}): Promise<string> {
  const c = catalog.find((x) => x.typeId === i.typeId);
  if (!c) throw new Error(`Geen Printify-aanbod voor ${i.typeId}: draai printify_setup`);
  const shop = await shopId();
  const listing = await db.listing.create({
    data: {
      niche: i.niche,
      title: i.title,
      description: i.description,
      tags: i.tags,
      productType: c.typeId,
      priceCents: 0,
      currency: "EUR",
      designSvg: i.svg,
      designFile: "",
      supplier: "printify",
    },
  });
  const files: Record<"light" | "dark", string> = { light: "", dark: "" };
  const imageIds: Record<"light" | "dark", string> = { light: "", dark: "" };
  for (const ink of ["light", "dark"] as const) {
    if (!c.variants.some((v) => inkFor(v.color) === ink)) continue;
    files[ink] = await saveDesign(await renderPrintFile(i.svg, "chest", c.placeholder.width, c.placeholder.height, ink, PRINTIFY_DPI), `${listing.id}-printify-${ink}`);
    imageIds[ink] = (await printify.uploadImage(files[ink], designUrl(files[ink]))).id;
  }
  // A first price to create the product with; the real one follows from Printify's cost.
  const provisional = c.variants.map((v) => ({ ...v, priceCents: 4999 }));
  const created = await printify.createProduct(shop, productBody({ title: i.title, description: i.description, tags: i.tags, blueprintId: c.blueprintId, providerId: c.providerId, variants: provisional, imageIds }));
  // A price per size from Printify's cost (S to XL cost the same; 2XL and 3XL a little more).
  // Printify's costs are treated as euros (if they are dollars, that only overestimates them).
  const priced = pricePerVariant(created.variants.filter((v) => v.is_enabled), c.shippingCents);
  const price = Math.min(...priced.map((v) => v.price));
  const cost = Math.min(...created.variants.filter((v) => v.is_enabled).map((v) => v.cost ?? 0));
  await printify.updateProduct(shop, created.id, { variants: priced });
  if (cost && cost !== c.costCents) {
    c.costCents = cost;
    await setSetting(CATALOG_KEY, catalog);
  }
  await db.listing.update({
    where: { id: listing.id },
    data: { printifyProductId: created.id, priceCents: price, designFile: files.dark || files.light, status: "uploaded", imageUrl: created.images.find((im) => im.is_default)?.src ?? created.images[0]?.src ?? null },
  });
  return listing.id;
}

/** One approval for the new Printify products, with a photo link per product. */
export async function requestPrintifyPublish(listingIds: string[], extra?: string) {
  const rows = await db.listing.findMany({ where: { id: { in: listingIds } } });
  if (!rows.length) return;
  await requestApproval({
    agentId: "etsy-pod",
    kind: "printify_publish",
    title: `${rows.length} Printify-product(en) op Etsy zetten`,
    details:
      `${extra ? `${extra}\n` : ""}Bekijk ze eerst (foto per product). Na goedkeuring zet Printify ze op Etsy en verzorgt het de bestellingen.\n` +
      rows.map((r) => `• ${r.title} · €${(r.priceCents / 100).toFixed(2)}${r.imageUrl ? `\n  ${r.imageUrl}` : ""}`).join("\n"),
    payload: { listingIds: rows.map((r) => r.id) },
  });
}

/** Approved: Printify publishes each product to Etsy. */
export async function publishPrintify(p: Record<string, unknown>): Promise<string> {
  const ids = Array.isArray(p.listingIds) ? (p.listingIds as string[]) : [];
  const shop = await shopId();
  const rows = await db.listing.findMany({ where: { id: { in: ids }, printifyProductId: { not: null } } });
  let done = 0;
  for (const r of rows) {
    await printify.publishProduct(shop, r.printifyProductId!);
    await db.listing.update({ where: { id: r.id }, data: { status: "publishing" } });
    done++;
  }
  return `${done} product(en) naar Etsy gestuurd via Printify; ze staan er binnen een paar minuten.`;
}

/** Links products Printify published to their Etsy listing (so SEO, stats and the dashboard see them). */
export async function printifyLink(): Promise<number> {
  const waiting = await db.listing.findMany({ where: { supplier: "printify", status: "publishing", printifyProductId: { not: null } } });
  if (!waiting.length) return 0;
  const shop = await shopId();
  let linked = 0;
  for (const r of waiting) {
    const p = await printify.getProduct(shop, r.printifyProductId!);
    const etsyId = p.external?.id;
    if (!etsyId) continue;
    // The hourly Etsy sync may already have found it as an unknown listing: this row replaces that one.
    await db.listing.deleteMany({ where: { etsyListingId: etsyId, id: { not: r.id } } });
    await db.listing.update({ where: { id: r.id }, data: { etsyListingId: etsyId, status: "active" } });
    await topUpPhotos({ ...r, etsyListingId: etsyId }, p).catch(() => undefined);
    linked++;
  }
  return linked;
}

/** Jarne's own Printify products: a price with at least €5 profit, then the same approval. */
export async function printifyOwn(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const shop = await shopId();
  const products = await printify.listProducts(shop);
  const known = new Map(
    (await db.listing.findMany({ where: { printifyProductId: { not: null } }, select: { id: true, printifyProductId: true, status: true } })).map((r) => [r.printifyProductId, r]),
  );
  // An earlier request for these products is replaced by this one (with the new prices).
  await db.approval.updateMany({ where: { kind: "printify_publish", status: "pending", title: { contains: "Printify" } }, data: { status: "rejected", decidedAt: new Date() } });
  const ids: string[] = [];
  for (const p of products) {
    const row0 = known.get(p.id);
    if (p.external?.id || (row0 && row0.status !== "uploaded")) continue;
    const c = catalog.find((x) => x.blueprintId === p.blueprint_id);
    const ship = c?.shippingCents ?? 500;
    const priced = pricePerVariant(p.variants.filter((v) => v.is_enabled), ship);
    const price = Math.min(...priced.map((v) => v.price));
    await printify.updateProduct(shop, p.id, { variants: priced });
    if (row0) {
      await db.listing.update({ where: { id: row0.id }, data: { priceCents: price } });
      ids.push(row0.id);
      continue;
    }
    const row = await db.listing.create({
      data: {
        niche: "jarne",
        title: p.title,
        description: p.description,
        tags: p.tags,
        productType: c?.typeId ?? "tshirt",
        priceCents: price,
        currency: "EUR",
        designSvg: "",
        designFile: "",
        supplier: "printify",
        source: "jarne",
        printifyProductId: p.id,
        status: "uploaded",
        imageUrl: p.images.find((im) => im.is_default)?.src ?? p.images[0]?.src ?? null,
      },
    });
    ids.push(row.id);
  }
  if (ids.length) await requestPrintifyPublish(ids, "Jouw eigen Printify-ontwerpen, met een prijs die ook met 20% korting nog minstens €5 winst geeft.");
  await log.info(`Printify: ${ids.length} eigen product(en) geprijsd en klaar voor jouw akkoord`, undefined, taskId);
  return { products: ids.length };
}

/** Etsy price per size: each variant's own cost plus shipping, at least €5 profit with the 20% sale. */
export function pricePerVariant(variants: { id: number; cost?: number }[], shippingCents: number) {
  return variants.map((v) => ({ id: v.id, price: retailPrice((v.cost ?? 0) + shippingCents, shippingCents), is_enabled: true }));
}

/** Fills an Etsy listing up to 10 photos with Printify's other mockups, then the design itself on white. */
async function topUpPhotos(r: { etsyListingId: string | null; designFile: string; title: string }, product: printify.PrintifyProduct): Promise<number> {
  if (!r.etsyListingId) return 0;
  let have = (await etsy.getListingImageIds(r.etsyListingId)).length;
  let added = 0;
  for (const src of extraPhotos(product.images, have)) {
    const img = await fetch(src).then((res) => (res.ok ? res.arrayBuffer() : null)).catch(() => null);
    if (!img) continue;
    await etsy.uploadListingImage(r.etsyListingId, await sharp(Buffer.from(img)).png().toBuffer(), ++have);
    added++;
  }
  if (have < 10 && r.designFile) {
    const art = await readFile(path.join(designsDir(), r.designFile)).catch(() => null);
    if (art) {
      const onWhite = await sharp(art).resize(2000, 2000, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer();
      await etsy.uploadListingImage(r.etsyListingId, onWhite, ++have);
      added++;
    }
  }
  return added;
}

/** Tops up the photos of every Printify listing already on Etsy. */
export async function printifyPhotos(_payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const shop = await shopId();
  const rows = await db.listing.findMany({ where: { supplier: "printify", etsyListingId: { not: null }, printifyProductId: { not: null }, status: "active" } });
  let added = 0;
  const counts: string[] = [];
  for (const r of rows) {
    try {
      const product = await printify.getProduct(shop, r.printifyProductId!);
      const onEtsy = (await etsy.getListingImageIds(r.etsyListingId!)).length;
      counts.push(`${r.title.slice(0, 40)}: Etsy ${onEtsy}, Printify ${product.images.length} (${product.images.filter((i) => !i.is_selected_for_publishing).length} niet verstuurd)`);
      added += await topUpPhotos(r, product);
    } catch (err) {
      await log.warn(`Foto's aanvullen mislukt voor ${r.title}: ${(err as Error).message.slice(0, 160)}`, undefined, taskId);
    }
  }
  await log.info(`Printify-listings: ${added} foto('s) toegevoegd aan ${rows.length} listing(s), tot 10 per listing\n${counts.join("\n")}`, undefined, taskId);
  return { added, listings: rows.length };
}
