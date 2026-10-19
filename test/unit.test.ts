import { describe, expect, it } from "vitest";
import { formatBriefing, type BriefingData } from "../src/agents/ceo.js";
import { retryDelayMs } from "../src/agents/debug.js";
import { normaliseIdea } from "../src/agents/etsyPod.js";
import { moneyToCents } from "../src/integrations/etsy.js";
import { usageCostUsdCents } from "../src/lib/claude.js";
import { sanitizeSvg } from "../src/lib/design.js";
import { startOfDay, startOfMonth } from "../src/lib/money.js";
import { splitMessage } from "../src/lib/telegram.js";

describe("normaliseIdea", () => {
  it("enforces Etsy title and tag limits", () => {
    const idea = normaliseIdea({
      niche: "nurses",
      slogan: "x",
      designBrief: "x",
      title: "t".repeat(200),
      description: "d",
      tags: ["Nurse Gift!", "nurse gift", "a".repeat(21), "", ...Array.from({ length: 20 }, (_, i) => `tag ${i}`)],
    });
    expect(idea.title).toHaveLength(140);
    expect(idea.tags).toHaveLength(13);
    expect(idea.tags[0]).toBe("nurse gift");
    expect(idea.tags.every((t) => t.length <= 20)).toBe(true);
  });
});

describe("sanitizeSvg", () => {
  it("extracts the svg element", () => {
    expect(sanitizeSvg('Here:\n<svg viewBox="0 0 1 1"><text>Hi</text></svg>\nDone')).toBe(
      '<svg viewBox="0 0 1 1"><text>Hi</text></svg>',
    );
  });
  it("allows internal gradient references", () => {
    expect(() => sanitizeSvg('<svg><linearGradient id="g"/><rect fill="url(#g)"/></svg>')).not.toThrow();
  });
  it.each([
    "<svg><script>alert(1)</script></svg>",
    '<svg><image href="http://x/y.png"/></svg>',
    '<svg><rect onload="x()"/></svg>',
    '<svg><rect fill="url(http://evil)"/></svg>',
    "<svg><foreignObject/></svg>",
  ])("rejects %s", (svg) => {
    expect(() => sanitizeSvg(svg)).toThrow();
  });
  it("rejects output without svg", () => {
    expect(() => sanitizeSvg("sorry")).toThrow();
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially and caps at an hour", () => {
    expect(retryDelayMs(1)).toBe(2 * 60_000);
    expect(retryDelayMs(3)).toBe(8 * 60_000);
    expect(retryDelayMs(10)).toBe(60 * 60_000);
  });
});

describe("time zones", () => {
  it("finds Prague midnight in summer and winter", () => {
    expect(startOfDay(new Date("2026-07-15T12:00:00Z"), "Europe/Prague").toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(startOfDay(new Date("2026-01-15T12:00:00Z"), "Europe/Prague").toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });
  it("handles the hour before local midnight", () => {
    // 23:30 UTC on Oct 19 is already Oct 20 in Prague (UTC+2)
    expect(startOfDay(new Date("2026-10-19T23:30:00Z"), "Europe/Prague").toISOString()).toBe("2026-10-19T22:00:00.000Z");
  });
  it("finds the first of the month", () => {
    expect(startOfMonth(new Date("2026-11-20T10:00:00Z"), "Europe/Prague").toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
});

describe("money", () => {
  it("converts Etsy money", () => {
    expect(moneyToCents({ amount: 1799, divisor: 100 })).toBe(1799);
  });
  it("prices Claude usage", () => {
    const cents = usageCostUsdCents("claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
    } as never);
    expect(cents).toBeCloseTo(400 + 200);
  });
});

describe("splitMessage", () => {
  it("splits long text on newlines", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i} ${"x".repeat(80)}`).join("\n");
    const parts = splitMessage(text, 1000);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join("\n")).toBe(text);
  });
});

describe("formatBriefing", () => {
  const data: BriefingData = {
    date: "Tuesday, 20 October 2026",
    revenue: { yesterday: 3598, monthToDate: 50_000 },
    costs: { yesterday: 120, monthToDate: 10_000 },
    agents: [{ id: "etsy-pod", name: "Etsy / Print-on-Demand Agent", status: "idle", done: 4, failed: 1, highlights: ["5 drafts"] }],
    incidents: [{ task: "etsy-pod:sync_sales", error: "timeout", fixed: true }],
    opportunities: [],
    approvals: [{ id: "abc", title: "Publish 5 Etsy listing(s)", amount: "€0.92" }],
  };
  it("shows progress towards the goal and pending decisions", () => {
    const text = formatBriefing(data, "• Ship more listings");
    expect(text).toContain("Net this month: €400.00 — 4% of €10,000");
    expect(text).toContain("fixed ✅");
    expect(text).toContain("/approve abc");
    expect(text).toContain("CEO focus");
  });
});
