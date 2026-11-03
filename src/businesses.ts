import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
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
  /** Deliberately on hold: shown, but not part of the current roadmap. */
  parked?: boolean;
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
    id: "kdp-coloring",
    name: "Coloring books on Amazon KDP",
    kind: "Self-publishing",
    description: "Coloring books for adults and kids, printed on demand and sold on Amazon through Kindle Direct Publishing.",
    phase: 2,
    channels: ["Amazon KDP"],
    targetCents: [0, 0],
    plan:
      "Pick themes, generate the line-art pages, the print-ready interior PDF and cover, plus title, description and keywords. " +
      "Jarne uploads each book in KDP (no publishing API; KDP allows a few new titles per day).",
    products: async () => {
      const books = await db.coloringBook.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
      return Promise.all(
        books.map(async (b) => {
          let image: string | undefined;
          try {
            const cover = await readFile(path.resolve(config.storageDir, "books", b.id, "cover-front.jpg"));
            const thumb = await sharp(cover).resize(360).jpeg({ quality: 70 }).toBuffer();
            image = `data:image/jpeg;base64,${thumb.toString("base64")}`;
          } catch {
            // no cover yet (still drawing, or failed)
          }
          const pages = (b.pages as { status: string }[]).filter((p) => p.status === "ok").length;
          return {
            id: b.id,
            title: b.title,
            status: b.status,
            priceCents: b.priceCents,
            currency: b.currency,
            image,
            detail: `${b.theme} · ages ${b.ageRange} · ${pages} pictures`,
            createdAt: b.createdAt,
            salesCount: 0, // KDP has no sales API; sales are entered from the KDP report
          };
        }),
      );
    },
  },
  {
    id: "dropshipping",
    name: "Dropshipping stores",
    kind: "E-commerce",
    description: "Online stores selling trending products shipped directly by suppliers.",
    phase: 3,
    channels: ["Shopify (or alternative)", "Ads"],
    targetCents: [5_000_00, 6_000_00],
    plan: "Pick products, build and update the store, write listings and ad copy, track margins.",
  },
  {
    id: "cartoon-content",
    name: "AI cartoon channel",
    kind: "Content",
    description: "AI cartoon videos and shorts for YouTube, TikTok and Instagram; also sends traffic to the shops.",
    phase: 4,
    channels: ["YouTube", "TikTok", "Instagram"],
    targetCents: [1_000_00, 2_000_00],
    plan: "Short-form first for reach, long-form for YouTube monetisation; ads and affiliate revenue.",
  },
  {
    id: "roadgem",
    name: "RoadGem",
    kind: "App",
    description: "The RoadGem road-trip planner: growth, content and support.",
    phase: 5,
    channels: ["roadgem app", "Premium subscriptions", "Affiliates"],
    targetCents: [0, 0],
    plan: "On hold: money first from simpler businesses (print-on-demand, coloring books, dropshipping).",
    parked: true,
  },
];

export const businessById = (id: string | null | undefined) => BUSINESSES.find((b) => b.id === id);
