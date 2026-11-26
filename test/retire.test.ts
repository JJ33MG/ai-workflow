import { describe, expect, it } from "vitest";
import { retireSelection } from "../src/lib/catalogRetire.js";

const row = (id: string, productType: string, personalized = false, source = "agent", status = "active") => ({ id, productType, personalized, source, status });

describe("retireSelection: which Printful listings go offline (Jarne, 26 Nov)", () => {
  it("takes all garments and the personalized posters, and keeps mugs, ornaments and plain posters", () => {
    const picked = retireSelection([
      row("h", "hoodie"),
      row("s", "sweatshirt"),
      row("t", "tshirt", true),
      row("pp", "poster", true),
      row("p", "poster"),
      row("m", "mug", true),
      row("o", "ornament"),
    ]);
    expect(picked.sort()).toEqual(["h", "pp", "s", "t"]);
  });

  it("never touches the new Printify garments", () => {
    expect(retireSelection([{ ...row("p", "hoodie"), supplier: "printify" }])).toEqual([]);
  });

  it("never touches listings Jarne placed himself, or ones already offline", () => {
    expect(retireSelection([row("a", "hoodie", false, "etsy"), row("b", "hoodie", false, "agent", "ended")])).toEqual([]);
  });
});
