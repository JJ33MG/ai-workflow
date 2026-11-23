// Shipping from Europe. Printful prints most products in Latvia and Spain as well as the US and sends
// each order from the facility nearest the buyer. Etsy showed every listing as "ships from United
// States, arrives Dec 7-30" to European buyers; this moves the shipping profiles to Latvia where
// Printful can print every product of the profile in Europe, with honest delivery times.

/** Checked against Printful's catalog (Nov 2026): these are printed in the US only. */
const US_ONLY = new Set(["ornament", "ornament-acrylic"]);

const EU = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
  "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export type Origin = "LV" | "US";

/** Where a shipping profile should ship from, given the product types that use it. */
export function profileOrigin(types: string[]): Origin | null {
  if (!types.length) return null;
  return types.some((t) => US_ONLY.has(t)) ? "US" : "LV";
}

export interface DestinationLike {
  destination_country_iso: string | null;
  destination_region: string | null;
}

/** Transit days for a profile destination (Etsy adds the processing time from the processing profile). */
export function deliveryDays(d: DestinationLike, origin: Origin): [number, number] {
  const country = d.destination_country_iso;
  const eu = d.destination_region === "eu" || (country !== null && EU.has(country));
  if (origin === "LV") {
    if (eu) return [3, 7];
    if (country === "GB" || country === "US" || country === "CA" || d.destination_region === "non_eu") return [4, 9];
    return [7, 20];
  }
  if (country === "US") return [3, 7];
  if (country === "CA") return [5, 10];
  return [7, 15];
}
