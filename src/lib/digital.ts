// Digital downloads for Etsy: the PDF files a buyer downloads (US Letter and A4) and the listing
// photos that sell them (cover, "what's included", page previews, "how it works"). Pages arrive as
// finished PNGs; everything here is layout, no Claude calls.
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { escapeXml, wrap } from "./coloring.js";

export type DigitalKind = "coloring" | "activity" | "planner";

export interface DigitalKindInfo {
  label: string;
  noun: string;
  pages: number;
  priceCents: number;
  /** Etsy category names to try, first found wins. */
  taxonomy: string[];
  facts: string;
}

/**
 * €7.99 keeps the shop's rule for downloads too: at least €5 profit even at 20% off (no production
 * or shipping, so only Etsy's fees come off).
 */
export const DIGITAL_KINDS: Record<DigitalKind, DigitalKindInfo> = {
  coloring: {
    label: "Kleurplaten (download)",
    noun: "Coloring Pages",
    pages: 24,
    priceCents: 799,
    taxonomy: ["Coloring Pages", "Coloring Books", "Kids' Crafts", "Digital Prints"],
    facts: "Instant digital download, nothing is shipped. Simple bold outlines for young kids, one picture per page, PDF in US Letter and A4. Print at home as often as you like.",
  },
  activity: {
    label: "Activiteitenpakket kids (download)",
    noun: "Printable Activity Pack",
    pages: 12,
    priceCents: 799,
    taxonomy: ["Party Games", "Kids' Crafts", "Games & Puzzles", "Digital Prints"],
    facts: "Instant digital download, nothing is shipped. Printable games and activities for kids, PDF in US Letter and A4. Print at home as often as you like.",
  },
  planner: {
    label: "Planner (download)",
    noun: "Printable Planner",
    pages: 14,
    priceCents: 799,
    taxonomy: ["Planners", "Calendars & Planners", "Templates", "Digital Prints"],
    facts: "Instant digital download, nothing is shipped. Undated pages, so it works for any year: PDF in US Letter and A4. Print as many copies as you need.",
  },
};

export const isDigitalType = (productType: string) => productType.startsWith("digital-");
export const digitalType = (kind: DigitalKind) => `digital-${kind}`;

/** Page sizes in PDF points (1/72 inch). */
const PAPER = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

const BRAND = "All You Can Wish";

/** Etsy's limit per download file is 20 MB. */
const MAX_FILE_BYTES = 19 * 1024 * 1024;

interface EncodedPage {
  bytes: Buffer;
  jpeg: boolean;
  width: number;
  height: number;
}

/** Compresses each page once (PNG with a small palette, or JPEG when a file must get smaller). */
async function encodePages(pages: Buffer[], jpegQuality?: number): Promise<EncodedPage[]> {
  return Promise.all(
    pages.map(async (png) => {
      const flat = sharp(png).flatten({ background: "#ffffff" });
      const { width, height } = await sharp(png).metadata();
      const bytes = jpegQuality
        ? await flat.jpeg({ quality: jpegQuality, mozjpeg: true }).toBuffer()
        : await flat.png({ palette: true, colours: 64, effort: 1, compressionLevel: 9 }).toBuffer();
      return { bytes, jpeg: Boolean(jpegQuality), width: width!, height: height! };
    }),
  );
}

/** A PDF with one page per image, each fitted inside a small margin and centred. */
export async function buildPdf(pages: EncodedPage[], paper: keyof typeof PAPER, title: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer(BRAND);
  pdf.setCreator(BRAND);
  const { width, height } = PAPER[paper];
  const margin = 18; // a quarter inch: home printers can't print to the edge
  for (const p of pages) {
    const image = p.jpeg ? await pdf.embedJpg(p.bytes) : await pdf.embedPng(p.bytes);
    const scale = Math.min((width - 2 * margin) / p.width, (height - 2 * margin) / p.height);
    const w = p.width * scale;
    const h = p.height * scale;
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
  }
  return Buffer.from(await pdf.save());
}

/** Letter and A4 PDFs, smaller (JPEG pages) when a file would pass Etsy's 20 MB limit. */
export async function buildDownloadFiles(pages: Buffer[], title: string): Promise<{ name: string; data: Buffer }[]> {
  for (const quality of [undefined, 85, 70]) {
    const encoded = await encodePages(pages, quality);
    const letter = await buildPdf(encoded, "letter", title);
    const a4 = await buildPdf(encoded, "a4", title);
    if (Math.max(letter.length, a4.length) <= MAX_FILE_BYTES) return [{ name: "US-Letter", data: letter }, { name: "A4", data: a4 }];
  }
  throw new Error("The PDF stays above Etsy's 20 MB limit even with compressed pages");
}

