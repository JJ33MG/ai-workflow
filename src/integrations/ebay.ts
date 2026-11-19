// eBay Sell APIs (Inventory, Account, Fulfillment, Taxonomy). Connect once with eBay's OAuth
// (open /auth/ebay/start?token=ADMIN_TOKEN); the refresh token lasts about 18 months.
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";

const API = "https://api.ebay.com";
const AUTH = "https://auth.ebay.com/oauth2/authorize";
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
];
const TOKEN_KEY = "ebay.token";
const PENDING_KEY = "ebay.oauth.pending";

interface StoredToken {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

export const isEbayConfigured = () => Boolean(config.ebay.clientId && config.ebay.clientSecret && config.ebay.ruName);
export const isEbayConnected = async () => Boolean((await getSetting<StoredToken>(TOKEN_KEY))?.refreshToken);

const basic = () => `Basic ${Buffer.from(`${config.ebay.clientId}:${config.ebay.clientSecret}`).toString("base64")}`;

export async function buildAuthUrl(): Promise<string> {
  const state = randomBytes(16).toString("hex");
  await setSetting(PENDING_KEY, { state });
  const params = new URLSearchParams({
    client_id: config.ebay.clientId,
    redirect_uri: config.ebay.ruName,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
  });
  return `${AUTH}?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) throw new Error(`eBay token request failed: ${res.status} ${json.error_description ?? ""}`);
  return json;
}

export async function handleCallback(code: string, state: string): Promise<void> {
  const pending = await getSetting<{ state: string }>(PENDING_KEY);
  if (!pending || pending.state !== state) throw new Error("OAuth state mismatch; start again");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config.ebay.ruName });
  await setSetting(TOKEN_KEY, {
    accessToken: t.access_token!,
    expiresAt: Date.now() + (t.expires_in ?? 7200) * 1000,
    refreshToken: t.refresh_token!,
    refreshExpiresAt: Date.now() + (t.refresh_token_expires_in ?? 47_304_000) * 1000,
  } satisfies StoredToken);
  await setSetting(PENDING_KEY, null);
}

async function userToken(): Promise<string> {
  const stored = await getSetting<StoredToken>(TOKEN_KEY);
  if (!stored?.refreshToken) throw new Error("eBay is not connected. Open /auth/ebay/start to connect the seller account.");
  if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: stored.refreshToken, scope: SCOPES.join(" ") });
  await setSetting(TOKEN_KEY, { ...stored, accessToken: t.access_token!, expiresAt: Date.now() + (t.expires_in ?? 7200) * 1000 });
  return t.access_token!;
}

let appToken: { token: string; expiresAt: number } | null = null;
/** Application token (no seller needed) for the Taxonomy API. */
async function applicationToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.token;
  const t = await tokenRequest({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" });
  appToken = { token: t.access_token!, expiresAt: Date.now() + (t.expires_in ?? 7200) * 1000 };
  return appToken.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class EbayError extends Error {
  constructor(public status: number, public errors: { errorId?: number; message?: string; longMessage?: string }[], text: string) {
    super(text);
    this.name = "EbayError";
  }
}

async function ebay<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token ?? (await userToken())}`,
        "content-type": "application/json",
        "content-language": "en-US",
        accept: "application/json",
        "x-ebay-c-marketplace-id": config.ebay.marketplaceId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 4) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as T & { errors?: { errorId?: number; message?: string; longMessage?: string }[] }) : ({} as T);
    if (!res.ok) {
      const errors = (json as { errors?: { errorId?: number; message?: string; longMessage?: string }[] }).errors ?? [];
      throw new EbayError(res.status, errors, `eBay ${method} ${path} failed: ${res.status} ${errors.map((e) => e.longMessage ?? e.message).join("; ") || text.slice(0, 300)}`);
    }
    return json;
  }
}

// ---- Account: business policies and the item location -------------------------------------

export async function optInToBusinessPolicies(): Promise<void> {
  try {
    await ebay("POST", "/sell/account/v1/program/opt_in", { programType: "SELLING_POLICY_MANAGEMENT" });
  } catch (err) {
    // Already opted in is fine.
    if (!(err instanceof EbayError) || err.status >= 500) throw err;
  }
}

type Policy = { name: string; [k: string]: unknown };
async function findPolicy(kind: "fulfillment" | "payment" | "return", name: string): Promise<string | null> {
  const res = await ebay<Record<string, (Policy & Record<string, string>)[]>>("GET", `/sell/account/v1/${kind}_policy?marketplace_id=${config.ebay.marketplaceId}`);
  const list = res[`${kind}Policies`] ?? [];
  const found = list.find((p) => p.name === name);
  return found ? String(found[`${kind}PolicyId`]) : null;
}

const POLICY_NAME = "All You Can Wish (bot)";
const ALL = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

