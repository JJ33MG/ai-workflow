import { describe, expect, it } from "vitest";
import { EU_COUNTRIES, PRINTIFY_TYPES, chooseBlueprint, chooseProvider, pickProductVariants, retailPrice } from "../src/lib/printifyCatalog.js";

// Jarne, 27 Nov: everything through Printify, also mugs, posters and tote bags.
const type = (id: string) => PRINTIFY_TYPES.find((t) => t.typeId === id)!;

describe("chooseBlueprint: the right Printify product by its name", () => {
  const blueprints = [
    { id: 1, title: "Black Coffee Cup, 11oz", brand: "", model: "" },
    { id: 2, title: "Ceramic Mug 11oz", brand: "", model: "" },
    { id: 3, title: "Matte Vertical Posters", brand: "", model: "" },
    { id: 4, title: "Canvas Gallery Wraps", brand: "", model: "" },
    { id: 5, title: "Cotton Tote Bag", brand: "", model: "" },
    { id: 6, title: "Tote Bag (AOP)", brand: "", model: "" },
  ];
  it("finds a white 11oz mug, a matte poster and a cotton tote, never the look-alikes", () => {
    expect(chooseBlueprint(blueprints, type("mug")).map((b) => b.id)).toEqual([2]);
    expect(chooseBlueprint(blueprints, type("poster")).map((b) => b.id)).toEqual([3]);
    expect(chooseBlueprint(blueprints, type("tote")).map((b) => b.id)).toEqual([5]);
  });
});

describe("chooseProvider: a print provider inside the EU (no customs)", () => {
  it("takes Germany before Latvia, and never the UK or the US", () => {
    const p = [{ id: 1, title: "US", country: "US" }, { id: 2, title: "UK", country: "GB" }, { id: 3, title: "LV", country: "LV" }, { id: 4, title: "DE", country: "DE" }];
    expect(chooseProvider(p)?.id).toBe(4);
    expect(chooseProvider(p.slice(0, 2))).toBeNull();
    expect(EU_COUNTRIES).not.toContain("GB");
  });
});

describe("pickProductVariants: sizes and colours for things that are not clothes", () => {
  it("takes the wanted poster sizes in order, at most four", () => {
    const v = ["8″ x 10″", "12″ x 16″", "18″ x 24″", "24″ x 36″", "11″ x 14″"].map((s, i) => ({ id: i + 1, title: s, options: { size: s } }));
    expect(pickProductVariants(v, type("poster")).map((x) => x.size)).toEqual(["12″ x 16″", "18″ x 24″", "24″ x 36″", "11″ x 14″"]);
  });
  it("falls back to the first variants when no wanted size is offered", () => {
    const v = [{ id: 9, title: "One size", options: {} }];
    expect(pickProductVariants(v, type("tote"))).toEqual([{ id: 9, color: "White", size: "One size" }]);
  });
});

describe("retailPrice floor per product", () => {
  it("lets a mug sell from €19.99 while a hoodie keeps €24.99", () => {
    expect(retailPrice(500, 0, 1999)).toBe(1999);
    expect(retailPrice(500, 0)).toBe(2499);
  });
});
