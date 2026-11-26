import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.js";

export const designsDir = () => path.resolve(config.storageDir, "designs");

/**
 * Rejects SVG that could pull in external resources or run script. Designs are
 * typography only, so anything beyond shapes and text is refused.
 */
export function sanitizeSvg(raw: string): string {
  const match = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) throw new Error("Design output did not contain an <svg> element");
  const svg = match[0];
  const forbidden = [/<script/i, /<foreignObject/i, /<image/i, /\son\w+\s*=/i, /(xlink:)?href\s*=\s*["'](?!#)/i, /url\(\s*['"]?(?!#)/i, /@import/i];
  for (const re of forbidden) {
    if (re.test(svg)) throw new Error(`Design SVG contains a forbidden construct: ${re}`);
  }
  return svg;
}

/** Full print-file size in pixels; replaced by Printful's real size once that has been looked up. */
const printSize = { width: config.pod.designWidth, height: config.pod.designHeight };
export function setPrintSize(width: number, height: number) {
  printSize.width = width;
  printSize.height = height;
}
export const getPrintSize = () => ({ ...printSize });

/** A mug is printed with the same design on both sides: each design is drawn for one half. */
export const sideSize = () => ({ width: Math.round(printSize.width / 2), height: printSize.height });

/** The rendered design runs off its canvas (usually text wider than the agent expected). */
export class DesignLayoutError extends Error {
  constructor(public edges: string[]) {
    super(`Design touches the ${edges.join(" and ")} edge${edges.length > 1 ? "s" : ""}: content is cut off`);
    this.name = "DesignLayoutError";
  }
}

const EDGE_BAND = 0.015; // 1.5% of each side must stay empty

/** Throws DesignLayoutError when any visible pixel sits in the empty band along an edge. */
export async function checkEdges(png: Buffer): Promise<void> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bx = Math.max(2, Math.round(width * EDGE_BAND));
  const by = Math.max(2, Math.round(height * EDGE_BAND));
  const inked = (x: number, y: number) => data[(y * width + x) * channels + channels - 1] > 40;
  const hits = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x < bx ? "left" : x >= width - bx ? "right" : y < by ? "top" : y >= height - by ? "bottom" : null;
      if (edge && !hits.has(edge) && inked(x, y)) hits.add(edge);
    }
  }
  if (hits.size) throw new DesignLayoutError([...hits]);
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Moves the visible content to the middle of its canvas. Agents often draw a design
 * high on the canvas, which would leave an empty band at the bottom of the mug.
 */
export async function centerContent(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + channels - 1] > 40) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return png; // empty design: nothing to centre
  const w = right - left + 1;
  const h = bottom - top + 1;
  const content = await sharp(png).extract({ left, top, width: w, height: h }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: TRANSPARENT } })
    .composite([{ input: content, left: Math.round((width - w) / 2), top: Math.round((height - h) / 2) }])
    .png()
    .toBuffer();
}

/** Places one side twice on the full print canvas, so the design shows on both sides of the mug. */
export async function mirrorSides(sidePng: Buffer): Promise<Buffer> {
  const { width, height } = await sharp(sidePng).metadata();
  return sharp({ create: { width: width! * 2, height: height!, channels: 4, background: TRANSPARENT } })
    .composite([
      { input: sidePng, left: 0, top: 0 },
      { input: sidePng, left: width!, top: 0 },
    ])
    .png()
    .toBuffer();
}

/**
 * How much of one side of the mug a design may fill. The front of a mug only shows about
 * two thirds of each side; wider designs look cut off in Printful's product photos.
 */
const FILL_WIDTH = 0.66;
const FILL_HEIGHT = 0.8;

export function viewBoxOf(svg: string): [number, number, number, number] {
  const m = svg.match(/<svg\b[^>]*\bviewBox\s*=\s*["']([^"']+)["']/i);
  const v = m?.[1].trim().split(/[\s,]+/).map(Number);
  if (!v || v.length !== 4 || v.some(Number.isNaN)) throw new Error("Design SVG has no usable viewBox");
  return v as [number, number, number, number];
}

export function withViewBox(svg: string, [x, y, w, h]: number[], width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) =>
    tag
      .replace(/\s(viewBox|width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, "")
      .replace(/<svg/i, `<svg viewBox="${x} ${y} ${w} ${h}" width="${width}" height="${height}"`),
  );
}

/** The drawn part of an SVG, in its own viewBox units (left copy only for old two-copy designs). */
async function contentBox(svg: string): Promise<[number, number, number, number]> {
  const [vx, vy, vw, vh] = viewBoxOf(svg);
  const scale = 2; // render the original at 2 px per unit to measure it precisely
  // Default density: one SVG pixel per output pixel, so the width/height set here is the real size.
  const full = await sharp(Buffer.from(withViewBox(svg, [vx, vy, vw, vh], vw * scale, vh * scale))).png().toBuffer();
  const twoCopies = vw > vh * 1.9;
  const region = await sharp(full)
    .extract({ left: 0, top: 0, width: Math.round((twoCopies ? vw / 2 : vw) * scale), height: Math.round(vh * scale) })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = region;
  let top = info.height, bottom = -1, left = info.width, right = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + info.channels - 1] > 20) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) throw new Error("Design is empty");
  const pad = 2 / scale; // a little air around strokes
  return [vx + left / scale - pad, vy + top / scale - pad, (right - left + 1) / scale + 2 * pad, (bottom - top + 1) / scale + 2 * pad];
}

