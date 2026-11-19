import { describe, expect, it } from "vitest";
import { applyName, checkName, designText, exampleName, fitName, isPersonalizable, personalizationOf, templateProblems } from "../src/lib/personalize.js";
import { viewBoxOf } from "../src/lib/design.js";
import sharp from "sharp";

const template = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800">
  <text x="500" y="250" font-family="serif" font-size="90" text-anchor="middle" fill="#1f4d3a">This mug belongs to</text>
  <text id="personal-name" x="500" y="450" font-family="sans-serif" font-weight="bold" font-size="170" text-anchor="middle" fill="#9b1c2c" data-case="upper">Emma</text>
  <text x="500" y="600" font-family="serif" font-size="80" text-anchor="middle" fill="#1f4d3a">hands off</text>
</svg>`;

/** Leftmost and rightmost inked pixel when rendered at its own size. */
async function span(svg: string) {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let l = info.width, r = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 20) { l = Math.min(l, x); r = Math.max(r, x); }
  return [l, r];
}

describe("personalization", () => {
  it("recognises a valid template and explains a broken one", () => {
    expect(isPersonalizable(template)).toBe(true);
    expect(templateProblems(template)).toEqual([]);
    expect(exampleName(template)).toBe("Emma");
    expect(templateProblems(template.replace('text-anchor="middle" fill="#9b1c2c"', 'fill="#9b1c2c"'))[0]).toMatch(/text-anchor/);
    expect(templateProblems(template.replace('id="personal-name"', ""))[0]).toMatch(/exactly one/);
  });

  it("puts the name in safely, in capitals when the design asks for it", () => {
    const out = applyName(template, `Zoë & <Jo>`);
    expect(out).toContain(">ZOË &amp; &lt;JO&gt;</text>");
    expect(designText(out)).toBe("This mug belongs to / ZOË & <JO> / hands off");
  });

  it("keeps a short name at its size and shrinks a long one to fit", async () => {
    const short = await fitName(template, "Mia");
    expect(short).toContain('font-size="170"');
    const long = await fitName(template, "Maximiliaan Jr");
    const size = Number(long.match(/id="personal-name"[^>]*font-size="([\d.]+)"/)![1]);
    expect(size).toBeLessThan(170);
    // Never wider than the design already was (or the 6% margins), so nothing is ever cut off.
    const [, , w] = viewBoxOf(long);
    const [tl, tr] = await span(template);
    const [l, r] = await span(long);
    expect(l).toBeGreaterThanOrEqual(Math.min(tl, w * 0.06) - 2);
    expect(r).toBeLessThanOrEqual(Math.max(tr, w * 0.94) + 2);
  });

  it("accepts names with accents and refuses what can't be printed", () => {
    expect(checkName("  Anne-Sophie  ")).toEqual({ ok: true, text: "Anne-Sophie" });
    expect(checkName("Zoë O'Neil")).toMatchObject({ ok: true });
    expect(checkName("")).toMatchObject({ ok: false });
    expect(checkName("Emma 🎄")).toMatchObject({ ok: false });
    expect(checkName("Александр")).toMatchObject({ ok: false });
  });

  it("reads the buyer's name from an Etsy transaction", () => {
    expect(personalizationOf({ variations: [{ property_id: 513, formatted_value: "15 oz" }, { property_id: 54, formatted_value: "Emma" }] })).toBe("Emma");
    expect(personalizationOf({ variations: [] })).toBeNull();
    expect(personalizationOf({})).toBeNull();
  });
});

describe("personalization photo", () => {
  it("shows the design with three different names", async () => {
    const { personalizationCard, sampleNames } = await import("../src/lib/personalize.js");
    expect(sampleNames("Emma")).toEqual(["Emma", "Grandpa Joe", "Sophia"]);
    expect(new Set(sampleNames("Sophia")).size).toBe(3);
    const png = await personalizationCard(template);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([2000, 2000]);
    if (process.env.CARD_PREVIEW) (await import("node:fs")).writeFileSync(process.env.CARD_PREVIEW, png);
  }, 60_000);
});
