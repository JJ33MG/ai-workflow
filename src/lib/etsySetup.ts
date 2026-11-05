// Finds the shop settings every new Etsy listing needs, so nothing has to be looked up by hand:
// the shipping profile Printful created, a return policy, the "Mugs" category, Printful as
// production partner, and the shop's currency (with a matching price). Saved and loaded at startup.
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";
import {
  es,
  getActiveListings,
  getProductionPartners,
  getReturnPolicies,
  getShippingProfiles,
  getShop,
  getTaxonomy,
  type TaxonomyNode,
} from "../integrations/etsy.js";

const KEY = "etsy.setup";

export interface EtsySetup {
  shopName: string;
  currency: string;
  priceCents: number;
  shippingProfileId: number;
  shippingProfileTitle: string;
  returnPolicyId: number | null;
  taxonomyId: number;
  productionPartnerId: number | null;
  /** What Etsy returned, so a missing partner can be diagnosed from the log. */
  partnersSeen?: string[];
}

/** Prefer the shipping profile Printful made for its products; otherwise the first one. */
export function pickShippingProfile<T extends { title: string }>(profiles: T[]): T | null {
  return profiles.find((p) => /printful/i.test(p.title)) ?? profiles[0] ?? null;
}

/** Printful by name; a shop with exactly one production partner uses that one. */
export function pickProductionPartner<T extends { partner_name: string }>(partners: T[]): T | null {
  return partners.find((p) => /printful/i.test(p.partner_name ?? "")) ?? (partners.length === 1 ? partners[0] : null);
}

/** The id most of the shop's existing listings use (e.g. the return policy picked by hand in Shop Manager). */
export function mostUsedId<K extends string>(listings: Partial<Record<K, number | null>>[], key: K): number | null {
  const counts = new Map<number, number>();
  for (const l of listings) {
    const id = l[key];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [id, n] of counts) if (best === null || n > counts.get(best)!) best = id;
  return best;
}

/** Depth-first search for the "Mugs" category in Etsy's seller taxonomy. */
export function findTaxonomyId(nodes: TaxonomyNode[], name = "Mugs"): number | null {
  for (const n of nodes) {
    if (n.name.toLowerCase() === name.toLowerCase()) return n.id;
    const inner = findTaxonomyId(n.children ?? [], name);
    if (inner) return inner;
  }
  return null;
}

/** POD_PRICE (in the shop's currency) wins; otherwise $21.99 for a USD shop, 19.99 elsewhere. */
export function defaultPriceCents(currency: string): number {
  const set = Number(process.env.POD_PRICE);
  if (set > 0) return Math.round(set * 100);
  return currency.toUpperCase() === "USD" ? 2199 : config.pod.priceCents;
}

function apply(s: EtsySetup) {
  es.currency = s.currency;
  es.priceCents = s.priceCents;
  es.shippingProfileId = s.shippingProfileId;
  es.returnPolicyId = s.returnPolicyId ?? 0;
  es.taxonomyId = s.taxonomyId;
  es.productionPartnerId = s.productionPartnerId ?? (Number(process.env.ETSY_PRODUCTION_PARTNER_ID) || 0);
}

export async function loadEtsySetup(): Promise<boolean> {
  const saved = await getSetting<EtsySetup>(KEY);
  if (saved) apply(saved);
  return Boolean(saved);
}

export async function findEtsySetup(): Promise<EtsySetup> {
  const shop = await getShop();
  const profile = pickShippingProfile(await getShippingProfiles());
  if (!profile) throw new Error("No shipping profile in the Etsy shop. Connect Printful to Etsy (it creates one) or add one in Shop Manager.");
  // Shops whose policy was chosen per listing may list no return policy here; then use the one
  // the existing listings carry.
  const returnPolicyId =
    (await getReturnPolicies())[0]?.return_policy_id ?? mostUsedId(await getActiveListings(), "return_policy_id");
  // Listings made through Printful often carry none; Etsy then applies the shop's own policy text.
  // Optional, so it never blocks the shop (a policy added later is picked up by running etsy_setup again).
  const taxonomyId = findTaxonomyId(await getTaxonomy());
  if (!taxonomyId) throw new Error('Could not find the "Mugs" category in Etsy\'s taxonomy');
  const partners = await getProductionPartners();
  const partner = pickProductionPartner(partners);

  const setup: EtsySetup = {
    shopName: shop.shop_name,
    currency: shop.currency_code,
    priceCents: defaultPriceCents(shop.currency_code),
    shippingProfileId: profile.shipping_profile_id,
    shippingProfileTitle: profile.title,
    returnPolicyId,
    taxonomyId,
    productionPartnerId: partner?.production_partner_id ?? null,
    partnersSeen: partners.map((p) => `${p.partner_name} (#${p.production_partner_id})`),
  };
  await setSetting(KEY, setup);
  apply(setup);
  return setup;
}
