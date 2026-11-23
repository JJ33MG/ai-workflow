import { describe, expect, it } from "vitest";
import { formatIdea, ideaButtons, tasteDigest } from "../src/lib/ideas.js";
import { parseButton } from "../src/lib/telegram.js";

const idea = {
  id: "abc123",
  kind: "trend",
  title: "Valentine's mugs for nurses",
  summary: "Nurse gifts peak in February.",
  whyNow: "Valentine's is 12 weeks away and Etsy searches start in January.",
  money: "€100-300 in February",
  cost: "€0 (existing agent)",
  effort: "low",
  firstStep: "Tell the Etsy agent to make 10 Valentine nurse designs.",
  risks: "Crowded niche.",
  outsideBox: false,
  sources: [{ url: "https://example.com/a", title: "Example" }],
};

describe("idea buttons", () => {
  it("offers build, later and no, and Telegram turns a tap back into the command", () => {
    const [row] = ideaButtons("abc123");
    expect(row.map((b) => b.callback_data)).toEqual(["idea_build:abc123", "idea_later:abc123", "idea_no:abc123"]);
    expect(parseButton("idea_build:abc123")).toEqual({ command: "idea_build", args: ["abc123"] });
    expect(parseButton("approve:xyz")).toEqual({ command: "approve", args: ["xyz"] });
    expect(parseButton("idea_hack:abc")).toBeNull();
  });
});

describe("formatIdea", () => {
  it("shows the kind, the why-now, money, cost, effort, first step, risks and the sources", () => {
    const text = formatIdea(idea, 1);
    for (const part of ["Valentine's mugs for nurses", "Trend", "12 weeks away", "€100-300", "low", "10 Valentine", "Crowded", "https://example.com/a"]) {
      expect(text).toContain(part);
    }
  });

  it("marks the outside-the-box idea", () => {
    expect(formatIdea({ ...idea, outsideBox: true }, 2)).toContain("buiten de lijntjes");
  });
});

describe("tasteDigest", () => {
  it("lists Jarne's votes with his reasons, newest first", () => {
    const text = tasteDigest([
      { title: "Dropshipping store", status: "no", feedback: "not now, no ad budget" },
      { title: "Printify for Etsy", status: "build", feedback: null },
    ]);
    expect(text).toContain("NO: Dropshipping store (not now, no ad budget)");
    expect(text).toContain("BUILD: Printify for Etsy");
  });

  it("says so when there are no votes yet", () => {
    expect(tasteDigest([])).toMatch(/no votes yet/i);
  });
});
