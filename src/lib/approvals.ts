import { db } from "../db.js";
import { formatEur, toEurCents } from "./money.js";
import { notify } from "./telegram.js";

export type ApprovalExecutor = (payload: Record<string, unknown>) => Promise<string>;

const executors = new Map<string, ApprovalExecutor>();

/** Agents register what should happen when Jarne approves a given kind. */
export function registerApprovalExecutor(kind: string, fn: ApprovalExecutor) {
  executors.set(kind, fn);
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
  await notify(
    `🟡 Approval needed${amount}: ${input.title}\n${input.details}\n\n/approve ${approval.id}\n/reject ${approval.id}`,
  );
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
    return existing ? `Already ${existing.status}: ${existing.title}` : `No approval with id ${id}`;
  }
  const approval = await db.approval.findUniqueOrThrow({ where: { id } });
  if (!approve) return `Rejected: ${approval.title}`;

  const executor = executors.get(approval.kind);
  if (!executor) return `Approved: ${approval.title} (nothing to execute)`;
  try {
    const outcome = await executor(approval.payload as Record<string, unknown>);
    await db.approval.update({ where: { id }, data: { status: "executed" } });
    return `Approved and done: ${approval.title}\n${outcome}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.approval.update({ where: { id }, data: { status: "failed" } });
    return `Approved, but executing failed: ${message}`;
  }
}
