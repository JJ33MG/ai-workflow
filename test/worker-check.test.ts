import { describe, expect, it } from "vitest";
import { workerCheck } from "../src/lib/health.js";

const now = new Date("2026-11-21T16:20:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe("task queue check", () => {
  it("is fine while a long task runs, and says which one", () => {
    const c = workerCheck({ startedAt: ago(18), lastWorkerTickAt: null, busySince: ago(17), busyWith: "etsy-pod:refresh_listings" }, now);
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("etsy-pod:refresh_listings");
  });

  it("warns when one task has been busy for over 2 hours, and errors after 4", () => {
    expect(workerCheck({ startedAt: ago(200), lastWorkerTickAt: ago(190), busySince: ago(130), busyWith: "x:y" }, now).status).toBe("warn");
    expect(workerCheck({ startedAt: ago(300), lastWorkerTickAt: ago(290), busySince: ago(250), busyWith: "x:y" }, now).status).toBe("error");
  });

  it("is fine after a recent tick, and an error when the worker stopped", () => {
    expect(workerCheck({ startedAt: ago(60), lastWorkerTickAt: ago(0.5), busySince: null, busyWith: null }, now).status).toBe("ok");
    expect(workerCheck({ startedAt: ago(60), lastWorkerTickAt: ago(10), busySince: null, busyWith: null }, now).status).toBe("error");
  });
});
