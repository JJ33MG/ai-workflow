// Copy-trade paper test: pure rules (who to follow, costs, when to close, results). No money moves.
// Design: docs/superpowers/2026-11-28-copytrade-design.md

/** Slippage plus fees, charged on the way in and on the way out. */
export const COST = 0.03;
export const STAKE_EUR = 10;
export const TEST_DAYS = 21;

export type StrategyId = "top10" | "steady" | "steady_safe";

export interface Strategy {
  id: StrategyId;
  label: string;
  minLiquidityUsd: number;
  /** Close after this many minutes even when the trader has not sold. */
  maxHoldMin: number | null;
}

export const STRATEGIES: Strategy[] = [
  { id: "top10", label: "Top 10 van de maand", minLiquidityUsd: 0, maxHoldMin: null },
  { id: "steady", label: "Stabiele winnaars", minLiquidityUsd: 0, maxHoldMin: null },
  { id: "steady_safe", label: "Stabiel + grote coins, max 4 uur", minLiquidityUsd: 250_000, maxHoldMin: 4 * 60 },
];

const MAX_DAYS = 7;

export interface BoardRow {
  window: "30d" | "7d";
  rank: number;
  userId: string;
  handle: string;
  pnlUsd: number;
  trades: number;
}

/** Which traders each strategy follows, from one day's leaderboards. */
export function followedBy(board: BoardRow[]): Record<StrategyId, string[]> {
  const month = board.filter((r) => r.window === "30d").sort((a, b) => a.rank - b.rank);
  const weekWinners = new Set(board.filter((r) => r.window === "7d" && r.pnlUsd > 0).map((r) => r.userId));
  const steady = month
    .filter((r) => r.pnlUsd > 0 && weekWinners.has(r.userId))
    .sort((a, b) => b.pnlUsd - a.pnlUsd)
    .slice(0, 15)
    .map((r) => r.userId);
  return { top10: month.slice(0, 10).map((r) => r.userId), steady, steady_safe: steady };
}

export const buyPrice = (price: number) => price * (1 + COST);
export const sellPrice = (price: number) => price * (1 - COST);

/** Profit in EUR of a position closed (or marked) at `exit` (already after costs). */
export const pnlEur = (p: { stakeEur: number; entryPrice: number }, exit: number) => p.stakeEur * (exit / p.entryPrice - 1);

/** Why a position must close now even though the trader has not sold, or null. */
export function timeExit(strategy: StrategyId, openedAt: Date, now: Date): string | null {
  const ageMin = (now.getTime() - openedAt.getTime()) / 60_000;
  const max = STRATEGIES.find((s) => s.id === strategy)?.maxHoldMin;
  if (max && ageMin >= max) return `na ${max / 60} uur`;
  if (ageMin >= MAX_DAYS * 24 * 60) return `max ${MAX_DAYS} dagen`;
  return null;
}

const DEX: Record<string, string> = { solana: "solana", eth: "ethereum", ethereum: "ethereum", base: "base", bsc: "bsc", monad: "monad" };
/** DexScreener's chain id for a FOMO chain name, or null when it cannot be priced. */
export const dexChain = (chain: string) => DEX[chain.toLowerCase()] ?? null;

export interface PaperPosition {
  strategy: string;
  handle: string;
  token: string;
  stakeEur: number;
  entryPrice: number;
  openedAt: Date;
  lastPrice: number | null;
  exitPrice: number | null;
  closedAt: Date | null;
  exitReason: string | null;
}

export interface StrategySummary {
  openedToday: number;
  closedToday: number;
  open: number;
  todayEur: number;
  realizedEur: number;
  unrealizedEur: number;
  winRate: number | null;
  best: (PaperPosition & { eur: number }) | null;
  worst: (PaperPosition & { eur: number }) | null;
}

const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

export function summarize(all: PaperPosition[], strategy: string, now: Date): StrategySummary {
  const mine = all.filter((p) => p.strategy === strategy);
  const closed = mine.filter((p) => p.closedAt && p.exitPrice != null).map((p) => ({ ...p, eur: pnlEur(p, p.exitPrice!) }));
  const open = mine.filter((p) => !p.closedAt);
  const sorted = [...closed].sort((a, b) => b.eur - a.eur);
  return {
    openedToday: mine.filter((p) => sameDay(p.openedAt, now)).length,
    closedToday: closed.filter((p) => sameDay(p.closedAt!, now)).length,
    open: open.length,
    todayEur: closed.filter((p) => sameDay(p.closedAt!, now)).reduce((s, p) => s + p.eur, 0),
    realizedEur: closed.reduce((s, p) => s + p.eur, 0),
    unrealizedEur: open.reduce((s, p) => s + (p.lastPrice != null ? pnlEur(p, sellPrice(p.lastPrice)) : 0), 0),
    winRate: closed.length ? closed.filter((p) => p.eur > 0).length / closed.length : null,
    best: sorted[0] ?? null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
  };
}
