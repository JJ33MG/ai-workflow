// Copy-trade paper test (approved by Jarne, 28 Nov 2026): follow FOMO's best traders for 21 days on paper,
// compare strategies with holding SOL, and report every evening on Telegram. No money moves.
// Design: docs/superpowers/2026-11-28-copytrade-design.md
import { config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import { fetchBoard, fetchPrices, startFeed, streamState, type FeedTrade, type Price } from "../integrations/fomo.js";
import { askText } from "../lib/claude.js";
import {
  STAKE_EUR,
  STRATEGIES,
  TEST_DAYS,
  buyPrice,
  dexChain,
  followedBy,
  sellPrice,
  summarize,
  timeExit,
  type BoardRow,
  type StrategyId,
} from "../lib/copytrade.js";
import { agentLogger } from "../lib/logger.js";
import { notify } from "../lib/telegram.js";
import type { AgentDefinition } from "./types.js";

const ID = "copytrade";
const START_KEY = "copytrade.start";
const WSOL = "So11111111111111111111111111111111111111112";

type PriceFn = (dexChainId: string, addresses: string[]) => Promise<Map<string, Price>>;
type Start = { day: string; solPrice: number | null };

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const eur = (n: number) => `${n >= 0 ? "+" : "-"}€${Math.abs(n).toFixed(2).replace(".", ",")}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1).replace(".", ",")}%`;

async function solPriceNow(): Promise<number | null> {
  return (await fetchPrices("solana", [WSOL])).get(WSOL.toLowerCase())?.priceUsd ?? null;
}

/** Who each strategy follows, from the newest leaderboard snapshot. */
async function followed(): Promise<Record<StrategyId, string[]>> {
  const latest = await db.copyTrader.findFirst({ orderBy: { day: "desc" }, select: { day: true } });
  if (!latest) return { top10: [], steady: [], steady_safe: [] };
  const rows = await db.copyTrader.findMany({ where: { day: latest.day } });
  return followedBy(rows.map((r) => ({ ...r, window: r.window as BoardRow["window"] })));
}

/** Daily: store today's 30-day and 7-day boards; the first run also starts the 21-day clock. */
export async function refreshBoard(deps: {
  board?: (w: "30d" | "7d") => Promise<BoardRow[]>;
  solPrice?: () => Promise<number | null>;
  now?: Date;
} = {}) {
  const board = deps.board ?? ((w) => fetchBoard(w, config.fomo.apiKey));
  const now = deps.now ?? new Date();
  const day = dayOf(now);
  let stored = 0;
  for (const w of ["30d", "7d"] as const) {
    for (const r of await board(w)) {
      await db.copyTrader.upsert({
        where: { day_window_userId: { day, window: w, userId: r.userId } },
        create: { day, window: w, rank: r.rank, userId: r.userId, handle: r.handle, pnlUsd: r.pnlUsd, trades: r.trades },
        update: { rank: r.rank, handle: r.handle, pnlUsd: r.pnlUsd, trades: r.trades },
      });
      stored++;
    }
  }
  if (!(await getSetting<Start>(START_KEY))) {
    const solPrice = await (deps.solPrice ?? solPriceNow)().catch(() => null);
    await setSetting(START_KEY, { day, solPrice } satisfies Start);
  }
  const f = await followed();
  return { stored, top10: f.top10.length, steady: f.steady.length };
}

async function priceOf(prices: PriceFn, chain: string, address: string): Promise<Price | null> {
  const c = dexChain(chain);
  if (!c) return null;
  return (await prices(c, [address])).get(address.toLowerCase()) ?? null;
}

/** One buy or sell from the feed: copy it into every strategy that follows the trader. */
export async function onTrade(t: FeedTrade, deps: { prices?: PriceFn; now?: Date } = {}): Promise<string> {
  const prices = deps.prices ?? fetchPrices;
  const now = deps.now ?? new Date();
  const exists = await db.copyAlert.findUnique({ where: { eventId: t.eventId } });
  if (exists) return "al verwerkt";
  const alert = await db.copyAlert.create({
    data: { eventId: t.eventId, userId: t.userId, handle: t.handle, side: t.side, token: t.token, tokenAddress: t.tokenAddress, chain: t.chain, ts: t.ts, receivedAt: now },
  });
  const note = async (text: string, price?: Price | null) => {
    await db.copyAlert.update({ where: { id: alert.id }, data: { note: text, priceUsd: price?.priceUsd, liquidityUsd: price?.liquidityUsd } });
    return text;
  };

  if (t.side === "buy") {
    const f = await followed();
    const strategies = STRATEGIES.filter((s) => f[s.id].includes(t.userId));
    if (!strategies.length) return note("niet gevolgd");
    if (!dexChain(t.chain)) return note(`overgeslagen: ${t.chain} niet te prijzen`);
    const price = await priceOf(prices, t.chain, t.tokenAddress);
    if (!price) return note("overgeslagen: geen prijs gevonden");
    let opened = 0;
    const skipped: string[] = [];
    for (const s of strategies) {
      if (price.liquidityUsd < s.minLiquidityUsd) {
        skipped.push(`${s.id}: te weinig liquiditeit`);
        continue;
      }
      const open = await db.copyPosition.findFirst({ where: { strategy: s.id, userId: t.userId, tokenAddress: t.tokenAddress, closedAt: null } });
      if (open) {
        skipped.push(`${s.id}: zit er al in`);
        continue;
      }
      await db.copyPosition.create({
        data: {
          strategy: s.id, userId: t.userId, handle: t.handle, token: t.token, tokenAddress: t.tokenAddress, chain: t.chain,
          stakeEur: STAKE_EUR, entryPrice: buyPrice(price.priceUsd), openedAt: now, lastPrice: price.priceUsd, lastPriceAt: now,
        },
      });
      opened++;
    }
    return note(`gekocht in ${opened} strategie(ën)${skipped.length ? `; ${skipped.join(", ")}` : ""}`, price);
  }

  const open = await db.copyPosition.findMany({ where: { userId: t.userId, tokenAddress: t.tokenAddress, closedAt: null } });
  if (!open.length) return note("geen open positie");
  const price = await priceOf(prices, t.chain, t.tokenAddress).catch(() => null);
  const exit = price?.priceUsd ?? open[0].lastPrice;
  if (exit == null) return note("verkoop gezien, maar geen prijs: blijft open tot de volgende prijsronde");
  for (const p of open) {
    await db.copyPosition.update({
      where: { id: p.id },
      data: { exitPrice: sellPrice(exit), closedAt: now, exitReason: price ? "trader verkocht" : "trader verkocht (laatste prijs)", lastPrice: exit, lastPriceAt: now },
    });
  }
  return note(`verkocht in ${open.length} strategie(ën)`, price);
}

/** Every 30 minutes: price the open positions and close the ones whose time is up. */
export async function markOpen(deps: { prices?: PriceFn; now?: Date } = {}) {
  const prices = deps.prices ?? fetchPrices;
  const now = deps.now ?? new Date();
  const open = await db.copyPosition.findMany({ where: { closedAt: null } });
  const byChain = new Map<string, Set<string>>();
  for (const p of open) {
    const c = dexChain(p.chain);
    if (c) byChain.set(c, (byChain.get(c) ?? new Set()).add(p.tokenAddress));
  }
  const known = new Map<string, Price>();
  for (const [c, addrs] of byChain) {
    const list = [...addrs];
    for (let i = 0; i < list.length; i += 30) for (const [k, v] of await prices(c, list.slice(i, i + 30))) known.set(k, v);
  }
  let marked = 0;
  let closed = 0;
  let unpriced = 0;
  for (const p of open) {
    const price = known.get(p.tokenAddress.toLowerCase())?.priceUsd;
    if (price == null) unpriced++;
    else marked++;
    const last = price ?? p.lastPrice;
    const why = timeExit(p.strategy as StrategyId, p.openedAt, now);
    await db.copyPosition.update({
      where: { id: p.id },
      data: {
        ...(price != null ? { lastPrice: price, lastPriceAt: now } : {}),
        ...(why && last != null ? { exitPrice: sellPrice(last), closedAt: now, exitReason: why } : {}),
      },
    });
    if (why && last != null) closed++;
  }
  return { marked, closed, unpriced };
}

/** The evening report: today's trades, each strategy, SOL, health, and an honest assessment. */
export async function buildReport(deps: { now?: Date; solPrice?: () => Promise<number | null>; assess?: (facts: string) => Promise<string> } = {}) {
  const now = deps.now ?? new Date();
  const start = (await getSetting<Start>(START_KEY)) ?? { day: dayOf(now), solPrice: null };
  const dayNr = Math.floor((Date.parse(dayOf(now)) - Date.parse(start.day)) / 86_400_000) + 1;
  const since = new Date(now.getTime() - 24 * 3600_000);
  const positions = await db.copyPosition.findMany();
  const lines: string[] = [`📈 Copy-trade op papier: dag ${dayNr} van ${TEST_DAYS}`, ""];

  for (const s of STRATEGIES) {
    const r = summarize(positions, s.id, now);
    const n = positions.filter((p) => p.strategy === s.id).length;
    const total = r.realizedEur + r.unrealizedEur;
    lines.push(`• ${s.label}: vandaag ${r.openedToday} gekocht, ${r.closedToday} verkocht (${eur(r.todayEur)})`);
    lines.push(
      `  totaal ${eur(total)} op ${n} trades van €${STAKE_EUR}${n ? ` (${pct(total / (n * STAKE_EUR))})` : ""}, ${r.open} open` +
        `${r.winRate != null ? `, ${Math.round(r.winRate * 100)}% winnend` : ""}`,
    );
    if (r.best) lines.push(`  beste: ${r.best.token} van ${r.best.handle} ${eur(r.best.eur)}${r.worst ? ` · slechtste: ${r.worst.token} ${eur(r.worst.eur)}` : ""}`);
  }

  const sol = start.solPrice ? await (deps.solPrice ?? solPriceNow)().catch(() => null) : null;
  lines.push("", sol && start.solPrice ? `SOL vasthouden: ${pct(sol / start.solPrice - 1)} sinds de start` : "SOL vasthouden: nog geen vergelijking");

  const today = await db.copyAlert.findMany({ where: { receivedAt: { gte: since }, note: { startsWith: "gekocht" } }, orderBy: { receivedAt: "asc" }, take: 8 });
  const sold = await db.copyPosition.findMany({ where: { closedAt: { gte: since } }, orderBy: { closedAt: "asc" } });
  if (today.length || sold.length) {
    lines.push("", "Trades van vandaag:");
    for (const a of today) lines.push(`🟢 ${a.handle} kocht ${a.token} (${a.chain}) → ${a.note}`);
    const seen = new Set<string>();
    for (const p of sold) {
      const key = `${p.handle}:${p.tokenAddress}:${p.exitReason}`;
      if (seen.has(key) || seen.size >= 8) continue;
      seen.add(key);
      lines.push(`🔴 ${p.token} van ${p.handle} verkocht (${p.exitReason}): ${eur((p.stakeEur * (p.exitPrice ?? 0)) / p.entryPrice - p.stakeEur)}`);
    }
  }

  const alerts24 = await db.copyAlert.count({ where: { receivedAt: { gte: since } } });
  const last = await db.copyAlert.findFirst({ orderBy: { receivedAt: "desc" } });
  const unpriceable = await db.copyAlert.count({ where: { receivedAt: { gte: since }, note: { contains: "niet te prijzen" } } });
  const noPrice = await db.copyAlert.count({ where: { receivedAt: { gte: since }, note: { contains: "geen prijs" } } });
  const failed = await db.task.findMany({ where: { agentId: ID, status: { in: ["failed", "escalated"] }, updatedAt: { gte: since } }, select: { type: true, error: true } });
  const problems: string[] = [];
  if (!config.fomo.apiKey) problems.push("FOMO_API_KEY ontbreekt in Railway: zonder sleutel geen ranglijst en geen feed.");
  if (alerts24 === 0) problems.push("Geen enkele trade ontvangen in 24 uur. De verbinding wordt automatisch herstart; blijft dit zo, dan zoek ik het uit.");
  if (streamState.reconnects > 5) problems.push(`De verbinding met FOMO viel ${streamState.reconnects} keer weg (${streamState.lastError ?? "onbekend"}); ze werd telkens hersteld.`);
  for (const f of failed) problems.push(`Taak ${f.type} mislukt: ${(f.error ?? "").slice(0, 120)}. De Debug-agent probeert ze opnieuw.`);

  lines.push(
    "",
    `Gezondheid: ${alerts24} trades ontvangen in 24 uur${last ? `, laatste om ${last.receivedAt.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit", timeZone: config.timezone })}` : ""}; ` +
      `niet te prijzen: ${unpriceable}; zonder prijs: ${noPrice}.`,
  );
  lines.push(problems.length ? `⚠️ Problemen:\n${problems.map((p) => `- ${p}`).join("\n")}` : "Geen problemen.");

  const assess = deps.assess ?? defaultAssess;
  const view = await assess(lines.join("\n")).catch(() => "");
  if (view) lines.push("", `Mijn inschatting: ${view}`);
  if (dayNr >= TEST_DAYS) {
    lines.push(
      "",
      "De 3 weken zijn om. Zeg of we stoppen, langer testen, of live gaan met het minimumbedrag en een harde limiet. Live gaan vraag ik je apart, met goedkeuring.",
    );
  }
  return lines.join("\n");
}

const defaultAssess = (facts: string) =>
  askText({
    agentId: ID,
    purpose: "copy-trade dagrapport",
    model: config.models.cheap,
    effort: "low",
    maxTokens: 400,
    system:
      "Je beoordeelt een papieren copy-trade-test voor Jarne. Schrijf in het Nederlands, 2 à 3 nuchtere zinnen: gaat het goed of slecht, " +
      "is het al betekenisvol (te weinig trades = nog niets te zeggen), en wat valt op. Geen hype, geen beleggingsadvies.",
    prompt: facts,
  });

export async function sendReport() {
  const text = await buildReport();
  await notify(text);
  return { sent: true };
}

/** Started by the server: the live feed (only with a key). */
export function startCopyFeed(): () => void {
  if (!config.fomo.apiKey) return () => {};
  const log = agentLogger(ID);
  return startFeed(config.fomo.apiKey, async (t) => void (await onTrade(t)), (m) => void log.warn(m));
}

export const copyTradeAgent: AgentDefinition = {
  id: ID,
  name: "Copy-trader (papier)",
  phase: 1,
  businessId: "copy-trade",
  description:
    "Volgt de beste traders van FOMO 21 dagen op papier, vergelijkt 3 strategieën met gewoon SOL vasthouden en stuurt elke avond een rapport. Er gaat geen geld in.",
  dependsOn: ["database", "telegram"],
  handlers: {
    board: async (_p, ctx) => {
      const r = await refreshBoard();
      await ctx.log.info(`Copy-trade: ranglijsten bewaard (${r.stored} rijen), top 10 ${r.top10}, stabiel ${r.steady}`, undefined, ctx.taskId);
      return r;
    },
    mark: async () => markOpen(),
    report: async () => sendReport(),
  },
  taskInfo: {
    board: "Elke ochtend de FOMO-ranglijsten (30 en 7 dagen) ophalen en kiezen wie we volgen",
    mark: "Elk half uur de open papieren trades prijzen en sluiten wanneer hun tijd om is",
    report: "Elke avond het rapport op Telegram: trades, resultaat per strategie, SOL, problemen en een inschatting",
  },
  chatTasks: ["board", "report"],
  maxAttempts: { board: 3, mark: 2, report: 2 },
};
