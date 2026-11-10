import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";

// Etsy Open API v3. OAuth 2.0 with PKCE; access tokens last 1 hour and are
// refreshed with the stored refresh token.
const API = "https://openapi.etsy.com/v3/application";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
// shops_r: /users/me, the shop, its shipping profiles, return policies and production partners.
const SCOPES = ["shops_r", "listings_r", "listings_w", "transactions_r"];
const TOKEN_KEY = "etsy.oauth.token";
const PENDING_KEY = "etsy.oauth.pending";

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

// The shop ID can be set by hand (ETSY_SHOP_ID) but is normally looked up once when the shop is connected.
const SHOP_KEY = "etsy.shop.id";
let shopIdCache: string | null = config.etsy.shopId || null;

export async function shopId(): Promise<string> {
  shopIdCache ??= await getSetting<string>(SHOP_KEY);
  if (!shopIdCache) throw new Error("Etsy is not connected. Open /auth/etsy/start to authorise the shop.");
  return shopIdCache;
}

export const isEtsyConfigured = () => Boolean(config.etsy.apiKey);

/**
 * Shop settings every new listing needs. Set by hand (ETSY_* variables) or, normally, found
 * automatically by findEtsySetup() right after the shop is connected and loaded at startup.
 */
export const es = {
  taxonomyId: config.etsy.taxonomyId,
  shippingProfileId: Number(config.etsy.shippingProfileId) || 0,
  returnPolicyId: Number(config.etsy.returnPolicyId) || 0,
  productionPartnerId: Number(process.env.ETSY_PRODUCTION_PARTNER_ID) || 0,
  readinessStateId: Number(process.env.ETSY_READINESS_STATE_ID) || 0,
  currency: config.pod.currency,
  priceCents: config.pod.priceCents,
};
export const isEtsyListingReady = () => Boolean(es.taxonomyId && es.shippingProfileId && es.readinessStateId);

/** Connected = a token and a known shop. A connection that failed half-way counts as not connected. */
export async function isEtsyConnected(): Promise<boolean> {
  if ((await getSetting<StoredToken>(TOKEN_KEY)) === null) return false;
  return Boolean(config.etsy.shopId || (await getSetting<string>(SHOP_KEY)));
}

const redirectUri = () => `${config.publicUrl}/auth/etsy/callback`;

function apiKeyHeader(): string {
  // Etsy expects "keystring:shared_secret"; fall back to the bare keystring if no secret is set.
  return config.etsy.sharedSecret ? `${config.etsy.apiKey}:${config.etsy.sharedSecret}` : config.etsy.apiKey;
}

export async function buildAuthUrl(): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  await setSetting(PENDING_KEY, { state, verifier });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.etsy.apiKey,
    redirect_uri: redirectUri(),
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://www.etsy.com/oauth/connect?${params}`;
}

export async function handleCallback(code: string, state: string): Promise<void> {
  const pending = await getSetting<{ state: string; verifier: string }>(PENDING_KEY);
  if (!pending || pending.state !== state) throw new Error("OAuth state mismatch; start again");
  await requestToken({
    grant_type: "authorization_code",
    client_id: config.etsy.apiKey,
    redirect_uri: redirectUri(),
    code,
    code_verifier: pending.verifier,
  });
  await setSetting(PENDING_KEY, null);
  // Etsy tells us which shop belongs to the account that just approved access.
  const me = await etsy<{ user_id: number; shop_id: number | null }>("GET", "/users/me");
  if (!me.shop_id) throw new Error("This Etsy account has no shop");
  shopIdCache = String(me.shop_id);
  await setSetting(SHOP_KEY, shopIdCache);
}

async function requestToken(form: Record<string, string>): Promise<StoredToken> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  if (!res.ok) throw new Error(`Etsy token request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const token: StoredToken = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  await setSetting(TOKEN_KEY, token);
  return token;
}

async function accessToken(): Promise<string> {
  const token = await getSetting<StoredToken>(TOKEN_KEY);
  if (!token) throw new Error("Etsy is not connected. Open /auth/etsy/start to authorise the shop.");
  if (token.expires_at - Date.now() > 60_000) return token.access_token;
  const refreshed = await requestToken({
    grant_type: "refresh_token",
    client_id: config.etsy.apiKey,
    refresh_token: token.refresh_token,
  });
  return refreshed.access_token;
}

// Etsy allows only a few requests per second per app. All calls go through one queue with a
// short gap, and a 429 is retried after a pause instead of failing the task.
const MIN_GAP_MS = 250;
const RATE_LIMIT_RETRIES = 4;
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function etsy<T>(method: string, path: string, body?: unknown | FormData): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await throttled(() => etsyRequest(method, path, body));
    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Etsy ${method} ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
}

async function etsyRequest(method: string, path: string, body?: unknown | FormData): Promise<Response> {
  const headers: Record<string, string> = {
    "x-api-key": apiKeyHeader(),
    authorization: `Bearer ${await accessToken()}`,
  };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${API}${path}`, { method, headers, body: payload });
}

export interface DraftListingInput {
  title: string;
  description: string;
  priceCents: number;
  tags: string[];
}

