import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalisePlan } from "../src/agents/kdpColoring.js";
import {
  artBox,
  buildCover,
  buildInterior,
  coverSize,
  inkedEdges,
  interiorPageCount,
  renderPage,
  spineWidth,
  wrap,
} from "../src/lib/coloring.js";

const page = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2190 2940"><rect width="2190" height="2940" fill="white"/>${inner}</svg>`;

describe("KDP sizes", () => {
  it("counts interior pages: title, belongs-to, picture + blank back each, closing page, even, at least 24", () => {
    expect(interiorPageCount(30)).toBe(64);
    expect(interiorPageCount(5)).toBe(24);
    expect(interiorPageCount(31) % 2).toBe(0);
  });

  it("sizes the cover from the page count", () => {
    expect(spineWidth(64)).toBeCloseTo(0.1441, 3);
    const c = coverSize(64);
    expect(c.width).toBeCloseTo(0.125 * 2 + 8.5 * 2 + 0.1441, 3);
    expect(c.height).toBeCloseTo(11.25, 5);
  });

  it("wraps text on word boundaries", () => {
    expect(wrap("Dinosaur Coloring Book for Toddlers", 18)).toEqual(["Dinosaur Coloring", "Book for Toddlers"]);
  });
});

describe("pages", () => {
  it("renders a page into the art box in greyscale", async () => {
    const png = await renderPage(page('<circle cx="1095" cy="1470" r="600" fill="white" stroke="#000" stroke-width="18"/>'));
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([artBox().width, artBox().height]);
    expect(await inkedEdges(png)).toEqual([]);
  });

  it("detects a drawing that runs off the page", async () => {
    const png = await renderPage(page('<circle cx="100" cy="1470" r="600" fill="white" stroke="#000" stroke-width="18"/>'));
    expect(await inkedEdges(png)).toContain("left");
  });
});

describe("PDFs", () => {
  it("builds an 8.5 x 11 interior with the expected page count", async () => {
    const pic = await renderPage(page('<rect x="400" y="600" width="1300" height="1500" fill="white" stroke="#000" stroke-width="16"/>'));
    const { pdf, pageCount } = await buildInterior([pic, pic, pic], { title: "Test Book", subtitle: "Sub", author: "Me" });
    const doc = await PDFDocument.load(pdf);
    expect(pageCount).toBe(24);
    expect(doc.getPageCount()).toBe(24);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(612, 1);
    expect(height).toBeCloseTo(792, 1);
  });

  it("builds a single-page cover at the full-wrap size", async () => {
    const art = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#3a86ff" } }).png().toBuffer();
    const { pdf, front } = await buildCover({
      title: "Big Trucks Coloring Book",
      subtitle: "Easy pages for toddlers",
      author: "Me",
      ageRange: "2-5",
      blurb: "Thirty simple trucks to color.",
      pageCount: 64,
      pictures: 30,
      frontArt: art,
      color: "#ffd23f",
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width / 72).toBeCloseTo(coverSize(64).width, 2);
    expect(height / 72).toBeCloseTo(11.25, 2);
    const f = await sharp(front).metadata();
    expect([f.width, f.height]).toEqual([2550, 3300]);
  });
});

describe("normalisePlan", () => {
  it("keeps KDP's limits: 7 keywords under 50 characters, a valid cover colour", () => {
    const plan = normalisePlan({
      theme: "t",
      ageRange: "2-5",
      title: "T",
      subtitle: "S",
      description: "D",
      keywords: ["A", "a", "b", "c", "d", "e", "f", "g", "h", "x".repeat(60)],
      categories: ["1", "2", "3", "4"],
      coverColor: "yellow",
      coverSubject: "c",
      pages: [],
    });
    expect(plan.keywords).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(plan.categories).toHaveLength(3);
    expect(plan.coverColor).toBe("#ffd23f");
  });
});

describe("drawModels", () => {
  it("tries the cheap model twice, then the main model once", async () => {
    const { drawModels } = await import("../src/agents/kdpColoring.js");
    const { config } = await import("../src/config.js");
    expect(drawModels()).toEqual([config.kdp.drawModel, config.kdp.drawModel, config.claude.model]);
  });
});
