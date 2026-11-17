import { describe, expect, it } from "vitest";
import { estimatedProfitCents, mockupGroups, orderItemsFor, type ListingVariant } from "../src/agents/etsyPod.js";
import { PRODUCT_TYPES, buildInventory, inkFor, offeredVariants, productType, skuFor, variantFromSku } from "../src/lib/catalog.js";
import { placementFor, profileMatches, taxonomyFor } from "../src/lib/catalogSetup.js";
import { lightInk } from "../src/lib/design.js";

const tee = productType("tshirt")!;

describe("Product catalog", () => {
  it("offers the chosen sizes and colours, skipping what Printful doesn't make", () => {
    const variants = [
      { id: 1, size: "S", color: "White", color_code: "#ffffff", price: "11.92" },
      { id: 2, size: "S", color: "Black", color_code: "#0c0c0c", price: "11.92" },
      { id: 3, size: "2XL", color: "Black", color_code: "#0c0c0c", price: "13.92" },
      { id: 4, size: "S", color: "Hot Pink", color_code: "#ff00aa", price: "11.92" },
    ];
    const offered = offeredVariants(tee, variants);
    expect(offered.map((v) => v.variantId)).toEqual([1, 2, 3]);
    expect(offered.find((v) => v.variantId === 2)).toMatchObject({ ink: "light", priceCents: 2699 });
    expect(offered.find((v) => v.variantId === 3)).toMatchObject({ size: "2XL", priceCents: 2899, ink: "light" });
    expect(offered.find((v) => v.variantId === 1)?.ink).toBe("dark");
  });

  it("uses light ink on dark colours only", () => {
    expect(inkFor("#131928")).toBe("light");
    expect(inkFor("#9b969c")).toBe("dark");
    expect(inkFor(null)).toBe("dark");
  });

  it("turns dark ink white for dark products and keeps lighter accents", () => {
    const svg = '<svg><text fill="#1F1F1F">A</text><line stroke="black"/><circle fill="#F2C14E"/></svg>';
    expect(lightInk(svg)).toBe('<svg><text fill="#ffffff">A</text><line stroke="#ffffff"/><circle fill="#F2C14E"/></svg>');
  });

  it("never uses parentheses in Etsy option labels and prices every type", () => {
    for (const t of PRODUCT_TYPES) {
      for (const s of t.sizes) {
        expect(s.label).not.toMatch(/[()]/);
        expect(s.priceCents).toBeGreaterThan(1500);
      }
    }
  });

  it("makes money on every product after Printful and Etsy fees", () => {
    // Printful's base costs in USD (catalogue, Nov 2026).
    expect(estimatedProfitCents(2199, 6.07)).toBeGreaterThan(1000);
    expect(estimatedProfitCents(2699, 11.92)).toBeGreaterThan(900);
    expect(estimatedProfitCents(4699, 22.63)).toBeGreaterThan(1500);
    expect(estimatedProfitCents(2499, 14.75)).toBeGreaterThan(600);
  });
});

describe("Etsy variations", () => {
  const v = (variantId: number, size: string, color: string | null, priceCents: number) => ({ variantId, size, color, priceCents });

  it("prices by size and colour, with a SKU naming the Printful variant", () => {
    const inv = buildInventory([v(1, "S", "White", 2699), v(2, "2XL", "Black", 2899)], 77);
    expect(inv.price_on_property).toEqual([513, 514]);
    expect(inv.sku_on_property).toEqual([513, 514]);
    expect(inv.products[1]).toEqual({
      sku: "PF-2",
      property_values: [
        { property_id: 513, property_name: "Size", value_ids: [], values: ["2XL"] },
        { property_id: 514, property_name: "Color", value_ids: [], values: ["Black"] },
      ],
      offerings: [{ price: 28.99, quantity: 999, is_enabled: true, readiness_state_id: 77 }],
    });
  });

  it("leaves out a property that doesn't vary", () => {
    const inv = buildInventory([v(1, "11 oz", null, 2199), v(2, "15 oz", null, 2499)], 1);
    expect(inv.price_on_property).toEqual([513]);
    expect(inv.products[0].property_values.map((p) => p.property_id)).toEqual([513]);
    const single = buildInventory([v(1, "One size", "Oyster", 2499)], 1);
    expect(single.price_on_property).toEqual([]);
    expect(single.products[0].property_values).toEqual([]);
  });

  it("reads the variant back from the SKU", () => {
    expect(variantFromSku(skuFor(4012))).toBe(4012);
    expect(variantFromSku("something-else")).toBeNull();
    expect(variantFromSku(null)).toBeNull();
  });
});

