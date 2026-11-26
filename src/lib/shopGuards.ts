// Rules that keep the Etsy shop safe and readable (Jarne, 26 Nov):
// - no live listing is taken down or has its photos replaced before 15 December without his approval;
// - the same photo is never uploaded twice to one listing;
// - the short-title test touches only 8 listings;
// - a mug's first photo is a close-up where the joke fills the frame.
import sharp from "sharp";
import { contentBox, lightInk, renderDensity, withViewBox } from "./design.js";

/** Christmas sales: live listings stay as they are until this day (Prague). */
export const frozenUntil = "2026-12-15";
const FREEZE_END = Date.UTC(2026, 11, 14, 23); // 15 Dec 00:00 in Prague

export const isFrozen = (now = new Date()) => now.getTime() < FREEZE_END;

/** True when this image (by hash) was uploaded before and is still on the listing. */
export function alreadyUploaded(seen: Record<string, string>, hash: string, liveImageIds: number[]): boolean {
  const live = new Set(liveImageIds.map(String));
  return Object.entries(seen).some(([imageId, h]) => h === hash && live.has(imageId));
}

const TEST_SIZE = 8;

/** The listings for the short-title test: the ones given, else the 8 oldest with a long title. */
export function pickTitleTest<T extends { id: string; title: string; createdAt: Date }>(rows: T[], ids: string[] | undefined): T[] {
  if (ids?.length) return rows.filter((r) => ids.includes(r.id));
  return rows
    .filter((r) => r.title.length > 70)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, TEST_SIZE);
}

const SIZE = 2000;

/** A square close-up of the mug's printed side: the design as large as it fits, on the mug colour with a soft curve. */
export async function mugCloseUp(svg: string, mug: "white" | "black"): Promise<Buffer> {
  const art = mug === "black" ? lightInk(svg) : svg;
  const box = await contentBox(art);
  const fit = Math.min((SIZE * 0.86) / box[2], (SIZE * 0.7) / box[3]);
  const w = Math.max(1, Math.round(box[2] * fit));
  const h = Math.max(1, Math.round(box[3] * fit));
  const design = await sharp(Buffer.from(withViewBox(art, box, w, h)), { density: renderDensity(w, h) }).resize(w, h).png().toBuffer();
  const base = mug === "black" ? "#1d1d1f" : "#ffffff";
  const edge = mug === "black" ? "#000000" : "#d9d9d9";
  // Darker at the left and right edges, like light on a round mug.
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><defs><linearGradient id="g" x1="0" x2="1">
    <stop offset="0" stop-color="${edge}"/><stop offset="0.18" stop-color="${base}"/><stop offset="0.82" stop-color="${base}"/><stop offset="1" stop-color="${edge}"/></linearGradient></defs>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(bg))
    .composite([{ input: design, left: Math.round((SIZE - w) / 2), top: Math.round((SIZE - h) / 2) }])
    .png()
    .toBuffer();
}
