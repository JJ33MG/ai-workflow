import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ebayDescription, ebayOrderItems, ebayTitle, skuFor } from "../src/agents/ebay.js";
import { challengeResponse } from "../src/integrations/ebay.js";

describe("eBay listings", () => {
  it("keeps titles within eBay's 80 characters, cut at a word", () => {
    const long = "Christmas Gift for Respiratory Therapist Mug, Dear Santa Just Good Sats and Strong Coffee, RT Coworker Present";
    const t = ebayTitle(long);
    expect(t.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(t)).toBe(true);
    expect(long[t.length]).toMatch(/[\s,]/);
    expect(ebayTitle("Short title")).toBe("Short title");
  });

  it("turns the Etsy description into safe HTML without Etsy-only wording", () => {
    const html = ebayDescription("A mug for <nurses> & friends.\n\nType the name in the personalization box.\n\nDishwasher safe.");
    expect(html).toContain("<p>A mug for &lt;nurses&gt; &amp; friends.</p>");
    expect(html).not.toContain("personalization box");
    expect(html).toContain("Free shipping");
  });

  it("orders exactly the variant the buyer picked, and refuses unknown items", () => {
    const sku = skuFor("cmabcdefghijklmnop", 1320);
    expect(sku.length).toBeLessThanOrEqual(50);
    const refs = { L1: { groupKey: "g", offerIds: [], ebayListingId: "1", skus: { [sku]: { variantId: 1320, file: "x.png", placement: "default" } } } };
    const order = { orderId: "12-1", lineItems: [{ lineItemId: "a", sku, quantity: 2, title: "Mug" }] } as never;
    expect(ebayOrderItems(order, refs)).toEqual([{ variantId: 1320, quantity: 2, fileUrl: expect.stringContaining("x.png"), placement: "default" }]);
    const unknown = { orderId: "12-2", lineItems: [{ lineItemId: "b", sku: "OTHER", quantity: 1, title: "Something" }] } as never;
    expect(() => ebayOrderItems(unknown, refs)).toThrow(/met de hand/);
  });

  it("answers eBay's account-deletion check as eBay computes it", () => {
    const expected = createHash("sha256").update("abc" + "token123" + "https://x.test/hooks/ebay/deletion").digest("hex");
    expect(challengeResponse("abc", "token123", "https://x.test/hooks/ebay/deletion")).toBe(expected);
  });
});

import { calledEndpoint } from "../src/integrations/ebay.js";

describe("eBay deletion check uses the address eBay called", () => {
  it("rebuilds the https address from the request, keeping a trailing slash and dropping the query", () => {
    expect(calledEndpoint("ai.example.app", "/hooks/ebay/deletion?challenge_code=abc")).toBe("https://ai.example.app/hooks/ebay/deletion");
    expect(calledEndpoint("ai.example.app", "/hooks/ebay/deletion/?challenge_code=abc")).toBe("https://ai.example.app/hooks/ebay/deletion/");
  });
});

import { firstAcceptedShipping, SHIPPING_FALLBACKS } from "../src/integrations/ebay.js";

describe("eBay shipping service", () => {
  it("tries the next shipping service when eBay refuses one for this seller", async () => {
    const tried: string[] = [];
    const id = await firstAcceptedShipping(async (s) => {
      tried.push(s.service);
      if (s.service === "USPSGroundAdvantage") throw new Error("eBay POST /sell/account/v1/fulfillment_policy failed: 400 LSAS validation failed.; LSAS validation failed : USPSGroundAdvantage");
      return "policy-1";
    }, "USPS", "USPSGroundAdvantage");
    expect(id).toBe("policy-1");
    expect(tried).toEqual(["USPSGroundAdvantage", SHIPPING_FALLBACKS[0].service]);
  });

  it("does not hide other errors", async () => {
    await expect(firstAcceptedShipping(async () => { throw new Error("401 unauthorized"); }, "USPS", "USPSGroundAdvantage")).rejects.toThrow(/401/);
  });
});
