// What one sale really earns: the buyer's price and shipping, minus Printful (product, shipping and
// the VAT Printful charges), minus Etsy's fees. Used for the pricing report and to check that a sale
// (a discount on the item price) still leaves a profit. All amounts in euro cents.

/**
 * Etsy's fees for a shop based in the Czech Republic (late 2026). A seller without a VAT number also
 * pays Czech VAT on Etsy's own fees (ETSY_FEE_VAT_PCT, 0 once a VAT number is in the shop settings).
 */
export const ETSY_FEES = {
  feeVatPct: Number(process.env.ETSY_FEE_VAT_PCT ?? 0.21),
  /** On item price + shipping (after discount). */
  transactionPct: 0.065,
  /** Etsy Payments: on the order total. */
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
  // VAT applies to Etsy's seller fees, not to payment processing (a financial service, exempt).
  const sellerFees =
    buyerPays * ETSY_FEES.transactionPct + ETSY_FEES.listingFeeCents + (i.offsiteAds ? buyerPays * ETSY_FEES.offsiteAdsPct : 0);
  const fees = sellerFees * (1 + ETSY_FEES.feeVatPct) + buyerPays * ETSY_FEES.paymentPct + ETSY_FEES.paymentFixedCents;
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

/**
 * eBay (ebay.com) for a seller based outside the US: final value fee on the total, the international
 * fee for a foreign seller, a fixed fee per order, and VAT on all of it (no VAT number yet).
 * Shipping is free for the buyer, so the price must cover Printful's shipping too.
 */
export const EBAY_FEES = {
  finalValuePct: 0.136,
  internationalPct: 0.0165,
  perOrderCents: 40, // USD
  feeVatPct: Number(process.env.ETSY_FEE_VAT_PCT ?? 0.21),
};

/** Profit in EUR cents of an eBay sale priced in USD cents, given Printful's total in EUR cents. */
export function ebaySaleProfitEur(priceUsdCents: number, printfulEurCents: number, usdToEur: number, discountPct = 0): number {
  const total = Math.round(priceUsdCents * (1 - discountPct));
  const fees = (total * (EBAY_FEES.finalValuePct + EBAY_FEES.internationalPct) + EBAY_FEES.perOrderCents) * (1 + EBAY_FEES.feeVatPct);
  return Math.round((total - fees) * usdToEur - printfulEurCents);
}

/** The lowest USD price ending in .99 that keeps the shop's rule on eBay. */
export function ebayPriceFor(printfulEurCents: number, usdToEur: number, minProfitEurCents: number, discountPct: number): number {
  for (let dollars = 1; dollars <= 400; dollars++) {
    const price = dollars * 100 - 1;
    if (ebaySaleProfitEur(price, printfulEurCents, usdToEur, discountPct) >= minProfitEurCents) return price;
  }
  return 39999;
}
