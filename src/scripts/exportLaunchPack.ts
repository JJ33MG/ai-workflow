// Export draft listings as a launch pack for manual upload through Printful's Etsy
// integration: one print-ready PNG per design plus all listing text.
//   npm run launch-pack -- <output dir> [listing ids…]
// Without ids it exports every listing that has not been uploaded yet.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db.js";
import { designsDir } from "../lib/design.js";

const [outDir, ...ids] = process.argv.slice(2);
if (!outDir) {
  console.error("Usage: npm run launch-pack -- <output dir> [listing ids…]");
  process.exit(1);
}

const listings = await db.listing.findMany({
  where: ids.length ? { id: { in: ids } } : { status: "draft", designFile: { not: "" } },
  orderBy: { createdAt: "asc" },
});
await mkdir(path.join(outDir, "designs"), { recursive: true });

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

const rows: string[] = [["file", "title", "price", "currency", "tags", "niche", "description"].join(",")];
const md: string[] = ["# Launch pack", "", `${listings.length} mugs, ready to upload in Printful.`, ""];

for (const [i, l] of listings.entries()) {
  const file = `${String(i + 1).padStart(2, "0")}-${slug(l.niche)}.png`;
  await copyFile(path.join(designsDir(), l.designFile), path.join(outDir, "designs", file));
  const price = (l.priceCents / 100).toFixed(2);
  rows.push([file, l.title, price, l.currency, l.tags.join(", "), l.niche, l.description].map((c) => csvCell(String(c))).join(","));
  md.push(
    `## ${i + 1}. ${l.niche}`,
    "",
    `**Design file:** designs/${file}`,
    `**Price:** ${price} ${l.currency}`,
    "",
    "**Title**",
    "",
    l.title,
    "",
    "**Description**",
    "",
    l.description,
    "",
    "**Tags** (13)",
    "",
    l.tags.join(", "),
    "",
  );
}

await writeFile(path.join(outDir, "listings.csv"), rows.join("\n") + "\n");
await writeFile(path.join(outDir, "listings.md"), md.join("\n"));
console.log(`Exported ${listings.length} listing(s) to ${outDir}`);
await db.$disconnect();