/** The shop's three policies, made once: free shipping, payment, and no returns (items are made to order). */
export async function ensurePolicies(): Promise<{ fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string }> {
  const marketplaceId = config.ebay.marketplaceId;
  const fulfillmentPolicyId =
    (await findPolicy("fulfillment", POLICY_NAME)) ??
    (
      await ebay<{ fulfillmentPolicyId: string }>("POST", "/sell/account/v1/fulfillment_policy", {
        name: POLICY_NAME,
        marketplaceId,
        categoryTypes: ALL,
        handlingTime: { unit: "DAY", value: config.ebay.handlingDays },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              { sortOrder: 1, shippingCarrierCode: config.ebay.shippingCarrier, shippingServiceCode: config.ebay.shippingService, freeShipping: true, buyerResponsibleForShipping: false },
            ],
          },
        ],
      })
    ).fulfillmentPolicyId;
  const paymentPolicyId =
    (await findPolicy("payment", POLICY_NAME)) ??
    (await ebay<{ paymentPolicyId: string }>("POST", "/sell/account/v1/payment_policy", { name: POLICY_NAME, marketplaceId, categoryTypes: ALL, immediatePay: true })).paymentPolicyId;
  const returnPolicyId =
    (await findPolicy("return", POLICY_NAME)) ??
    (await ebay<{ returnPolicyId: string }>("POST", "/sell/account/v1/return_policy", { name: POLICY_NAME, marketplaceId, categoryTypes: ALL, returnsAccepted: false })).returnPolicyId;
  return { fulfillmentPolicyId, paymentPolicyId, returnPolicyId };
}

export const LOCATION_KEY = "printful-us";

/** Where items ship from: Printful's US fulfilment centre (buyers see the city and state). */
export async function ensureLocation(): Promise<void> {
  try {
    await ebay("GET", `/sell/inventory/v1/location/${LOCATION_KEY}`);
  } catch (err) {
    if (!(err instanceof EbayError) || err.status !== 404) throw err;
    await ebay("POST", `/sell/inventory/v1/location/${LOCATION_KEY}`, {
      location: { address: { city: "Charlotte", stateOrProvince: "NC", postalCode: "28273", country: "US" } },
      locationTypes: ["WAREHOUSE"],
      name: "Printful US",
      merchantLocationStatus: "ENABLED",
    });
  }
}

// ---- Taxonomy -------------------------------------------------------------------------------

let treeId: string | null = null;
async function categoryTreeId(): Promise<string> {
  if (treeId) return treeId;
  const res = await ebay<{ categoryTreeId: string }>(
    "GET",
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${config.ebay.marketplaceId}`,
    undefined,
    await applicationToken(),
  );
  treeId = res.categoryTreeId;
  return treeId;
}

export async function suggestCategory(query: string): Promise<{ id: string; name: string } | null> {
  const res = await ebay<{ categorySuggestions?: { category: { categoryId: string; categoryName: string } }[] }>(
    "GET",
    `/commerce/taxonomy/v1/category_tree/${await categoryTreeId()}/get_category_suggestions?q=${encodeURIComponent(query)}`,
    undefined,
    await applicationToken(),
  );
  const c = res.categorySuggestions?.[0]?.category;
  return c ? { id: c.categoryId, name: c.categoryName } : null;
}

export interface Aspect {
  name: string;
  required: boolean;
  values: string[];
  freeText: boolean;
}

/** The item specifics a category asks for; required ones must be filled before eBay publishes. */
export async function categoryAspects(categoryId: string): Promise<Aspect[]> {
  const res = await ebay<{
    aspects?: { localizedAspectName: string; aspectConstraint: { aspectRequired?: boolean; aspectMode?: string }; aspectValues?: { localizedValue: string }[] }[];
  }>("GET", `/commerce/taxonomy/v1/category_tree/${await categoryTreeId()}/get_item_aspects_for_category?category_id=${categoryId}`, undefined, await applicationToken());
  return (res.aspects ?? []).map((a) => ({
    name: a.localizedAspectName,
    required: Boolean(a.aspectConstraint.aspectRequired),
    values: (a.aspectValues ?? []).slice(0, 40).map((v) => v.localizedValue),
    freeText: a.aspectConstraint.aspectMode !== "SELECTION_ONLY",
  }));
}

// ---- Inventory: items, groups and offers ----------------------------------------------------

export interface InventoryItem {
  title: string;
  description: string;
  aspects: Record<string, string[]>;
  imageUrls: string[];
  quantity: number;
}

export async function putInventoryItem(sku: string, item: InventoryItem): Promise<void> {
  await ebay("PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    availability: { shipToLocationAvailability: { quantity: item.quantity } },
    condition: "NEW",
    product: { title: item.title, description: item.description, aspects: item.aspects, imageUrls: item.imageUrls },
  });
}

export async function putInventoryGroup(
  key: string,
  g: { title: string; description: string; imageUrls: string[]; aspects: Record<string, string[]>; skus: string[]; varies: Record<string, string[]> },
): Promise<void> {
  await ebay("PUT", `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(key)}`, {
    title: g.title,
    description: g.description,
    imageUrls: g.imageUrls,
    aspects: g.aspects,
    variantSKUs: g.skus,
    variesBy: {
      aspectsImageVariesBy: g.varies.Color ? ["Color"] : [],
      specifications: Object.entries(g.varies).map(([name, values]) => ({ name, values })),
    },
  });
}

export interface OfferInput {
  sku: string;
  categoryId: string;
  description: string;
  priceCents: number;
  quantity: number;
  policies: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string };
}

/** Creates the offer for a SKU, or updates the one that exists (safe to repeat). Returns its id. */
export async function upsertOffer(o: OfferInput): Promise<string> {
  const body = {
    sku: o.sku,
    marketplaceId: config.ebay.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: o.quantity,
    categoryId: o.categoryId,
    listingDescription: o.description,
    listingPolicies: o.policies,
    merchantLocationKey: LOCATION_KEY,
    pricingSummary: { price: { value: (o.priceCents / 100).toFixed(2), currency: config.ebay.currency } },
  };
  const existing = await ebay<{ offers?: { offerId: string }[] }>("GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(o.sku)}&marketplace_id=${config.ebay.marketplaceId}`).catch(
    (err) => {
      if (err instanceof EbayError && err.status === 404) return { offers: [] };
      throw err;
    },
  );
  const id = existing.offers?.[0]?.offerId;
  if (id) {
    await ebay("PUT", `/sell/inventory/v1/offer/${id}`, body);
    return id;
  }
  return (await ebay<{ offerId: string }>("POST", "/sell/inventory/v1/offer", body)).offerId;
}