/**
 * SVG text is drawn at `density` and then scaled to the target size: oversampling makes small
 * sizes crisper, but a poster drawn at 300 dpi would be hundreds of megapixels, more than sharp
 * accepts. Large outputs are already sharp at a lower density, so it scales down with the size.
 */
export function renderDensity(width: number, height: number, budgetPixels = 60_000_000): number {
  const scale = Math.sqrt(budgetPixels / Math.max(1, width * height)); // allowed oversampling factor
  return Math.round(Math.min(300, Math.max(72, 72 * scale)));
}

/**
 * Draws the design's content as large as fits in maxW × maxH (vector redraw, so it stays sharp)
 * and places it on a transparent canvas of width × height at the given top (or centred).
 */
async function placeContent(svg: string, width: number, height: number, maxW: number, maxH: number, top: number | "center" | "chest-centre"): Promise<Buffer> {
  const box = await contentBox(svg);
  const fit = Math.min(maxW / box[2], maxH / box[3]);
  const w = Math.max(1, Math.round(box[2] * fit));
  const h = Math.max(1, Math.round(box[3] * fit));
  const content = await sharp(Buffer.from(withViewBox(svg, box, w, h)), { density: renderDensity(w, h) }).resize(w, h).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: TRANSPARENT }, limitInputPixels: false })
    .composite([{ input: content, left: Math.round((width - w) / 2), top: top === "center" ? Math.round((height - h) / 2) : top === "chest-centre" ? Math.round((height - h) * 0.65) : Math.round(top) }])
    .png()
    .toBuffer();
}

/**
 * Redraws the design so its content fills one side of the mug: crops the SVG's viewBox to
 * what is actually drawn, then renders that at the largest size that fits. Vector redraw,
 * so it stays sharp. Older designs drawn as two copies side by side use their left copy.
 */
export async function fitToSide(svg: string, side = sideSize()): Promise<Buffer> {
  return placeContent(svg, side.width, side.height, side.width * FILL_WIDTH, side.height * FILL_HEIGHT, "center");
}

/**
 * Light ink for dark products: every dark colour in the design (text, lines) becomes white;
 * lighter accent colours stay. Designs are made with dark ink for white products.
 */
export function lightInk(svg: string): string {
  const dark = (hex: string) => {
    const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1);
    const n = parseInt(h, 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35;
  };
  return svg
    .replace(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi, (hex) => (dark(hex) ? "#ffffff" : hex))
    .replace(/((?:fill|stroke|stop-color|color)\s*[:=]\s*["']?)black\b/gi, "$1#ffffff");
}

/** One print file for a product: the design laid out for its print area, in dark or light ink. */
export async function renderPrintFile(
  svg: string,
  layout: "mug-wrap" | "chest" | "center" | "round",
  width: number,
  height: number,
  ink: "dark" | "light",
  /** Pixels per inch of the print file: Printful uses 150, Printify 300. */
  dpi = 150,
): Promise<Buffer> {
  const art = ink === "light" ? lightInk(svg) : svg;
  if (layout === "mug-wrap") return mirrorSides(await fitToSide(art, { width: Math.round(width / 2), height }));
  // On a garment every design hangs from the same line on the chest, whatever its shape (Jarne: some sat
  // under the collar, others on the pocket). Printful print files are 150 dpi.
  if (layout === "chest") {
    const IN = dpi;
    if (width >= height * 0.9) {
      // Hoodie: the area is wider than tall and the pouch pocket sits below it. Top 1 in below the area's
      // top edge, at most 11 in wide and 7.5 in tall, so it ends well above the pocket.
      return placeContent(art, width, height, Math.min(width * 0.78, 11 * IN), Math.min(height * 0.62, 7.5 * IN), Math.round(1 * IN));
    }
    // T-shirt and sweater: a tall area that starts near the collar. Top 2.5 in down (about 3.5 in below the
    // collar, where printed shirts put it), up to 11.5 in wide and 9 in tall.
    return placeContent(art, width, height, Math.min(width * 0.9, 11.5 * IN), Math.min(height * 0.56, 9 * IN), Math.round(2.5 * IN));
  }
  // A round ornament: a square inside the circle is 71% of its width; keep a margin inside that.
  if (layout === "round") return placeContent(art, width, height, width * 0.64, height * 0.64, "center");
  return placeContent(art, width, height, width * 0.8, height * 0.7, "center");
}

/** A printable wall-art file: the design centred on white, as a high-quality JPG. */
export async function renderPrintable(svg: string, width: number, height: number): Promise<Buffer> {
  const art = await placeContent(svg, width, height, width * 0.8, height * 0.6, "center");
  return sharp(art, { limitInputPixels: false }).flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Renders one side, checks nothing is cut off, fills the mug face with it, and lays it out twice. */
export async function prepareDesign(svg: string): Promise<Buffer> {
  const side = sideSize();
  const sidePng = await sharp(Buffer.from(svg), { density: 300 })
    .resize(side.width, side.height, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
  await checkEdges(sidePng);
  return mirrorSides(await fitToSide(svg));
}

/** A file name that changes with the content: Printful caches files by address, so a redrawn file needs a new one. */
export const versionedId = (id: string, content: Buffer) => `${id}-${createHash("sha256").update(content).digest("hex").slice(0, 10)}`;

export async function saveDesign(png: Buffer, id: string, ext: "png" | "jpg" = "png"): Promise<string> {
  await mkdir(designsDir(), { recursive: true });
  const file = `${versionedId(id, png)}.${ext}`;
  await writeFile(path.join(designsDir(), file), png);
  return file;
}

export const designUrl = (file: string) => `${config.publicUrl}/files/designs/${encodeURIComponent(file)}`;
