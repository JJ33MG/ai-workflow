// Scout's ideas: how they look in Telegram, their buttons, and what Scout learns from Jarne's votes.
import type { Button } from "./telegram.js";

export const IDEA_KINDS = ["new_business", "grow", "brain", "trend"] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

const KIND_LABEL: Record<string, string> = {
  new_business: "Nieuw bedrijf",
  grow: "Meer verdienen",
  brain: "Brain beter maken",
  trend: "Trend",
};

export interface IdeaView {
  id: string;
  kind: string;
  title: string;
  summary: string;
  whyNow: string;
  money: string;
  cost: string;
  effort: string;
  firstStep: string;
  risks: string;
  outsideBox: boolean;
  sources: { url: string; title?: string }[];
}

export const ideaButtons = (id: string): Button[][] => [
  [
    { text: "👍 Bouwen", callback_data: `idea_build:${id}` },
    { text: "🕐 Later", callback_data: `idea_later:${id}` },
    { text: "👎 Nee", callback_data: `idea_no:${id}` },
  ],
];

/** One idea as a Telegram message. */
export function formatIdea(i: IdeaView, n: number): string {
  const sources = i.sources.slice(0, 3).map((s) => `• ${s.title ? `${s.title}: ` : ""}${s.url}`);
  return [
    `💡 Idee ${n}${i.outsideBox ? " (buiten de lijntjes)" : ""} · ${KIND_LABEL[i.kind] ?? i.kind}`,
    i.title,
    "",
    i.summary,
    `Waarom nu: ${i.whyNow}`,
    `Opbrengst: ${i.money} · Kosten: ${i.cost} · Moeite: ${i.effort}`,
    `Eerste stap: ${i.firstStep}`,
    `Risico's: ${i.risks}`,
    ...(sources.length ? ["Bronnen:", ...sources] : []),
  ].join("\n");
}

const VOTE: Record<string, string> = { build: "BUILD", later: "LATER", no: "NO" };

/** Jarne's earlier votes (newest first) for the idea writer, so Scout learns his taste. */
export function tasteDigest(decided: { title: string; status: string; feedback: string | null }[]): string {
  if (!decided.length) return "Jarne has no votes yet: explore broadly.";
  return decided.map((d) => `${VOTE[d.status] ?? d.status.toUpperCase()}: ${d.title}${d.feedback ? ` (${d.feedback})` : ""}`).join("\n");
}
