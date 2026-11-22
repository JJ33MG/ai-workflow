import { describe, expect, it } from "vitest";
import { routifyCheck } from "../src/lib/health.js";

const stats = (errors24h: number) => ({ generatedAt: "2026-12-01T07:10:00Z", health: { errors24h, lastError: errors24h ? { at: "2026-12-01T06:00:00Z", message: "database unreachable" } : null } });

describe("Routify on the health list", () => {
  it("is an error when the site does not answer", () => {
    expect(routifyCheck(stats(0) as never, false).status).toBe("error");
  });
  it("warns with the last server error of the day", () => {
    const c = routifyCheck(stats(3) as never, true);
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("3 serverfout(en)");
    expect(c.detail).toContain("database unreachable");
  });
  it("is fine when it answers and had no errors", () => {
    expect(routifyCheck(stats(0) as never, true).status).toBe("ok");
  });
});
