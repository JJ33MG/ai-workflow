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

import { ebayHeaders } from "../src/integrations/ebay.js";

describe("eBay request headers", () => {
  it("names the language itself (fetch would otherwise send Accept-Language: *, which eBay refuses)", () => {
    const h = ebayHeaders("tok");
    expect(h["accept-language"]).toBe("en-US");
    expect(h["content-language"]).toBe("en-US");
    expect(h.authorization).toBe("Bearer tok");
  });
});

import { colorAspect } from "../src/agents/ebay.js";

describe("eBay colour item specific", () => {
  it("is the variant's colour, else the product's own colour", () => {
    expect(colorAspect("hoodie", "Navy")).toBe("Navy");
    expect(colorAspect("mug", null)).toBe("White");
    expect(colorAspect("mug-black", null)).toBe("Black");
    expect(colorAspect("poster", null)).toBe("Multicolor");
  });
});

import { privilegeLine } from "../src/integrations/ebay.js";

describe("eBay seller status line", () => {
  it("says whether registration is complete and the selling limit", () => {
    expect(privilegeLine({ sellerRegistrationCompleted: true, sellingLimit: { quantity: 10, amount: { value: "500.0", currency: "USD" } } }))
      .toBe("eBay-verkopersaccount: registratie voltooid, verkooplimiet 10 stuks of 500.0 USD per maand");
    expect(privilegeLine({ sellerRegistrationCompleted: false })).toBe("eBay-verkopersaccount: registratie NIET voltooid, verkooplimiet onbekend");
  });
});

import { errorText } from "../src/integrations/ebay.js";

describe("eBay error text", () => {
  it("keeps the error number and parameters next to eBay's message", () => {
    expect(errorText([{ errorId: 25002, longMessage: "Cannot revise listing.", parameters: [{ name: "0", value: "title" }] }])).toBe("Cannot revise listing. [25002] (0=title)");
  });
});

import { ebayVariants, EBAY_STOCK } from "../src/agents/ebay.js";

describe("eBay variants within a new seller's limit", () => {
  const v = (size: string, color: string | null) => ({ size, color, variantId: Math.random() });
  it("lists one unit per variant and one colour of apparel, all sizes", () => {
    expect(EBAY_STOCK).toBe(1);
    const hoodie = ["Black", "Navy", "Sport Grey", "White"].flatMap((c) => ["S", "M", "L"].map((s) => v(s, c)));
    const picked = ebayVariants(hoodie);
    expect(new Set(picked.map((x) => x.color))).toEqual(new Set(["Black"]));
    expect(picked).toHaveLength(3);
  });
  it("keeps products without colours as they are", () => {
    const mug = [v("11 oz", null), v("15 oz", null)];
    expect(ebayVariants(mug)).toHaveLength(2);
  });
});

import { EbayError } from "../src/integrations/ebay.js";
import { isSellingLimit, nextMonthStart, summarizeOffers } from "../src/agents/ebay.js";

describe("eBay selling limit and check", () => {
  it("recognises eBay's monthly selling limit (error 25002) and waits until the next month", () => {
    expect(isSellingLimit(new EbayError(400, [{ errorId: 25002 }], "limit"))).toBe(true);
    expect(isSellingLimit(new EbayError(400, [{ errorId: 25001 }], "other"))).toBe(false);
    expect(isSellingLimit(new Error("x"))).toBe(false);
    expect(nextMonthStart(new Date("2026-11-21T22:00:00Z")).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(nextMonthStart(new Date("2026-12-31T10:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("sums up what eBay holds: offers per status and listings per state", () => {
    const s = summarizeOffers([
      { sku: "a", status: "PUBLISHED", listing: { listingId: "1", listingStatus: "ACTIVE" } },
      { sku: "b", status: "PUBLISHED", listing: { listingId: "1", listingStatus: "ACTIVE" } },
      { sku: "c", status: "PUBLISHED", listing: { listingId: "2", listingStatus: "ENDED" } },
      { sku: "d", status: "UNPUBLISHED" },
    ]);
    expect(s).toEqual({ offers: 4, byStatus: { PUBLISHED: 3, UNPUBLISHED: 1 }, listings: { ACTIVE: ["1"], ENDED: ["2"] } });
  });
});

import { byFewestItems, ebayVariants as variantsForEbay } from "../src/agents/ebay.js";

describe("fitting eBay's monthly item limit", () => {
  it("lists apparel in one colour, every size", () => {
    const v = ["Black", "Navy", "White"].flatMap((color) => ["S", "M", "L"].map((size) => ({ color, size })));
    const kept = variantsForEbay(v);
    expect(new Set(kept.map((x) => x.color))).toEqual(new Set(["Black"]));
    expect(kept).toHaveLength(3);
  });

  it("puts products that use few items (a mug, a poster) before ones that use many (a hoodie in every size)", () => {
    const mk = (id: string, n: number, favorites = 0) => ({ id, favorites, variants: Array.from({ length: n }, (_, i) => ({ color: "Black", size: String(i) })) });
    const order = (byFewestItems([mk("hoodie", 5, 9), mk("mug", 1, 0), mk("poster", 2, 3), mk("mug2", 1, 4)] as never) as unknown as { id: string }[]).map((l) => l.id);
    expect(order).toEqual(["mug2", "mug", "poster", "hoodie"]);
  });
});

import { isLive } from "../src/agents/ebay.js";

describe("careful eBay start", () => {
  it("counts a listing as live only when eBay reports it ACTIVE", () => {
    expect(isLive([{ sku: "a", status: "PUBLISHED", listing: { listingId: "1", listingStatus: "ACTIVE" } }])).toBe(true);
    expect(isLive([{ sku: "a", status: "PUBLISHED", listing: { listingId: "1", listingStatus: "ENDED" } }])).toBe(false);
    expect(isLive([{ sku: "a", status: "UNPUBLISHED" }])).toBe(false);
    expect(isLive([])).toBe(false);
  });
});
