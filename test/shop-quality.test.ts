import { describe, expect, it } from "vitest";
import { lifestyleFirst } from "../src/integrations/printful.js";
import { nicheFocus } from "../src/agents/etsyPod.js";

describe("mockup order", () => {
  it("puts photos of the product worn or held before flat and ghost shots", () => {
    const out = lifestyleFirst([
      { url: "a", label: "Front" },
      { url: "b", label: "Flat Front" },
      { url: "c", label: "Women's Lifestyle" },
      { url: "d", label: "Men's Front" },
      { url: "e", label: "Ghost" },
    ]);
    expect(out).toEqual(["c", "d", "a", "b", "e"]);
  });
});

describe("niche focus", () => {
  it("names the niches buyers already favour, best first, at most eight", () => {
    const rows = [
      { niche: "Land surveyors", favorites: 1 },
      { niche: "Ham radio", favorites: 4 },
      { niche: "Land surveyors", favorites: 2 },
      { niche: "Farriers", favorites: 0 },
    ];
    expect(nicheFocus(rows)).toEqual(["Ham radio (4 favorites)", "Land surveyors (3 favorites)"]);
  });
});
