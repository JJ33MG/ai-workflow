import { collectBriefingData, formatBriefing } from "./agents/ceo.js";
import { agents } from "./agents/index.js";
import { db } from "./db.js";
import { decide } from "./lib/approvals.js";
import { enqueue } from "./lib/tasks.js";

const HELP = [
  "/status — agents and today's numbers",
  "/approvals — pending decisions",
  "/approve <id> · /reject <id>",
  "/brief — send the morning briefing now",
  "/run <agent> <task> — queue a task, e.g. /run etsy-pod create_listings",
  "/pause <agent> · /resume <agent>",
].join("\n");

/** Telegram commands. Replies are plain text. */
export async function handleCommand(command: string, args: string[]): Promise<string> {
  switch (command) {
    case "start":
    case "help":
      return HELP;
    case "status": {
      const d = await collectBriefingData();
      return formatBriefing(d);
    }
    case "brief":
      await enqueue("ceo", "briefing");
      return "Briefing queued.";
    case "approvals": {
      const pending = await db.approval.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });
      return pending.length ? pending.map((a) => `• ${a.title}\n  /approve ${a.id}`).join("\n") : "Nothing pending.";
    }
    case "approve":
    case "reject":
      if (!args[0]) return `Usage: /${command} <id>`;
      return decide(args[0], command === "approve");
    case "run": {
      const [agentId, type] = args;
      if (!agents.get(agentId)?.handlers[type]) return `Unknown task. ${HELP}`;
      await enqueue(agentId, type);
      return `Queued ${agentId}:${type}`;
    }
    case "pause":
    case "resume": {
      if (!agents.has(args[0])) return `Unknown agent "${args[0]}"`;
      await db.agent.update({ where: { id: args[0] }, data: { enabled: command === "resume" } });
      return `${args[0]} ${command === "resume" ? "resumed" : "paused"}`;
    }
    default:
      return `Unknown command.\n${HELP}`;
  }
}
