// Garments move from Printful to Printify (Jarne, 26 Nov: Printify looks better and is cheaper). The
// Printful garments and the personalized posters go offline; new garments are made through Printify.

/** Printful product types that no longer get new designs, refreshes or photos. */
export const PRINTFUL_RETIRED = new Set(["hoodie", "sweatshirt", "tshirt"]);

interface Row {
  id: string;
  productType: string;
  personalized: boolean;
  source: string;
  status: string;
  supplier?: string;
}

/** The agent's live Printful listings to take offline: every garment, and every personalized poster. */
export function retireSelection(rows: Row[]): string[] {
  return rows
    .filter((r) => r.source === "agent" && (r.supplier ?? "printful") === "printful" && ["active", "uploaded"].includes(r.status))
    .filter((r) => PRINTFUL_RETIRED.has(r.productType) || (r.productType === "poster" && r.personalized))
    .map((r) => r.id);
}
