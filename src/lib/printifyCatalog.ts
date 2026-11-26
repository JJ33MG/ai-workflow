// What the shop makes through Printify (Jarne, 26 Nov: garments move to Printify, it looks better and is
// cheaper): which garments, which print provider, colours and sizes, ink per colour, and the price.
import { priceFor } from "./pricing.js";

/** Textildruck Europa (Germany): European, so fast and without customs for EU buyers. */
export const PRINTIFY_PROVIDER = 26;

export interface PrintifyType {
  typeId: string;
  blueprintId: number;
  label: string;
  noun: string;
  colors: string[];
  facts: string;
}

export const PRINTIFY_TYPES: PrintifyType[] = [
  {
    typeId: "tshirt",
    blueprintId: 12,
    label: "T-shirt (Printify)",
    noun: "T-Shirt",
    colors: ["White", "Black", "Natural", "Heather Navy", "Navy", "Athletic Heather"],
    facts: "Unisex soft cotton jersey T-shirt (Bella + Canvas 3001), retail fit, sizes S to 3XL, printed on the front in Europe.",
  },
  {
    typeId: "hoodie",
    blueprintId: 77,
    label: "Hoodie (Printify)",
    noun: "Hoodie",
    colors: ["Black", "Sport Grey", "Sand", "Navy", "White", "Forest Green"],
    facts: "Unisex heavy blend hoodie (Gildan 18500) with front pouch pocket, sizes S to 3XL, printed on the front in Europe.",
  },
  {
    typeId: "sweatshirt",
    blueprintId: 49,
    label: "Sweater (Printify)",
    noun: "Sweatshirt",
    colors: ["Sand", "Sport Grey", "Black", "Navy", "Light Pink", "Forest Green", "White"],
    facts: "Unisex heavy blend crewneck sweatshirt (Gildan 18000), classic fit, sizes S to 3XL, printed on the front in Europe.",
  },
];

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

export interface PickedVariant {
  id: number;
  color: string;
  size: string;
}

/** The preferred colours that exist, in that order (at most `maxColors`), in sizes S to 3XL. */
export function pickVariants(
  variants: { id: number; title: string; options: Record<string, string> }[],
  colors: string[],
  maxColors: number,
): PickedVariant[] {
  const has = (c: string) => variants.some((x) => x.options.color === c);
  const chosen = colors.filter(has).slice(0, maxColors);
  const out: PickedVariant[] = [];
  for (const c of chosen) {
    for (const x of variants) {
      if (x.options.color === c && SIZES.includes(x.options.size)) out.push({ id: x.id, color: c, size: x.options.size });
    }
  }
  return out;
}

/** Light ink on dark garments, dark ink on light ones. */
export function inkFor(color: string): "light" | "dark" {
  return /black|navy|forest|maroon|charcoal|dark|military|purple|royal|red|brown/i.test(color) ? "light" : "dark";
}

/** A price ending in ,99 that leaves at least €5 profit with the 20% sale (and never below €24.99). */
export function retailPrice(costCents: number, shippingChargedCents: number): number {
  const price = priceFor(500, { shippingChargedCents, printfulTotalCents: costCents }, 0.2);
  return Math.max(2499, price);
}

export function productBody(i: {
  title: string;
  description: string;
  tags: string[];
  blueprintId: number;
  providerId: number;
  variants: (PickedVariant & { priceCents: number })[];
  imageIds: { light: string; dark: string };
}) {
  const byInk = { light: [] as number[], dark: [] as number[] };
  for (const v of i.variants) byInk[inkFor(v.color)].push(v.id);
  return {
    title: i.title,
    description: i.description,
    tags: i.tags,
    blueprint_id: i.blueprintId,
    print_provider_id: i.providerId,
    variants: i.variants.map((v) => ({ id: v.id, price: v.priceCents, is_enabled: true })),
    print_areas: (["light", "dark"] as const)
      .filter((ink) => byInk[ink].length)
      .map((ink) => ({
        variant_ids: byInk[ink],
        placeholders: [{ position: "front", images: [{ id: i.imageIds[ink], x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      })),
  };
}

const PHOTO_TARGET = 10;

/**
 * Which of Printify's mockups to add to an Etsy listing so it has 10 photos (Jarne: too few photos).
 * Printify generates many more than it sends: other views (back, worn, folded) go first, then the rest.
 */
export function extraPhotos(
  images: { src: string; is_selected_for_publishing?: boolean; position: string }[],
  have: number,
  target = PHOTO_TARGET,
): string[] {
  const room = Math.max(0, target - have);
  const seen = new Set<string>();
  const unsent = images.filter((i) => !i.is_selected_for_publishing && !seen.has(i.src) && seen.add(i.src));
  const ordered = [...unsent.filter((i) => i.position !== "front"), ...unsent.filter((i) => i.position === "front")];
  return ordered.slice(0, room).map((i) => i.src);
}
