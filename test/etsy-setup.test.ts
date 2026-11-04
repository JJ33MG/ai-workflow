import { describe, expect, it } from "vitest";
import { defaultPriceCents, findTaxonomyId, pickProductionPartner, pickShippingProfile } from "../src/lib/etsySetup.js";

describe("Etsy setup", () => {
  it("prefers the shipping profile Printful created", () => {
    const profiles = [
      { shipping_profile_id: 1, title: "Standard" },
      { shipping_profile_id: 2, title: "Printful Shipping Profile (Europe)" },
    ];
    expect(pickShippingProfile(profiles)?.shipping_profile_id).toBe(2);
    expect(pickShippingProfile([profiles[0]])?.shipping_profile_id).toBe(1);
    expect(pickShippingProfile([])).toBeNull();
  });

  it("finds Printful as production partner, or nothing", () => {
    expect(pickProductionPartner([{ production_partner_id: 7, partner_name: "Printful" }])?.production_partner_id).toBe(7);
    expect(pickProductionPartner([{ production_partner_id: 8, partner_name: "Local print shop" }])).toBeNull();
  });

  it("finds the Mugs category deep in the taxonomy", () => {
    const tree = [
      {
        id: 1,
        name: "Home & Living",
        children: [{ id: 2, name: "Kitchen & Dining", children: [{ id: 1062, name: "Mugs", children: [] }] }],
      },
    ];
    expect(findTaxonomyId(tree)).toBe(1062);
    expect(findTaxonomyId([{ id: 9, name: "Toys", children: [] }])).toBeNull();
  });

  it("prices in the shop's currency", () => {
    delete process.env.POD_PRICE;
    expect(defaultPriceCents("USD")).toBe(2199);
    process.env.POD_PRICE = "24.5";
    expect(defaultPriceCents("USD")).toBe(2450);
    delete process.env.POD_PRICE;
  });
});
