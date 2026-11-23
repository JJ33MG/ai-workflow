import { describe, expect, it } from "vitest";
import { cleanSeo, seoBatches } from "../src/lib/seo.js";

describe("cleanSeo (Etsy's title and tag rules)", () => {
  it("keeps a good title and 13 tags as they are", () => {
    const tags = Array.from({ length: 13 }, (_, i) => `beekeeper gift ${i}`);
    const r = cleanSeo("Beekeeper Gifts, Funny Bee Mug", tags);
    expect(r).toEqual({ title: "Beekeeper Gifts, Funny Bee Mug", tags });
  });

  it("cuts the title at 140 characters on a word boundary and squeezes spaces", () => {
    const r = cleanSeo(`Beekeeper   Gift ${"word ".repeat(40)}`, ["a b", "c d", "e f", "g h", "i j"]);
    expect(r!.title.length).toBeLessThanOrEqual(140);
    expect(r!.title).not.toMatch(/\s{2}|\s$/);
  });

  it("drops tags over 20 characters, duplicates and characters Etsy refuses; keeps at most 13", () => {
    const r = cleanSeo("Ham Radio Gifts", [
      "Ham Radio Gifts",
      "ham radio gifts",
      "a tag that is far too long",
      "ham radio #1!",
      ...Array.from({ length: 15 }, (_, i) => `tag ${i}`),
    ]);
    expect(r!.tags[0]).toBe("ham radio gifts");
    expect(r!.tags).toContain("ham radio 1");
    expect(r!.tags).not.toContain("a tag that is far too long");
    expect(r!.tags.length).toBe(13);
  });

  it("allows an ampersand at most once in a title (Etsy rule)", () => {
    expect(cleanSeo("Mug & Gift & More", ["a b", "c d", "e f", "g h", "i j"])!.title).toBe("Mug & Gift and More");
  });

  it("refuses an empty title or fewer than 5 usable tags", () => {
    expect(cleanSeo("  ", ["a", "b", "c", "d", "e"])).toBeNull();
    expect(cleanSeo("Mug", ["a", "b"])).toBeNull();
  });
});

describe("seoBatches", () => {
  it("skips listings already rewritten and splits the rest into batches", () => {
    const ids = ["1", "2", "3", "4", "5"];
    expect(seoBatches(ids, new Set(["2"]), 2, 10)).toEqual([["1", "3"], ["4", "5"]]);
  });

  it("stops after the batch limit for this run", () => {
    expect(seoBatches(["1", "2", "3", "4", "5"], new Set(), 2, 1)).toEqual([["1", "2"]]);
  });
});