export async function publishGroup(groupKey: string): Promise<string> {
  const res = await ebay<{ listingId: string }>("POST", "/sell/inventory/v1/offer/publish_by_inventory_item_group", {
    inventoryItemGroupKey: groupKey,
    marketplaceId: config.ebay.marketplaceId,
  });
  return res.listingId;
}

export async function publishOffer(offerId: string): Promise<string> {
  return (await ebay<{ listingId: string }>("POST", `/sell/inventory/v1/offer/${offerId}/publish`)).listingId;
}

/** Ends a listing (its items and offers stay, so it can be published again). */
export async function withdrawGroup(groupKey: string): Promise<void> {
  await ebay("POST", "/sell/inventory/v1/offer/withdraw_by_inventory_item_group", { inventoryItemGroupKey: groupKey, marketplaceId: config.ebay.marketplaceId });
}
export async function withdrawOffer(offerId: string): Promise<void> {
  await ebay("POST", `/sell/inventory/v1/offer/${offerId}/withdraw`);
}

// ---- Orders ---------------------------------------------------------------------------------

export interface EbayOrder {
  orderId: string;
  creationDate: string;
  orderPaymentStatus: string;
  orderFulfillmentStatus: string;
  pricingSummary: { total: { value: string; currency: string } };
  lineItems: { lineItemId: string; sku?: string; quantity: number; title: string }[];
  fulfillmentStartInstructions: {
    shippingStep?: {
      shipTo: {
        fullName: string;
        contactAddress: { addressLine1: string; addressLine2?: string; city: string; stateOrProvince?: string; postalCode: string; countryCode: string };
        primaryPhone?: { phoneNumber?: string };
      };
    };
  }[];
}

/** Paid orders that still need shipping. */
export async function getOpenOrders(): Promise<EbayOrder[]> {
  const filter = encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");
  const res = await ebay<{ orders?: EbayOrder[] }>("GET", `/sell/fulfillment/v1/order?filter=${filter}&limit=50`);
  return (res.orders ?? []).filter((o) => o.orderPaymentStatus === "PAID");
}

/** Marks line items shipped with a tracking number; eBay tells the buyer. */
export async function addShipment(orderId: string, lineItems: { lineItemId: string; quantity: number }[], carrier: string, trackingNumber: string): Promise<void> {
  await ebay("POST", `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, {
    lineItems,
    shippedDate: new Date().toISOString(),
    shippingCarrierCode: carrier,
    trackingNumber,
  });
}

// ---- Marketplace account deletion (required for every production app) ----------------------

/** The token entered in eBay's developer portal next to the deletion endpoint. */
export function verificationToken(): string {
  return config.ebay.verificationToken || createHash("sha256").update(`ebay-deletion:${config.adminToken}`).digest("hex").slice(0, 48);
}
export const deletionEndpoint = () => `${config.publicUrl}/hooks/ebay/deletion`;

/** eBay's check that we own the endpoint: sha256(challengeCode + verificationToken + endpoint). */
export function challengeResponse(challengeCode: string, token = verificationToken(), endpoint = deletionEndpoint()): string {
  return createHash("sha256").update(challengeCode).update(token).update(endpoint).digest("hex");
}
