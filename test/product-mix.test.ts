import { describe, expect, it } from "vitest";
import { chooseProducts } from "../src/agents/etsyPod.js";

const l = (product: string) => ({ product, slogan: product });

describe("product mix per design", () => {
  it("puts apparel first and allows at most one mug per design", () => {
    const picked = chooseProducts([l("mug"), l("mug-black"), l("hoodie"), l("tshirt"), l("mug-color")], 3);
    expect(picked.map((x) => x.product)).toEqual(["hoodie", "tshirt", "mug"]);
  });

  it("skips mugs entirely while the shop has far more mugs than apparel", () => {
    const picked = chooseProducts([l("mug"), l("hoodie"), l("tote"), l("sweatshirt")], 3, { mugs: 69, apparel: 16 });
    expect(picked.map((x) => x.product)).toEqual(["hoodie", "sweatshirt", "tote"]);
  });
});
