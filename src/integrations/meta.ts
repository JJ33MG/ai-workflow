// Meta Graph API: one Meta app posts to a Facebook Page and the Instagram business account linked
// to it. Connect once with Facebook Login (open /auth/meta/start?token=ADMIN_TOKEN); the Page
// token that comes out of it does not expire.
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";

const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];
const CONNECTION_KEY = "meta.connection";
const PENDING_KEY = "meta.oauth.pending";

export interface MetaConnection {
  pageId: string;
  pageName: string;
  pageToken: string;
  instagramId: string | null;
  instagramUsername: string | null;
}

export const isMetaConfigured = () => Boolean(config.meta.appId && config.meta.appSecret);
export const metaConnection = () => getSetting<MetaConnection>(CONNECTION_KEY);

const graph = () => `https://graph.facebook.com/${config.meta.graphVersion}`;
const redirectUri = () => `${config.publicUrl}/auth/meta/callback`;

export async function buildAuthUrl(): Promise<string> {
  const state = randomBytes(16).toString("hex");
  await setSetting(PENDING_KEY, { state });
  const params = new URLSearchParams({
    client_id: config.meta.appId,
    redirect_uri: redirectUri(),
    state,
    scope: SCOPES.join(","),
    response_type: "code",
  });
  return `https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth?${params}`;
}

async function call<T>(method: "GET" | "POST", path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params);
  const res =
    method === "GET"
      ? await fetch(`${graph()}${path}?${query}`)
      : await fetch(`${graph()}${path}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: query,
        });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) throw new Error(`Meta ${method} ${path} failed: ${res.status} ${json.error?.message ?? ""}`);
  return json;
}

interface PageInfo {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

/** META_PAGE_ID wins; otherwise the Page with an Instagram account; otherwise the first Page. */
export function pickPage(pages: PageInfo[], wanted = config.meta.pageId): PageInfo | null {
  if (wanted) return pages.find((p) => p.id === wanted) ?? null;
  return pages.find((p) => p.instagram_business_account) ?? pages[0] ?? null;
}

export async function handleCallback(code: string, state: string): Promise<MetaConnection> {
  const pending = await getSetting<{ state: string }>(PENDING_KEY);
  if (!pending || pending.state !== state) throw new Error("OAuth state mismatch; start again");
  const short = await call<{ access_token: string }>("GET", "/oauth/access_token", {
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    redirect_uri: redirectUri(),
    code,
  });
  // A long-lived user token gives Page tokens that never expire.
  const long = await call<{ access_token: string }>("GET", "/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    fb_exchange_token: short.access_token,
  });
  const pages = await call<{ data: PageInfo[] }>("GET", "/me/accounts", {
    fields: "id,name,access_token,instagram_business_account",
    access_token: long.access_token,
  });
  const page = pickPage(pages.data);
  if (!page) throw new Error("No Facebook Page found for this account (or META_PAGE_ID does not match one). Create a Page for the shop first.");

  let instagramUsername: string | null = null;
  const instagramId = page.instagram_business_account?.id ?? null;
  if (instagramId) {
    const ig = await call<{ username: string }>("GET", `/${instagramId}`, { fields: "username", access_token: page.access_token });
    instagramUsername = ig.username;
  }
  const connection: MetaConnection = { pageId: page.id, pageName: page.name, pageToken: page.access_token, instagramId, instagramUsername };
  await setSetting(CONNECTION_KEY, connection);
  await setSetting(PENDING_KEY, null);
  return connection;
}

/** A photo post on the Facebook Page; the link in the text is clickable there. */
export async function postToFacebook(c: MetaConnection, imageUrl: string, message: string): Promise<string> {
  const res = await call<{ id: string; post_id?: string }>("POST", `/${c.pageId}/photos`, {
    url: imageUrl,
    message,
    access_token: c.pageToken,
  });
  return res.post_id ?? res.id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * An Instagram feed post: Meta first downloads the image into a container, then it is published.
 * Links in captions are not clickable on Instagram, so the caption points to the link in the bio.
 */
export async function postToInstagram(c: MetaConnection, imageUrl: string, caption: string, pollMs = 3000): Promise<string> {
  if (!c.instagramId) throw new Error("No Instagram business account is linked to the Facebook Page");
  const container = await call<{ id: string }>("POST", `/${c.instagramId}/media`, {
    image_url: imageUrl,
    caption: caption.slice(0, 2200),
    access_token: c.pageToken,
  });
  for (let i = 0; i < 10; i++) {
    const { status_code } = await call<{ status_code?: string }>("GET", `/${container.id}`, { fields: "status_code", access_token: c.pageToken });
    if (!status_code || status_code === "FINISHED") break;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Instagram could not process the image (${status_code})`);
    await sleep(pollMs);
  }
  const published = await call<{ id: string }>("POST", `/${c.instagramId}/media_publish`, {
    creation_id: container.id,
    access_token: c.pageToken,
  });
  return published.id;
}
