import { config } from "./config.js";
import { chatModelFor } from "./lib/chatModel.js";
import { type Attachment, attachmentBlocks } from "./lib/attachments.js";
import type Anthropic from "@anthropic-ai/sdk";
import { agents } from "./agents/index.js";
import { BUSINESSES, businessById } from "./businesses.js";
import { buildDashboard } from "./dashboard.js";
import { db } from "./db.js";
import { chatWithTools, isClaudeConfigured, type ChatTool } from "./lib/claude.js";
import { agentLogger } from "./lib/logger.js";
import { askGrok, isGrokConfigured } from "./lib/grok.js";
import { TACTICS, getStrategy, liveListingStats } from "./lib/marketing.js";
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

  // Grok (xAI) as a helper: live X posts and a second opinion. Claude stays the one who answers Jarne.
  const grokTool: ChatTool[] = isGrokConfigured()
    ? [
        {
          definition: {
            name: "ask_grok",
            description:
              "Ask Grok (xAI), which can search X (Twitter) posts in real time and the web. Use it for what people say right now on X, " +
              "trending topics, memes and sayings, competitors' posts, or a second opinion on marketing or money. Give it a precise question; " +
              "weigh its answer yourself and say to Jarne what came from Grok. Each question costs about €0.50-0.75 and there are at most 4 a day: ask one well-aimed question, not several.",
            input_schema: {
              type: "object",
              properties: {
                question: { type: "string" },
                days: { type: "integer", description: "How many days of X posts to search (default 3; more days cost more)" },
              },
              required: ["question"],
            },
          },
          run: async (input) => {
            const r = await askGrok({ agentId, purpose: "chat_grok", prompt: String(input.question ?? ""), xDays: Number(input.days) || 3, web: true });
            return `${r.text}\n\nBronnen: ${r.sources.slice(0, 8).join(" ") || "geen"}`;
          },
        },
      ]
    : [];

  return [
    ...grokTool,
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
        const queued = await enqueue(target, task, payload, { maxAttempts: agents.get(target)?.maxAttempts?.[task] });
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
  const knowledge = await db.knowledge.findMany({ orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 12 });

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
    // Jarne's own steps (ticked on the dashboard): what he did by hand outside the system.
    jarneSteps: d.plan.filter((p) => p.owner === "jarne").map((p) => ({ step: p.title, status: p.status })),
    notes:
      "The Etsy shop is connected and synced every hour, including listings Jarne placed by hand. Amazon KDP has no API: " +
      "books are uploaded by Jarne and their sales are not in these numbers.",
    marketing: agentId === "marketing" || agentId === "ceo" ? await marketingSnapshot() : undefined,
    rules:
      agentId === "ceo"
        ? "Etsy: every listing must disclose AI use (done automatically) and may only go live after Jarne reviewed it individually " +
          "(no mass auto-publishing: bot-made listings are banned). No trademarks, characters, lyrics or film quotes. " +
          "Printful orders below the approval limit are confirmed automatically; anything that costs money above it waits for Jarne."
        : undefined,
    recentLog: mine(d.activity).slice(0, 15).map((l) => `${new Date(l.createdAt).toISOString()} ${l.agentId} ${l.level}: ${l.message}`),
    sharedBrain: knowledge.map((k) => ({ kind: k.kind, title: k.title, body: k.body })),
  };
}

/** Strategies and plays per business, for the marketing agent's chat. */
async function marketingSnapshot() {
  const plays = await db.marketingPlay.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const strategies = Object.fromEntries(
    (await Promise.all(BUSINESSES.map(async (b) => [b.id, await getStrategy(b.id)] as const))).filter(([, s]) => s),
  );
  return {
    strategies,
    plays: plays.map((p) => ({ business: p.businessId, tactic: p.tactic, title: p.title, status: p.status, verdict: p.verdict, liftPct: p.liftPct, note: p.note })),
    tactics: TACTICS.map((t) => ({ id: t.id, businesses: t.businesses, auto: t.auto, description: t.description })),
    etsyListings: (await liveListingStats()).map((l) => ({ title: l.title, favorites: l.favorites, orders: l.orders, ageDays: l.ageDays })),
    visits: "Etsy's API has no visit counts; Jarne sees visits and Etsy Ads clicks only in Etsy itself.",
  };
}

