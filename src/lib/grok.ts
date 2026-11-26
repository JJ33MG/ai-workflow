// Grok (xAI) next to Claude (Jarne, 26 Nov): Grok searches X in real time, which Claude cannot, and gives
// a second opinion. Claude stays in charge; Grok's answers are input. Costs count towards the same
// daily budget as Claude. API: https://api.x.ai/v1/responses with the x_search and web_search tools.
import { config } from "../config.js";
import { db } from "../db.js";
import { assertApiBudget, recordCost } from "./budget.js";
import { startOfDay } from "./money.js";

const API = "https://api.x.ai/v1/responses";

export const isGrokConfigured = () => Boolean(config.grok.apiKey);

interface GrokResponse {
  output?: { type: string; content?: { type: string; text?: string; annotations?: { type?: string; url?: string }[] }[] }[];
  usage?: { cost_in_usd_ticks?: number; input_tokens?: number; output_tokens?: number };
}

/** The answer text and its sources (each once). */
export function parseGrokResponse(r: GrokResponse): { text: string; sources: string[] } {
  const parts = (r.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
  const sources = [...new Set(parts.flatMap((p) => (p.annotations ?? []).map((a) => a.url).filter((u): u is string => Boolean(u))))];
  return { text: parts.map((p) => p.text ?? "").join("\n").trim(), sources };
}

/** xAI reports cost in ticks of 10^-10 USD. */
export const grokCostCents = (usage: GrokResponse["usage"] | undefined) => ((usage?.cost_in_usd_ticks ?? 0) / 1e10) * 100;

export async function askGrok(opts: {
  agentId: string;
  purpose: string;
  prompt: string;
  system?: string;
  /** Search X posts from this many days back (default 3); 0 turns X search off. */
  xDays?: number;
  web?: boolean;
}): Promise<{ text: string; sources: string[] }> {
  if (!isGrokConfigured()) throw new Error("Grok is niet gekoppeld: zet XAI_API_KEY in Railway");
  await assertApiBudget();
  // A Grok question reads many X posts (~€0.75 each in the first tests): a few a day, Scout first.
  const today = await db.cost.count({ where: { category: "grok_api", occurredAt: { gte: startOfDay(new Date(), config.timezone) } } });
  if (today >= config.grok.dailyCalls) throw new Error(`Grok-daglimiet bereikt (${config.grok.dailyCalls} vragen per dag); morgen weer`);
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${config.grok.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(grokBody({ model: config.grok.model, ...opts })),
  });
  if (!res.ok) throw new Error(`Grok ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as GrokResponse;
  await recordCost({ agentId: opts.agentId, category: "grok_api", amountCents: grokCostCents(body.usage), currency: "USD", note: opts.purpose, data: { usage: body.usage } });
  return parseGrokResponse(body);
}

/**
 * The request: at most 2 search rounds and only the recent days of X (one open-ended question read
 * 200,000 tokens of posts and cost €0.88).
 */
export function grokBody(o: { model: string; prompt: string; system?: string; xDays?: number; web?: boolean }, now = new Date()) {
  const days = o.xDays ?? 3;
  const tools: Record<string, unknown>[] = [];
  if (days > 0) tools.push({ type: "x_search", from_date: new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10) });
  if (o.web) tools.push({ type: "web_search" });
  return {
    model: o.model,
    input: [...(o.system ? [{ role: "system", content: o.system }] : []), { role: "user", content: o.prompt }],
    tools,
    max_turns: 2,
  };
}
