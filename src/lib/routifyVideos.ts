// Routify's short videos (TikTok, Reels, Shorts): the playbook of what goes viral now, and video plans
// Jarne approves before anything is made or posted. Jarne, 26 Nov: "very nice videos, super professional,
// already announce that the website is coming".
import { z } from "zod";

export const SERIES = ["teaser", "cost", "gems", "route", "ai-checks", "behind"] as const;

export const VideoPlanSchema = z.object({
  series: z.enum(SERIES),
  title: z.string(),
  hook: z.string(),
  durationSec: z.number(),
  scenes: z.array(z.object({ sec: z.string(), visual: z.string(), onScreenText: z.string(), voiceover: z.string() })),
  caption: z.string(),
  hashtags: z.array(z.string()),
  sound: z.string(),
  cta: z.string(),
  whyItWorks: z.string(),
});
export type VideoPlan = z.infer<typeof VideoPlanSchema>;

export const PlaybookSchema = z.object({
  formats: z.array(z.object({ name: z.string(), why: z.string(), example: z.string(), forRoutify: z.string() })),
  hooks: z.array(z.string()),
  doList: z.array(z.string()),
  dontList: z.array(z.string()),
  postingTimes: z.string(),
  trends: z.array(z.string()),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

export const PLAYBOOK_KEY = "routify.playbook";
export const SOFT_LAUNCH = new Date("2026-12-15T00:00:00Z");

/** Before the soft launch the videos announce Routify; after it they send people to plan a trip. */
export const launchPhase = (now = new Date()): "teaser" | "live" => (now < SOFT_LAUNCH ? "teaser" : "live");

const SERIES_LABEL: Record<(typeof SERIES)[number], string> = {
  teaser: "Teaser (RoamGem komt eraan)",
  cost: "Wat kost het echt",
  gems: "Gems onderweg",
  route: "Route van de week",
  "ai-checks": "AI bedenkt, RoamGem checkt",
  behind: "Achter de schermen",
};

export function formatVideoPlan(p: VideoPlan, n: number): string {
  return [
    `🎬 Video ${n}: ${p.title} (${SERIES_LABEL[p.series]}, ${p.durationSec} s)`,
    `Hook: ${p.hook}`,
    ...p.scenes.map((s) => `• ${s.sec} s: ${s.visual}${s.onScreenText ? ` | tekst: "${s.onScreenText}"` : ""}${s.voiceover ? ` | stem: "${s.voiceover}"` : ""}`),
    `Geluid: ${p.sound}`,
    `Caption: ${p.caption}`,
    p.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "),
    `Oproep: ${p.cta}`,
    `Waarom: ${p.whyItWorks}`,
  ].join("\n");
}
