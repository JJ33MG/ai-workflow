import { db } from "../db.js";
import { ceoAgent } from "./ceo.js";
import { debugAgent } from "./debug.js";
import { etsyPodAgent } from "./etsyPod.js";
import type { AgentDefinition } from "./types.js";

export const agents = new Map<string, AgentDefinition>(
  [ceoAgent, etsyPodAgent, debugAgent].map((a) => [a.id, a]),
);

/** Make sure every registered agent has a row (logs and costs reference it). */
export async function syncAgents(): Promise<void> {
  for (const a of agents.values()) {
    await db.agent.upsert({
      where: { id: a.id },
      create: { id: a.id, name: a.name, phase: a.phase },
      update: { name: a.name, phase: a.phase },
    });
  }
}
