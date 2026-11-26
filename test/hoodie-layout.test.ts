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

const IN = 150; // Printful print files are 150 dpi

describe("chest print on a hoodie (wide print area, pocket below)", () => {
  it("starts 1 inch below the top of the area and ends well above the pocket", async () => {
    const box = await inkBox(await renderPrintFile(SLOGAN, "chest", 2250, 1800, "dark"));
    expect(Math.abs(box.top * 1800 - 1 * IN)).toBeLessThan(0.15 * IN); // the same spot for every design
    expect((box.top + box.h) * 1800).toBeLessThanOrEqual(8.5 * IN + 2); // pocket starts lower
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

describe("chest print on a T-shirt or sweater (tall print area)", () => {
  it("starts 2.5 inches below the top of the area: on the chest, not under the collar", async () => {
    const box = await inkBox(await renderPrintFile(SLOGAN, "chest", 1800, 2400, "dark"));
    expect(Math.abs(box.top * 2400 - 2.5 * IN)).toBeLessThan(0.15 * IN);
  });

  it("puts a short wide slogan at the same top line as a tall one", async () => {
    const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 200"><text x="500" y="150" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="120">COZY SEASON</text></svg>`;
    const a = await inkBox(await renderPrintFile(wide, "chest", 1800, 2400, "dark"));
    const b = await inkBox(await renderPrintFile(SLOGAN, "chest", 1800, 2400, "dark"));
    expect(Math.abs(a.top - b.top) * 2400).toBeLessThan(0.3 * IN);
    expect(a.w * 1800).toBeGreaterThan(10.5 * IN); // a wide slogan prints big
  });
});

describe("Printify print files are 300 dpi", () => {
  it("prints a wide slogan just as large in inches as on a 150 dpi Printful file", async () => {
    const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 200"><text x="500" y="150" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="120">COZY SEASON</text></svg>`;
    const box = await inkBox(await renderPrintFile(wide, "chest", 3402, 4273, "dark", 300));
    expect(box.w * 3402).toBeGreaterThan(10 * 300); // over 10 inches wide
    expect(Math.abs(box.top * 4273 - 2.5 * 300)).toBeLessThan(0.15 * 300); // same chest line
  });
});
