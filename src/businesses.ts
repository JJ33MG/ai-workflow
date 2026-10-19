import { db } from "./db.js";

// Every business the company runs or plans to run (from the build brief).
// Agents point at a business with `businessId`; revenue and costs of a business
// are the sales and costs recorded by its agents.

export interface Product {
  id: string;
  title: string;
  status: string; // draft | uploaded | active | failed …
  priceCents: number;
  currency: string;
  /** Inline image (sanitised SVG design) or URL. */
  image?: string;
  detail?: string;
  createdAt: Date;
  salesCount: number;
}

export interface BusinessDefinition {
  id: string;
  name: string;
  kind: string;
  description: string;
  phase: number;
  /** Channels it sells or publishes on. */
  channels: string[];
  /** Monthly revenue target range from the brief, in EUR cents. */
  targetCents: [number, number];
  /** What its agent will do; shown for planned businesses. */
  plan: string;
  products?: () => Promise<Product[]>;
}

export const BUSINESSES: BusinessDefinition[] = [
  {
    id: "etsy-pod",
    name: "Etsy print-on-demand shop",
    kind: "Print-on-demand",
    description: "Typography mugs for gift niches, sold on Etsy and printed and shipped by Printful.",
    phase: 1,
    channels: ["Etsy", "Printful"],
    targetCents: [1_000_00, 2_000_00],
    plan: "Research niches, generate designs and listings, publish via the Etsy API, fulfil via Printful.",
    products: async () => {
      const listings = await db.listing.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
      const sales = await db.sale.findMany({ where: { source: "etsy" }, select: { data: true } });
      const soldByListing = new Map<string, number>();
      for (const s of sales) {
        const tx = (s.data as { transactions?: { listing_id: number; quantity: number }[] } | null)?.transactions ?? [];
        for (const t of tx) soldByListing.set(String(t.listing_id), (soldByListing.get(String(t.listing_id)) ?? 0) + t.quantity);
      }
      return listings.map((l) => ({
        id: l.id,
        title: l.title,
        status: l.status,
        priceCents: l.priceCents,
        currency: l.currency,
        image: l.designSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.designSvg)}` : undefined,
        detail: l.niche,
        createdAt: l.createdAt,
        salesCount: l.etsyListingId ? (soldByListing.get(l.etsyListingId) ?? 0) : 0,
      }));
    },
  },
  {
    id: "dropshipping",
    name: "Dropshipping stores",
    kind: "E-commerce",
    description: "Online stores selling trending products shipped directly by suppliers.",
    phase: 2,
    channels: ["Shopify (or alternative)", "Ads"],
    targetCents: [5_000_00, 6_000_00],
    plan: "Pick products, build and update the store, write listings and ad copy, track margins.",
  },
  {
    id: "cartoon-content",
    name: "AI cartoon channel",
    kind: "Content",
    description: "AI cartoon videos and shorts for YouTube, TikTok and Instagram; also sends traffic to the shops.",
    phase: 3,
    channels: ["YouTube", "TikTok", "Instagram"],
    targetCents: [1_000_00, 2_000_00],
    plan: "Short-form first for reach, long-form for YouTube monetisation; ads and affiliate revenue.",
  },
  {
    id: "roadgem",
    name: "RoadGem",
    kind: "App",
    description: "The RoadGem road-trip planner: growth, content and support.",
    phase: 4,
    channels: ["roadgem app", "Premium subscriptions", "Affiliates"],
    targetCents: [0, 0],
    plan: "Growth, content and support for the RoadGem app once the core businesses are profitable.",
  },
];

export const businessById = (id: string | null | undefined) => BUSINESSES.find((b) => b.id === id);
