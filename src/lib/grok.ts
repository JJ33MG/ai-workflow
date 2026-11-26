// Grok (xAI) next to Claude (Jarne, 26 Nov): Grok searches X in real time, which Claude cannot, and gives
// a second opinion. Claude stays in charge; Grok's answers are input. Costs count towards the same
// daily budget as Claude. API: https://api.x.ai/v1/responses with the x_search and web_search tools.
import { config } from "../config.js";
import { assertApiBudget, recordCost } from "./budget.js";

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
  /** Search X posts from this many days back (default 7); 0 turns X search off. */
  xDays?: number;
  web?: boolean;
}): Promise<{ text: string; sources: string[] }> {
  if (!isGrokConfigured()) throw new Error("Grok is niet gekoppeld: zet XAI_API_KEY in Railway");
  await assertApiBudget();
  const days = opts.xDays ?? 7;
  const tools: Record<string, unknown>[] = [];
  if (days > 0) tools.push({ type: "x_search", from_date: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) });
  if (opts.web) tools.push({ type: "web_search" });
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${config.grok.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.grok.model,
      input: [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content: opts.prompt }],
      tools,
    }),
  });
  if (!res.ok) throw new Error(`Grok ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as GrokResponse;
  await recordCost({ agentId: opts.agentId, category: "grok_api", amountCents: grokCostCents(body.usage), currency: "USD", note: opts.purpose, data: { usage: body.usage } });
  return parseGrokResponse(body);
}
