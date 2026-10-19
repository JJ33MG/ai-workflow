import type Anthropic from "@anthropic-ai/sdk";
import { agents } from "./agents/index.js";
import { businessById } from "./businesses.js";
import { buildDashboard } from "./dashboard.js";
import { db } from "./db.js";
import { chatWithTools, isClaudeConfigured, type ChatTool } from "./lib/claude.js";
import { agentLogger } from "./lib/logger.js";
import { enqueue } from "./lib/tasks.js";

const HISTORY_TURNS = 20;
const KNOWLEDGE_KINDS = ["niche", "product", "hook", "fix", "lesson", "opportunity", "note"] as const;

export class ChatUnavailableError extends Error {}

export async function chatHistory(agentId: string, limit = 100) {
  const rows = await db.chatMessage.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse();
}

/** Company-wide agents (CEO, Debug) can act on any agent; the rest only on themselves. */
function canActFor(speakerId: string, targetId: string) {
  return speakerId === targetId || agents.get(speakerId)?.businessId === null;
}

export function toolsFor(agentId: string): ChatTool[] {
  const speaker = agents.get(agentId)!;
  const log = agentLogger(agentId);
  const reachable = [...agents.values()].filter((a) => canActFor(agentId, a.id));
  const startable = reachable.flatMap((a) => a.chatTasks.map((t) => `${a.id}:${t}`));

  return [
    {
      definition: {
        name: "start_task",
        description:
          "Queue one of the agents' jobs to run now (it starts within 15 seconds). " +
          `Allowed jobs: ${startable.join(", ") || "none"}. Use only when Jarne asks for it or agrees.`,
        input_schema: {
          type: "object",
          properties: {
            agent: { type: "string", description: "Agent id, e.g. etsy-pod" },
            task: { type: "string", description: "Job name, e.g. create_listings" },
            count: { type: "integer", description: "Optional: how many items, for jobs that create several" },
            instructions: {
              type: "string",
              description: "Optional: Jarne's direction for this run, e.g. the theme or niche to design for",
            },
          },
          required: ["agent", "task"],
        },
      },
      run: async (input) => {
        const target = String(input.agent ?? agentId);
        const task = String(input.task ?? "");
        if (!startable.includes(`${target}:${task}`)) {
          throw new Error(`Not allowed from chat: ${target}:${task}. Allowed: ${startable.join(", ")}`);
        }
        const count = Number(input.count);
        const payload: Record<string, unknown> = {};
        if (Number.isInteger(count) && count > 0) payload.count = Math.min(count, 20);
        if (typeof input.instructions === "string" && input.instructions.trim()) {
          payload.instructions = input.instructions.trim().slice(0, 500);
        }
        const queued = await enqueue(target, task, payload);
        await log.info(`Chat: queued ${target}:${task}`, payload);
        return `Queued ${target}:${task} (task ${queued.id}). It starts within 15 seconds.`;
      },
    },
    {
      definition: {
        name: "retry_task",
        description: "Run a failed task again from the start. Use the task id from the problems list.",
        input_schema: {
          type: "object",
          properties: { task_id: { type: "string" } },
          required: ["task_id"],
        },
      },
      run: async (input) => {
        const task = await db.task.findUnique({ where: { id: String(input.task_id) } });
        if (!task) throw new Error("No task with that id");
        if (!canActFor(agentId, task.agentId)) throw new Error(`That task belongs to ${task.agentId}`);
        if (!["failed", "escalated", "pending"].includes(task.status)) throw new Error(`Task is ${task.status}`);
        await db.task.update({
          where: { id: task.id },
          data: { status: "pending", attempts: 0, runAfter: new Date(), finishedAt: null },
        });
        await log.info(`Chat: retried ${task.agentId}:${task.type}`, { taskId: task.id });
        return `Retrying ${task.agentId}:${task.type} now.`;
      },
    },
    {
      definition: {
        name: "save_to_brain",
        description:
          "Save something to the shared knowledge base every agent reads (what sells, a fix that worked, an idea, a decision Jarne made).",
        input_schema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...KNOWLEDGE_KINDS] },
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["kind", "title", "body"],
        },
      },
      run: async (input) => {
        const kind = KNOWLEDGE_KINDS.includes(input.kind as never) ? String(input.kind) : "note";
        const row = await db.knowledge.create({
          data: {
            agentId: speaker.id,
            kind,
            title: String(input.title).slice(0, 200),
            body: String(input.body).slice(0, 4000),
            tags: ["chat"],
          },
        });
        return `Saved to the shared brain (${row.id}).`;
      },
    },
  ];
}

