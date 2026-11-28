import { describe, expect, it } from "vitest";
import {
  COST,
  STRATEGIES,
  buyPrice,
  dexChain,
  followedBy,
  pnlEur,
  sellPrice,
  summarize,
  timeExit,
  type BoardRow,
  type PaperPosition,
} from "../src/lib/copytrade.js";

const row = (window: "30d" | "7d", rank: number, userId: string, pnlUsd: number): BoardRow => ({ window, rank, userId, handle: userId, pnlUsd, trades: 20 });

describe("copy-trade paper strategies", () => {
  const board: BoardRow[] = [
    ...Array.from({ length: 30 }, (_, i) => row("30d", i + 1, `u${i + 1}`, 100_000 - i * 1000)),
    row("7d", 1, "u5", 20_000),
    row("7d", 2, "u1", 10_000),
    row("7d", 3, "u40", 50_000), // not on the 30-day board
    row("7d", 4, "u2", -3_000), // lost money this week
  ];

  it("top10 follows the ten best of the 30-day board", () => {
    const f = followedBy(board);
    expect([...f.top10].sort()).toEqual(["u1", "u10", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"]);
  });

  it("steady follows only traders with profit on both boards, best 30-day first", () => {
    const f = followedBy(board);
    expect([...f.steady]).toEqual(["u1", "u5"]);
    expect(f.steady_safe).toEqual(f.steady);
  });

  it("charges 3 % on the way in and on the way out", () => {
    expect(COST).toBe(0.03);
    expect(buyPrice(1)).toBeCloseTo(1.03);
    expect(sellPrice(2)).toBeCloseTo(1.94);
    // €10 in at 1.03, out at 1.94: 10 * (1.94/1.03 - 1)
    expect(pnlEur({ stakeEur: 10, entryPrice: buyPrice(1) }, sellPrice(2))).toBeCloseTo(8.835, 2);
  });

  it("steady_safe needs liquidity and closes after 4 hours; every strategy closes after 7 days", () => {
    const safe = STRATEGIES.find((s) => s.id === "steady_safe")!;
    expect(safe.minLiquidityUsd).toBe(250_000);
    const opened = new Date("2026-11-28T10:00:00Z");
    expect(timeExit("steady_safe", opened, new Date("2026-11-28T13:59:00Z"))).toBeNull();
    expect(timeExit("steady_safe", opened, new Date("2026-11-28T14:00:00Z"))).toBe("na 4 uur");
    expect(timeExit("top10", opened, new Date("2026-12-04T10:00:00Z"))).toBeNull();
    expect(timeExit("top10", opened, new Date("2026-12-05T10:00:00Z"))).toBe("max 7 dagen");
  });

  it("maps FOMO chains to DexScreener and skips the ones it cannot price", () => {
    expect(dexChain("solana")).toBe("solana");
    expect(dexChain("eth")).toBe("ethereum");
    expect(dexChain("bsc")).toBe("bsc");
    expect(dexChain("base")).toBe("base");
    expect(dexChain("hyperliquid")).toBeNull();
  });

  it("summarizes a strategy: today, total, open, win rate, best and worst", () => {
    const now = new Date("2026-11-29T19:00:00Z");
    const p = (o: Partial<PaperPosition>): PaperPosition => ({
      strategy: "top10", handle: "u1", token: "AAA", stakeEur: 10, entryPrice: 1, openedAt: new Date("2026-11-29T08:00:00Z"),
      lastPrice: null, exitPrice: null, closedAt: null, exitReason: null, ...o,
    });
    const s = summarize(
      [
        p({ token: "WIN", exitPrice: 1.5, closedAt: new Date("2026-11-29T12:00:00Z") }), // +5
        p({ token: "LOSS", exitPrice: 0.8, closedAt: new Date("2026-11-28T12:00:00Z"), openedAt: new Date("2026-11-28T08:00:00Z") }), // -2
        p({ token: "OPEN", lastPrice: 1.1 }), // +1 unrealized
        p({ strategy: "steady", token: "X", exitPrice: 2, closedAt: now }),
      ],
      "top10",
      now,
    );
    expect(s.openedToday).toBe(2);
    expect(s.closedToday).toBe(1);
    expect(s.open).toBe(1);
    expect(s.realizedEur).toBeCloseTo(3);
    expect(s.unrealizedEur).toBeCloseTo(0.67); // valued at what selling now would bring: 10 * (1.1 * 0.97 - 1)
    expect(s.todayEur).toBeCloseTo(5);
    expect(s.winRate).toBeCloseTo(0.5);
    expect(s.best?.token).toBe("WIN");
    expect(s.worst?.token).toBe("LOSS");
  });
});
