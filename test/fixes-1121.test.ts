import { describe, expect, it } from "vitest";
import { drawPage } from "../src/agents/kdpColoring.js";
import { budgetSkip } from "../src/agents/etsyDigital.js";
import { shouldWarnBudget } from "../src/agents/debug.js";

describe("drawing a coloring page", () => {
  it("tries again when a drawing is cut off or broken, and asks for a simpler one", async () => {
    const prompts: string[] = [];
    let calls = 0;
    const page = await drawPage("Polar bear", "Winter", "4-8", {
      ask: async (_model, prompt) => {
        prompts.push(prompt);
        if (++calls === 1) throw new Error("Claude response was cut off at max_tokens (kdp_page_svg)");
        return "<svg viewBox=\"0 0 10 10\"></svg>";
      },
      render: async () => Buffer.from("png"),
      edges: async () => [],
      review: async () => ({ ok: true, problems: [] }),
    });
    expect(page).not.toBeNull();
    expect(calls).toBe(2);
    expect(prompts[1]).toMatch(/simpler|shorter/i);
  });

  it("gives up only after every model had its try", async () => {
    let calls = 0;
    const page = await drawPage("Polar bear", "Winter", "4-8", {
      ask: async () => {
        calls++;
        throw new Error("Input buffer has corrupt header");
      },
      render: async () => Buffer.from("png"),
      edges: async () => [],
      review: async () => ({ ok: true, problems: [] }),
    });
    expect(page).toBeNull();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe("budget for a download product", () => {
  it("skips quietly when today's budget is too low, instead of failing", () => {
    expect(budgetSkip(83, 200)).toEqual({ skipped: "Niet genoeg Claude-budget vandaag (€0.83 over, nodig tot €2.00); morgen opnieuw." });
    expect(budgetSkip(300, 200)).toBeNull();
  });
});

describe("budget warning", () => {
  it("warns once a day when spend passes 80%, not every half hour", () => {
    expect(shouldWarnBudget(417, 500, null, "2026-11-21")).toBe(true);
    expect(shouldWarnBudget(417, 500, "2026-11-21", "2026-11-21")).toBe(false);
    expect(shouldWarnBudget(417, 500, "2026-11-20", "2026-11-21")).toBe(true);
    expect(shouldWarnBudget(100, 500, null, "2026-11-21")).toBe(false);
  });
});

import { PAGE_REQUEST } from "../src/agents/kdpColoring.js";

describe("drawing a coloring page", () => {
  it("leaves the answer room for the whole drawing: little thinking, a large token limit (streamed)", () => {
    expect(PAGE_REQUEST.effort).toBe("low");
    expect(PAGE_REQUEST.maxTokens).toBeGreaterThanOrEqual(20000);
    // Above ~21k the SDK needs streaming; askText streams those requests since 26 Nov, so 32k is allowed.
    expect(PAGE_REQUEST.maxTokens).toBe(32000);
  });
});
