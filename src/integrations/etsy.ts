import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";

// Etsy Open API v3. OAuth 2.0 with PKCE; access tokens last 1 hour and are
// refreshed with the stored refresh token.
const API = "https://openapi.etsy.com/v3/application";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const SCOPES = ["listings_r", "listings_w", "transactions_r"];
const TOKEN_KEY = "etsy.oauth.token";
const PENDING_KEY = "etsy.oauth.pending";

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

export const isEtsyConfigured = () => Boolean(config.etsy.apiKey && config.etsy.shopId);

export async function isEtsyConnected(): Promise<boolean> {
  return (await getSetting<StoredToken>(TOKEN_KEY)) !== null;
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

async function etsy<T>(method: string, path: string, body?: unknown | FormData): Promise<T> {
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
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  if (!res.ok) throw new Error(`Etsy ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
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
    taxonomy_id: config.etsy.taxonomyId,
    shipping_profile_id: Number(config.etsy.shippingProfileId),
    return_policy_id: Number(config.etsy.returnPolicyId),
    tags: input.tags,
    type: "physical",
    is_supply: false,
  };
  const partner = process.env.ETSY_PRODUCTION_PARTNER_ID;
  if (partner) body.production_partner_ids = [Number(partner)];
  return etsy("POST", `/shops/${config.etsy.shopId}/listings`, body);
}

export async function uploadListingImage(listingId: string, png: Buffer, rank = 1): Promise<void> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), `image-${rank}.png`);
  form.append("rank", String(rank));
  await etsy("POST", `/shops/${config.etsy.shopId}/listings/${listingId}/images`, form);
}

export async function activateListing(listingId: string): Promise<void> {
  await etsy("PATCH", `/shops/${config.etsy.shopId}/listings/${listingId}`, { state: "active" });
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
  const res = await etsy<{ results: EtsyReceipt[] }>("GET", `/shops/${config.etsy.shopId}/receipts?${params}`);
  return res.results;
}

/** Etsy amounts are { amount, divisor }; convert to minor units (cents). */
export function moneyToCents(m: { amount: number; divisor: number }): number {
  return Math.round((m.amount / m.divisor) * 100);
}
