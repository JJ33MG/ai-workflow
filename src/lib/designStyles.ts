// The kinds of design the Etsy agent makes. Jarne: "everybody needs to be able to find something nice",
// so a daily batch mixes job/hobby gifts with designs anyone would like (quotes, cartoons, art prints).

export const STYLES = ["niche", "quote", "cartoon", "print", "seasonal"] as const;
export type DesignStyle = (typeof STYLES)[number];

/** What the idea writer is told for each style. */
export const STYLE_BRIEFS: Record<DesignStyle, string> = {
  niche:
    "niche: a funny or heartfelt gift for a specific job, hobby or life event (nurses, teachers, gardeners, dog owners…), typography.",
  quote:
    "quote: a short original quote or one-liner for a BROAD audience, not a job: coffee lovers, introverts, book lovers, " +
    "self-care, good vibes, sarcastic everyday humour. Something many people would wear or use for themselves. Typography.",
  cartoon:
    "cartoon: a cute or funny cartoon character or scene (an animal, a food with a face, a little monster, a cosy winter scene) " +
    "with a short caption of 1 to 4 words. The drawing is the hero. Original characters only.",
  print:
    "print: a good-looking graphic print with little or no text (at most 3 words): retro sunset, mountains, ocean wave, " +
    "botanical line art, a vintage-style badge, a moon and stars, a mushroom forest. Something people wear because it looks good.",
  seasonal:
    "seasonal: a winter or Christmas design for everyone (not a job): cosy, funny or pretty. Typography with a small illustration, " +
    "or a cartoon, whichever suits it.",
};

/** The styles for today's batch: one of each for 5 designs, rotating through the days for fewer. */
export function batchStyles(count: number, dayIndex: number): DesignStyle[] {
  return Array.from({ length: count }, (_, i) => STYLES[(dayIndex * count + i) % STYLES.length]);
}

const COMMON =
  "Never use textLength, lengthAdjust or letter squeezing. Every word separated by a real space. " +
  "Nothing smaller than one tenth of the canvas height: tiny captions or fake small print are unreadable on a mug, leave them out. " +
  "Frames, banners and boxes only when every letter stays well inside them with clear space around it; when in doubt, no frame. " +
  "No brand names, logos, existing characters, celebrities, song lyrics, film or TV quotes, sports teams or trademarked phrases.";

const TYPOGRAPHY =
  "Typography only, set straight and level: never put text on a curve or path, never rotate or tilt words or single letters. " +
  "Big and bold: the main words fill most of the width and must still read when the whole design is shown as a 150-pixel thumbnail " +
  "in Etsy search; at most 6 words in total. " +
  "At most 3 text sizes and 2 colours; one simple icon at most, beside the text, never behind or touching it. ";

const ILLUSTRATION =
  "The illustration is the hero and fills most of the canvas: a clean, charming flat drawing built from simple shapes and paths, " +
  "bold even outlines, 3 to 5 harmonious colours, no gradients that look muddy, no photo realism. It must read as a 150-pixel thumbnail. " +
  "Text (if any) is short, straight and level, beside or below the drawing, never on top of it, never on a curve. ";

/** The design rules for a style. */
export function designRulesFor(style: DesignStyle | undefined): string {
  return (style === "cartoon" || style === "print" ? ILLUSTRATION : TYPOGRAPHY) + COMMON;
}
