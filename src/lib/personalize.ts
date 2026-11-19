// Personalized designs: the buyer types a name at checkout and it is printed in the design.
// A personalized design is an ordinary SVG with exactly one <text id="personal-name"> element;
// its text is the example name shown in the listing photos and is replaced per order. A long
// name gets a smaller font so it always stays inside the design, never cut off.
import sharp from "sharp";
import { renderPrintFile, viewBoxOf, withViewBox } from "./design.js";

export const NAME_ID = "personal-name";
/** Etsy's text box limit: long enough for "Grandma Rose", short enough to stay readable. */
export const MAX_NAME_CHARS = 14;
/** Extra charged for a personalized product, on top of the normal price. */
export const PERSONALIZATION_EXTRA_CENTS = 400;

/** The question buyers answer at checkout (Etsy: question ≤ 45 chars, instructions ≤ 120). */
export const PERSONALIZATION_QUESTION = {
  question_type: "text_input",
  question_text: "Name to print",
  instructions: `Type the name exactly as it should be printed, up to ${MAX_NAME_CHARS} characters. We print it as you type it.`,
  required: true,
  max_allowed_characters: MAX_NAME_CHARS,
};

/** Etsy sends the buyer's answers as variations with this property id. */
export const PERSONALIZATION_PROPERTY_ID = 54;

const NAME_ELEMENT = new RegExp(`(<text\\b[^>]*\\bid\\s*=\\s*["']${NAME_ID}["'][^>]*>)([\\s\\S]*?)(</text>)`, "i");

export const isPersonalizable = (svg: string) => (svg.match(new RegExp(`\\bid\\s*=\\s*["']${NAME_ID}["']`, "gi")) ?? []).length === 1 && NAME_ELEMENT.test(svg);

