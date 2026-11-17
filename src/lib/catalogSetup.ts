// Looks up, for every product type in catalog.ts, what the shop needs to sell it: the Printful
// variants (with their print-file size and placement) and the Etsy category and shipping profile.
// A type without an Etsy shipping profile for its kind of product is switched off with the reason,
// so the shop never charges mug shipping for a hoodie. Saved and loaded at startup.
import { getSetting, setSetting } from "../db.js";
import { es, getShippingProfiles, getTaxonomy, type TaxonomyNode } from "../integrations/etsy.js";
import { getCatalogProduct, getPrintfiles, type PrintfileInfo } from "../integrations/printful.js";
import { PRINTABLE, PRODUCT_TYPES, offeredVariants, type Ink, type Layout, type ProductType } from "./catalog.js";
import { findTaxonomyId } from "./etsySetup.js";

const KEY = "catalog.setup";

export interface CatalogVariant {
  variantId: number;
  size: string;
  color: string | null;
  ink: Ink;
  priceCents: number;
  costUsd: number;
  placement: string;
  width: number;
  height: number;
}

export interface CatalogEntry {
  typeId: string;
  label: string;
  enabled: boolean;
  /** Why it is off (Dutch, shown on the dashboard). */
  reason?: string;
  productId: number;
  layout: Layout;
  taxonomyId: number | null;
  shippingProfileId: number | null;
  shippingProfileTitle: string | null;
  variants: CatalogVariant[];
  /** A digital download (no Printful product, no variants). */
  digital?: boolean;
}

let catalog: CatalogEntry[] = [];
export const getCatalog = () => catalog;
export const enabledTypes = () => catalog.filter((c) => c.enabled);
export const catalogEntry = (typeId: string) => catalog.find((c) => c.typeId === typeId);

/** The print placement and file size of one variant, preferring the type's placements. */
export function placementFor(info: PrintfileInfo, variantId: number, preferred: string[]): { placement: string; width: number; height: number } | null {
  const placements = info.variant_printfiles.find((v) => v.variant_id === variantId)?.placements ?? {};
  const keys = Object.keys(placements).filter((k) => !k.startsWith("embroidery"));
  const placement = preferred.find((p) => p in placements) ?? keys[0];
  if (!placement) return null;
  const file = info.printfiles.find((f) => f.printfile_id === placements[placement]);
  return file ? { placement, width: file.width, height: file.height } : null;
}

/** "Printful: Mugs (20oz)" must not count as a poster profile because "Printful" contains "print". */
export const profileMatches = (type: ProductType, title: string) => type.shippingProfile.test(title.replace(/\bprintful\b:?/gi, ""));

/** The first category whose name matches, in the order the type lists them. */
export function taxonomyFor(type: ProductType, tree: TaxonomyNode[]): number | null {
  for (const name of type.etsyTaxonomy) {
    const id = findTaxonomyId(tree, name);
    if (id) return id;
  }
  return null;
}

export async function loadCatalog(): Promise<boolean> {
  catalog = (await getSetting<CatalogEntry[]>(KEY)) ?? [];
  return catalog.length > 0;
}

export async function findCatalog(): Promise<CatalogEntry[]> {
  const [profiles, tree] = await Promise.all([getShippingProfiles(), getTaxonomy()]);
  const entries: CatalogEntry[] = [];
  for (const type of PRODUCT_TYPES) {
    const base = { typeId: type.id, label: type.label, productId: type.printfulProductId, layout: type.layout };
    const off = (reason: string): CatalogEntry => ({
      ...base,
      enabled: false,
      reason,
      taxonomyId: null,
      shippingProfileId: null,
      shippingProfileTitle: null,
      variants: [],
    });
    try {
      const product = await getCatalogProduct(type.printfulProductId);
      if (!type.printfulTitle.test(product.product.title)) {
        entries.push(off(`Printful-product ${type.printfulProductId} is nu "${product.product.title}", niet het verwachte product`));
        continue;
      }
      const info = await getPrintfiles(type.printfulProductId);
      const variants: CatalogVariant[] = [];
      for (const v of offeredVariants(type, product.variants)) {
        const file = placementFor(info, v.variantId, type.placements);
        if (file) variants.push({ ...v, ...file });
      }
      if (!variants.length) {
        entries.push(off("Geen van de gekozen maten of kleuren is bij Printful te krijgen"));
        continue;
      }
      // Mugs use the profile the shop's own mugs use (found by etsy_setup); others need their own.
      const profile = type.shippingProfile.test("mug") && es.shippingProfileId
        ? profiles.find((p) => p.shipping_profile_id === es.shippingProfileId) ?? profiles.find((p) => profileMatches(type, p.title))
        : profiles.find((p) => profileMatches(type, p.title));
      const taxonomyId = taxonomyFor(type, tree);
      const entry: CatalogEntry = {
        ...base,
        enabled: Boolean(profile && taxonomyId),
        taxonomyId,
        shippingProfileId: profile?.shipping_profile_id ?? null,
        shippingProfileTitle: profile?.title ?? null,
        variants,
      };
      if (!taxonomyId) entry.reason = `Geen Etsy-categorie gevonden (${type.etsyTaxonomy.join(" / ")})`;
      else if (!profile) {
        entry.reason =
          `Geen verzendprofiel voor ${type.label.toLowerCase()} in je Etsy-winkel. Zet één ${type.label.toLowerCase()} via Printful op Etsy ` +
          "(dan maakt Printful het profiel), of maak er zelf een met dit woord in de naam; start daarna catalog_setup opnieuw.";
      }
      entries.push(entry);
    } catch (err) {
      entries.push(off(`Opzoeken mislukt: ${(err as Error).message}`));
    }
  }
  // Printable wall art: only needs an Etsy category.
  const printableTaxonomy = PRINTABLE.etsyTaxonomy.map((n) => findTaxonomyId(tree, n)).find((id) => id) ?? null;
  entries.push({
    typeId: PRINTABLE.id,
    label: PRINTABLE.label,
    enabled: Boolean(printableTaxonomy),
    reason: printableTaxonomy ? undefined : `Geen Etsy-categorie gevonden (${PRINTABLE.etsyTaxonomy.join(" / ")})`,
    productId: 0,
    layout: "center",
    taxonomyId: printableTaxonomy,
    shippingProfileId: null,
    shippingProfileTitle: null,
    variants: [],
    digital: true,
  });
  await setSetting(KEY, entries);
  catalog = entries;
  return entries;
}
