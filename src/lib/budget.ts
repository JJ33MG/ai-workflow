import { config } from "../config.js";
import { db } from "../db.js";
import { startOfDay, toEurCents } from "./money.js";

export class BudgetExceededError extends Error {
  constructor(spentCents: number, capCents: number) {
    super(`Daily API budget reached: spent ${spentCents} of ${capCents} EUR cents`);
    this.name = "BudgetExceededError";
  }
}

export async function apiSpendTodayCents(now = new Date()): Promise<number> {
  const rows = await db.cost.findMany({
    where: { category: "claude_api", occurredAt: { gte: startOfDay(now, config.timezone) } },
    select: { amountCents: true, currency: true },
  });
  return rows.reduce((sum, r) => sum + toEurCents(r.amountCents, r.currency), 0);
}

/** Throws before a Claude call if today's API spend has hit the hard cap. */
export async function assertApiBudget(): Promise<void> {
  const spent = await apiSpendTodayCents();
  if (spent >= config.budget.dailyApiCapCents) {
    throw new BudgetExceededError(spent, config.budget.dailyApiCapCents);
  }
}

export async function recordCost(input: {
  agentId: string;
  category: string;
  amountCents: number;
  currency: string;
  note?: string;
  data?: unknown;
}): Promise<void> {
  await db.cost.create({
    data: { ...input, data: input.data === undefined ? undefined : (input.data as object) },
  });
}
