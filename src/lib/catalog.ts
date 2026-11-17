// The product range of the Etsy shop: every Printful product the agent can put a design on,
// which sizes and colours it offers, and the price of each. One design becomes several listings
// (a mug, a T-shirt, a tote …); each listing lets the buyer pick size and colour.
//
// Prices are in the shop's currency (EUR), chosen against Printful's cost with room for Etsy's
// fees: roughly €6-15 profit per item. Change them here.

export type Ink = "dark" | "light";
export type Layout = "mug-wrap" | "chest" | "center";

export interface ProductType {
  id: string;
  /** Dutch, for the dashboard. */
  label: string;
  /** English product word for titles, e.g. "T-Shirt". */
  noun: string;
  printfulProductId: number;
  /** Safety check that the id still points at the same product. */
  printfulTitle: RegExp;
  /** Print placements in order of preference. */
  placements: string[];
  layout: Layout;
  /** Printful size name → label on Etsy (no parentheses: Etsy refuses them) and price. */
  sizes: { printful: string; label: string; priceCents: number }[];
  /** Printful colour names to offer, in order. Undefined: the product has one colour. */
  colors?: string[];
  /** Etsy category names, first found wins. */
  etsyTaxonomy: string[];
  /** Matches the Etsy shipping profile Printful made for this kind of product. */
  shippingProfile: RegExp;
  /** Product facts Claude puts in the description. */
  facts: string;
  /** Mockups are made for this many colours (each colour is a separate photo). */
  mockupColors: number;
}

export const PRODUCT_TYPES: ProductType[] = [
  {
    id: "mug",
    label: "Witte mok",
    noun: "Mug",
    printfulProductId: 19,
    printfulTitle: /white glossy mug/i,
    placements: ["default"],
    layout: "mug-wrap",
    sizes: [
      { printful: "11 oz", label: "11 oz", priceCents: 2199 },
      { printful: "15 oz", label: "15 oz", priceCents: 2499 },
      { printful: "20 oz", label: "20 oz", priceCents: 2799 },
    ],
    etsyTaxonomy: ["Mugs"],
    shippingProfile: /mug/i,
    facts: "White glossy ceramic mug, 11, 15 or 20 oz, design printed on both sides, dishwasher and microwave safe.",
    mockupColors: 1,
  },
  {
    id: "mug-black",
    label: "Zwarte mok",
    noun: "Black Mug",
    printfulProductId: 300,
    printfulTitle: /black glossy mug/i,
    placements: ["default"],
    layout: "mug-wrap",
    sizes: [
      { printful: "11 oz", label: "11 oz", priceCents: 2399 },
      { printful: "15 oz", label: "15 oz", priceCents: 2699 },
    ],
    etsyTaxonomy: ["Mugs"],
    shippingProfile: /mug/i,
    facts: "Black glossy ceramic mug, 11 or 15 oz, design printed on both sides, dishwasher and microwave safe.",
    mockupColors: 1,
  },
  {
    id: "mug-color",
    label: "Mok met gekleurde binnenkant",
    noun: "Mug with Color Inside",
    printfulProductId: 403,
    printfulTitle: /color inside/i,
    placements: ["default"],
    layout: "mug-wrap",
    sizes: [
      { printful: "11 oz", label: "11 oz", priceCents: 2299 },
      { printful: "15 oz", label: "15 oz", priceCents: 2599 },
    ],
    colors: ["Black", "Red", "Blue", "Pink", "Yellow", "Dark Green"],
    etsyTaxonomy: ["Mugs"],
    shippingProfile: /mug/i,
    facts: "White ceramic mug with a coloured inside and handle (choose the colour), 11 or 15 oz, design on both sides, dishwasher and microwave safe.",
    mockupColors: 3,
  },
  {
    id: "tshirt",
    label: "T-shirt",
    noun: "T-Shirt",
    printfulProductId: 71,
    printfulTitle: /bella \+ canvas 3001/i,
    placements: ["front"],
    layout: "chest",
    sizes: [
      { printful: "S", label: "S", priceCents: 2699 },
      { printful: "M", label: "M", priceCents: 2699 },
      { printful: "L", label: "L", priceCents: 2699 },
      { printful: "XL", label: "XL", priceCents: 2699 },
      { printful: "2XL", label: "2XL", priceCents: 2899 },
      { printful: "3XL", label: "3XL", priceCents: 3099 },
    ],
    colors: ["White", "Black", "Navy", "Athletic Heather"],
    etsyTaxonomy: ["T-shirts"],
    shippingProfile: /t-?shirt|\btee|apparel|cloth|shirt/i,
    facts: "Unisex soft cotton T-shirt (Bella + Canvas 3001), retail fit, sizes S to 3XL, printed on the front.",
    mockupColors: 3,
  },
  {
    id: "hoodie",
    label: "Hoodie",
    noun: "Hoodie",
    printfulProductId: 146,
    printfulTitle: /gildan 18500/i,
    placements: ["front"],
    layout: "chest",
    sizes: [
      { printful: "S", label: "S", priceCents: 4699 },
      { printful: "M", label: "M", priceCents: 4699 },
      { printful: "L", label: "L", priceCents: 4699 },
      { printful: "XL", label: "XL", priceCents: 4699 },
      { printful: "2XL", label: "2XL", priceCents: 4899 },
      { printful: "3XL", label: "3XL", priceCents: 5099 },
    ],
    colors: ["Black", "Navy", "Sport Grey", "White"],
    etsyTaxonomy: ["Hoodies", "Hoodies & Sweatshirts", "Sweatshirts"],
    shippingProfile: /hood|sweat|apparel|cloth/i,
    facts: "Unisex heavy blend hoodie (Gildan 18500) with front pouch pocket, sizes S to 3XL, printed on the front.",
    mockupColors: 3,
  },
  {
    id: "tote",
    label: "Tote bag",
    noun: "Tote Bag",
    printfulProductId: 367,
    printfulTitle: /eco tote bag/i,
    placements: ["front", "default"],
    layout: "center",
    sizes: [{ printful: "One size", label: "One size", priceCents: 2499 }],
    colors: ["Oyster", "Black", "Pacific"],
    etsyTaxonomy: ["Tote Bags", "Totes"],
    shippingProfile: /tote|bag/i,
    facts: "Eco tote bag of recycled cotton blend, 15 x 16 inches, long handles, printed on the front.",
    mockupColors: 3,
  },
  {
    id: "poster",
    label: "Poster",
    noun: "Poster",
    printfulProductId: 1,
    printfulTitle: /enhanced matte paper poster \(in\)/i,
    placements: ["default"],
    layout: "center",
    sizes: [
      { printful: "12″×16″", label: "12 x 16 in", priceCents: 2499 },
      { printful: "18″×24″", label: "18 x 24 in", priceCents: 3299 },
      { printful: "24″×36″", label: "24 x 36 in", priceCents: 4499 },
    ],
    etsyTaxonomy: ["Posters", "Prints"],
    // Only a real poster profile: "All over prints" in Printful's bags profile is clothing, not posters.
    shippingProfile: /poster/i,
    facts: "Museum-quality enhanced matte paper poster, frame not included, sizes 12x16, 18x24 or 24x36 inches.",
    mockupColors: 1,
  },
];

