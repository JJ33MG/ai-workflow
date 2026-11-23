// Etsy search: how buyers actually search (from Etsy's own search suggestions, Nov 2026) and the
// rules Etsy puts on titles and tags. Used by the marketing agent's full-shop SEO rewrite.

/** Search patterns seen in Etsy's search box for our niches. Claude follows these shapes. */
export const SEARCH_PATTERNS = [
  "<job> gifts / <job> gift ideas (the most common shape: '911 dispatcher gifts', 'audiologist gifts', 'land surveyor gifts')",
  "<job> gifts for men / for her / for him ('ham radio gifts for men', 'dental hygienist gift for her', 'pharmacy tech gift for him')",
  "<job> christmas shirt / sweatshirt / ornament ('nurse christmas sweatshirt', 'snow plow ornament', 'ham radio gifts ornament')",
  "<hobby> gift personalized / personalized <hobby> ornament with name ('beekeeper gift personalized', 'personalized ornament with names')",
  "funny coffee mug for <recipient> ('funny coffee mugs for coworkers', 'funny coffee mugs for men', 'funny coffee mugs christmas')",
  "retirement gift for <recipient> ('retirement gift for coworker', 'retirement gifts for nurses', 'retirement gift for dad')",
  "Buyers type the job name, then 'gift(s)', then recipient or product. They never type our slogan.",
];

const TITLE_MAX = 140;
const TAG_MAX = 20;
const TAGS = 13;
const MIN_TAGS = 5;

/** Title and tags made safe for Etsy, or null when too little is left to be worth saving. */
export function cleanSeo(rawTitle: string, rawTags: string[]): { title: string; tags: string[] } | null {
  let title = rawTitle.replace(/\s+/g, " ").trim();
  // Etsy allows %, :, & and + only once each in a title; keep the first &, write the rest out.
  let amp = 0;
  title = title.replace(/&/g, () => (amp++ === 0 ? "&" : "and"));
  if (title.length > TITLE_MAX) {
    const cut = title.slice(0, TITLE_MAX + 1);
    title = cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,–-]+$/, "");
  }
  const tags: string[] = [];
  for (const raw of rawTags) {
    const tag = raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    if (tag && tag.length <= TAG_MAX && !tags.includes(tag)) tags.push(tag);
    if (tags.length === TAGS) break;
  }
  if (!title || tags.length < MIN_TAGS) return null;
  return { title, tags };
}

/** The listings still to rewrite, in batches, at most `maxBatches` this run. */
export function seoBatches(ids: string[], done: Set<string>, size: number, maxBatches: number): string[][] {
  const todo = ids.filter((id) => !done.has(id));
  const out: string[][] = [];
  for (let i = 0; i < todo.length && out.length < maxBatches; i += size) out.push(todo.slice(i, i + size));
  return out;
}
