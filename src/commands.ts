import { collectBriefingData, formatBriefing } from "./agents/ceo.js";
import { agents } from "./agents/index.js";
import { db } from "./db.js";
import { decide } from "./lib/approvals.js";
import { enqueue } from "./lib/tasks.js";

const HELP = [
  "/status — agents en de cijfers van vandaag",
  "/approvals — beslissingen die op jou wachten",
  "/approve <id> · /reject <id> — goedkeuren of afwijzen",
  "/brief — stuur de ochtendbriefing nu",
  "/run <agent> <taak> — start een taak, bv. /run etsy-pod create_listings",
  "/pause <agent> · /resume <agent> — agent pauzeren of hervatten",
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
      return "Briefing staat in de wachtrij; je krijgt hem binnen een minuut.";
    case "approvals": {
      const pending = await db.approval.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });
      return pending.length ? pending.map((a) => `• ${a.title}\n  /approve ${a.id}`).join("\n") : "Er wacht niets op een beslissing.";
    }
    case "approve":
    case "reject":
      if (!args[0]) return `Gebruik: /${command} <id>`;
      return decide(args[0], command === "approve");
    case "run": {
      const [agentId, type] = args;
      if (!agents.get(agentId)?.handlers[type]) return `Onbekende taak.\n${HELP}`;
      await enqueue(agentId, type);
      return `In de wachtrij gezet: ${agentId}:${type}`;
    }
    case "pause":
    case "resume": {
      if (!agents.has(args[0])) return `Onbekende agent "${args[0]}"`;
      await db.agent.update({ where: { id: args[0] }, data: { enabled: command === "resume" } });
      return `${args[0]} ${command === "resume" ? "hervat" : "gepauzeerd"}`;
    }
    default:
      return `Onbekend commando.\n${HELP}`;
  }
}
