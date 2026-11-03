// Print layout for KDP coloring books: page rendering, the interior PDF and the
// full-wrap cover PDF. Paperback, 8.5 × 11 in, black-and-white interior, no bleed.
// All text is drawn into images, so the PDFs contain no fonts (KDP rejects
// PDFs with fonts that are not embedded).
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export const DPI = 300;
export const TRIM = { width: 8.5, height: 11 }; // inches
export const BLEED = 0.125; // cover only; the interior has no bleed
const PAGE_MARGIN = 0.6; // inches, well inside KDP's minimum for books under 150 pages
const SPINE_PER_PAGE = 0.002252; // inches per page, black-and-white on white paper
export const MIN_PAGES = 24; // KDP's minimum for a paperback
export const SPINE_TEXT_MIN_PAGES = 80; // KDP doesn't allow spine text on thinner books

const px = (inches: number) => Math.round(inches * DPI);
const pt = (inches: number) => inches * 72;

/** The area a picture may use on an interior page, in pixels at 300 dpi. */
export const artBox = () => ({
  width: px(TRIM.width - 2 * PAGE_MARGIN),
  height: px(TRIM.height - 2 * PAGE_MARGIN),
});

export const spineWidth = (pageCount: number) => pageCount * SPINE_PER_PAGE;

/** Full cover size in inches: back + spine + front, with bleed on every side. */
export function coverSize(pageCount: number) {
  return {
    width: 2 * BLEED + 2 * TRIM.width + spineWidth(pageCount),
    height: 2 * BLEED + TRIM.height,
  };
}

/**
 * Interior page count for a book with `pictures` coloring pages: title page, "this book
 * belongs to", each picture on a right-hand page with a blank back (so markers don't
 * bleed through onto the next picture), a closing page, padded to an even count ≥ 24.
 */
export function interiorPageCount(pictures: number): number {
  const raw = 2 + pictures * 2 + 1;
  return Math.max(MIN_PAGES, raw + (raw % 2));
}

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Greedy word wrap by character count; good enough for titles and blurbs. */
export function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** A dark pixel within this share of an edge means the drawing is cut off. */
const EDGE_BAND = 0.012;

/** Renders a page SVG into the art box as a greyscale PNG on white. */
export async function renderPage(svg: string): Promise<Buffer> {
  const box = artBox();
  return sharp(Buffer.from(svg), { density: 300 })
    .resize(box.width, box.height, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .png()
    .toBuffer();
}

/** Edges of the page where ink touches the border (the drawing runs off the page). */
export async function inkedEdges(png: Buffer): Promise<string[]> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bx = Math.max(2, Math.round(width * EDGE_BAND));
  const by = Math.max(2, Math.round(height * EDGE_BAND));
  const hits = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x < bx ? "left" : x >= width - bx ? "right" : y < by ? "top" : y >= height - by ? "bottom" : null;
      if (edge && !hits.has(edge) && data[(y * width + x) * channels] < 128) hits.add(edge);
    }
  }
  return [...hits];
}