/** Problems with a personalized template, for the designer to fix (empty = fine). */
export function templateProblems(svg: string): string[] {
  const ids = (svg.match(new RegExp(`\\bid\\s*=\\s*["']${NAME_ID}["']`, "gi")) ?? []).length;
  if (ids !== 1) return [`there must be exactly one <text id="${NAME_ID}"> element (found ${ids})`];
  const m = svg.match(NAME_ELEMENT);
  if (!m) return [`the id "${NAME_ID}" must be on a <text> element`];
  const problems: string[] = [];
  if (/<tspan/i.test(m[2])) problems.push(`the <text id="${NAME_ID}"> element must contain only the name, no <tspan>`);
  if (!fontSizeOf(m[1])) problems.push(`give <text id="${NAME_ID}"> a numeric font-size attribute`);
  if (!/text-anchor\s*[:=]\s*["']?middle/i.test(m[1])) problems.push(`give <text id="${NAME_ID}"> text-anchor="middle" so a longer name grows evenly from the centre`);
  return problems;
}

function fontSizeOf(openTag: string): number | null {
  const m = openTag.match(/\bfont-size\s*=\s*["']?([\d.]+)/i) ?? openTag.match(/font-size\s*:\s*([\d.]+)/i);
  return m ? Number(m[1]) : null;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** The design with this name in it, at the given font size (unchanged size when omitted). */
export function applyName(svg: string, name: string, fontSize?: number): string {
  return svg.replace(NAME_ELEMENT, (_all, open: string, _old: string, close: string) => {
    const upper = /data-case\s*=\s*["']upper["']/i.test(open);
    let tag = open;
    if (fontSize) {
      tag = /\bfont-size\s*=/.test(tag)
        ? tag.replace(/\bfont-size\s*=\s*["']?[\d.]+(px)?["']?/i, `font-size="${fontSize.toFixed(1)}"`)
        : tag.replace(/font-size\s*:\s*[\d.]+(px)?/i, `font-size:${fontSize.toFixed(1)}px`);
    }
    return `${tag}${escapeXml(upper ? name.toUpperCase() : name)}${close}`;
  });
}

/** The example name in a template (what the listing photos show). */
export function exampleName(svg: string): string {
  return (svg.match(NAME_ELEMENT)?.[2] ?? "").replace(/<[^>]+>/g, "").trim();
}

/** The horizontal extent of everything drawn, measured on a canvas three times wider than the design. */
async function inkSpan(svg: string): Promise<[number, number]> {
  const [vx, vy, vw, vh] = viewBoxOf(svg);
  const scale = Math.min(2, 1500 / vw);
  const wide = [vx - vw, vy, vw * 3, vh];
  const { data, info } = await sharp(Buffer.from(withViewBox(svg, wide, Math.round(wide[2] * scale), Math.round(vh * scale))))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let right = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + info.channels - 1] > 20) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right < 0) throw new Error("Design is empty");
  return [wide[0] + left / scale, wide[0] + (right + 1) / scale];
}

/**
 * The design with the buyer's name, shrinking the name's font until everything stays inside the
 * design's width (with a margin). The rest of the design is untouched.
 */
export async function fitName(svg: string, name: string): Promise<string> {
  const m = svg.match(NAME_ELEMENT);
  if (!m) throw new Error(`Design has no <text id="${NAME_ID}"> element`);
  const base = fontSizeOf(m[1]);
  if (!base) throw new Error(`<text id="${NAME_ID}"> has no numeric font-size`);
  const [vx, , vw] = viewBoxOf(svg);
  // The name may use the margin band or as much width as the template already uses, whichever is wider.
  const [tl, tr] = await inkSpan(svg);
  const min = Math.min(vx + vw * 0.06, tl);
  const max = Math.max(vx + vw * 0.94, tr);
  let size = base;
  for (let i = 0; i < 12; i++) {
    const out = applyName(svg, name, size === base ? undefined : size);
    const [left, right] = await inkSpan(out);
    if (left >= min - 0.5 && right <= max + 0.5) return out;
    const over = Math.max((right - left) / (max - min), 1.02);
    size = size / over;
    if (size < base * 0.35) break;
  }
  throw new Error(`The name "${name}" does not fit in the design, even at a much smaller size`);
}

export type NameCheck = { ok: true; text: string } | { ok: false; text: string; reason: string };

/**
 * Cleans what the buyer typed and checks it can be printed: our fonts cover Latin letters with
 * accents, digits and simple punctuation. Anything else goes to Jarne first.
 */
export function checkName(raw: string | null | undefined): NameCheck {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, text, reason: "de koper vulde geen naam in" };
  if (text.length > MAX_NAME_CHARS + 6) return { ok: false, text, reason: `de tekst is ${text.length} tekens, meer dan in het ontwerp past` };
  if (!/^[\p{Script=Latin}0-9 '’.,&!?\-]+$/u.test(text)) {
    return { ok: false, text, reason: "de tekst bevat tekens of emoji die niet goed geprint kunnen worden" };
  }
  return { ok: true, text };
}

/** All readable text in a design, in order (for the quality check of a personalized print). */
export function designText(svg: string): string {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((t) => t[1].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" / ");
}

/** The buyer's answer on an Etsy transaction (the first text answer, if the listing asked one). */
export function personalizationOf(t: { variations?: { property_id: number; formatted_value: string }[] | null }): string | null {
  const v = (t.variations ?? []).find((x) => x.property_id === PERSONALIZATION_PROPERTY_ID && !/^https?:\/\//.test(x.formatted_value));
  return v ? v.formatted_value : null;
}

const SAMPLE_NAMES = ["Emma", "Grandpa Joe", "Sophia", "Liam", "Aunt Rosie", "Noah"];

/** Three names to show on the listing photo: the design's own example first, then two different ones. */
export function sampleNames(example: string): string[] {
  const others = SAMPLE_NAMES.filter((n) => n.toLowerCase() !== example.toLowerCase());
  return [example || others.shift()!, others[0], others[1]];
}

const CARD = 2000;

/**
 * The listing photo that sells personalization: "Add any name" with the design shown three times,
 * each with a different name, on clean white cards. Fonts are the generic families the server has.
 */
export async function personalizationCard(svg: string): Promise<Buffer> {
  const names = sampleNames(exampleName(svg));
  const cardW = 560;
  const cardH = 720;
  const gap = 60;
  const left0 = Math.round((CARD - (3 * cardW + 2 * gap)) / 2);
  const top = 560;
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  for (const [i, name] of names.entries()) {
    const art = await renderPrintFile(await fitName(svg, name), "center", cardW - 60, cardH - 170, "dark");
    const left = left0 + i * (cardW + gap);
    tiles.push({ input: art, left: left + 30, top: top + 40 });
  }
  const cards = names
    .map((name, i) => {
      const x = left0 + i * (cardW + gap);
      return (
        `<rect x="${x + 6}" y="${top + 10}" width="${cardW}" height="${cardH}" rx="28" fill="#000" opacity="0.06"/>` +
        `<rect x="${x}" y="${top}" width="${cardW}" height="${cardH}" rx="28" fill="#ffffff"/>` +
        `<text x="${x + cardW / 2}" y="${top + cardH - 50}" text-anchor="middle" font-family="sans-serif" font-size="40" fill="#7a7a7a">“${escapeXml(name)}”</text>`
      );
    })
    .join("");
  const ticks = ["Any name, up to 14 characters", "Printed exactly as you type it", "Made just for them"];
  const tickRow = ticks
    .map((t, i) => `<text x="${CARD / 2}" y="${1470 + i * 78}" text-anchor="middle" font-family="sans-serif" font-size="46" fill="#3c3c3c"><tspan fill="#9b1c2c" font-weight="bold">✓</tspan>  ${escapeXml(t)}</text>`)
    .join("");
  const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD}" height="${CARD}" viewBox="0 0 ${CARD} ${CARD}">
  <rect width="${CARD}" height="${CARD}" fill="#f6f1ea"/>
  <text x="${CARD / 2}" y="200" text-anchor="middle" font-family="sans-serif" font-size="40" letter-spacing="10" fill="#9b1c2c">PERSONALIZED GIFT</text>
  <text x="${CARD / 2}" y="350" text-anchor="middle" font-family="serif" font-size="140" fill="#1f2a24">Add any name</text>
  <text x="${CARD / 2}" y="445" text-anchor="middle" font-family="sans-serif" font-size="50" fill="#5b5b5b">Type it in the personalization box at checkout</text>
  ${cards}
  ${tickRow}
  <text x="${CARD / 2}" y="1880" text-anchor="middle" font-family="serif" font-style="italic" font-size="44" fill="#9b9b9b">All You Can Wish</text>
</svg>`;
  return sharp(Buffer.from(frame)).composite(tiles).png().toBuffer();
}

/** The text a personalized design should show: the slogan with NAME replaced by the sample name, as printed. */
export function intendedText(slogan: string, svg: string): string {
  const m = svg.match(NAME_ELEMENT);
  const sample = exampleName(svg);
  const shown = m && /data-case\s*=\s*["']upper["']/i.test(m[1]) ? sample.toUpperCase() : sample;
  return slogan.replace(/\bNAME\b/g, shown);
}

/**
 * Tidies a freshly drawn template so it behaves the same in the photos as on an order: the name
 * line is centred (text-anchor middle at the design's centre) and a name meant for capitals is
 * shown in capitals already.
 */
export function normalizeTemplate(svg: string): string {
  const m = svg.match(NAME_ELEMENT);
  if (!m) return svg;
  let open = m[1];
  if (!/text-anchor\s*[:=]\s*["']?middle/i.test(open)) {
    const [vx, , vw] = viewBoxOf(svg);
    const centre = String(Math.round(vx + vw / 2));
    open = open.replace(/text-anchor\s*=\s*["'][^"']*["']/i, "").replace(/text-anchor\s*:\s*[^;"']+;?/i, "");
    open = /\sx\s*=\s*["'][^"']*["']/i.test(open) ? open.replace(/\sx\s*=\s*["'][^"']*["']/i, ` x="${centre}"`) : open.replace(/^<text\b/i, `<text x="${centre}"`);
    open = open.replace(/^<text\b/i, '<text text-anchor="middle"');
  }
  const fixed = svg.replace(NAME_ELEMENT, `${open}${m[2]}${m[3]}`);
  return /<tspan/i.test(m[2]) ? fixed : applyName(fixed, exampleName(fixed));
}
