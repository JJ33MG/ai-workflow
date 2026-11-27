import { describe, expect, it } from "vitest";
import { mediaGroups } from "../src/lib/telegram.js";

// Jarne, 27 Nov: approvals for listings show the product itself on Telegram, not just text.
describe("mediaGroups: photos for Telegram, at most 10 per album", () => {
  it("makes albums of up to 10 photos, each with its caption cut to Telegram's 1024 limit", () => {
    const photos = Array.from({ length: 12 }, (_, i) => ({ url: `https://img/${i}.jpg`, caption: i === 0 ? "x".repeat(2000) : `Item ${i}` }));
    const groups = mediaGroups(photos);
    expect(groups.map((g) => g.length)).toEqual([10, 2]);
    expect(groups[0][0]).toEqual({ type: "photo", media: "https://img/0.jpg", caption: "x".repeat(1024) });
    expect(groups[1][1]).toEqual({ type: "photo", media: "https://img/11.jpg", caption: "Item 11" });
  });
  it("skips photos without an address", () => {
    expect(mediaGroups([{ url: "", caption: "a" }])).toEqual([]);
  });
});
