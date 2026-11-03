import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db.js";
import { askJson, askText } from "../lib/claude.js";
import { buildCover, buildInterior, inkedEdges, renderPage } from "../lib/coloring.js";
import { sanitizeSvg } from "../lib/design.js";
import type { AgentDefinition, TaskContext } from "./types.js";

const ID = "kdp-coloring";
const DRAW_ATTEMPTS = 2;
const PARALLEL_PAGES = 3;
const MIN_SHARE_OF_PAGES = 0.7; // fail the book if fewer pages than this pass review

export const booksDir = () => path.resolve(config.storageDir, "books");

const PlanSchema = z.object({
  theme: z.string(),
  ageRange: z.string(),
  title: z.string(),
  subtitle: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  categories: z.array(z.string()),
  coverColor: z.string(),
  coverSubject: z.string(),
  pages: z.array(z.object({ subject: z.string() })),
});
type Plan = z.infer<typeof PlanSchema>;

const ReviewSchema = z.object({ ok: z.boolean(), problems: z.array(z.string()) });

/** KDP limits: 7 keywords of at most 50 characters; title + subtitle under 200 characters. */
export function normalisePlan(plan: Plan): Plan {
  const keywords = [...new Set(plan.keywords.map((k) => k.trim().toLowerCase()))]
    .filter((k) => k.length > 0 && k.length <= 50)
    .slice(0, 7);
  const color = /^#[0-9a-f]{6}$/i.test(plan.coverColor.trim()) ? plan.coverColor.trim() : "#ffd23f";
  return {
    ...plan,
    title: plan.title.trim().slice(0, 120),
    subtitle: plan.subtitle.trim().slice(0, 75),
    keywords,
    categories: plan.categories.slice(0, 3),
    coverColor: color,
  };
}

const PAGE_RULES =
  "You draw coloring pages for young children. Output one standalone SVG document and nothing else. " +
  'Use viewBox="0 0 2190 2940", a white background, and black outlines only: every shape has fill="white" or fill="none" and stroke="#000". ' +
  "Outlines are thick (stroke-width 14–20) with round joins and caps. Shapes are big, simple and closed so small hands can colour inside them. " +
  "One clear, friendly main subject fills most of the page, with a few simple background elements (sun, clouds, flowers, grass tufts). " +
  "The ground is a single line or gentle curve: never a box, panel or frame behind the subject. Shapes must not cut through each other. " +
  "No shading, hatching, grey, text or letters. Use only <path>, <circle>, <ellipse>, <rect>, <line>, <polyline>, <polygon>, <g>. " +
  "Keep everything at least 120 units from every edge.";

const COVER_RULES =
  "You draw the colourful front illustration for a children's coloring book cover. Output one standalone SVG document and nothing else. " +
  'Use viewBox="0 0 2000 2000" and a white background. Bright, cheerful flat colours with thick dark outlines (stroke-width 12–18). ' +
  "Two to four friendly characters from the book's theme, big and centred, a simple scene around them. No text or letters. " +
  "Use only <path>, <circle>, <ellipse>, <rect>, <line>, <polyline>, <polygon>, <g> and gradients. Keep everything 80 units from the edges.";

/** Claude looks at the rendered page and judges it as a parent buying the book would. */
async function review(png: Buffer, subject: string, kind: "page" | "cover") {
  const small = await sharp(png).resize(800, 800, { fit: "inside" }).png().toBuffer();
  return askJson({
    agentId: ID,
    purpose: "kdp_page_review",
    effort: "low",
    maxTokens: 2000,
    schema: ReviewSchema,
    images: [small],
    system:
      "You check pages for a children's coloring book before it is printed. Be strict: a parent who sees a broken page leaves a bad review.",
    prompt:
      kind === "page"
        ? `This should be a coloring page of: ${subject}. Is it good enough to print? Reject it (ok=false) if the subject is hard to recognise, ` +
          "shapes overlap or cut through each other in a messy way, there are boxes or panels behind the subject, parts look broken or misplaced, " +
          "areas are too small or too fiddly for a young child, or anything is cut off at the edge. List each problem briefly."
        : `This should be a cheerful, colourful cover illustration showing: ${subject}. Reject it (ok=false) if the characters are hard to recognise, ` +
          "look broken or misplaced, shapes collide messily, or anything is cut off. List each problem briefly.",
  });
}