const SIZE = 2000;

/** A light background tint of the accent colour. */
function tint(hex: string, amount = 0.88): string {
  const n = parseInt((/^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "e8d5c4"), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** A page as a thumbnail on white paper with a soft shadow, `w` wide. */
async function paperThumb(page: Buffer, w: number, rotate = 0): Promise<Buffer> {
  const meta = await sharp(page).metadata();
  const h = Math.round((w * meta.height!) / meta.width!);
  const pad = 30;
  const img = await sharp(page).resize(w, h).flatten({ background: "#ffffff" }).png().toBuffer();
  const shadow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter></defs>` +
      `<rect x="${pad + 6}" y="${pad + 12}" width="${w}" height="${h}" fill="#000" opacity="0.18" filter="url(#s)"/></svg>`,
  );
  const framed = await sharp(shadow)
    .composite([{ input: img, left: pad, top: pad }])
    .png()
    .toBuffer();
  return rotate ? sharp(framed).rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() : framed;
}

async function place(images: { input: Buffer; cx: number; cy: number }[]) {
  const out: { input: Buffer; left: number; top: number }[] = [];
  for (const i of images) {
    const m = await sharp(i.input).metadata();
    out.push({ input: i.input, left: Math.round(i.cx - m.width! / 2), top: Math.round(i.cy - m.height! / 2) });
  }
  return out;
}

const textLines = (lines: string[], x: number, y: number, size: number, opts: string) =>
  lines.map((l, i) => `<text x="${x}" y="${y + i * size * 1.15}" text-anchor="middle" font-size="${size}" ${opts}>${escapeXml(l)}</text>`).join("");

export interface PhotoInput {
  coverTitle: string;
  coverSubtitle: string;
  accent: string;
  pages: Buffer[];
  pageTitles: string[];
}

/** Photo 1, the search thumbnail: the title, a fan of three pages and what the buyer gets. */
export async function coverPhoto(p: PhotoInput): Promise<Buffer> {
  const title = wrap(p.coverTitle, 18).slice(0, 2);
  const picks = [p.pages[1] ?? p.pages[0], p.pages[0], p.pages[2] ?? p.pages[0]];
  const thumbs = await Promise.all([paperThumb(picks[0], 600, -8), paperThumb(picks[2], 600, 8), paperThumb(picks[1], 680)]);
  const subtitleY = 230 + (title.length - 1) * 172 + 120;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" fill="${tint(p.accent)}"/>
    ${textLines(title, SIZE / 2, 230, 150, `font-family="serif" font-weight="bold" fill="#1f2a24"`)}
    <text x="${SIZE / 2}" y="${subtitleY}" text-anchor="middle" font-family="sans-serif" font-size="58" fill="#4a4a4a">${escapeXml(p.coverSubtitle)}</text>
    <rect x="${SIZE / 2 - 560}" y="1770" width="1120" height="110" rx="55" fill="${p.accent}"/>
    <text x="${SIZE / 2}" y="1843" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="50" letter-spacing="3" fill="#ffffff">INSTANT DOWNLOAD · ${p.pages.length} PAGES · PDF</text>
  </svg>`;
  const cy = subtitleY + 640;
  return sharp(Buffer.from(svg))
    .composite(await place([{ input: thumbs[0], cx: 540, cy: cy + 30 }, { input: thumbs[1], cx: 1460, cy: cy + 30 }, { input: thumbs[2], cx: 1000, cy }]))
    .png()
    .toBuffer();
}

/** Photo 2: every page (up to 12) in a grid, "+N more" when there are more. */
export async function contentsPhoto(p: PhotoInput): Promise<Buffer> {
  const shown = p.pages.slice(0, p.pages.length > 12 ? 11 : 12);
  const cols = 4;
  const gapX = 50;
  const gapY = 40;
  const meta = await sharp(p.pages[0]).metadata();
  const ratio = meta.height! / meta.width!;
  const rows = Math.ceil((shown.length + (p.pages.length > 12 ? 1 : 0)) / cols);
  // Cells as large as fit both across (4 columns) and down (the rows below the heading).
  const area = { top: 340, bottom: SIZE - 70 };
  const cellH = Math.floor(Math.min(420 * ratio, (area.bottom - area.top - (rows - 1) * gapY) / rows));
  const cellW = Math.floor(cellH / ratio);
  const x0 = (SIZE - (cols * cellW + (cols - 1) * gapX)) / 2;
  const y0 = area.top + Math.max(0, (area.bottom - area.top - (rows * cellH + (rows - 1) * gapY)) / 2);
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  for (const [i, page] of shown.entries()) {
    const img = await sharp(page).resize(cellW - 20, cellH - 20, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer();
    tiles.push({ input: img, left: Math.round(x0 + (i % cols) * (cellW + gapX) + 10), top: Math.round(y0 + Math.floor(i / cols) * (cellH + gapY) + 10) });
  }
  const cards = [...shown.keys()]
    .map((i) => `<rect x="${x0 + (i % cols) * (cellW + gapX)}" y="${y0 + Math.floor(i / cols) * (cellH + gapY)}" width="${cellW}" height="${cellH}" rx="10" fill="#ffffff" stroke="#e0dbd3" stroke-width="3"/>`)
    .join("");
  const more = p.pages.length > 12
    ? (() => {
        const i = shown.length;
        const x = x0 + (i % cols) * (cellW + gapX);
        const y = y0 + Math.floor(i / cols) * (cellH + gapY);
        return `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="10" fill="${p.accent}"/>` +
          `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 30}" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="90" fill="#fff">+${p.pages.length - shown.length}</text>` +
          `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 100}" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#fff">more pages</text>`;
      })()
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" fill="${tint(p.accent, 0.92)}"/>
    <text x="${SIZE / 2}" y="190" text-anchor="middle" font-family="serif" font-size="110" fill="#1f2a24">What's included</text>
    <text x="${SIZE / 2}" y="270" text-anchor="middle" font-family="sans-serif" font-size="52" fill="#5b5b5b">${p.pages.length} printable pages</text>
    ${cards}${more}
  </svg>`;
  return sharp(Buffer.from(svg)).composite(tiles).png().toBuffer();
}

/** Photos 3+: one page large, with its name. */
export async function pagePhoto(p: PhotoInput, index: number): Promise<Buffer> {
  const thumb = await paperThumb(p.pages[index], 1180);
  const name = p.pageTitles[index] ?? "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" fill="${tint(p.accent, 0.9)}"/>
    <text x="${SIZE / 2}" y="1935" text-anchor="middle" font-family="sans-serif" font-size="50" fill="#4a4a4a">${escapeXml(name.slice(0, 60))}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).composite(await place([{ input: thumb, cx: SIZE / 2, cy: 940 }])).png().toBuffer();
}

/** The last photo: how a download works, so nobody expects a parcel. */
export async function howItWorksPhoto(accent: string): Promise<Buffer> {
  const steps = [
    ["1", "Buy", "No waiting and no shipping"],
    ["2", "Download", "Etsy sends the PDF files right away"],
    ["3", "Print", "At home, as often as you like"],
  ];
  const rows = steps
    .map(([n, head, line], i) => {
      const y = 560 + i * 380;
      return `<circle cx="470" cy="${y}" r="110" fill="${accent}"/>` +
        `<text x="470" y="${y + 42}" text-anchor="middle" font-family="serif" font-weight="bold" font-size="120" fill="#fff">${n}</text>` +
        `<text x="650" y="${y - 10}" font-family="serif" font-weight="bold" font-size="96" fill="#1f2a24">${head}</text>` +
        `<text x="650" y="${y + 75}" font-family="sans-serif" font-size="54" fill="#5b5b5b">${escapeXml(line)}</text>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" fill="${tint(accent, 0.9)}"/>
    <text x="${SIZE / 2}" y="250" text-anchor="middle" font-family="serif" font-size="130" fill="#1f2a24">How it works</text>
    ${rows}
    <text x="${SIZE / 2}" y="1640" text-anchor="middle" font-family="sans-serif" font-size="54" fill="#3c3c3c">US Letter and A4 PDF included</text>
    <text x="${SIZE / 2}" y="1720" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#7a7a7a">Digital file only: no physical item is shipped. For personal use.</text>
    <text x="${SIZE / 2}" y="1880" text-anchor="middle" font-family="serif" font-style="italic" font-size="46" fill="#9b9b9b">${BRAND}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** All listing photos in Etsy order (cover first: it is the search thumbnail). */
export async function listingPhotos(p: PhotoInput): Promise<Buffer[]> {
  const previews = [0, Math.min(3, p.pages.length - 1)].filter((v, i, a) => a.indexOf(v) === i);
  return [await coverPhoto(p), await contentsPhoto(p), ...(await Promise.all(previews.map((i) => pagePhoto(p, i)))), await howItWorksPhoto(p.accent)];
}
