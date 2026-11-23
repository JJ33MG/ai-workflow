import { describe, expect, it } from "vitest";
import { STYLES, batchStyles, designRulesFor } from "../src/lib/designStyles.js";

describe("batchStyles: every daily batch is a mix, not only job niches", () => {
  it("gives a batch of 5 one of each style", () => {
    expect(new Set(batchStyles(5, 0))).toEqual(new Set(STYLES));
  });

  it("rotates smaller batches so every style comes round over the days", () => {
    const seen = new Set([0, 1, 2, 3, 4].flatMap((day) => batchStyles(2, day)));
    expect(seen).toEqual(new Set(STYLES));
  });

  it("repeats the rotation for bigger batches", () => {
    expect(batchStyles(7, 0)).toHaveLength(7);
  });
});

describe("designRulesFor", () => {
  it("keeps typography-only rules for quote and niche designs", () => {
    expect(designRulesFor("quote")).toMatch(/Typography/);
  });

  it("lets cartoon and print designs make the illustration the hero", () => {
    expect(designRulesFor("cartoon")).toMatch(/illustration is the hero/i);
    expect(designRulesFor("print")).toMatch(/illustration is the hero/i);
    expect(designRulesFor("cartoon")).not.toMatch(/Typography only/);
  });
});
