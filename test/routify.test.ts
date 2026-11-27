import { describe, expect, it } from "vitest";
import { syncRoutifyStats } from "../src/agents/routify.js";
import { fetchRoutifyStats, routifyLine, type RoutifyStats } from "../src/integrations/routify.js";

const STATS: RoutifyStats = {
  generatedAt: "2026-11-19T08:10:00.000Z",
  users: { total: 120, last7d: 12 },
  trips: { total: 300, last7d: 30 },
  plus: 2,
  affiliateClicks: { last7d: 41, byPartner: { booking: 30, rentalcars: 11 } },
  community: { pending: 1, approved: 4 },
};

const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("Routify stats", () => {
  it("asks the Routify stats endpoint with the token header", async () => {
    let seen: { url: string; token: string | null } | null = null;
    const spy = (async (url: string, init?: RequestInit) => {
      seen = { url, token: new Headers(init?.headers).get("x-stats-token") };
      return new Response(JSON.stringify(STATS), { status: 200 });
    }) as typeof fetch;
    const stats = await fetchRoutifyStats({ url: "https://routify.test/", statsToken: "tok" }, spy);
    expect(seen).toEqual({ url: "https://routify.test/api/stats", token: "tok" });
    expect(stats.trips.last7d).toBe(30);
  });

  it("names ROUTIFY_STATS_TOKEN when Routify refuses the token", async () => {
    await expect(fetchRoutifyStats({ url: "https://routify.test", statsToken: "bad" }, reply(401, { error: "Unauthorized" }))).rejects.toThrow(
      /ROUTIFY_STATS_TOKEN/,
    );
  });

  it("refuses to run without a URL and token", async () => {
    await expect(fetchRoutifyStats({ url: "", statsToken: "" }, reply(200, STATS))).rejects.toThrow(/ROUTIFY_URL/);
  });

  it("sums the week up in one Dutch line", () => {
    expect(routifyLine(STATS)).toBe("RoamGem: 12 nieuwe gebruikers, 30 trips, 2 Plus, 41 affiliate-kliks deze week");
  });

  it("skips quietly while Routify is not set up", async () => {
    const log = { info: async () => {}, warn: async () => {}, error: async () => {} };
    await expect(syncRoutifyStats({ log }, { url: "", statsToken: "" })).resolves.toEqual({ skipped: "RoamGem is niet ingesteld" });
  });

  it("refuses a reply that is not Routify's stats", async () => {
    await expect(fetchRoutifyStats({ url: "https://routify.test", statsToken: "t" }, reply(200, { hello: "world" }))).rejects.toThrow(/onverwacht/);
  });
});
