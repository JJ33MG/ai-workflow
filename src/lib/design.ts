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

/** Renders one side, checks nothing is cut off, and lays it out twice on the full print canvas. */
export async function prepareDesign(svg: string): Promise<Buffer> {
  const side = sideSize();
  const sidePng = await sharp(Buffer.from(svg), { density: 300 })
    .resize(side.width, side.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await checkEdges(sidePng);
  return sharp({
    create: { width: side.width * 2, height: side.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: sidePng, left: 0, top: 0 },
      { input: sidePng, left: side.width, top: 0 },
    ])
    .png()
    .toBuffer();
}

export async function saveDesign(png: Buffer, id: string): Promise<string> {
  await mkdir(designsDir(), { recursive: true });
  const file = `${id}.png`;
  await writeFile(path.join(designsDir(), file), png);
  return file;
}

export const designUrl = (file: string) => `${config.publicUrl}/files/designs/${encodeURIComponent(file)}`;