/** A page with centred text lines, drawn as an image. */
async function textPage(lines: { text: string; size: number; bold?: boolean; gap?: number }[]): Promise<Buffer> {
  const box = artBox();
  let y = box.height * 0.3;
  const parts: string[] = [];
  for (const l of lines) {
    for (const row of wrap(l.text, Math.floor(box.width / (l.size * 0.55)))) {
      parts.push(
        `<text x="${box.width / 2}" y="${y}" font-family="sans-serif" font-size="${l.size}" ` +
          `font-weight="${l.bold ? 700 : 400}" text-anchor="middle" fill="#000">${escapeXml(row)}</text>`,
      );
      y += l.size * 1.3;
    }
    y += l.gap ?? l.size * 0.6;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><rect width="100%" height="100%" fill="#fff"/>${parts.join("")}</svg>`;
  return sharp(Buffer.from(svg)).greyscale().png().toBuffer();
}

async function belongsToPage(): Promise<Buffer> {
  const box = artBox();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">
    <rect width="100%" height="100%" fill="#fff"/>
    <rect x="${box.width * 0.1}" y="${box.height * 0.3}" width="${box.width * 0.8}" height="${box.height * 0.32}" rx="60" fill="#fff" stroke="#000" stroke-width="14"/>
    <text x="${box.width / 2}" y="${box.height * 0.4}" font-family="sans-serif" font-size="130" font-weight="700" text-anchor="middle">This book belongs to:</text>
    <line x1="${box.width * 0.2}" y1="${box.height * 0.53}" x2="${box.width * 0.8}" y2="${box.height * 0.53}" stroke="#000" stroke-width="8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).greyscale().png().toBuffer();
}

export interface BookText {
  title: string;
  subtitle: string;
  author: string;
}

/** Builds the interior PDF from rendered picture pages (PNG buffers from renderPage). */
export async function buildInterior(pictures: Buffer[], book: BookText): Promise<{ pdf: Uint8Array; pageCount: number }> {
  const doc = await PDFDocument.create();
  const blank = await textPage([]);
  const pages: Buffer[] = [
    await textPage([
      { text: book.title, size: 150, bold: true },
      { text: book.subtitle, size: 80 },
      { text: `by ${book.author}`, size: 70, gap: 0 },
    ]),
    await belongsToPage(),
  ];
  for (const p of pictures) pages.push(p, blank);
  pages.push(
    await textPage([
      { text: "Great job!", size: 150, bold: true },
      { text: "We hope you loved coloring these pictures.", size: 75 },
    ]),
  );
  const pageCount = interiorPageCount(pictures.length);
  while (pages.length < pageCount) pages.push(blank);

  const box = artBox();
  const embedded = new Map<Buffer, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const png of pages) {
    const page = doc.addPage([pt(TRIM.width), pt(TRIM.height)]);
    let img = embedded.get(png);
    if (!img) {
      img = await doc.embedPng(png);
      embedded.set(png, img);
    }
    page.drawImage(img, {
      x: pt(PAGE_MARGIN),
      y: pt(PAGE_MARGIN),
      width: pt(box.width / DPI),
      height: pt(box.height / DPI),
    });
  }
  return { pdf: await doc.save(), pageCount };
}

export interface CoverInput extends BookText {
  ageRange: string;
  blurb: string;
  pageCount: number;
  pictures: number;
  /** Colour illustration for the front, any size; it is fitted into the art area. */
  frontArt: Buffer;
  /** Background colour of the cover, e.g. "#ffd23f". */
  color: string;
}

/** Builds the full-wrap cover as one 300 dpi image, then wraps it in a single-page PDF. */
export async function buildCover(c: CoverInput): Promise<{ pdf: Uint8Array; png: Buffer; front: Buffer }> {
  const size = coverSize(c.pageCount);
  const W = px(size.width);
  const H = px(size.height);
  const spine = px(spineWidth(c.pageCount));
  const trimW = px(TRIM.width);
  const bleed = px(BLEED);
  const backX = bleed;
  const frontX = bleed + trimW + spine;
  const safe = px(0.375); // keep text this far inside the trim

  const titleLines = wrap(c.title, 18).slice(0, 3);
  const titleSize = titleLines.length > 2 ? 190 : 230;
  const title = titleLines
    .map(
      (l, i) =>
        `<text x="${frontX + trimW / 2}" y="${bleed + safe + 230 + i * titleSize * 1.08}" font-family="sans-serif" font-size="${titleSize}" font-weight="900" text-anchor="middle" fill="#ffffff" stroke="#1d1d1d" stroke-width="16" paint-order="stroke" stroke-linejoin="round">${escapeXml(l)}</text>`,
    )
    .join("");
  const titleBottom = bleed + safe + 230 + (titleLines.length - 1) * titleSize * 1.08 + 60;
  const subtitle = wrap(c.subtitle, 40)
    .slice(0, 2)
    .map(
      (l, i) =>
        `<text x="${frontX + trimW / 2}" y="${titleBottom + 110 + i * 105}" font-family="sans-serif" font-size="88" font-weight="700" text-anchor="middle" fill="#1d1d1d">${escapeXml(l)}</text>`,
    )
    .join("");
  const artTop = Math.round(titleBottom + 330);
  const artBottom = H - bleed - safe - 230;
  const artW = trimW - 2 * safe;
  const artH = artBottom - artTop;

  const blurb = wrap(c.blurb, 44)
    .slice(0, 14)
    .map(
      (l, i) =>
        `<text x="${backX + safe + 60}" y="${bleed + safe + 520 + i * 105}" font-family="sans-serif" font-size="78" fill="#1d1d1d">${escapeXml(l)}</text>`,
    )
    .join("");
  // KDP prints the barcode bottom-right on the back cover: keep 2 × 1.2 in clear (white).
  const barcode = { w: px(2), h: px(1.2), x: backX + trimW - safe - px(2), y: H - bleed - safe - px(1.2) };
  const spineText =
    c.pageCount >= SPINE_TEXT_MIN_PAGES
      ? `<text transform="translate(${bleed + trimW + spine / 2},${H / 2}) rotate(90)" font-family="sans-serif" font-size="${Math.min(70, spine * 0.6)}" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="#1d1d1d">${escapeXml(c.title)}</text>`
      : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${escapeXml(c.color)}"/>
    <rect x="${frontX + safe}" y="${artTop - 40}" width="${artW}" height="${artH + 80}" rx="80" fill="#ffffff"/>
    ${title}${subtitle}
    <text x="${frontX + trimW / 2}" y="${H - bleed - safe - 80}" font-family="sans-serif" font-size="80" font-weight="700" text-anchor="middle" fill="#1d1d1d">${escapeXml(`For kids ages ${c.ageRange} · ${c.pictures} pictures to color`)}</text>
    <rect x="${backX + safe}" y="${bleed + safe + 250}" width="${trimW - 2 * safe}" height="${14 * 105 + 400}" rx="60" fill="#ffffff"/>
    <text x="${backX + safe + 60}" y="${bleed + safe + 400}" font-family="sans-serif" font-size="100" font-weight="900" fill="#1d1d1d">${escapeXml(c.title.length > 30 ? "About this book" : c.title)}</text>
    ${blurb}
    <rect x="${barcode.x}" y="${barcode.y}" width="${barcode.w}" height="${barcode.h}" fill="#ffffff"/>
    ${spineText}
  </svg>`;

  const art = await sharp(c.frontArt)
    .resize(artW - 80, artH, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const png = await sharp(Buffer.from(svg))
    .composite([{ input: art, left: frontX + safe + 40, top: artTop }])
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const front = await sharp(png).extract({ left: frontX, top: bleed, width: trimW, height: px(TRIM.height) }).jpeg({ quality: 85 }).toBuffer();

  const doc = await PDFDocument.create();
  const page = doc.addPage([pt(size.width), pt(size.height)]);
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 0, y: 0, width: pt(size.width), height: pt(size.height) });
  return { pdf: await doc.save(), png, front };
}
