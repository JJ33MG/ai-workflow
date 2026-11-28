// FOMO leaderboards and trade feed (fomoapi.io, free key: FOMO_API_KEY in Railway) and token prices (DexScreener, no key).
// Read-only: nothing here can trade.
import type { BoardRow } from "../lib/copytrade.js";

const API = "https://api.fomoapi.io";

export async function fetchBoard(window: "30d" | "7d", key: string, fetchImpl: typeof fetch = fetch): Promise<BoardRow[]> {
  if (!key) throw new Error("FOMO is niet ingesteld: zet FOMO_API_KEY in Railway (gratis sleutel op fomoapi.io/dashboard).");
  const res = await fetchImpl(`${API}/v2/leaderboard/${window}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("FOMO weigert de sleutel: controleer FOMO_API_KEY.");
  if (res.status === 402) throw new Error("FOMO: de gratis credits van deze maand zijn op.");
  if (!res.ok) throw new Error(`FOMO-ranglijst ${window} ophalen mislukt (HTTP ${res.status}).`);
  const body = (await res.json().catch(() => null)) as { traders?: Record<string, unknown>[] } | null;
  if (!Array.isArray(body?.traders)) throw new Error(`FOMO gaf een onverwacht antwoord voor de ranglijst ${window}.`);
  return body.traders
    .filter((t) => typeof t.userId === "string")
    .map((t) => ({
      window,
      rank: Number(t.rank),
      handle: String(t.handle ?? t.userId),
      userId: String(t.userId),
      pnlUsd: Number(t.pnlUsd ?? 0),
      trades: Number(t.trades ?? 0),
    }));
}

export type Price = { priceUsd: number; liquidityUsd: number };

/** Prices for up to 30 tokens on one DexScreener chain, keyed by lower-case address. Unknown tokens are absent. */
export async function fetchPrices(dexChainId: string, addresses: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, Price>> {
  const out = new Map<string, Price>();
  if (!addresses.length) return out;
  const res = await fetchImpl(`https://api.dexscreener.com/tokens/v1/${dexChainId}/${addresses.slice(0, 30).join(",")}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Prijzen ophalen bij DexScreener mislukt (HTTP ${res.status}).`);
  const pairs = (await res.json().catch(() => [])) as { baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }[];
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const addr = p.baseToken?.address?.toLowerCase();
    const price = Number(p.priceUsd);
    const liq = Number(p.liquidity?.usd ?? 0);
    if (!addr || !(price > 0)) continue;
    const seen = out.get(addr);
    if (!seen || liq > seen.liquidityUsd) out.set(addr, { priceUsd: price, liquidityUsd: liq });
  }
  return out;
}

export interface FeedTrade {
  eventId: string;
  userId: string;
  handle: string;
  side: "buy" | "sell";
  token: string;
  tokenAddress: string;
  chain: string;
  ts: Date;
}

/** A buy or sell from the app feed, or null for anything else (theses, pushes, welcome messages). */
export function parseAlert(m: Record<string, unknown>): FeedTrade | null {
  if (m.type !== "alert" || (m.alertType !== "buy" && m.alertType !== "sell")) return null;
  const s = (k: string) => (typeof m[k] === "string" && m[k] ? (m[k] as string) : null);
  const [eventId, userId, tokenAddress, chain] = [s("eventId"), s("userId"), s("tokenAddress"), s("chain")];
  if (!eventId || !userId || !tokenAddress || !chain) return null;
  return {
    eventId,
    userId,
    handle: s("trader") ?? userId,
    side: m.alertType,
    token: s("token") ?? tokenAddress.slice(0, 6),
    tokenAddress,
    chain,
    ts: new Date(typeof m.ts === "number" ? m.ts : Date.now()),
  };
}

export const streamState = { connectedAt: null as Date | null, lastMessageAt: null as Date | null, reconnects: 0, lastError: null as string | null };

/**
 * Keep the app-feed WebSocket open: reconnect with backoff, and restart it after 15 minutes of silence.
 * Connecting and messages cost no credits. Returns a stop function.
 */
export function startFeed(key: string, onTrade: (t: FeedTrade) => Promise<void>, log: (msg: string) => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let delay = 5_000;
  let timer: NodeJS.Timeout | null = null;

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(`wss://api.fomoapi.io/ws/alerts?key=${encodeURIComponent(key)}`);
    ws.onopen = () => {
      streamState.connectedAt = new Date();
      streamState.lastMessageAt = new Date();
      delay = 5_000;
    };
    ws.onmessage = (e) => {
      streamState.lastMessageAt = new Date();
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const t = parseAlert(m);
      if (t) onTrade(t).catch((err) => log(`Copy-trade: verwerken van ${t.side} ${t.token} mislukt: ${(err as Error).message}`));
    };
    ws.onerror = () => {
      streamState.lastError = "verbindingsfout";
    };
    ws.onclose = (e) => {
      streamState.connectedAt = null;
      if (stopped) return;
      streamState.reconnects++;
      if (e.reason) streamState.lastError = e.reason;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 5 * 60_000);
    };
  };

  connect();
  const watchdog = setInterval(() => {
    const silentMin = streamState.lastMessageAt ? (Date.now() - streamState.lastMessageAt.getTime()) / 60_000 : 0;
    if (ws && silentMin > 15) {
      log(`Copy-trade: ${Math.round(silentMin)} min niets van FOMO, ik herstart de verbinding.`);
      streamState.lastMessageAt = new Date();
      ws.close();
    }
  }, 60_000);

  return () => {
    stopped = true;
    clearInterval(watchdog);
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