export const productType = (id: string | null | undefined) => PRODUCT_TYPES.find((t) => t.id === id);

/** Light ink on dark products, dark ink on light ones; products without a colour code are white. */
export function inkFor(colorCode: string | null | undefined): Ink {
  const m = colorCode?.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "dark";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45 ? "light" : "dark";
}

export interface CatalogVariantInput {
  id: number;
  size: string;
  color: string | null;
  color_code?: string | null;
  price: string;
}

export interface OfferedVariant {
  variantId: number;
  size: string;
  color: string | null;
  ink: Ink;
  priceCents: number;
  /** Printful's base cost in USD, for the margin check. */
  costUsd: number;
}

/**
 * The Printful variants a product type offers, in size-then-colour order. A combination that
 * Printful doesn't make is simply left out.
 */
export function offeredVariants(type: ProductType, variants: CatalogVariantInput[]): OfferedVariant[] {
  const out: OfferedVariant[] = [];
  for (const s of type.sizes) {
    for (const color of type.colors ?? [null]) {
      const v = variants.find((x) => x.size === s.printful && (color === null || x.color === color));
      if (!v) continue;
      out.push({
        variantId: v.id,
        size: s.label,
        color,
        ink: type.id === "mug" ? "dark" : inkFor(v.color_code),
        priceCents: s.priceCents,
        costUsd: Number(v.price),
      });
    }
  }
  return out;
}

export const skuFor = (variantId: number) => `PF-${variantId}`;
export const variantFromSku = (sku: string | null | undefined) => {
  const m = sku?.match(/^PF-(\d+)$/);
  return m ? Number(m[1]) : null;
};

/** Custom variation properties every Etsy category accepts. */
const SIZE_PROPERTY = 513;
const COLOR_PROPERTY = 514;

/** Etsy inventory for a listing: one product per variant with its price and a SKU naming the Printful variant. */
export function buildInventory(variants: { variantId: number; size: string; color: string | null; priceCents: number }[], readinessStateId: number) {
  const bySize = new Set(variants.map((v) => v.size)).size > 1;
  const byColor = new Set(variants.map((v) => v.color)).size > 1;
  const pricedBy = [...(bySize ? [SIZE_PROPERTY] : []), ...(byColor ? [COLOR_PROPERTY] : [])];
  return {
    products: variants.map((v) => ({
      sku: skuFor(v.variantId),
      property_values: [
        ...(bySize ? [{ property_id: SIZE_PROPERTY, property_name: "Size", value_ids: [], values: [v.size] }] : []),
        ...(byColor ? [{ property_id: COLOR_PROPERTY, property_name: "Color", value_ids: [], values: [v.color ?? ""] }] : []),
      ],
      offerings: [{ price: v.priceCents / 100, quantity: 999, is_enabled: true, readiness_state_id: readinessStateId }],
    })),
    price_on_property: pricedBy,
    quantity_on_property: [],
    sku_on_property: pricedBy,
  };
}
