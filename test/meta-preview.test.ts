import { describe, expect, it, vi } from "vitest";

const posted: string[] = [];
vi.mock("../src/integrations/meta.js", () => ({
  metaConnection: async () => ({ pageId: "p", pageName: "All You Can Wish", pageToken: "t", instagramId: "ig", instagramUsername: "allyoucanwish.design" }),
  isMetaConfigured: () => true,
  postToFacebook: async () => { posted.push("facebook"); return "fb1"; },
  postToInstagram: async () => { posted.push("instagram"); return "ig1"; },
}));
vi.mock("../src/lib/claude.js", () => ({
  askJson: async () => ({ posts: [{ listingId: "L1", facebook: "FB text https://www.etsy.com/listing/99", instagram: "IG text. Link in bio #gift" }] }),
  askText: async () => "",
  isClaudeConfigured: () => true,
}));
vi.mock("../src/integrations/etsy.js", () => ({ getLargeImageUrl: async () => "https://i.etsystatic.com/x.jpg" }));
vi.mock("../src/db.js", () => ({
  db: {
    socialPost: { findMany: async () => [], create: async () => { posted.push("db"); return {}; } },
    listing: { findMany: async () => [{ id: "L1", title: "Snowplow Hoodie", niche: "snowplow", tags: [], etsyListingId: "99" }] },
    approval: { findFirst: async () => null, count: async () => 0, create: async () => ({ id: "a" }) },
  },
  getSetting: async () => null,
  setSetting: async () => {},
}));

describe("Meta post preview", () => {
  it("writes the posts as they would go out, without asking approval or posting anything", async () => {
    const { marketingAgent } = await import("../src/agents/marketing.js");
    const log = { info: vi.fn(async () => {}), warn: async () => {}, error: async () => {} };
    const res = (await marketingAgent.handlers.meta_posts({ preview: true }, { log })) as { preview: unknown[] };
    expect(res.preview).toEqual([
      { title: "Snowplow Hoodie", imageUrl: "https://i.etsystatic.com/x.jpg", link: "https://www.etsy.com/listing/99", facebook: "FB text https://www.etsy.com/listing/99", instagram: "IG text. Link in bio #gift" },
    ]);
    expect(posted).toEqual([]);
  });
});
