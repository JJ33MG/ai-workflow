import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { alreadyUploaded, frozenUntil, isFrozen, mugCloseUp, pickTitleTest } from "../src/lib/shopGuards.js";

describe("isFrozen: no live listing removed or replaced before 15 December without Jarne", () => {
  it("is frozen until the end of 14 December and free from 15 December", () => {
    expect(isFrozen(new Date("2026-11-27T10:00:00Z"))).toBe(true);
    expect(isFrozen(new Date("2026-12-14T22:59:00Z"))).toBe(true);
    expect(isFrozen(new Date("2026-12-15T00:00:00Z"))).toBe(false);
    expect(frozenUntil).toBe("2026-12-15");
  });
});

describe("alreadyUploaded: never the same photo twice on a listing", () => {
  it("is true when the same image is still on the listing, false once it was deleted there", () => {
    const seen = { "1001": "abc", "1002": "def" };
    expect(alreadyUploaded(seen, "abc", [1001, 1002])).toBe(true);
    expect(alreadyUploaded(seen, "abc", [1002])).toBe(false);
    expect(alreadyUploaded(seen, "xyz", [1001, 1002])).toBe(false);
  });
});

describe("pickTitleTest: the short-title test touches only 8 listings", () => {
  it("takes the given ids, else the 8 oldest long titles", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, title: "x".repeat(80), createdAt: new Date(2026, 10, i + 1) }));
    expect(pickTitleTest(rows, undefined).map((r) => r.id)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    expect(pickTitleTest(rows, ["3", "9"]).map((r) => r.id)).toEqual(["3", "9"]);
    expect(pickTitleTest([{ id: "s", title: "short", createdAt: new Date() }], undefined)).toEqual([]);
  });
});

describe("mugCloseUp: the joke fills the frame", () => {
  it("makes a square photo where the design covers most of the width", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400"><text x="500" y="250" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="150" fill="#000">FUNNY MUG</text></svg>`;
    const png = await mugCloseUp(svg, "white");
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(2000);
    // the text block spans most of the width: trim away the plain border around it
    const { info } = await sharp(png).trim({ threshold: 40 }).toBuffer({ resolveWithObject: true });
    expect(info.width / 2000).toBeGreaterThan(0.7);
  });
});
