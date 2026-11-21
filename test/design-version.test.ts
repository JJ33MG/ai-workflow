import { describe, expect, it } from "vitest";
import { versionedId } from "../src/lib/design.js";

describe("print file names", () => {
  it("change when the drawing changes, so Printful never reuses an old file at the same address", () => {
    const a = versionedId("L1-front-2100x2100-light", Buffer.from("old drawing"));
    const b = versionedId("L1-front-2100x2100-light", Buffer.from("new drawing"));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^L1-front-2100x2100-light-[0-9a-f]{10}$/);
    expect(versionedId("L1-front-2100x2100-light", Buffer.from("old drawing"))).toBe(a);
  });
});
