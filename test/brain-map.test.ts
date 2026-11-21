import { describe, expect, it } from "vitest";
import { buildBrain } from "../src/brain.js";

const biz = (id: string, byStatus: Record<string, number>) => ({
  id, name: id, stage: "setting-up", products: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
});

describe("business on the brain map", () => {
  it("shows a shop with live products as live, with what waits for approval", () => {
    const { nodes } = buildBrain({
      checks: [], agents: [], approvals: [], plan: [],
      businesses: [biz("etsy-pod", { active: 87, uploaded: 31, removed: 16 })],
    } as never);
    const n = nodes.find((x: { id: string }) => x.id === "biz:etsy-pod") as { status: { state: string; label: string; detail: string } };
    expect(n.status.state).toBe("live");
    expect(n.status.label).toBe("Live");
    expect(n.status.detail).toBe("87 product(en) live, 31 wachten op jouw akkoord; nog geen verkoop in 30 dagen.");
  });
});
