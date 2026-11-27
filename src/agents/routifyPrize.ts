// The explorer of the month on RoamGem wins a year of Plus. On the 1st the Brain asks Jarne on Telegram;
// only after his Approve does RoamGem grant it (and RoamGem grants each month only once).
import { db } from "../db.js";
import { config } from "../config.js";
import { registerApprovalExecutor, requestApproval } from "../lib/approvals.js";
import { fetchPrizeWinner, grantPrize, type PrizeWinner } from "../integrations/routify.js";

export const PRIZE_KIND = "roamgem_prize";

export function previousMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const monthName = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString("nl-BE", { month: "long", year: "numeric", timeZone: "UTC" });

type Deps = {
  winner: (month: string) => Promise<PrizeWinner | null>;
  asked: (month: string) => Promise<boolean>;
  ask: (a: { agentId: string; kind: string; title: string; details: string; payload: Record<string, unknown> }) => Promise<unknown>;
};

export async function prizeRound(month: string, deps: Deps) {
  if (await deps.asked(month)) return { asked: false, month, reason: "al gevraagd" };
  const w = await deps.winner(month);
  if (!w) return { asked: false, month, reason: "geen winnaar" };
  await deps.ask({
    agentId: "routify",
    kind: PRIZE_KIND,
    title: `Explorer van ${monthName(month)}: ${w.name}`,
    details: `${w.name} haalde ${w.points} punten in de RoamGem-community (${w.moments ?? 0} momenten, ${w.likes ?? 0} likes, ${w.inTrips ?? 0} keer in een trip). Een jaar RoamGem Plus geven? Pas na jouw Goedkeuren wordt het toegekend.`,
    payload: { userId: w.userId, month },
  });
  return { asked: true, month };
}

const askedBefore = async (month: string) =>
  (await db.approval.count({ where: { kind: PRIZE_KIND, payload: { path: ["month"], equals: month } } })) > 0;

export const runPrizeRound = (now = new Date()) =>
  prizeRound(previousMonth(now), { winner: (m) => fetchPrizeWinner(m), asked: askedBefore, ask: requestApproval });

registerApprovalExecutor(PRIZE_KIND, async (p) => {
  const userId = String(p.userId ?? "");
  const month = String(p.month ?? "");
  if (config.dryRun) return `DRY_RUN: niets toegekend (${month}).`;
  const r = await grantPrize(userId, month);
  return r.granted ? `Een jaar Plus toegekend voor ${month}.` : `Voor ${month} was de prijs al toegekend.`;
});
