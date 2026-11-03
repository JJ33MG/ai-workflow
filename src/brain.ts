// Live status for every node on the brain map, and the build plan with Jarne's ticks.
import { config } from "./config.js";
import { getSetting, setSetting } from "./db.js";
import { EDGES, NODES, PLAN, type PlanItem, type PlanStatus } from "./explain.js";
import type { HealthCheck } from "./lib/health.js";

/**
 * live: werkt echt · test: werkt, maar in dry run · manual: in gebruik, met de hand ·
 * warn: werkt met waarschuwing · error: kapot · off: nog niet ingesteld ·
 * planned: komt later · parked: bewust stilgezet
 */
export type NodeState = "live" | "test" | "manual" | "warn" | "error" | "off" | "planned" | "parked";

export interface NodeStatus {
  state: NodeState;
  label: string;
  detail: string;
}

const PLAN_KEY = "plan.status";

export async function planWithStatus(): Promise<(PlanItem & { status: PlanStatus })[]> {
  const overrides = (await getSetting<Record<string, PlanStatus>>(PLAN_KEY)) ?? {};
  return PLAN.map((p) => ({ ...p, status: overrides[p.id] ?? p.status }));
}

/** Jarne ticks off (or reopens) one of his own steps. */
export async function setPlanStatus(id: string, status: PlanStatus): Promise<PlanItem> {
  const item = PLAN.find((p) => p.id === id);
  if (!item) throw new Error("Onbekende stap");
  if (item.owner !== "jarne") throw new Error("Deze stap houdt het systeem zelf bij");
  const overrides = (await getSetting<Record<string, PlanStatus>>(PLAN_KEY)) ?? {};
  overrides[id] = status;
  await setSetting(PLAN_KEY, overrides);
  return { ...item, status };
}

interface Inputs {
  checks: HealthCheck[];
  agents: { id: string; severity: string; health: string; reason: string; enabled: boolean }[];
  businesses: { id: string; stage: string; revenueMonth: number; products: { total: number } }[];
  approvals: unknown[];
  plan: (PlanItem & { status: PlanStatus })[];
}

const AGENT_STATE: Record<string, [NodeState, string]> = {
  ok: ["live", "Werkt"],
  running: ["live", "Bezig"],
  waiting: ["off", "Wacht op eerste taak"],
  paused: ["off", "Gepauzeerd"],
  retrying: ["warn", "Probeert opnieuw"],
  stale: ["warn", "Te laat"],
  blocked: ["error", "Geblokkeerd"],
  failing: ["error", "Faalt"],
};

