// What the shop makes through Printify (Jarne, 26 Nov: garments move to Printify, it looks better and is
// cheaper): which garments, which print provider, colours and sizes, ink per colour, and the price.
import { priceFor } from "./pricing.js";

/** Textildruck Europa (Germany): European, so fast and without customs for EU buyers. */
export const PRINTIFY_PROVIDER = 26;

export interface PrintifyType {
  typeId: string;
  /** Fixed blueprint (garments); other products are found by `match` in Printify's catalogue. */
  blueprintId?: number;
  match?: { include: RegExp[]; exclude: RegExp };
  /** How the design sits in the print area. */
  layout?: "chest" | "mug-wrap" | "center";
  /** Wanted sizes in order (substring of the variant), for products that are not clothes. */
  sizes?: string[];
  /** Lowest shop price in cents (default €24.99). */
  minPriceCents?: number;
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
  // Jarne, 27 Nov: everything through Printify. Found by name, printed by an EU provider.
  {
    typeId: "mug",
    match: { include: [/\bmug\b/i, /11\s?oz/i], exclude: /black|enamel|travel|color|colour|accent|latte|metallic|magic|camp|two-tone|inner|stainless|glitter|heat/i },
    label: "Mok (Printify)",
    noun: "Mug",
    colors: ["White"],
    sizes: ["11oz", "15oz"],
    layout: "mug-wrap",
    minPriceCents: 1999,
    facts: "White ceramic mug, 11oz (330 ml), dishwasher and microwave safe, the design printed on both sides, made in Europe.",
  },
  {
    typeId: "poster",
    match: { include: [/poster/i, /matte/i], exclude: /canvas|framed|frame|horizontal|square|glossy|aop/i },
    label: "Poster (Printify)",
    noun: "Poster",
    colors: ["White"],
    sizes: ["30x40", "40x50", "50x70", "A4", "A3", "A2", "12″ x 16″", "18″ x 24″", "24″ x 36″", "11″ x 14″"],
    layout: "center",
    minPriceCents: 1999,
    facts: "Museum-quality matte poster on thick paper, several sizes, frame not included, printed in Europe.",
  },
  {
    typeId: "tote",
    match: { include: [/tote/i, /cotton|canvas|organic/i], exclude: /aop|all over|polyester|straps|zip/i },
    label: "Draagtas (Printify)",
    noun: "Tote Bag",
    colors: ["Natural", "Black", "White"],
    sizes: [],
    layout: "center",
    minPriceCents: 1999,
    facts: "Sturdy cotton tote bag with long handles, printed on one side in Europe.",
  },
];

/** EU countries in order of preference (fast, no customs for EU buyers); never the UK or the US. */
export const EU_COUNTRIES = ["DE", "NL", "BE", "CZ", "LV", "FR", "ES", "IT", "PL", "AT", "PT", "LT", "EE", "SK", "SI", "DK", "SE", "FI", "IE", "HU", "RO", "BG", "HR", "GR"];

/** Catalogue products whose name fits the type (all include words, no exclude word). */
export function chooseBlueprint<B extends { id: number; title: string }>(blueprints: B[], t: PrintifyType): B[] {
  if (!t.match) return blueprints.filter((b) => b.id === t.blueprintId);
  return blueprints.filter((b) => t.match!.include.every((re) => re.test(b.title)) && !t.match!.exclude.test(b.title));
}

/** The first print provider in the EU, by country preference; null when there is none. */
export function chooseProvider<P extends { id: number; country?: string }>(providers: P[]): P | null {
  for (const c of EU_COUNTRIES) {
    const hit = providers.find((p) => p.country === c);
    if (hit) return hit;
  }
  return null;
}

/** Variants of a product that is not clothing: wanted colours and sizes in order, at most four. */
export function pickProductVariants(variants: { id: number; title: string; options: Record<string, string> }[], t: PrintifyType): PickedVariant[] {
  const colorOk = (v: { options: Record<string, string> }) => !v.options.color || t.colors.includes(v.options.color);
  const toPick = (v: { id: number; title: string; options: Record<string, string> }) => ({ id: v.id, color: v.options.color ?? "White", size: v.options.size ?? v.title });
  const out: PickedVariant[] = [];
  for (const want of t.sizes ?? []) {
    for (const v of variants) {
      if (out.length >= 4) break;
      if (colorOk(v) && v.title.includes(want) && !out.some((o) => o.id === v.id)) out.push(toPick(v));
    }
  }
  if (out.length) return out;
  return variants.filter(colorOk).slice(0, 3).map(toPick);
}

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

/** A price ending in ,99 that leaves at least €5 profit with the 20% sale (and never below the floor, €24.99 for clothes). */
export function retailPrice(costCents: number, shippingChargedCents: number, floorCents = 2499): number {
  const price = priceFor(500, { shippingChargedCents, printfulTotalCents: costCents }, 0.2);
  return Math.max(floorCents, price);
}

export function productBody(i: {
  /** The print zone (clothes: front; some mugs or posters name it differently). */
  position?: string;
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
        placeholders: [{ position: i.position ?? "front", images: [{ id: i.imageIds[ink], x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
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