export async function createDraftListing(input: DraftListingInput): Promise<{ listing_id: number }> {
  const body: Record<string, unknown> = {
    quantity: 999,
    title: input.title,
    description: input.description,
    price: input.priceCents / 100,
    who_made: "i_did",
    when_made: "made_to_order",
    taxonomy_id: es.taxonomyId,
    shipping_profile_id: es.shippingProfileId,
    tags: input.tags,
    type: "physical",
    is_supply: false,
  };
  // Etsy requires a processing profile ("readiness state") on physical listings.
  body.readiness_state_id = es.readinessStateId;
  if (es.returnPolicyId) body.return_policy_id = es.returnPolicyId;
  if (es.productionPartnerId) body.production_partner_ids = [es.productionPartnerId];
  return etsy("POST", `/shops/${await shopId()}/listings`, body);
}

export async function uploadListingImage(listingId: string, png: Buffer, rank = 1): Promise<void> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), `image-${rank}.png`);
  form.append("rank", String(rank));
  await etsy("POST", `/shops/${await shopId()}/listings/${listingId}/images`, form);
}

/** New title and tags for a listing (the marketing agent's SEO refresh). Free on Etsy. */
export async function updateListingSeo(listingId: string, title: string, tags: string[]): Promise<void> {
  await etsy("PATCH", `/shops/${await shopId()}/listings/${listingId}`, { title, tags });
}

/** How many photos a listing has on Etsy. */
export async function getListingImageCount(listingId: string): Promise<number> {
  const res = await etsy<{ count: number }>("GET", `/listings/${listingId}/images`);
  return res.count;
}

export async function activateListing(listingId: string): Promise<void> {
  await etsy("PATCH", `/shops/${await shopId()}/listings/${listingId}`, { state: "active" });
}

export interface EtsyReceipt {
  receipt_id: number;
  name: string;
  first_line: string;
  second_line: string | null;
  city: string;
  state: string | null;
  zip: string;
  country_iso: string;
  create_timestamp: number;
  grandtotal: { amount: number; divisor: number; currency_code: string };
  transactions: { listing_id: number; quantity: number; transaction_id: number }[];
}

export async function getPaidReceiptsSince(sinceEpochSeconds: number): Promise<EtsyReceipt[]> {
  const params = new URLSearchParams({
    was_paid: "true",
    min_created: String(sinceEpochSeconds),
    limit: "100",
  });
  const res = await etsy<{ results: EtsyReceipt[] }>("GET", `/shops/${await shopId()}/receipts?${params}`);
  return res.results;
}

export interface EtsyListing {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  state: string;
  url: string;
  price: { amount: number; divisor: number; currency_code: string };
  shipping_profile_id?: number | null;
  return_policy_id?: number | null;
  views?: number;
  num_favorers?: number;
}

/** Every active listing in the shop, including ones placed by hand or through Printful. */
export async function getActiveListings(): Promise<EtsyListing[]> {
  const all: EtsyListing[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await etsy<{ count: number; results: EtsyListing[] }>(
      "GET",
      `/shops/${await shopId()}/listings/active?limit=100&offset=${offset}`,
    );
    all.push(...page.results);
    if (page.results.length < 100 || all.length >= page.count) return all;
  }
}

export const getShop = async () =>
  etsy<{ shop_id: number; shop_name: string; currency_code: string }>("GET", `/shops/${await shopId()}`);

export const getShippingProfiles = async () =>
  (await etsy<{ results: { shipping_profile_id: number; title: string }[] }>("GET", `/shops/${await shopId()}/shipping-profiles`)).results;

export const getReturnPolicies = async () =>
  (await etsy<{ results: { return_policy_id: number; accepts_returns: boolean; accepts_exchanges: boolean }[] }>(
    "GET",
    `/shops/${await shopId()}/policies/return`,
  )).results;

/** Processing profiles: made to order or ready to ship, with a processing time. */
export const getReadinessStates = async () =>
  (await etsy<{
    results: {
      readiness_state_id: number;
      readiness_state: string;
      min_processing_time: number;
      max_processing_time: number;
      processing_time_unit: string;
    }[];
  }>("GET", `/shops/${await shopId()}/readiness-state-definitions`)).results;

export const getProductionPartners = async () =>
  (await etsy<{ results: { production_partner_id: number; partner_name: string }[] }>("GET", `/shops/${await shopId()}/production-partners`)).results;

export interface TaxonomyNode {
  id: number;
  name: string;
  children: TaxonomyNode[];
}
export const getTaxonomy = async () => (await etsy<{ results: TaxonomyNode[] }>("GET", "/seller-taxonomy/nodes")).results;

/** URL of a listing's main photo (570 px wide), if it has one. */
export async function getMainImageUrl(listingId: number): Promise<string | null> {
  const res = await etsy<{ results: { url_570xN: string; rank: number }[] }>("GET", `/listings/${listingId}/images`);
  return res.results.sort((a, b) => a.rank - b.rank)[0]?.url_570xN ?? null;
}

/** The listing's main photo at full size (for Pinterest, which prefers large images). */
export async function getLargeImageUrl(listingId: string): Promise<string | null> {
  const res = await etsy<{ results: { url_fullxfull: string; rank: number }[] }>("GET", `/listings/${listingId}/images`);
  return res.results.sort((a, b) => a.rank - b.rank)[0]?.url_fullxfull ?? null;
}

/** Etsy amounts are { amount, divisor }; convert to minor units (cents). */
export function moneyToCents(m: { amount: number; divisor: number }): number {
  return Math.round((m.amount / m.divisor) * 100);
}
