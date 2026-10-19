// Run one agent task immediately, outside the queue:
//   npm run agent:run -- ceo briefing
//   npm run agent:run -- etsy-pod create_listings '{"count":2}'
import { agents, syncAgents } from "./agents/index.js";
import { db } from "./db.js";
import { agentLogger } from "./lib/logger.js";

const [agentId, type, json] = process.argv.slice(2);
const handler = agents.get(agentId)?.handlers[type];
if (!handler) {
  console.error(`Usage: npm run agent:run -- <agent> <task> [json]\nAgents: ${[...agents.keys()].join(", ")}`);
  process.exit(1);
}

await syncAgents();
try {
  const result = await handler(json ? JSON.parse(json) : {}, { log: agentLogger(agentId) });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.$disconnect();
}
