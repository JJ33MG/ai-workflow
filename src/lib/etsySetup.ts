// Finds the shop settings every new Etsy listing needs, so nothing has to be looked up by hand:
// the shipping profile Printful created, a return policy, the "Mugs" category, Printful as
// production partner, and the shop's currency (with a matching price). Saved and loaded at startup.
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";
import {
  es,
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
  returnPolicyId: number;
  taxonomyId: number;
  productionPartnerId: number | null;
}

/** Prefer the shipping profile Printful made for its products; otherwise the first one. */
export function pickShippingProfile<T extends { title: string }>(profiles: T[]): T | null {
  return profiles.find((p) => /printful/i.test(p.title)) ?? profiles[0] ?? null;
}

export function pickProductionPartner<T extends { partner_name: string }>(partners: T[]): T | null {
  return partners.find((p) => /printful/i.test(p.partner_name)) ?? null;
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
  es.returnPolicyId = s.returnPolicyId;
  es.taxonomyId = s.taxonomyId;
  es.productionPartnerId = s.productionPartnerId ?? 0;
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
  const returns = (await getReturnPolicies())[0];
  if (!returns) throw new Error("No return policy in the Etsy shop. Add one in Shop Manager → Settings → Policies.");
  const taxonomyId = findTaxonomyId(await getTaxonomy());
  if (!taxonomyId) throw new Error('Could not find the "Mugs" category in Etsy\'s taxonomy');
  const partner = pickProductionPartner(await getProductionPartners());

  const setup: EtsySetup = {
    shopName: shop.shop_name,
    currency: shop.currency_code,
    priceCents: defaultPriceCents(shop.currency_code),
    shippingProfileId: profile.shipping_profile_id,
    shippingProfileTitle: profile.title,
    returnPolicyId: returns.return_policy_id,
    taxonomyId,
    productionPartnerId: partner?.production_partner_id ?? null,
  };
  await setSetting(KEY, setup);
  apply(setup);
  return setup;
}
