// Pinterest API v5: connect once with OAuth (open /auth/pinterest/start?token=ADMIN_TOKEN),
// then the marketing agent creates pins that link to the products.
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";

const SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"];
const TOKEN_KEY = "pinterest.oauth.token";
const PENDING_KEY = "pinterest.oauth.pending";
const USER_KEY = "pinterest.user";

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export const isPinterestConfigured = () => Boolean(config.pinterest.appId && config.pinterest.appSecret);
export const isPinterestConnected = async () => (await getSetting<StoredToken>(TOKEN_KEY)) !== null;
export const pinterestUser = () => getSetting<string>(USER_KEY);

const redirectUri = () => `${config.publicUrl}/auth/pinterest/callback`;
const basicAuth = () => `Basic ${Buffer.from(`${config.pinterest.appId}:${config.pinterest.appSecret}`).toString("base64")}`;

export async function buildAuthUrl(): Promise<string> {
  const state = randomBytes(16).toString("hex");
  await setSetting(PENDING_KEY, { state });
  const params = new URLSearchParams({
    client_id: config.pinterest.appId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(","),
    state,
  });
  return `https://www.pinterest.com/oauth/?${params}`;
}

export async function handleCallback(code: string, state: string): Promise<string> {
  const pending = await getSetting<{ state: string }>(PENDING_KEY);
  if (!pending || pending.state !== state) throw new Error("OAuth state mismatch; start again");
  await requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  await setSetting(PENDING_KEY, null);
  const me = await pinterest<{ username: string }>("GET", "/v5/user_account");
  await setSetting(USER_KEY, me.username);
  return me.username;
}

async function requestToken(form: Record<string, string>): Promise<StoredToken> {
  const res = await fetch(`${config.pinterest.apiUrl}/v5/oauth/token`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  if (!res.ok) throw new Error(`Pinterest token request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const previous = await getSetting<StoredToken>(TOKEN_KEY);
  const token: StoredToken = {
    access_token: json.access_token,
    // A refresh does not always return a new refresh token; keep the old one then.
    refresh_token: json.refresh_token ?? previous?.refresh_token ?? "",
    expires_at: Date.now() + json.expires_in * 1000,
  };
  await setSetting(TOKEN_KEY, token);
  return token;
}

async function accessToken(): Promise<string> {
  const token = await getSetting<StoredToken>(TOKEN_KEY);
  if (!token) throw new Error("Pinterest is not connected. Open /auth/pinterest/start to connect the account.");
  if (token.expires_at - Date.now() > 60_000) return token.access_token;
  return (await requestToken({ grant_type: "refresh_token", refresh_token: token.refresh_token })).access_token;
}

async function pinterest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.pinterest.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Pinterest ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface Board {
  id: string;
  name: string;
}

export async function listBoards(): Promise<Board[]> {
  const all: Board[] = [];
  let bookmark: string | null | undefined;
  do {
    const page = await pinterest<{ items: Board[]; bookmark?: string | null }>(
      "GET",
      `/v5/boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`,
    );
    all.push(...page.items.map((b) => ({ id: b.id, name: b.name })));
    bookmark = page.bookmark;
  } while (bookmark && all.length < 500);
  return all;
}

export const createBoard = (name: string, description: string) =>
  pinterest<Board>("POST", "/v5/boards", { name, description, privacy: "PUBLIC" });

export interface NewPin {
  boardId: string;
  title: string;
  description: string;
  altText: string;
  link: string;
  imageUrl: string;
}

export async function createPin(pin: NewPin): Promise<{ id: string }> {
  return pinterest<{ id: string }>("POST", "/v5/pins", {
    board_id: pin.boardId,
    title: pin.title.slice(0, 100),
    description: pin.description.slice(0, 500),
    alt_text: pin.altText.slice(0, 500),
    link: pin.link,
    media_source: { source_type: "image_url", url: pin.imageUrl },
  });
}

/** Case- and spacing-insensitive board match, so "Gifts for Nurses" finds "gifts for  nurses". */
export const sameBoard = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
