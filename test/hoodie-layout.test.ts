import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderPrintFile } from "../src/lib/design.js";

// A five-line slogan like the personalized hoodies ("Inhale Cocoa / Exhale Chaos / MEGAN / ...").
const SLOGAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  ${["Inhale Cocoa", "Exhale Chaos", "MEGAN", "Respiratory", "Therapist"]
    .map((t, i) => `<text x="500" y="${300 + i * 100}" text-anchor="middle" font-family="sans-serif" font-size="80" fill="#000">${t}</text>`)
    .join("")}
</svg>`;

async function inkBox(png: Buffer) {
  const { info } = await sharp(png).trim().toBuffer({ resolveWithObject: true });
  const meta = await sharp(png).metadata();
  return { w: info.width / meta.width!, h: info.height / meta.height!, top: -(info.trimOffsetTop ?? 0) / meta.height!, left: -(info.trimOffsetLeft ?? 0) / meta.width! };
}

describe("chest print on a hoodie (wide print area)", () => {
  it("prints the slogan large and centred on the chest, not squeezed under the collar", async () => {
    const box = await inkBox(await renderPrintFile(SLOGAN, "chest", 2250, 1800, "dark"));
    expect(box.h).toBeGreaterThan(0.6); // large: well over half of the area
    expect(box.top).toBeGreaterThan(0.18); // was 6% from the top edge: sits mid-chest, below the collar
    expect(Math.abs(box.left + box.w / 2 - 0.5)).toBeLessThan(0.02); // centred left to right
  });
});

describe("chest print on a large square hoodie area", () => {
  it("stays a normal chest size: at most about 11 x 10 inches at 150 dpi", async () => {
    const png = await renderPrintFile(SLOGAN, "chest", 3600, 3600, "dark");
    const { info } = await sharp(png).trim().toBuffer({ resolveWithObject: true });
    expect(info.width).toBeLessThanOrEqual(11 * 150 + 2);
    expect(info.height).toBeLessThanOrEqual(10 * 150 + 2);
  });
});

describe("chest print on a T-shirt (tall print area)", () => {
  it("keeps the slogan near the top of the shirt's chest area", async () => {
    const box = await inkBox(await renderPrintFile(SLOGAN, "chest", 1800, 2400, "dark"));
    expect(box.top).toBeLessThan(0.1);
  });
});
