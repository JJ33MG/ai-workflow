import { describe, expect, it } from "vitest";
import { pickMugProduct, pickMugVariant, pickStore, printfileFor } from "../src/lib/printfulSetup.js";

describe("Printful setup", () => {
  it("orders through the API store, never the Etsy-linked one", () => {
    expect(pickStore([{ id: 1, name: "AllyouwishDesigns", type: "etsy" }, { id: 2, name: "API", type: "native" }])?.id).toBe(2);
    expect(pickStore([{ id: 1, name: "AllyouwishDesigns", type: "etsy" }])).toBeNull();
  });

  it("finds the 11 oz white glossy mug", () => {
    const catalog = [{ id: 5, title: "Black Glossy Mug" }, { id: 19, title: "White Glossy Mug" }];
    expect(pickMugProduct(catalog)?.id).toBe(19);
    const product = {
      product: { id: 19, title: "White Glossy Mug", type: "MUG" },
      variants: [
        { id: 4830, name: "White Glossy Mug (15 oz)", size: "15 oz", color: "White", price: "8.50" },
        { id: 1320, name: "White Glossy Mug (11 oz)", size: "11 oz", color: "White", price: "6.50" },
      ],
    };
    expect(pickMugVariant(product)?.id).toBe(1320);
  });

  it("reads the print-file size for the variant", () => {
    const info = {
      printfiles: [{ printfile_id: 43, width: 2700, height: 1050, dpi: 300 }],
      variant_printfiles: [{ variant_id: 1320, placements: { default: 43 } }],
    };
    expect(printfileFor(info, 1320)).toEqual({ placement: "default", width: 2700, height: 1050 });
    expect(printfileFor(info, 999)).toBeNull();
  });
});

describe("Printful mockups", () => {
  async function run(handler: (path: string, body: Record<string, unknown> | undefined) => unknown) {
    const { vi } = await import("vitest");
    const calls: { path: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^https:\/\/[^/]+/, "");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      const result = handler(path, body);
      const ok = !(result instanceof Error);
      return new Response(JSON.stringify(ok ? { result } : { error: { message: (result as Error).message } }), { status: ok ? 200 : 400 });
    });
    vi.useFakeTimers();
    try {
      const { generateMockup } = await import("../src/integrations/printful.js");
      const promise = generateMockup("https://example.com/d.png", { width: 2700, height: 1050 });
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(5000);
      return { urls: await promise, calls };
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  }

  it("asks for every view and keeps the extra angles", async () => {
    const { urls, calls } = await run((path) => {
      if (path.startsWith("/mockup-generator/printfiles")) return { printfiles: [], variant_printfiles: [], options: ["Front", "Left", "Right"] };
      if (path.startsWith("/mockup-generator/create-task")) return { task_key: "k1" };
      return { status: "completed", mockups: [{ mockup_url: "a.jpg", extra: [{ url: "b.jpg" }, { url: "c.jpg" }] }] };
    });
    expect(urls).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    const create = calls.filter((c) => c.path.startsWith("/mockup-generator/create-task"));
    expect(create).toHaveLength(1);
    expect(create[0].body?.options).toEqual(["Front", "Left", "Right"]);
    expect((create[0].body?.files as { position?: unknown }[])[0].position).toMatchObject({ area_width: 2700, area_height: 1050 });
  });

  it("falls back to the plain mockup when the views are refused", async () => {
    const { urls } = await run((path, body) => {
      if (path.startsWith("/mockup-generator/printfiles")) return { printfiles: [], variant_printfiles: [], options: ["Bogus"] };
      if (path.startsWith("/mockup-generator/create-task")) return body?.options ? new Error("Invalid option") : { task_key: "k2" };
      return { status: "completed", mockups: [{ mockup_url: "plain.jpg" }] };
    });
    expect(urls).toEqual(["plain.jpg"]);
  });
});

describe("Printful rate limit", () => {
  it("waits as long as Printful asks", async () => {
    const { retryAfterSeconds } = await import("../src/integrations/printful.js");
    expect(retryAfterSeconds("You've recently sent too many requests. Please try again after 41 seconds.", null)).toBe(41);
    expect(retryAfterSeconds(undefined, "12")).toBe(12);
    expect(retryAfterSeconds("Too many requests", null)).toBe(60);
  });
});
