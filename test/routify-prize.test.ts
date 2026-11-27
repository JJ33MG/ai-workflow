import { describe, expect, it, vi } from "vitest";
import { previousMonth, prizeRound } from "../src/agents/routifyPrize.js";
import { fetchPrizeWinner, grantPrize } from "../src/integrations/routify.js";

const C = { url: "https://roamgem.test/", statsToken: "tok" };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("monthly explorer prize", () => {
  it("is about the month that just ended", () => {
    expect(previousMonth(new Date("2026-12-01T09:05:00Z"))).toBe("2026-11");
    expect(previousMonth(new Date("2027-01-01T09:05:00Z"))).toBe("2026-12");
  });

  it("asks Jarne once for the winner of the month", async () => {
    const ask = vi.fn(async (_a: { details: string }) => undefined);
    const deps = { winner: async () => ({ userId: "u1", name: "anna_roams", points: 640, moments: 9, likes: 290, inTrips: 12 }), asked: vi.fn(async () => false), ask };
    expect(await prizeRound("2026-11", deps)).toEqual({ asked: true, month: "2026-11" });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      kind: "roamgem_prize",
      title: "Explorer van november 2026: anna_roams",
      payload: { userId: "u1", month: "2026-11" },
    }));
    expect(ask.mock.calls[0][0].details).toContain("9 momenten, 290 likes, 12 keer in een trip");
    deps.asked.mockResolvedValue(true);
    expect(await prizeRound("2026-11", deps)).toEqual({ asked: false, month: "2026-11", reason: "al gevraagd" });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks nothing when nobody scored", async () => {
    const ask = vi.fn();
    expect(await prizeRound("2026-11", { winner: async () => null, asked: async () => false, ask })).toEqual({ asked: false, month: "2026-11", reason: "geen winnaar" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("reads the winner and grants the year with the stats token", async () => {
    const read = reply(200, { winner: { userId: "u1", name: "anna", points: 63 } });
    expect(await fetchPrizeWinner("2026-11", C, read)).toEqual({ userId: "u1", name: "anna", points: 63 });
    expect(read).toHaveBeenCalledWith("https://roamgem.test/api/community/prize?month=2026-11", expect.objectContaining({ headers: { "x-stats-token": "tok" } }));
    const grant = reply(200, { granted: true });
    expect(await grantPrize("u1", "2026-11", C, grant)).toEqual({ granted: true });
    expect(grant).toHaveBeenCalledWith("https://roamgem.test/api/community/prize/grant", expect.objectContaining({ method: "POST" }));
  });
});
