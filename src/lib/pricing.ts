// What one sale really earns: the buyer's price and shipping, minus Printful (product, shipping and
// the VAT Printful charges), minus Etsy's fees. Used for the pricing report and to check that a sale
// (a discount on the item price) still leaves a profit. All amounts in euro cents.

/** Etsy's fees for a shop based in Belgium (late 2026). */
export const ETSY_FEES = {
  /** On item price + shipping (after discount). */
  transactionPct: 0.065,
  /** Etsy Payments in Belgium: on the order total. */
  paymentPct: 0.04,
  paymentFixedCents: 30,
  /** $0.20 listing fee, charged again (auto-renew) for every item sold. */
  listingFeeCents: 19,
  /** Offsite Ads: only on sales Etsy brought in through its own ads on Google, Pinterest and the like. */
  offsiteAdsPct: 0.15,
};

export interface SaleInput {
  /** The item price on Etsy, before a sale. */
  priceCents: number;
  /** What the buyer pays for shipping on Etsy. */
  shippingChargedCents: number;
  /** What Printful charges for the item, shipping and VAT together. */
  printfulTotalCents: number;
  /** A sale on the item price, e.g. 0.2 for 20% off (shipping is not discounted). */
  discountPct?: number;
  /** The sale came from Etsy's Offsite Ads. */
  offsiteAds?: boolean;
}

export interface SaleResult {
  buyerPaysCents: number;
  etsyFeesCents: number;
  printfulCents: number;
  profitCents: number;
  /** Profit as a share of what the buyer paid. */
  marginPct: number;
}

export function saleProfit(i: SaleInput): SaleResult {
  const item = Math.round(i.priceCents * (1 - (i.discountPct ?? 0)));
  const buyerPays = item + i.shippingChargedCents;
  const fees =
    buyerPays * ETSY_FEES.transactionPct +
    buyerPays * ETSY_FEES.paymentPct +
    ETSY_FEES.paymentFixedCents +
    ETSY_FEES.listingFeeCents +
    (i.offsiteAds ? buyerPays * ETSY_FEES.offsiteAdsPct : 0);
  const profit = buyerPays - fees - i.printfulTotalCents;
  return {
    buyerPaysCents: buyerPays,
    etsyFeesCents: Math.round(fees),
    printfulCents: i.printfulTotalCents,
    profitCents: Math.round(profit),
    marginPct: buyerPays ? profit / buyerPays : 0,
  };
}

/** The deepest discount (in whole percent) that still leaves at least `minProfitCents`. */
export function maxDiscountPct(i: Omit<SaleInput, "discountPct">, minProfitCents: number): number {
  for (let pct = 70; pct >= 0; pct--) {
    if (saleProfit({ ...i, discountPct: pct / 100 }).profitCents >= minProfitCents) return pct;
  }
  return 0;
}

/**
 * The item price at which a sale of `discountPct` still leaves `targetProfitCents`, rounded up to
 * a price ending in ,99. Used to suggest prices that survive a sale.
 */
export function priceFor(targetProfitCents: number, i: Omit<SaleInput, "priceCents" | "discountPct">, discountPct: number): number {
  for (let euros = 1; euros <= 300; euros++) {
    const price = euros * 100 - 1;
    if (saleProfit({ ...i, priceCents: price, discountPct }).profitCents >= targetProfitCents) return price;
  }
  return 29999;
}