export function buildBrain({ checks, agents, businesses, approvals, plan }: Inputs) {
  const check = (id: string) => checks.find((c) => c.id === id);
  const done = (planId: string) => plan.find((p) => p.id === planId)?.status === "done";
  const doing = (planId: string) => plan.find((p) => p.id === planId)?.status === "doing";
  const dry = config.dryRun;

  const fromCheck = (id: string, manual?: { planId: string; label: string; detail: string }): NodeStatus => {
    const c = check(id);
    if (!c) return { state: "off", label: "Onbekend", detail: "" };
    if (c.status === "error") return { state: "error", label: "Probleem", detail: c.detail };
    if (c.status === "off") {
      if (manual && done(manual.planId)) return { state: "manual", label: manual.label, detail: manual.detail };
      return { state: "off", label: "Niet gekoppeld", detail: c.detail };
    }
    if (c.status === "warn") return { state: "warn", label: "Let op", detail: c.detail };
    return { state: dry && ["etsy", "printful"].includes(id) ? "test" : "live", label: dry && ["etsy", "printful"].includes(id) ? "Gekoppeld (dry run)" : "Live", detail: c.detail };
  };

  const status: Record<string, NodeStatus> = {};
  status["you"] = approvals.length
    ? { state: "warn", label: `${approvals.length} beslissing(en)`, detail: "Er wachten beslissingen op jou in Overzicht." }
    : { state: "live", label: "Niets te beslissen", detail: "Geen openstaande beslissingen." };

  const db = check("database");
  const worker = check("worker");
  status["brain"] =
    db?.status === "error" || worker?.status === "error"
      ? { state: "error", label: "Probleem", detail: [db, worker].filter((c) => c?.status === "error").map((c) => c!.detail).join(" · ") }
      : { state: dry ? "test" : "live", label: dry ? "Werkt (dry run)" : "Werkt", detail: "Database bereikbaar, takenwachtrij draait." };

  // Agents that act on outside websites only rehearse while DRY_RUN is on.
  const actsOutside = new Set(["etsy-pod", "kdp-coloring"]);
  const online = !config.publicUrl.includes("localhost");
  for (const a of agents) {
    let [state, label] = AGENT_STATE[a.health] ?? (["off", a.health] as [NodeState, string]);
    let detail = a.reason;
    if (state === "live" && dry && actsOutside.has(a.id)) [state, label] = ["test", `${label} (dry run)`];
    // Scheduled jobs only run while the server runs; offline, "late" is expected.
    if (a.health === "stale" && !online) {
      label = "Te laat (niet online)";
      detail = `${a.reason}. Geplande taken draaien pas vanzelf als het systeem online staat.`;
    }
    status[`agent:${a.id}`] = { state, label, detail };
  }

  for (const b of businesses) {
    const id = `biz:${b.id}`;
    if (b.stage === "parked") status[id] = { state: "parked", label: "Geparkeerd", detail: "Bewust stilgezet." };
    else if (b.stage === "planned") status[id] = { state: "planned", label: "Gepland", detail: "Komt in een latere fase." };
    else if (b.stage === "earning") status[id] = { state: "live", label: "Verdient", detail: "Er zijn verkopen in de laatste 30 dagen." };
    else if (b.id === "etsy-pod" && done("etsy-live")) status[id] = { state: "manual", label: "Live (handmatig)", detail: "Mokken staan op Etsy; verkopen verschijnen hier zodra het systeem gekoppeld is." };
    else if (b.id === "kdp-coloring" && done("first-book")) status[id] = { state: "manual", label: "Live (handmatig)", detail: "Boek staat op Amazon." };
    else status[id] = { state: "test", label: "In opbouw", detail: `${b.products.total} product(en) klaar, nog niet live.` };
  }

  status["svc:claude"] = fromCheck("claude");
  status["svc:database"] = fromCheck("database");
  status["svc:telegram"] = fromCheck("telegram");
  status["svc:etsy"] = fromCheck("etsy", { planId: "etsy-shop", label: "Winkel open (handmatig)", detail: "Je winkel bestaat; het systeem is er nog niet mee verbonden." });
  if (status["svc:etsy"].state === "off" && doing("etsy-shop")) {
    status["svc:etsy"] = { state: "warn", label: "Wacht op Etsy", detail: "Etsy controleert je identiteit." };
  }
  status["svc:printful"] = fromCheck("printful", { planId: "printful-account", label: "Handmatig in gebruik", detail: "Je gebruikt Printful zelf; het systeem heeft nog geen Printful-sleutel." });
  status["svc:kdp"] = done("kdp-account")
    ? { state: "manual", label: "Handmatig", detail: "Account bestaat; boeken upload je zelf (Amazon heeft geen koppeling)." }
    : { state: "off", label: "Geen account", detail: "Nog geen KDP-account." };
  status["svc:server"] = online
    ? worker?.status === "error"
      ? { state: "error", label: "Probleem", detail: worker.detail }
      : { state: "live", label: "Online", detail: config.publicUrl }
    : { state: "off", label: "Niet online", detail: "Draait alleen tijdens onze sessies. Zet het op Railway om 24/7 te werken." };

  return {
    nodes: NODES.map((n) => ({ ...n, status: status[n.id] ?? { state: "off" as NodeState, label: "Onbekend", detail: "" } })),
    edges: EDGES,
  };
}
