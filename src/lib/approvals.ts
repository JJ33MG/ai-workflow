import { db } from "../db.js";
import { formatEur, toEurCents } from "./money.js";
import { approvalButtons, notify, notifyPhotos, type Photo } from "./telegram.js";
import * as etsy from "../integrations/etsy.js";

const STATUS_NL: Record<string, string> = {
  approved: "goedgekeurd",
  rejected: "afgewezen",
  executed: "uitgevoerd",
  failed: "mislukt",
};

export type ApprovalExecutor = (payload: Record<string, unknown>) => Promise<string>;

const executors = new Map<string, ApprovalExecutor>();

/** Agents register what should happen when Jarne approves a given kind. */
export function registerApprovalExecutor(kind: string, fn: ApprovalExecutor) {
  executors.set(kind, fn);
}

/** A photo per listing (Printify's mockup or the listing's main photo on Etsy), with its title and price. */
async function listingPhotos(ids: string[]): Promise<Photo[]> {
  const rows = await db.listing.findMany({ where: { id: { in: ids.slice(0, 20) } }, select: { title: true, priceCents: true, imageUrl: true, etsyListingId: true } });
  const out: Photo[] = [];
  for (const r of rows) {
    const url = r.imageUrl ?? (r.etsyListingId ? await etsy.getLargeImageUrl(r.etsyListingId).catch(() => null) : null);
    if (url) out.push({ url, caption: `${r.title}${r.priceCents ? ` · €${(r.priceCents / 100).toFixed(2)}` : ""}` });
  }
  return out;
}

export async function requestApproval(input: {
  agentId: string;
  kind: string;
  title: string;
  details: string;
  amountCents?: number;
  currency?: string;
  payload?: Record<string, unknown>;
}) {
  const approval = await db.approval.create({
    data: { ...input, payload: (input.payload ?? {}) as object },
  });
  const amount =
    input.amountCents != null && input.currency
      ? ` (${formatEur(toEurCents(input.amountCents, input.currency))})`
      : "";
  // Jarne, 27 Nov: an approval about listings first shows the products themselves, then the buttons.
  const listingIds = Array.isArray(input.payload?.listingIds) ? (input.payload!.listingIds as string[]) : [];
  if (listingIds.length) await notifyPhotos(await listingPhotos(listingIds)).catch(() => undefined);
  await notify(`🟡 Jouw akkoord nodig${amount}: ${input.title}\n${input.details}`, approvalButtons(approval.id, input.kind));
  return approval;
}

export async function decide(id: string, approve: boolean): Promise<string> {
  // Claim the pending row atomically so a double tap can't run it twice.
  const claimed = await db.approval.updateMany({
    where: { id, status: "pending" },
    data: { status: approve ? "approved" : "rejected", decidedAt: new Date() },
  });
  if (claimed.count !== 1) {
    const existing = await db.approval.findUnique({ where: { id } });
    return existing ? `Al ${STATUS_NL[existing.status] ?? existing.status}: ${existing.title}` : `Geen beslissing met id ${id}`;
  }
  const approval = await db.approval.findUniqueOrThrow({ where: { id } });
  if (!approve) return `Afgewezen: ${approval.title}`;

  const executor = executors.get(approval.kind);
  if (!executor) return `Goedgekeurd: ${approval.title} (er hoeft niets uitgevoerd te worden)`;
  try {
    const outcome = await executor(approval.payload as Record<string, unknown>);
    await db.approval.update({ where: { id }, data: { status: "executed" } });
    return `Goedgekeurd en uitgevoerd: ${approval.title}\n${outcome}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.approval.update({ where: { id }, data: { status: "failed" } });
    return `Goedgekeurd, maar uitvoeren mislukte: ${message}`;
  }
}

/** Approves every pending decision of one kind in one go (e.g. all "publish listings" requests). */
export async function decideAll(kind: string): Promise<string> {
  const pending = await db.approval.findMany({ where: { kind, status: "pending" }, orderBy: { createdAt: "asc" } });
  if (!pending.length) return "Er wacht niets van deze soort.";
  const results: string[] = [];
  for (const a of pending) results.push(await decide(a.id, true));
  const failed = results.filter((r) => /mislukt/i.test(r)).length;
  return `${pending.length} goedgekeurd${failed ? `, ${failed} mislukt (zie Problemen)` : ""}.`;
}
