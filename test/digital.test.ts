import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildDownloadFiles, listingPhotos } from "../src/lib/digital.js";

/** A simple line-art page like the coloring agent makes (2190 x 2940). */
const page = (n: number) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2190" height="2940"><rect width="100%" height="100%" fill="#fff"/>
    <circle cx="1095" cy="1300" r="${500 + n * 20}" fill="none" stroke="#000" stroke-width="18"/>
    <path d="M700 2300 Q1095 2100 1490 2300" fill="none" stroke="#000" stroke-width="18"/>
    <text x="1095" y="1350" font-size="200" text-anchor="middle" font-family="sans-serif">${n + 1}</text></svg>`)).png().toBuffer();

describe("digital downloads", () => {
  it("makes Letter and A4 PDFs with one page per picture", async () => {
    const pages = await Promise.all([0, 1, 2].map(page));
    const files = await buildDownloadFiles(pages, "Test");
    expect(files.map((f) => f.name)).toEqual(["US-Letter", "A4"]);
    for (const f of files) expect((await PDFDocument.load(f.data)).getPageCount()).toBe(3);
    const a4 = (await PDFDocument.load(files[1].data)).getPage(0).getSize();
    expect(Math.round(a4.width)).toBe(595);
  }, 60_000);

  it("makes the listing photos: cover, contents, previews, how it works", async () => {
    const pages = await Promise.all(Array.from({ length: 24 }, (_, i) => page(i)));
    const photos = await listingPhotos({
      coverTitle: "Christmas Coloring Pages for Kids",
      coverSubtitle: "24 cute pages for ages 3–8",
      accent: "#b3262e",
      pages,
      pageTitles: pages.map((_, i) => `Page ${i + 1}: a happy snowman`),
    });
    expect(photos).toHaveLength(5);
    for (const ph of photos) expect((await sharp(ph).metadata()).width).toBe(2000);
    const dir = process.env.DIGITAL_PREVIEW;
    if (dir) photos.forEach((ph, i) => writeFileSync(`${dir}/photo${i + 1}.png`, ph));
  }, 60_000);
});

describe("download agent", () => {
  it("rotates the kinds day by day and follows an explicit choice", async () => {
    const { kindFor } = await import("../src/agents/etsyDigital.js");
    const day = (n: number) => new Date(n * 86_400_000 + 3_600_000);
    expect(new Set([0, 1, 2].map((n) => kindFor({}, day(n))))).toEqual(new Set(["coloring", "activity", "planner"]));
    expect(kindFor({ kind: "planner" }, day(0))).toBe("planner");
    expect(kindFor({ kind: "nonsense" }, day(1))).toBe(kindFor({}, day(1)));
  });
});
