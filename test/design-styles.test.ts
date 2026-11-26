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

import { personalizedDay } from "../src/lib/designStyles.js";

describe("personalizedDay: personalized designs only twice a week (Jarne: far too many)", () => {
  it("is true on Monday and Thursday only", () => {
    const days = [23, 24, 25, 26, 27, 28, 29].map((d) => personalizedDay(new Date(Date.UTC(2026, 10, d, 9))));
    // 23 Nov 2026 is a Monday
    expect(days).toEqual([true, false, false, true, false, false, false]);
  });
});

describe("bold lettering", () => {
  it("asks for heavy fonts and forbids thin and dashed lines", () => {
    expect(designRulesFor("quote")).toMatch(/font-weight 700/);
    expect(designRulesFor("cartoon")).toMatch(/no dashed/i);
  });
});
