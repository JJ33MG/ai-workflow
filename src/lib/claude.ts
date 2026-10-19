import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "../config.js";
import { assertApiBudget, recordCost } from "./budget.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Reads ANTHROPIC_API_KEY from the environment.
  client ??= new Anthropic();
  return client;
}

// USD per million tokens (input, output). Unknown models are billed at Opus rates
// so cost tracking errs on the high side.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function usageCostUsdCents(model: string, usage: Anthropic.Usage): number {
  const price = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const input =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return ((input * price.input + usage.output_tokens * price.output) / 1_000_000) * 100;
}

type Effort = "low" | "medium" | "high";

interface AskOptions {
  agentId: string;
  purpose: string; // stored on the cost row
  system: string;
  prompt: string;
  effort?: Effort;
  maxTokens?: number;
}

async function track(agentId: string, purpose: string, response: Anthropic.Message) {
  await recordCost({
    agentId,
    category: "claude_api",
    amountCents: usageCostUsdCents(response.model, response.usage),
    currency: "USD",
    note: purpose,
    data: { model: response.model, usage: response.usage },
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined the request (${purpose})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(`Claude response was cut off at max_tokens (${purpose})`);
  }
}

/** Plain text answer. Enforces the daily budget and records the cost. */
export async function askText(opts: AskOptions): Promise<string> {
  await assertApiBudget();
  const response = await getClient().messages.create({
    model: config.claude.model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    output_config: { effort: opts.effort ?? "medium" },
    messages: [{ role: "user", content: opts.prompt }],
  });
  await track(opts.agentId, opts.purpose, response);
  return response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

/** Structured answer validated against a zod schema. */
export async function askJson<S extends z.ZodType>(opts: AskOptions & { schema: S }): Promise<z.infer<S>> {
  await assertApiBudget();
  const response = await getClient().messages.parse({
    model: config.claude.model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    output_config: { effort: opts.effort ?? "medium", format: zodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.prompt }],
  });
  await track(opts.agentId, opts.purpose, response);
  if (response.parsed_output == null) {
    throw new Error(`Claude returned output that did not match the schema (${opts.purpose})`);
  }
  return response.parsed_output as z.infer<S>;
}

export interface ChatTool {
  definition: Anthropic.Tool;
  run: (input: Record<string, unknown>) => Promise<string>;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
}

/**
 * A conversation turn where Claude may use tools (agent chat). Loops until Claude
 * answers in text, at most `maxSteps` model calls. Every call is budgeted and costed.
 */
export async function chatWithTools(opts: {
  agentId: string;
  purpose: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: ChatTool[];
  effort?: Effort;
  maxSteps?: number;
}): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const messages = [...opts.messages];
  const byName = new Map(opts.tools.map((t) => [t.definition.name, t]));
  const toolCalls: ToolCall[] = [];

  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    await assertApiBudget();
    const response = await getClient().messages.create({
      model: config.claude.model,
      max_tokens: 16000,
      system: opts.system,
      output_config: { effort: opts.effort ?? "medium" },
      tools: opts.tools.map((t) => t.definition),
      messages,
    });
    await track(opts.agentId, opts.purpose, response);

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      const text = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      return { text, toolCalls };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      const tool = byName.get(use.name);
      let result: string;
      let isError = false;
      try {
        if (!tool) throw new Error(`Unknown tool ${use.name}`);
        result = await tool.run(input);
      } catch (err) {
        result = err instanceof Error ? err.message : String(err);
        isError = true;
      }
      toolCalls.push({ name: use.name, input, result, isError });
      results.push({ type: "tool_result", tool_use_id: use.id, content: result, is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("The agent used too many steps without answering; try a more specific question");
}

export const isClaudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);
