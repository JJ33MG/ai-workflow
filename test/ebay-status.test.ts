import { describe, expect, it } from "vitest";
import { ebayCheck } from "../src/lib/health.js";

const now = new Date("2026-11-23T10:00:00Z");

describe("eBay on the health list", () => {
  it("warns when nothing is live, with the limit and until when new listings wait", () => {
    const c = ebayCheck({ at: "2026-11-23T07:00:00Z", live: 0, offers: 170, limit: { quantity: 70, amount: "3500 USD" } }, "2026-12-01T00:00:00.000Z", now);
    expect(c.status).toBe("warn");
    expect(c.detail).toBe("Gekoppeld · 0 listings live (170 klaargezet bij eBay) · limiet 70 stuks of 3500 USD per maand · nieuwe listings wachten tot 1 december (maandlimiet)");
  });
  it("is fine with live listings and no pause", () => {
    const c = ebayCheck({ at: "2026-12-02T07:00:00Z", live: 12, offers: 30, limit: { quantity: 70, amount: "3500 USD" } }, null, now);
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("12 listings live");
  });
  it("says when no check ran yet", () => {
    expect(ebayCheck(null, null, now).detail).toBe("Gekoppeld · nog geen controle bij eBay (elke ochtend om 07:30)");
  });
});
