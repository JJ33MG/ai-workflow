import { describe, expect, it } from "vitest";
import { pickMugProduct, pickMugVariant, pickStore, printfileFor } from "../src/lib/printfulSetup.js";

describe("Printful setup", () => {
  it("orders through the API store, never the Etsy-linked one", () => {
    expect(pickStore([{ id: 1, name: "AllyouwishDesigns", type: "etsy" }, { id: 2, name: "API", type: "native" }])?.id).toBe(2);
    expect(pickStore([{ id: 1, name: "AllyouwishDesigns", type: "etsy" }])).toBeNull();
  });

  it("finds the 11 oz white glossy mug", () => {
    const catalog = [{ id: 5, title: "Black Glossy Mug" }, { id: 19, title: "White Glossy Mug" }];
    expect(pickMugProduct(catalog)?.id).toBe(19);
    const product = {
      product: { id: 19, title: "White Glossy Mug", type: "MUG" },
      variants: [
        { id: 4830, name: "White Glossy Mug (15 oz)", size: "15 oz", color: "White", price: "8.50" },
        { id: 1320, name: "White Glossy Mug (11 oz)", size: "11 oz", color: "White", price: "6.50" },
      ],
    };
    expect(pickMugVariant(product)?.id).toBe(1320);
  });

  it("reads the print-file size for the variant", () => {
    const info = {
      printfiles: [{ printfile_id: 43, width: 2700, height: 1050, dpi: 300 }],
      variant_printfiles: [{ variant_id: 1320, placements: { default: 43 } }],
    };
    expect(printfileFor(info, 1320)).toEqual({ placement: "default", width: 2700, height: 1050 });
    expect(printfileFor(info, 999)).toBeNull();
  });
});
