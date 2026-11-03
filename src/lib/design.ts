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

/** A mug is printed with the same design on both sides: each design is drawn for one half. */
export const sideSize = () => ({ width: Math.round(config.pod.designWidth / 2), height: config.pod.designHeight });

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

/** How much of one side of the mug a design may fill. */
const FILL_WIDTH = 0.86;
const FILL_HEIGHT = 0.8;

function viewBoxOf(svg: string): [number, number, number, number] {
  const m = svg.match(/<svg\b[^>]*\bviewBox\s*=\s*["']([^"']+)["']/i);
  const v = m?.[1].trim().split(/[\s,]+/).map(Number);
  if (!v || v.length !== 4 || v.some(Number.isNaN)) throw new Error("Design SVG has no usable viewBox");
  return v as [number, number, number, number];
}

function withViewBox(svg: string, [x, y, w, h]: number[], width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) =>
    tag
      .replace(/\s(viewBox|width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, "")
      .replace(/<svg/i, `<svg viewBox="${x} ${y} ${w} ${h}" width="${width}" height="${height}"`),
  );
}

/**
 * Redraws the design so its content fills one side of the mug: crops the SVG's viewBox to
 * what is actually drawn, then renders that at the largest size that fits. Vector redraw,
 * so it stays sharp. Older designs drawn as two copies side by side use their left copy.
 */
export async function fitToSide(svg: string): Promise<Buffer> {
  const side = sideSize();
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
  const box = [vx + left / scale - pad, vy + top / scale - pad, (right - left + 1) / scale + 2 * pad, (bottom - top + 1) / scale + 2 * pad];
  const fit = Math.min((side.width * FILL_WIDTH) / box[2], (side.height * FILL_HEIGHT) / box[3]);
  const w = Math.round(box[2] * fit);
  const h = Math.round(box[3] * fit);
  const content = await sharp(Buffer.from(withViewBox(svg, box, w, h)), { density: 300 }).resize(w, h).png().toBuffer();
  return sharp({ create: { width: side.width, height: side.height, channels: 4, background: TRANSPARENT } })
    .composite([{ input: content, left: Math.round((side.width - w) / 2), top: Math.round((side.height - h) / 2) }])
    .png()
    .toBuffer();
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

export async function saveDesign(png: Buffer, id: string): Promise<string> {
  await mkdir(designsDir(), { recursive: true });
  const file = `${id}.png`;
  await writeFile(path.join(designsDir(), file), png);
  return file;
}

export const designUrl = (file: string) => `${config.publicUrl}/files/designs/${encodeURIComponent(file)}`;
