import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import { PRINTABLE, productType } from "./lib/catalog.js";
import { designUrl } from "./lib/design.js";
import { DIGITAL_KINDS, type DigitalKind } from "./lib/digital.js";
import { db } from "./db.js";

/** Dutch name of a product type for the dashboard, including printables and downloads. */
function productLabel(type: string): string {
  if (type === PRINTABLE.id) return PRINTABLE.label;
  const kind = type.startsWith("digital-") ? DIGITAL_KINDS[type.slice(8) as DigitalKind] : undefined;
  return kind?.label ?? productType(type)?.label ?? type;
}

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
  /** Exact count per status over all products (products() shows only the newest). */
  productCounts?: () => Promise<Record<string, number>>;
}

function countBy(rows: { status: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

export const BUSINESSES: BusinessDefinition[] = [
  {
    id: "etsy-pod",
    name: "Etsy-winkel",
    kind: "Print-on-demand",
    description: "Tekstontwerpen voor cadeau-niches op mokken, shirts, hoodies, tassen, posters en printbare posters; verkocht op Etsy, gedrukt en verstuurd door Printful.",
    phase: 1,
    channels: ["Etsy", "Printful"],
    targetCents: [1_000_00, 2_000_00],
    plan: "Niches zoeken, ontwerpen en listings maken, publiceren via Etsy, laten drukken door Printful.",
    productCounts: async () => countBy(await db.listing.findMany({ select: { status: true } })),
    products: async () => {
      const listings = await db.listing.findMany({ orderBy: { createdAt: "desc" }, take: 120 });
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
        image: l.designSvg
          ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.designSvg)}`
          : l.productType.startsWith("digital-") && l.designFile
            ? designUrl(l.designFile)
            : (l.imageUrl ?? undefined),
        detail: l.source === "etsy" ? "Uit je Etsy-winkel" : `${productLabel(l.productType)} · ${l.niche}`,
        createdAt: l.createdAt,
        salesCount: l.etsyListingId ? (soldByListing.get(l.etsyListingId) ?? 0) : 0,
      }));
    },
  },
  {
    id: "kdp-coloring",
    name: "Kleurboeken",
    kind: "Zelfpublicatie",
    description: "Kinderkleurboeken, gedrukt op bestelling en verkocht op Amazon via Kindle Direct Publishing.",
    phase: 2,
    channels: ["Amazon KDP"],
    targetCents: [0, 0],
    plan:
      "Thema's kiezen, kleurplaten tekenen, het printklare binnenwerk en de omslag maken, plus titel, beschrijving en zoekwoorden. " +
      "Jarne uploadt elk boek in KDP (geen koppeling mogelijk; KDP staat een paar nieuwe boeken per dag toe).",
    productCounts: async () => countBy(await db.coloringBook.findMany({ select: { status: true } })),
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
    name: "Dropshipping",
    kind: "Webwinkel",
    description: "Webwinkels met trending producten die de leverancier zelf verstuurt.",
    phase: 3,
    channels: ["Shopify (or alternative)", "Ads"],
    targetCents: [5_000_00, 6_000_00],
    plan: "Producten kiezen, de winkel bouwen en bijhouden, teksten en advertenties schrijven, marges bewaken.",
  },
  {
    id: "cartoon-content",
    name: "AI-cartoonkanaal",
    kind: "Content",
    description: "AI-cartoonvideo's en shorts voor YouTube, TikTok en Instagram; stuurt ook bezoekers naar de winkels.",
    phase: 4,
    channels: ["YouTube", "TikTok", "Instagram"],
    targetCents: [1_000_00, 2_000_00],
    plan: "Eerst korte video's voor bereik, daarna lange voor YouTube-inkomsten; advertenties en affiliate-links.",
  },
  {
    id: "roadgem",
    name: "RoamGem",
    kind: "App",
    description: "RoamGem (voorheen Routify en RoadGem): de roadtrip-planner met gems onderweg, Plus-abonnementen en affiliate-links.",
    phase: 5,
    channels: ["RoamGem website/app", "Plus-abonnementen en Trip pass", "Affiliates (Travelpayouts: Tiqets, Klook, Localrent, GetRentacar, Airalo; DiscoverCars; Booking.com via CJ in aanvraag)", "Betalingen via Stripe Managed Payments"],
    targetCents: [0, 0],
    plan: "Soft launch half december met testers, harde lancering eind januari of februari; de stappen staan op de RoamGem-pagina. De RoamGem-agent volgt elke ochtend gebruikers, trips, Plus, kliks en de gem-bibliotheek.",
  },
];

export const businessById = (id: string | null | undefined) => BUSINESSES.find((b) => b.id === id);
