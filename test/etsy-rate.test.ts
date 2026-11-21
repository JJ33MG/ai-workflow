import { describe, expect, it } from "vitest";
import { withRateLimitRetry } from "../src/integrations/etsy.js";

describe("Etsy rate limit", () => {
  it("waits and tries again when Etsy says too many requests per second", async () => {
    let calls = 0;
    const res = await withRateLimitRetry(async () => {
      calls++;
      return calls === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }) : new Response(null, { status: 204 });
    });
    expect(res.status).toBe(204);
    expect(calls).toBe(2);
  });
});