describe("Orders and mockups", () => {
  const lv = (variantId: number, color: string | null, file: string): ListingVariant => ({
    variantId,
    sku: skuFor(variantId),
    size: "M",
    color,
    ink: "dark",
    priceCents: 2699,
    costUsd: 11.92,
    placement: "front",
    width: 1800,
    height: 2400,
    file,
  });

  it("orders exactly the size and colour the buyer picked", () => {
    const listing = { etsyListingId: "9", printfulVariant: 1, designFile: "a.png", title: "Tee", variants: [lv(1, "White", "dark.png"), lv(2, "Black", "light.png")] };
    const items = orderItemsFor([{ listing_id: 9, quantity: 2, transaction_id: 1, sku: "PF-2" }], [listing]);
    expect(items).toEqual([{ variantId: 2, quantity: 2, fileUrl: expect.stringContaining("light.png"), placement: "front" }]);
    expect(() => orderItemsFor([{ listing_id: 9, quantity: 1, transaction_id: 1, sku: null }], [listing])).toThrow(/by hand/);
  });

  it("keeps old single-mug listings and skips listings that aren't ours", () => {
    const old = { etsyListingId: "5", printfulVariant: 1320, designFile: "m.png", title: "Mug", variants: null };
    const manual = { etsyListingId: "6", printfulVariant: null, designFile: "", title: "By hand", variants: null };
    const items = orderItemsFor(
      [
        { listing_id: 5, quantity: 1, transaction_id: 1 },
        { listing_id: 6, quantity: 1, transaction_id: 2 },
      ],
      [old, manual],
    );
    expect(items).toEqual([{ variantId: 1320, quantity: 1, fileUrl: expect.stringContaining("m.png") }]);
  });

  it("makes one mockup per colour, grouped by print file", () => {
    const groups = mockupGroups([lv(1, "White", "dark.png"), lv(2, "Black", "light.png"), lv(3, "Navy", "light.png"), lv(4, "Grey", "dark.png")], 3);
    expect(groups).toEqual([
      expect.objectContaining({ file: "dark.png", variantIds: [1] }),
      expect.objectContaining({ file: "light.png", variantIds: [2, 3] }),
    ]);
  });
});

describe("Catalog setup", () => {
  it("prints on the front of a shirt, never on an embroidery placement", () => {
    const info = {
      printfiles: [
        { printfile_id: 1, width: 1800, height: 2400, dpi: 150 },
        { printfile_id: 2, width: 600, height: 600, dpi: 150 },
      ],
      variant_printfiles: [{ variant_id: 7, placements: { embroidery_chest_left: 2, front: 1, back: 1 } }],
    };
    expect(placementFor(info, 7, ["front"])).toEqual({ placement: "front", width: 1800, height: 2400 });
    expect(placementFor(info, 7, ["default"])).toEqual({ placement: "front", width: 1800, height: 2400 });
  });

  it("matches shipping profiles by product, not by the word Printful", () => {
    expect(profileMatches(productType("poster")!, "Printful: Mugs (20oz) (#PF-FRG50)")).toBe(false);
    expect(profileMatches(productType("poster")!, "Printful: Posters (#PF-1)")).toBe(true);
    expect(profileMatches(productType("poster")!, "Printful: Hats, Bags, Pillowcases, All over prints, Socks (#PF-FRG42)")).toBe(false);
    expect(profileMatches(productType("tote")!, "Printful: Hats, Bags, Pillowcases, All over prints, Socks (#PF-FRG42)")).toBe(true);
    expect(profileMatches(productType("hoodie")!, "Printful: Hoodies (#PF-FRG2)")).toBe(true);
    expect(profileMatches(tee, "Printful: Tshirts (#PF-FRG1)")).toBe(true);
    expect(profileMatches(productType("mug")!, "Printful: Mugs (20oz) (#PF-FRG50)")).toBe(true);
    expect(profileMatches(tee, "Printful: T-Shirts")).toBe(true);
  });

  it("finds the first Etsy category the type names", () => {
    const tree = [{ id: 1, name: "Bags & Purses", children: [{ id: 2, name: "Totes", children: [] }] }];
    expect(taxonomyFor(productType("tote")!, tree)).toBe(2);
    expect(taxonomyFor(tee, tree)).toBeNull();
  });
});

describe("Printable wall art", () => {
  it("makes a high-resolution JPG per frame ratio, well under Etsy's 20 MB", async () => {
    const { renderPrintable } = await import("../src/lib/design.js");
    const { PRINTABLE } = await import("../src/lib/catalog.js");
    const sharp = (await import("sharp")).default;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1350 1050"><text x="675" y="525" text-anchor="middle" font-size="120" fill="#111">HELLO</text></svg>';
    const f = PRINTABLE.formats.find((x) => x.name === "11x14in")!;
    const jpg = await renderPrintable(svg, f.width, f.height);
    const meta = await sharp(jpg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 3300, 4200]);
    expect(jpg.length).toBeLessThan(20_000_000);
    expect(PRINTABLE.formats.length).toBeLessThanOrEqual(5); // Etsy's limit per listing
  });
});
