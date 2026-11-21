import { collectBriefingData, formatBriefing } from "./agents/ceo.js";
import { agents } from "./agents/index.js";
import { db } from "./db.js";
import { decide, decideAll } from "./lib/approvals.js";
import { approvalButtons, notify } from "./lib/telegram.js";
import { enqueue } from "./lib/tasks.js";

const HELP = [
  "/status — agents en de cijfers van vandaag",
  "/approvals — beslissingen die op jou wachten",
  "/approve <id> · /reject <id> — goedkeuren of afwijzen",
  "/alles — alle wachtende publicaties (listings en downloads) in één keer goedkeuren",
  "Of tik op de knoppen onder een bericht.",
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
      if (!pending.length) return "Er wacht niets op een beslissing.";
      // Each decision as its own message with buttons, so nothing needs copying.
      for (const a of pending) await notify(`🟡 ${a.title}`, approvalButtons(a.id, a.kind));
      const publications = pending.filter((a) => a.kind === "etsy_publish").length;
      return `${pending.length} beslissing(en) hierboven.${publications > 1 ? ` Alle ${publications} publicaties in één keer: /alles` : ""}`;
    }
    case "alles":
      return decideAll("etsy_publish");
    case "approve":
    case "reject":
      if (!args[0]) return `Gebruik: /${command} <id>`;
      // Only listings in bulk: money decisions like Printful orders stay one by one.
      if (command === "approve" && ["alles", "all"].includes(args[0].toLowerCase())) return decideAll("etsy_publish");
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
