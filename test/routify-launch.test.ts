import { describe, expect, it } from "vitest";
import { IDEAS, LAUNCH, launchView } from "../src/routifyLaunch.js";

const stats = (setup: Record<string, unknown>, gems = { library: 0, seedSearches: 0, seedBudget: 0 }) => ({ setup, gems }) as never;

describe("Routify launch list", () => {
  it("has soft and hard launch steps for Jarne and for Claude, and ideas", () => {
    for (const stage of ["soft", "hard"]) {
      for (const owner of ["jarne", "claude"]) expect(LAUNCH.some((i) => i.stage === stage && i.owner === owner)).toBe(true);
    }
    expect(new Set(LAUNCH.map((i) => i.id)).size).toBe(LAUNCH.length);
    expect(IDEAS.length).toBeGreaterThan(5);
  });

  it("ticks off a step by itself when Routify reports it is set up", () => {
    const v = launchView(stats({ mapsStatic: "ok", stripe: false, partners: ["booking"], adminEmails: true }), {});
    const status = (id: string) => v.items.find((i) => i.id === id)!.status;
    expect(status("j-maps")).toBe("done");
    expect(status("j-booking")).toBe("done");
    expect(status("j-stripe")).toBe("todo");
    expect(v.items.find((i) => i.id === "j-maps")!.auto).toBe(true);
  });

  it("keeps Jarne's own ticks, and counts what is left per launch", () => {
    const v = launchView(null, { "j-domain": "done" });
    expect(v.items.find((i) => i.id === "j-domain")!.status).toBe("done");
    const soft = v.progress.soft;
    expect(soft.done).toBeGreaterThan(0);
    expect(soft.total).toBe(LAUNCH.filter((i) => i.stage === "soft").length);
  });
});

describe("Routify launch list: waiting for approval", () => {
  it("shows Booking.com as waiting until Routify reports the partner is set", () => {
    expect(launchView(null, {}).items.find((i) => i.id === "j-booking")!.status).toBe("waiting");
    expect(launchView({ setup: { partners: ["booking"] } } as never, {}).items.find((i) => i.id === "j-booking")!.status).toBe("done");
  });
});
