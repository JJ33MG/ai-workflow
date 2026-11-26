import { describe, expect, it } from "vitest";
import { grokCostCents, parseGrokResponse } from "../src/lib/grok.js";

const response = {
  output: [
    { type: "x_search_call", id: "t1" },
    {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "People on X are posting about nurse gift mugs.",
          annotations: [
            { type: "url_citation", url: "https://x.com/someone/status/1", title: "post" },
            { type: "url_citation", url: "https://x.com/someone/status/1" },
            { type: "url_citation", url: "https://example.com/a" },
          ],
        },
      ],
    },
  ],
  usage: { input_tokens: 100, output_tokens: 50, cost_in_usd_ticks: 28_896_000 },
};

describe("parseGrokResponse", () => {
  it("takes the answer text and every source once", () => {
    expect(parseGrokResponse(response)).toEqual({
      text: "People on X are posting about nurse gift mugs.",
      sources: ["https://x.com/someone/status/1", "https://example.com/a"],
    });
  });

  it("copes with an answer without sources", () => {
    expect(parseGrokResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }] })).toEqual({ text: "hi", sources: [] });
  });
});

describe("grokCostCents", () => {
  it("turns xAI's cost ticks (10^-10 USD) into US cents", () => {
    expect(grokCostCents(response.usage)).toBeCloseTo(0.28896, 5);
    expect(grokCostCents({})).toBe(0);
  });
});