/** The CEO is also Jarne's sparring partner: candid, numbers-first, with a dry sense of humour. */
const CEO_PERSONA = [
  "You are also Jarne's sparring partner and advisor on the whole company, not a yes-man.",
  "Personality: Dutch directness. Say what you actually think, including 'no, that's a bad idea, and here's why'. Never flatter him or tell him what he wants to hear; if the numbers say a plan won't work, say so and offer a better one.",
  "Ground every opinion in the live data (sales, costs, listings, marketing results, problems). Warn him early about risks: wasted money, Etsy rules and account bans, quality, his time.",
  "A dry, quick sense of humour: now and then one short joke or wry remark, never instead of a useful answer and never more than one per reply. Always professional and clearly on his side.",
].join(" ");

/** Replies to voice messages are read aloud by the browser. */
const VOICE_STYLE =
  "This message was spoken and your reply will be read aloud by a speech engine. Answer in English, as you would say it out loud: " +
  "conversational, 2 to 6 sentences, no lists, bullets, markdown, URLs, ids or code. Say numbers the way people say them " +
  "('about twelve euros', 'three listings'). If the answer needs detail, give the gist and offer to put the details in the chat.";

function systemPrompt(agentId: string, voice = false): string {
  const a = agents.get(agentId)!;
  const business = businessById(a.businessId);
  return [
    ...(agentId === "ceo" ? [CEO_PERSONA] : []),
    ...(voice ? [VOICE_STYLE] : []),
    `You are the ${a.name} in Jarne's AI agency: a team of AI agents that each run an online business, share one memory and report to Jarne. The company goal is €10,000/month net profit.`,
    business
      ? `You work for the business "${business.name}": ${business.description}`
      : "You work across all businesses.",
    `Your role: ${a.description}`,
    "Jarne is the owner and talks to you from the company dashboard. Each message comes with a live snapshot of the data you can see; answer from it, and say plainly when something isn't in it instead of guessing.",
    "When something is broken, say what failed, the likely cause and the concrete next step. When asked for ideas or plans, be specific to the data.",
    "You can act with your tools, but only when Jarne asks or clearly agrees. You cannot spend money: publishing listings and confirming orders always go through approvals that Jarne decides on the dashboard.",
    voice
      ? "Speak English."
      : "Write plain text for a chat window: short paragraphs or '-' bullet lines, no markdown headings, tables or bold. Reply in the language Jarne writes in.",
  ].join("\n\n");
}

/** Exposed for tests. */
export const systemPromptForTest = systemPrompt;

export async function sendChat(agentId: string, text: string, opts: { voice?: boolean; attachments?: Attachment[] } = {}) {
  if (!agents.has(agentId)) throw new Error(`Unknown agent ${agentId}`);
  if (!isClaudeConfigured()) {
    throw new ChatUnavailableError("Chat needs the Claude API key. Set ANTHROPIC_API_KEY on the server and restart it.");
  }
  const files = await attachmentBlocks(opts.attachments);
  const typed = text.trim().slice(0, 4000);
  const question = typed || (files.length ? "Bekijk de bijlage(n) en zeg wat je ziet en wat ik ermee moet doen." : "");
  const note = opts.attachments?.length ? `\n📎 ${opts.attachments.map((a) => a.name).join(", ")}` : "";
  const history = await chatHistory(agentId, HISTORY_TURNS);
  const userMsg = await db.chatMessage.create({ data: { agentId, role: "user", content: `${question}${note}` } });

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
  if (files.length) {
    // Screenshots and PDFs go with this turn only (history keeps just their names).
    const blocks: Anthropic.ContentBlockParam[] = [...files, { type: "text", text: current }];
    if (last?.role === "user") last.content = [{ type: "text", text: String(last.content) }, ...blocks];
    else messages.push({ role: "user", content: blocks });
  } else if (last?.role === "user") last.content = `${last.content}\n\n${current}`;
  else messages.push({ role: "user", content: current });

  try {
    const { text: answer, toolCalls } = await chatWithTools({
      agentId,
      purpose: "chat",
      model: chatModelFor(question, files.length > 0, { top: config.claude.model, chat: config.models.chat }),
      system: systemPrompt(agentId, opts.voice),
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
