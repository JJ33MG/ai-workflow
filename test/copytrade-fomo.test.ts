import { describe, expect, it, vi } from "vitest";
import { fetchBoard, fetchPrices, parseAlert } from "../src/integrations/fomo.js";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("FOMO and DexScreener", () => {
  it("reads a leaderboard with the key", async () => {
    const f = reply(200, { window: "30d", traders: [{ rank: 1, handle: "heat", userId: "id1", pnlUsd: 449000, trades: 70 }] });
    expect(await fetchBoard("30d", "KEY", f)).toEqual([{ window: "30d", rank: 1, handle: "heat", userId: "id1", pnlUsd: 449000, trades: 70 }]);
    expect(f).toHaveBeenCalledWith("https://api.fomoapi.io/v2/leaderboard/30d", expect.objectContaining({ headers: { authorization: "Bearer KEY" } }));
  });

  it("says plainly what is wrong with the key or the credits", async () => {
    await expect(fetchBoard("30d", "", reply(200, {}))).rejects.toThrow(/FOMO_API_KEY/);
    await expect(fetchBoard("30d", "KEY", reply(401, {}))).rejects.toThrow(/sleutel/);
    await expect(fetchBoard("30d", "KEY", reply(402, {}))).rejects.toThrow(/credits/);
  });

  it("prices each token from its most liquid pair, per chain", async () => {
    const f = reply(200, [
      { baseToken: { address: "AAA" }, priceUsd: "0.10", liquidity: { usd: 5_000 } },
      { baseToken: { address: "AAA" }, priceUsd: "0.12", liquidity: { usd: 90_000 } },
      { baseToken: { address: "bbb" }, priceUsd: "2", liquidity: { usd: 300_000 } },
      { baseToken: { address: "QUOTE" }, quoteToken: { address: "AAA" }, priceUsd: "9", liquidity: { usd: 1e9 } },
    ]);
    const prices = await fetchPrices("solana", ["AAA", "BBB", "CCC"], f);
    expect(prices.get("aaa")).toEqual({ priceUsd: 0.12, liquidityUsd: 90_000 });
    expect(prices.get("bbb")).toEqual({ priceUsd: 2, liquidityUsd: 300_000 });
    expect(prices.has("ccc")).toBe(false);
    expect(f).toHaveBeenCalledWith("https://api.dexscreener.com/tokens/v1/solana/AAA,BBB,CCC", expect.anything());
  });

  it("keeps only buys and sells with the ids it needs", () => {
    const base = { type: "alert", eventId: "e1", userId: "u1", trader: "heat", token: "PONS", tokenAddress: "Abc", chain: "solana", ts: 1788378000000 };
    expect(parseAlert({ ...base, alertType: "buy" })).toEqual({
      eventId: "e1", userId: "u1", handle: "heat", side: "buy", token: "PONS", tokenAddress: "Abc", chain: "solana", ts: new Date(1788378000000),
    });
    expect(parseAlert({ ...base, alertType: "thesis" })).toBeNull();
    expect(parseAlert({ ...base, alertType: "sell", userId: undefined })).toBeNull();
    expect(parseAlert({ type: "welcome" })).toBeNull();
  });
});