/** Live snapshot of what this agent knows, as compact JSON for the prompt. */
async function snapshot(agentId: string) {
  const d = await buildDashboard();
  const companyWide = agents.get(agentId)?.businessId === null;
  const me = d.agents.find((a) => a.id === agentId);
  const mine = <T extends { agentId: string }>(rows: T[]) => (companyWide ? rows : rows.filter((r) => r.agentId === agentId));
  const knowledge = await db.knowledge.findMany({ orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 25 });

  return {
    now: d.generatedAt,
    timezone: d.timezone,
    dryRun: d.dryRun,
    you: me && {
      name: me.name,
      business: me.business,
      health: me.health,
      reason: me.reason,
      error: me.error,
      stats: me.stats,
      jobs: me.tasks.map((t) => ({ job: t.type, what: t.description, when: t.schedule, lastSuccessAt: t.lastSuccessAt, nextRunAt: t.nextRunAt })),
    },
    company: companyWide
      ? {
          overall: d.overall,
          money: d.money,
          systems: d.checks,
          agents: d.agents.map((a) => ({ id: a.id, name: a.name, health: a.health, reason: a.reason, error: a.error })),
          businesses: d.businesses,
        }
      : { business: d.businesses.find((b) => b.id === agents.get(agentId)?.businessId), systems: d.checks },
    problems: mine(d.problems).map((p) => ({ taskId: p.taskId, agent: p.agentId, job: p.type, state: p.state, attempts: p.attempts, error: p.error, likelyCause: p.guide.title, fix: p.guide.fix })),
    approvalsWaiting: mine(d.approvals).map((a) => ({ title: a.title, details: a.details })),
    recentLog: mine(d.activity).slice(0, 40).map((l) => `${new Date(l.createdAt).toISOString()} ${l.agentId} ${l.level}: ${l.message}`),
    sharedBrain: knowledge.map((k) => ({ kind: k.kind, title: k.title, body: k.body })),
  };
}

function systemPrompt(agentId: string): string {
  const a = agents.get(agentId)!;
  const business = businessById(a.businessId);
  return [
    `You are the ${a.name} in Jarne's AI agency: a team of AI agents that each run an online business, share one memory and report to Jarne. The company goal is €10,000/month net profit.`,
    business
      ? `You work for the business "${business.name}": ${business.description}`
      : "You work across all businesses.",
    `Your role: ${a.description}`,
    "Jarne is the owner and talks to you from the company dashboard. Each message comes with a live snapshot of the data you can see; answer from it, and say plainly when something isn't in it instead of guessing.",
    "When something is broken, say what failed, the likely cause and the concrete next step. When asked for ideas or plans, be specific to the data.",
    "You can act with your tools, but only when Jarne asks or clearly agrees. You cannot spend money: publishing listings and confirming orders always go through approvals that Jarne decides on the dashboard.",
    "Write plain text for a chat window: short paragraphs or '-' bullet lines, no markdown headings, tables or bold. Reply in the language Jarne writes in.",
  ].join("\n\n");
}

export async function sendChat(agentId: string, text: string) {
  if (!agents.has(agentId)) throw new Error(`Unknown agent ${agentId}`);
  if (!isClaudeConfigured()) {
    throw new ChatUnavailableError("Chat needs the Claude API key. Set ANTHROPIC_API_KEY on the server and restart it.");
  }
  const question = text.trim().slice(0, 4000);
  const history = await chatHistory(agentId, HISTORY_TURNS);
  const userMsg = await db.chatMessage.create({ data: { agentId, role: "user", content: question } });

  // Rebuild the conversation from stored text, merging same-role neighbours so roles alternate.
  const messages: Anthropic.MessageParam[] = [];
  for (const m of history) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = messages[messages.length - 1];
    if (last?.role === role) last.content = `${last.content}\n\n${m.content}`;
    else messages.push({ role, content: m.content });
  }
  if (messages[0]?.role === "assistant") messages.shift();
  const current = `Live data snapshot:\n${JSON.stringify(await snapshot(agentId))}\n\nJarne: ${question}`;
  const last = messages[messages.length - 1];
  if (last?.role === "user") last.content = `${last.content}\n\n${current}`;
  else messages.push({ role: "user", content: current });

  try {
    const { text: answer, toolCalls } = await chatWithTools({
      agentId,
      purpose: "chat",
      system: systemPrompt(agentId),
      messages,
      tools: toolsFor(agentId),
    });
    const reply = await db.chatMessage.create({
      data: {
        agentId,
        role: "assistant",
        content: answer || "(no answer)",
        actions: toolCalls.length ? (toolCalls as unknown as object) : undefined,
      },
    });
    return { question: userMsg, reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reply = await db.chatMessage.create({
      data: { agentId, role: "assistant", content: `I couldn't answer: ${message}`, actions: { error: true } },
    });
    return { question: userMsg, reply };
  }
}