async function drawPage(subject: string, theme: string, ageRange: string): Promise<{ svg: string; png: Buffer } | null> {
  let feedback = "";
  for (let attempt = 1; attempt <= DRAW_ATTEMPTS; attempt++) {
    const svg = sanitizeSvg(
      await askText({
        agentId: ID,
        purpose: "kdp_page_svg",
        effort: "medium",
        system: PAGE_RULES,
        prompt: `Book theme: ${theme} (ages ${ageRange}).\nDraw: ${subject}${feedback}`,
      }),
    );
    const png = await renderPage(svg);
    const edges = await inkedEdges(png);
    const verdict = edges.length
      ? { ok: false, problems: [`the drawing runs off the ${edges.join(" and ")} edge`] }
      : await review(png, subject, "page");
    if (verdict.ok) return { svg, png };
    feedback = `\n\nA reviewer rejected your previous drawing of this subject: ${verdict.problems.join("; ")}. Draw it again and avoid these problems.`;
  }
  return null;
}

/** Runs `fn` over items with at most `limit` in flight, keeping input order in the result. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function createBook(payload: Record<string, unknown>, { log, taskId }: TaskContext) {
  const pictures = Math.min(50, Math.max(12, Number(payload.count ?? config.kdp.picturesPerBook)));
  const instructions = typeof payload.instructions === "string" ? payload.instructions.slice(0, 500) : "";
  const existing = await db.coloringBook.findMany({ select: { theme: true, title: true }, orderBy: { createdAt: "desc" }, take: 50 });

  const plan = normalisePlan(
    await askJson({
      agentId: ID,
      purpose: "kdp_book_plan",
      effort: "medium",
      schema: PlanSchema,
      system:
        "You plan coloring books for young children, sold as paperbacks on Amazon KDP. Pick specific themes parents search for " +
        "(e.g. 'dinosaurs for toddlers', 'construction vehicles', 'farm animals'), never trademarks or characters from films, shows or games. " +
        "Write for parents buying a gift: clear title, helpful subtitle, an honest description. Every page subject must be different and drawable as simple line art.",
      prompt:
        `${existing.length ? `Books we already made (pick something different):\n${existing.map((b) => `- ${b.theme}: ${b.title}`).join("\n")}\n\n` : ""}` +
        `${instructions ? `Jarne's direction for this book (follow it): ${instructions}\n\n` : ""}` +
        `Plan one coloring book with exactly ${pictures} pages. Give: theme, ageRange (e.g. "2-5"), title (max 60 characters), ` +
        "subtitle (max 75 characters), description (3 short paragraphs, plain text, mention simple bold designs, single-sided pages and the 8.5 x 11 inch size), " +
        "7 Amazon keywords (phrases parents type, each under 50 characters), 2 or 3 Amazon category paths, coverColor (a bright hex colour), " +
        "coverSubject (what the cover illustration shows) and pages (one subject per page, e.g. 'a smiling T-rex holding a balloon').",
    }),
  );

  const book = await db.coloringBook.create({
    data: {
      theme: plan.theme,
      ageRange: plan.ageRange,
      title: plan.title,
      subtitle: plan.subtitle,
      author: config.kdp.author,
      description: plan.description,
      keywords: plan.keywords,
      categories: plan.categories,
      priceCents: config.kdp.priceCents,
      currency: config.kdp.currency,
      pages: plan.pages.map((p) => ({ subject: p.subject, status: "pending" })),
    },
  });
  await log.info(`Book planned: ${plan.title} (${plan.pages.length} pages)`, { bookId: book.id }, taskId);
  const dir = path.join(booksDir(), book.id);
  await mkdir(path.join(dir, "pages"), { recursive: true });

  try {
    const results = await mapLimited(plan.pages.slice(0, pictures), PARALLEL_PAGES, async (p, i) => {
      const drawn = await drawPage(p.subject, plan.theme, plan.ageRange).catch(async (err: Error) => {
        await log.warn(`Page "${p.subject}" failed: ${err.message}`, undefined, taskId);
        return null;
      });
      if (drawn) await writeFile(path.join(dir, "pages", `${String(i + 1).padStart(2, "0")}.png`), drawn.png);
      // Heartbeat: a long book must not look stuck to the Debug Agent.
      if (taskId) await db.task.update({ where: { id: taskId }, data: { status: "running" } });
      return { subject: p.subject, png: drawn?.png ?? null };
    });

    const good = results.filter((r) => r.png);
    await db.coloringBook.update({
      where: { id: book.id },
      data: {
        pages: results.map((r, i) => ({
          subject: r.subject,
          status: r.png ? "ok" : "rejected",
          file: r.png ? `pages/${String(i + 1).padStart(2, "0")}.png` : undefined,
        })),
      },
    });
    if (good.length < Math.ceil(pictures * MIN_SHARE_OF_PAGES)) {
      throw new Error(`Only ${good.length} of ${pictures} pages passed review; not enough for a good book`);
    }

    // Cover illustration, reviewed like the pages.
    let coverArt: Buffer | null = null;
    let feedback = "";
    for (let attempt = 1; attempt <= DRAW_ATTEMPTS && !coverArt; attempt++) {
      const svg = sanitizeSvg(
        await askText({
          agentId: ID,
          purpose: "kdp_cover_svg",
          effort: "medium",
          system: COVER_RULES,
          prompt: `Book: ${plan.title} (${plan.theme}, ages ${plan.ageRange}).\nCover shows: ${plan.coverSubject}${feedback}`,
        }),
      );
      const png = await sharp(Buffer.from(svg), { density: 300 }).resize(2000, 2000).flatten({ background: "#ffffff" }).png().toBuffer();
      const verdict = await review(png, plan.coverSubject, "cover");
      if (verdict.ok) coverArt = png;
      else feedback = `\n\nA reviewer rejected your previous version: ${verdict.problems.join("; ")}. Draw it again and avoid these problems.`;
    }
    if (!coverArt) throw new Error("The cover illustration did not pass review");

    const text = { title: plan.title, subtitle: plan.subtitle, author: config.kdp.author };
    const interior = await buildInterior(good.map((r) => r.png!), text);
    const cover = await buildCover({
      ...text,
      ageRange: plan.ageRange,
      blurb: plan.description.split(/\n+/)[0] ?? plan.description,
      pageCount: interior.pageCount,
      pictures: good.length,
      frontArt: coverArt,
      color: plan.coverColor,
    });
    await writeFile(path.join(dir, "interior.pdf"), interior.pdf);
    await writeFile(path.join(dir, "cover.pdf"), cover.pdf);
    await writeFile(path.join(dir, "cover-front.jpg"), cover.front);
    await writeFile(path.join(dir, "cover-full.png"), cover.png);

    await db.coloringBook.update({ where: { id: book.id }, data: { status: "ready", pageCount: interior.pageCount } });
    await log.info(`Book ready: ${plan.title} (${good.length} pictures, ${interior.pageCount} pages)`, { bookId: book.id }, taskId);
    return { bookId: book.id, pictures: good.length, rejected: results.length - good.length, pageCount: interior.pageCount };
  } catch (err) {
    await db.coloringBook.update({ where: { id: book.id }, data: { status: "failed", error: (err as Error).message } });
    throw err;
  }
}

export const kdpColoringAgent: AgentDefinition = {
  id: ID,
  name: "Coloring Book Agent",
  phase: 2,
  businessId: "kdp-coloring",
  description: "Plans and draws children's coloring books, checks every page, and prepares the print files for Amazon KDP.",
  dependsOn: ["database", "claude"],
  chatTasks: ["create_book"],
  handlers: { create_book: createBook },
  taskInfo: {
    create_book: "Plan a children's coloring book, draw and review every page, build the interior and cover PDFs for KDP",
  },
};
