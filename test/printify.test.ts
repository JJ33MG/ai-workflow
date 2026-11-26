import { describe, expect, it } from "vitest";
import { saleProfit } from "../src/lib/pricing.js";
import { inkFor, pickVariants, productBody, retailPrice } from "../src/lib/printifyCatalog.js";

const v = (id: number, color: string, size: string) => ({ id, title: `${color} / ${size}`, options: { color, size } });

describe("pickVariants", () => {
  it("takes the preferred colours that exist (in order, at most 4) in sizes S to 3XL", () => {
    const all = [v(1, "Black", "S"), v(2, "Black", "XS"), v(3, "Sand", "M"), v(4, "Pink", "M"), v(5, "Navy", "3XL"), v(6, "Black", "5XL")];
    const picked = pickVariants(all, ["Navy", "Black", "Sand", "White"], 4);
    expect(picked.map((p) => p.id)).toEqual([5, 1, 3]);
    expect(picked[0]).toMatchObject({ color: "Navy", size: "3XL" });
  });
});

describe("inkFor", () => {
  it("prints light ink on dark garments and dark ink on light ones", () => {
    expect(inkFor("Black")).toBe("light");
    expect(inkFor("Heather Navy")).toBe("light");
    expect(inkFor("Forest Green")).toBe("light");
    expect(inkFor("Sand")).toBe("dark");
    expect(inkFor("White")).toBe("dark");
    expect(inkFor("Sport Grey")).toBe("dark");
  });
});

describe("retailPrice", () => {
  it("leaves at least €5 profit even with the 20% sale, and never goes under €24.99", () => {
    const cost = 2300; // hoodie with shipping included
    const price = retailPrice(cost, 0);
    expect(price % 100).toBe(99);
    expect(saleProfit({ priceCents: price, shippingChargedCents: 0, printfulTotalCents: cost, discountPct: 0.2 }).profitCents).toBeGreaterThanOrEqual(500);
    expect(retailPrice(500, 0)).toBe(2499);
  });
});

describe("productBody", () => {
  it("sends one print area per ink, centred, with every picked variant priced and enabled", () => {
    const body = productBody({
      title: "T",
      description: "D",
      tags: ["a"],
      blueprintId: 12,
      providerId: 26,
      variants: [
        { id: 1, color: "Black", size: "M", priceCents: 2999 },
        { id: 2, color: "White", size: "M", priceCents: 2999 },
      ],
      imageIds: { light: "img-light", dark: "img-dark" },
    });
    expect(body.variants).toEqual([
      { id: 1, price: 2999, is_enabled: true },
      { id: 2, price: 2999, is_enabled: true },
    ]);
    expect(body.print_areas).toEqual([
      { variant_ids: [1], placeholders: [{ position: "front", images: [{ id: "img-light", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }] },
      { variant_ids: [2], placeholders: [{ position: "front", images: [{ id: "img-dark", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }] },
    ]);
  });
});

import { extraPhotos } from "../src/lib/printifyCatalog.js";

describe("extraPhotos: fill a Printify listing up to 10 photos", () => {
  const img = (src: string, sel: boolean, position = "front") => ({ src, is_selected_for_publishing: sel, position, is_default: false, variant_ids: [] });
  it("adds the mockups Printify did not send to Etsy, other views first, never twice", () => {
    const picked = extraPhotos([img("a", true), img("b", false, "back"), img("c", false), img("c", false), img("d", false, "other")], 8);
    expect(picked).toEqual(["b", "d"]);
  });
  it("stops at 10 photos in total and adds nothing when the listing already has 10", () => {
    const many = Array.from({ length: 20 }, (_, i) => img(`x${i}`, false));
    expect(extraPhotos(many, 6)).toHaveLength(4);
    expect(extraPhotos(many, 10)).toEqual([]);
  });
});
