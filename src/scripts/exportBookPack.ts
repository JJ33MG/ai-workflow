// Export coloring books as upload packs for Amazon KDP: interior PDF, cover PDF,
// a cover preview and every form field in the order KDP asks for it.
//   npm run book-pack -- <output dir> [book ids…]
// Without ids it exports every book that is ready and not yet published.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { booksDir } from "../agents/kdpColoring.js";
import { db } from "../db.js";

const [outDir, ...ids] = process.argv.slice(2);
if (!outDir) {
  console.error("Usage: npm run book-pack -- <output dir> [book ids…]");
  process.exit(1);
}

const books = await db.coloringBook.findMany({
  where: ids.length ? { id: { in: ids } } : { status: "ready" },
  orderBy: { createdAt: "asc" },
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

for (const [i, b] of books.entries()) {
  const dir = path.join(outDir, `${String(i + 1).padStart(2, "0")}-${slug(b.title)}`);
  await mkdir(dir, { recursive: true });
  for (const f of ["interior.pdf", "cover.pdf", "cover-front.jpg"]) {
    await copyFile(path.join(booksDir(), b.id, f), path.join(dir, f));
  }
  const [minAge, maxAge] = b.ageRange.split(/[-–]/).map((s) => s.trim());
  const pictures = (b.pages as { status: string }[]).filter((p) => p.status === "ok").length;
  await writeFile(
    path.join(dir, "KDP-UPLOAD.md"),
    [
      `# ${b.title}`,
      "",
      "Fill in KDP (kdp.amazon.com → Create → **Paperback**) with the values below, top to bottom.",
      "",
      "## 1. Paperback details",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Language | English |",
      `| Book title | ${b.title} |`,
      `| Subtitle | ${b.subtitle} |`,
      `| Author | ${b.author} |`,
      "| Publishing rights | I own the copyright and I hold the necessary publishing rights |",
      "| Primary audience: sexually explicit content | No |",
      `| Reading age | Minimum ${minAge ?? "2"}, maximum ${maxAge ?? "6"} |`,
      "",
      "**Description** (paste as is):",
      "",
      b.description,
      "",
      "**Keywords** (one per box):",
      "",
      ...b.keywords.map((k, n) => `${n + 1}. ${k}`),
      "",
      "**Categories** (pick the closest matches):",
      "",
      ...b.categories.map((c) => `- ${c}`),
      "",
      "**AI-generated content: answer Yes.** Amazon requires this. Images: *AI-generated*, several pages, tool *Claude (Anthropic)*. Text: *AI-generated*, tool *Claude (Anthropic)*. Translations: *None*.",
      "",
      "## 2. Paperback content",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Print ISBN | Get a free KDP ISBN |",
      "| Print options | Black & white interior with white paper |",
      "| Trim size | 8.5 x 11 in |",
      "| Bleed settings | No bleed |",
      "| Paperback cover finish | Glossy |",
      "| Manuscript | upload `interior.pdf` |",
      "| Book cover | Upload a cover you already have → `cover.pdf` |",
      "",
      `Then press **Launch Previewer** and page through: ${pictures} pictures, ${b.pageCount} pages in total. Approve if nothing is flagged.`,
      "",
      "## 3. Paperback rights & pricing",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Territories | All territories (worldwide rights) |",
      "| Primary marketplace | Amazon.com |",
      `| List price | $${(b.priceCents / 100).toFixed(2)} (KDP shows your royalty next to it; it must be positive) |`,
      "",
      "Press **Publish your paperback**. Amazon reviews it, usually within 72 hours.",
      "",
    ].join("\n"),
  );
  console.log(`Exported ${b.title} → ${dir}`);
}
console.log(`${books.length} book(s) exported`);
await db.$disconnect();
