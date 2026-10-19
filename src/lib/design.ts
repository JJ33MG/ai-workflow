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
  const forbidden = [/<script/i, /<foreignObject/i, /<image/i, /\son\w+\s*=/i, /(xlink:)?href\s*=/i, /url\(\s*['"]?(?!#)/i, /@import/i];
  for (const re of forbidden) {
    if (re.test(svg)) throw new Error(`Design SVG contains a forbidden construct: ${re}`);
  }
  return svg;
}

/** Renders SVG to a transparent PNG at the print size and saves it. Returns the file name. */
export async function renderDesign(svg: string, id: string): Promise<{ file: string; png: Buffer }> {
  const png = await sharp(Buffer.from(svg), { density: 300 })
    .resize(config.pod.designWidth, config.pod.designHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  await mkdir(designsDir(), { recursive: true });
  const file = `${id}.png`;
  await writeFile(path.join(designsDir(), file), png);
  return { file, png };
}

export const designUrl = (file: string) => `${config.publicUrl}/files/designs/${encodeURIComponent(file)}`;
