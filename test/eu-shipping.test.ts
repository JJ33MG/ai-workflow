import { describe, expect, it } from "vitest";
import { deliveryDays, profileOrigin } from "../src/lib/euShipping.js";

describe("profileOrigin: ship from Europe when Printful prints every product of the profile there", () => {
  it("moves mugs, apparel, totes, posters and wooden ornaments to Latvia", () => {
    expect(profileOrigin(["mug", "mug-black"])).toBe("LV");
    expect(profileOrigin(["hoodie", "sweatshirt", "tshirt"])).toBe("LV");
    expect(profileOrigin(["ornament-wood"])).toBe("LV");
  });

  it("keeps a profile in the US when one of its products is only printed there", () => {
    expect(profileOrigin(["ornament"])).toBe("US");
    expect(profileOrigin(["ornament-wood", "ornament-acrylic"])).toBe("US");
  });

  it("leaves a profile no product uses alone", () => {
    expect(profileOrigin([])).toBeNull();
  });
});

describe("deliveryDays (transit only; Etsy adds the processing time)", () => {
  it("from Latvia: EU fast, UK and the US (printed in the US) a bit longer, the rest of the world longest", () => {
    expect(deliveryDays({ destination_country_iso: null, destination_region: "eu" }, "LV")).toEqual([3, 7]);
    expect(deliveryDays({ destination_country_iso: "BE", destination_region: "none" }, "LV")).toEqual([3, 7]);
    expect(deliveryDays({ destination_country_iso: "GB", destination_region: "none" }, "LV")).toEqual([4, 9]);
    expect(deliveryDays({ destination_country_iso: "US", destination_region: "none" }, "LV")).toEqual([4, 9]);
    expect(deliveryDays({ destination_country_iso: null, destination_region: "none" }, "LV")).toEqual([7, 20]);
  });

  it("from the US: the US fast, Europe slower", () => {
    expect(deliveryDays({ destination_country_iso: "US", destination_region: "none" }, "US")).toEqual([3, 7]);
    expect(deliveryDays({ destination_country_iso: null, destination_region: "eu" }, "US")).toEqual([7, 15]);
  });
});
