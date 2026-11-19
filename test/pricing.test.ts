import { describe, expect, it } from "vitest";
import { maxDiscountPct, priceFor, saleProfit } from "../src/lib/pricing.js";

describe("profit per sale", () => {
  const mug = { priceCents: 2199, shippingChargedCents: 599, printfulTotalCents: 1250 };

  it("subtracts Printful and every Etsy fee", () => {
    const r = saleProfit(mug);
    expect(r.buyerPaysCents).toBe(2798);
    // Seller fees 6.5% of 27.98 + €0.19 listing = 2.01, +21% VAT = 2.43; payment 4% + €0.30 = 1.42 → 3.85
    expect(r.etsyFeesCents).toBe(385);
    expect(r.profitCents).toBe(2798 - 385 - 1250);
  });

  it("discounts the item, not the shipping, and counts Offsite Ads when asked", () => {
    expect(saleProfit({ ...mug, discountPct: 0.2 }).buyerPaysCents).toBe(1759 + 599);
    expect(saleProfit({ ...mug, offsiteAds: true }).profitCents).toBeLessThan(saleProfit(mug).profitCents - 400);
  });

  it("finds the deepest sale that keeps a minimum profit, and a price that survives a sale", () => {
    const pct = maxDiscountPct(mug, 300);
    expect(saleProfit({ ...mug, discountPct: pct / 100 }).profitCents).toBeGreaterThanOrEqual(300);
    expect(saleProfit({ ...mug, discountPct: (pct + 1) / 100 }).profitCents).toBeLessThan(300);
    const price = priceFor(800, { shippingChargedCents: 599, printfulTotalCents: 1250 }, 0.3);
    expect(price % 100).toBe(99);
    expect(saleProfit({ shippingChargedCents: 599, printfulTotalCents: 1250, priceCents: price, discountPct: 0.3 }).profitCents).toBeGreaterThanOrEqual(800);
  });
});
