// Jarne's votes on Scout's ideas (Telegram buttons, commands and the dashboard).
import { db } from "../db.js";

export type Vote = "build" | "later" | "no";

const REPLY: Record<Vote, string> = {
  build: "👍 Genoteerd om te bouwen. Zeg in je volgende sessie met Claude: \"bouw de goedgekeurde ideeën\".",
  later: "🕐 Bewaard voor later.",
  no: "👎 Afgewezen. Scout onthoudt het. Wil je zeggen waarom? Stuur /waarom <reden>.",
};

export async function decideIdea(id: string | undefined, vote: Vote): Promise<string> {
  if (!id) return "Geen idee opgegeven.";
  const idea = await db.idea.findUnique({ where: { id } });
  if (!idea) return "Dat idee bestaat niet (meer).";
  await db.idea.update({ where: { id }, data: { status: vote, decidedAt: new Date() } });
  return `${REPLY[vote]}\n(${idea.title})`;
}

/** A reason for the latest vote, so Scout learns why. */
export async function ideaFeedback(reason: string): Promise<string> {
  const text = reason.trim().slice(0, 300);
  if (!text) return "Gebruik: /waarom <reden>";
  const last = await db.idea.findFirst({ where: { decidedAt: { not: null } }, orderBy: { decidedAt: "desc" } });
  if (!last) return "Er is nog geen idee waarop je gestemd hebt.";
  await db.idea.update({ where: { id: last.id }, data: { feedback: text } });
  return `Bedankt, Scout onthoudt het bij "${last.title}".`;
}
