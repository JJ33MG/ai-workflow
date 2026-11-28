// Copy-trade paper test against a real PostgreSQL (skipped without TEST_DATABASE_URL).
import { beforeEach, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("copy-trade paper test", async () => {
  const { db } = await import("../src/db.js");
  const { onTrade, refreshBoard, markOpen, buildReport } = await import("../src/agents/copytrade.js");
  type Price = { priceUsd: number; liquidityUsd: number };

  const trade = (o: Record<string, unknown> = {}) => ({
    eventId: `e${Math.random()}`, userId: "u1", handle: "heat", side: "buy" as const, token: "PONS", tokenAddress: "Pons1", chain: "solana",
    ts: new Date("2026-11-29T10:00:00Z"), ...o,
  });
  const priced = (price: number, liq = 1_000_000) => async (_c: string, addrs: string[]) =>
    new Map<string, Price>(addrs.map((a) => [a.toLowerCase(), { priceUsd: price, liquidityUsd: liq }]));
  const now = new Date("2026-11-29T10:00:05Z");

  beforeEach(async () => {
    await db.copyPosition.deleteMany();
    await db.copyAlert.deleteMany();
    await db.copyTrader.deleteMany();
    await db.setting.deleteMany({ where: { key: "copytrade.start" } });
    // u1 is in the top 10 and steady; u2 only in the top 10.
    await refreshBoard({
      board: async (w) =>
        w === "30d"
          ? [{ window: "30d", rank: 1, userId: "u1", handle: "heat", pnlUsd: 300_000, trades: 50 }, { window: "30d", rank: 2, userId: "u2", handle: "end", pnlUsd: 200_000, trades: 40 }]
          : [{ window: "7d", rank: 1, userId: "u1", handle: "heat", pnlUsd: 40_000, trades: 9 }],
      solPrice: async () => 200,
      now,
    });
  });

  it("copies a buy into every strategy that follows the trader, at the price plus costs", async () => {
    await onTrade(trade(), { prices: priced(1), now });
    const open = await db.copyPosition.findMany({ orderBy: { strategy: "asc" } });
    expect(open.map((p) => p.strategy)).toEqual(["steady", "steady_safe", "top10"]);
    expect(open[0].entryPrice).toBeCloseTo(1.03);
    const alert = await db.copyAlert.findFirst();
    expect(alert?.note).toContain("3 strategie");
  });

  it("skips small coins for the safe strategy, a trader nobody follows, and a second buy of the same coin", async () => {
    await onTrade(trade(), { prices: priced(1, 20_000), now });
    expect((await db.copyPosition.findMany()).map((p) => p.strategy).sort()).toEqual(["steady", "top10"]);
    await onTrade(trade(), { prices: priced(1.2, 20_000), now });
    expect(await db.copyPosition.count()).toBe(2);
    await onTrade(trade({ userId: "nobody" }), { prices: priced(1), now });
    expect(await db.copyPosition.count()).toBe(2);
  });

  it("handles each feed event once", async () => {
    const t = trade({ eventId: "same" });
    await onTrade(t, { prices: priced(1), now });
    await onTrade(t, { prices: priced(1), now });
    expect(await db.copyAlert.count()).toBe(1);
    expect(await db.copyPosition.count()).toBe(3);
  });

  it("notes a chain it cannot price instead of guessing", async () => {
    await onTrade(trade({ chain: "hyperliquid" }), { prices: priced(1), now });
    expect(await db.copyPosition.count()).toBe(0);
    expect((await db.copyAlert.findFirst())?.note).toMatch(/hyperliquid/);
  });

  it("sells when the trader sells, after costs", async () => {
    await onTrade(trade(), { prices: priced(1), now });
    await onTrade(trade({ side: "sell" }), { prices: priced(2), now: new Date("2026-11-29T12:00:00Z") });
    const closed = await db.copyPosition.findMany({ where: { closedAt: { not: null } } });
    expect(closed).toHaveLength(3);
    expect(closed[0].exitPrice).toBeCloseTo(1.94);
    expect(closed[0].exitReason).toBe("trader verkocht");
  });

  it("marks open positions every half hour and closes the safe one after 4 hours", async () => {
    await onTrade(trade(), { prices: priced(1), now });
    const r = await markOpen({ prices: priced(1.5), now: new Date("2026-11-29T14:30:00Z") });
    expect(r).toEqual({ marked: 3, closed: 1, unpriced: 0 });
    const safe = await db.copyPosition.findFirst({ where: { strategy: "steady_safe" } });
    expect(safe?.exitReason).toBe("na 4 uur");
    expect(safe?.exitPrice).toBeCloseTo(1.455);
    expect((await db.copyPosition.findFirst({ where: { strategy: "top10" } }))?.lastPrice).toBe(1.5);
  });

  it("reports the day: trades, results per strategy, SOL, health and the assessment", async () => {
    await onTrade(trade(), { prices: priced(1), now });
    await onTrade(trade({ side: "sell" }), { prices: priced(2), now: new Date("2026-11-29T12:00:00Z") });
    await onTrade(trade({ chain: "hyperliquid", eventId: "hl" }), { prices: priced(1), now });
    const text = await buildReport({ now: new Date("2026-11-29T19:00:00Z"), solPrice: async () => 210, assess: async () => "Goed begin, nog te weinig trades." });
    expect(text).toContain("dag 1 van 21");
    expect(text).toContain("Top 10 van de maand");
    expect(text).toContain("heat kocht PONS");
    expect(text).toContain("+€8,83");
    expect(text).toContain("SOL vasthouden: +5,0%");
    expect(text).toContain("niet te prijzen: 1");
    expect(text).toContain("Goed begin, nog te weinig trades.");
  });

  it("asks Jarne to decide on day 21", async () => {
    const text = await buildReport({ now: new Date("2026-12-19T19:00:00Z"), solPrice: async () => 200, assess: async () => "" });
    expect(text).toContain("dag 21 van 21");
    expect(text).toContain("De 3 weken zijn om");
  });
});
