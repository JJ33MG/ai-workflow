import { describe, expect, it } from "vitest";
import { computeLift, tacticsFor, verdictFor } from "../src/lib/marketing.js";

describe("Marketing measurement", () => {
  const before = (id: string, views: number, ageDays: number) => ({ listingId: id, views, ageDays });

  it("measures the changed listings against the untouched ones", () => {
    // Target: 10 views over 10 days (1/day), then 28 in 14 days (2/day): x2.
    // Control: 20 views over 10 days (2/day), then 28 in 14 days (2/day): x1.
    const lift = computeLift(
      { before: [before("a", 10, 10)], viewsNow: { a: 38, b: 48 } },
      { before: [before("b", 20, 10)], viewsNow: { a: 38, b: 48 } },
      14,
    );
    expect(lift.liftPct).toBe(100);
    expect(lift.targetViewsAfter).toBe(28);
  });

  it("takes out what happened to the whole shop", () => {
    // Both doubled: the change itself did nothing.
    const now = { a: 38, b: 76 };
    const lift = computeLift({ before: [before("a", 10, 10)], viewsNow: now }, { before: [before("b", 20, 10)], viewsNow: now }, 14);
    expect(lift.liftPct).toBe(0);
  });

  it("ignores listings that ended and has no answer without earlier views", () => {
    expect(computeLift({ before: [before("a", 10, 10)], viewsNow: {} }, { before: [], viewsNow: {} }, 14).liftPct).toBeNull();
    expect(computeLift({ before: [before("a", 0, 10)], viewsNow: { a: 5 } }, { before: [], viewsNow: {} }, 14).liftPct).toBeNull();
  });

  it("only calls it when there are enough views", () => {
    expect(verdictFor(50, 10)).toBe("unclear");
    expect(verdictFor(50, 40)).toBe("worked");
    expect(verdictFor(-30, 40)).toBe("worse");
    expect(verdictFor(5, 40)).toBe("no_effect");
    expect(verdictFor(null, 100)).toBe("unclear");
  });

  it("offers each business only its own tactics, and manual everywhere", () => {
    expect(tacticsFor("etsy-pod").map((t) => t.id)).toEqual(["etsy_seo_refresh", "etsy_niche_focus", "manual"]);
    expect(tacticsFor("kdp-coloring").map((t) => t.id)).toEqual(["manual"]);
    expect(tacticsFor("kdp-coloring").every((t) => !t.auto)).toBe(true);
  });
});

describe("Pinterest boards", () => {
  it("matches board names loosely, so no duplicate boards appear", async () => {
    const { sameBoard } = await import("../src/integrations/pinterest.js");
    expect(sameBoard("Gifts for Nurses", " gifts for  nurses ")).toBe(true);
    expect(sameBoard("Gifts for Nurses", "Gifts for Teachers")).toBe(false);
  });
});

describe("Instagram + Facebook", () => {
  const page = (id: string, ig?: string) => ({ id, name: `Page ${id}`, access_token: `t${id}`, ...(ig ? { instagram_business_account: { id: ig } } : {}) });

  it("posts to the Page with Instagram, unless a Page is named", async () => {
    const { pickPage } = await import("../src/integrations/meta.js");
    expect(pickPage([page("1"), page("2", "ig2")], "")?.id).toBe("2");
    expect(pickPage([page("1"), page("2", "ig2")], "1")?.id).toBe("1");
    expect(pickPage([page("1")], "9")).toBeNull();
    expect(pickPage([], "")).toBeNull();
  });

  it("publishes to Instagram in two steps: container, then publish", async () => {
    const { vi } = await import("vitest");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      calls.push(`${init?.method ?? "GET"} ${u.pathname.replace(/^\/v[\d.]+/, "")}`);
      const body = u.pathname.endsWith("/media") ? { id: "c1" } : u.pathname.endsWith("/media_publish") ? { id: "post1" } : { status_code: "FINISHED" };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    try {
      const { postToInstagram } = await import("../src/integrations/meta.js");
      const conn = { pageId: "p", pageName: "Shop", pageToken: "t", instagramId: "ig", instagramUsername: "shop" };
      expect(await postToInstagram(conn, "https://img/x.jpg", "Hi", 0)).toBe("post1");
      expect(calls).toEqual(["POST /ig/media", "GET /c1", "POST /ig/media_publish"]);
      await expect(postToInstagram({ ...conn, instagramId: null }, "https://img/x.jpg", "Hi", 0)).rejects.toThrow(/No Instagram/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
