// The brain map: every part of the company as one picture. Nodes are coloured by their
// live status (always paired with an icon and a word); click one to see what it is,
// how it works, whether it's live and what Jarne needs to do.
import { $, act, empty, fill, h, openSection, state } from "./core.js";
import { openChat } from "./chat.js";
import { openBusiness } from "./businesses.js";

export const NODE_STATE = {
  live: { label: "Live", icon: "✓", tone: "good" },
  test: { label: "Test (dry run)", icon: "≈", tone: "test" },
  manual: { label: "Handmatig", icon: "✎", tone: "manual" },
  warn: { label: "Let op", icon: "!", tone: "warn" },
  error: { label: "Probleem", icon: "✕", tone: "error" },
  off: { label: "Niet ingesteld", icon: "–", tone: "off" },
  planned: { label: "Gepland", icon: "…", tone: "off" },
  parked: { label: "Geparkeerd", icon: "‖", tone: "off" },
};

export const STATE_HELP = {
  live: "Werkt echt, met echte klanten of echte gegevens.",
  test: "Werkt, maar in dry run: er gaat nog niets naar buiten en er wordt niets uitgegeven.",
  manual: "In gebruik, maar jij doet dit deel met de hand; het systeem is er nog niet mee verbonden.",
  warn: "Werkt, maar iets vraagt aandacht.",
  error: "Kapot. Klik erop voor de oorzaak en de oplossing.",
  off: "Nog niet ingesteld of gekoppeld.",
  planned: "Komt in een latere fase.",
  parked: "Bewust stilgezet.",
};

// Positions on a 1200 × 760 canvas: businesses and their websites on the left,
// the brain and agents in the middle, system services on the right, plans at the bottom.
const POS = {
  you: [600, 60],
  brain: [600, 340],
  "agent:etsy-pod": [400, 220],
  "agent:kdp-coloring": [400, 470],
  "agent:ceo": [800, 220],
  "agent:debug": [800, 470],
  "biz:etsy-pod": [195, 220],
  "biz:kdp-coloring": [195, 470],
  "svc:etsy": [112, 90],
  "svc:printful": [112, 345],
  "svc:kdp": [112, 600],
  "svc:telegram": [1088, 90],
  "svc:claude": [1088, 270],
  "svc:database": [1088, 420],
  "svc:server": [1088, 570],
  "biz:dropshipping": [380, 690],
  "biz:cartoon-content": [600, 690],
  "biz:roadgem": [820, 690],
};
const W = 196;
const H = 68;
const SVGNS = "http://www.w3.org/2000/svg";

let selected = "brain";
let highlight = null; // a state to emphasise, from the summary chips

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

const RANK = { error: 0, warn: 1, off: 2, planned: 2, parked: 2, manual: 3, test: 4, live: 5 };

function edgeTone(a, b) {
  const worst = RANK[a.status.state] < RANK[b.status.state] ? a.status.state : b.status.state;
  return { tone: NODE_STATE[worst].tone, dashed: ["off", "planned", "parked"].includes(worst), flowing: ["live", "test", "manual"].includes(worst) };
}

function drawMap(d) {
  const nodes = new Map(d.brain.nodes.map((n) => [n.id, n]));
  const svg = s("svg", { viewBox: "0 0 1200 760", class: "map", role: "group", "aria-label": "Kaart van het bedrijf" });

  // Faint zone labels so the layout explains itself.
  [
    [150, 30, "Bedrijven en hun websites"],
    [600, 165, ""],
    [1090, 30, "Systeem"],
    [600, 630, "Later"],
  ].forEach(([x, y, t]) => t && svg.append(s("text", { x, y, class: "zone", "text-anchor": "middle" }, t)));

  for (const [a, b] of d.brain.edges) {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb || !POS[a] || !POS[b]) continue;
    const { tone, dashed, flowing } = edgeTone(na, nb);
    const dim = highlight && na.status.state !== highlight && nb.status.state !== highlight;
    svg.append(
      s("line", {
        x1: POS[a][0],
        y1: POS[a][1],
        x2: POS[b][0],
        y2: POS[b][1],
        class: `edge tone-${tone} ${dashed ? "dashed" : ""} ${flowing ? "flow" : ""} ${dim ? "dim" : ""}`,
      }),
    );
  }

  for (const n of d.brain.nodes) {
    const p = POS[n.id];
    if (!p) continue;
    const meta = NODE_STATE[n.status.state] ?? NODE_STATE.off;
    const dim = highlight && n.status.state !== highlight;
    const g = s("g", {
      class: `node kind-${n.kind} tone-${meta.tone} ${n.id === selected ? "selected" : ""} ${dim ? "dim" : ""} ${["planned", "parked"].includes(n.status.state) ? "later" : ""}`,
      transform: `translate(${p[0]},${p[1]})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${n.label}: ${n.status.label}`,
      "aria-pressed": String(n.id === selected),
    });
    if (n.kind === "brain") {
      g.append(s("circle", { r: 86, class: "brain-halo" }));
      g.append(s("circle", { r: 72, class: "card" }));
      g.append(s("text", { y: -6, class: "label big", "text-anchor": "middle" }, n.label));
      g.append(s("text", { y: 22, class: "sub", "text-anchor": "middle" }, `${meta.icon} ${n.status.label}`));
    } else {
      g.append(s("rect", { x: -W / 2, y: -H / 2, width: W, height: H, rx: 12, class: "card" }));
      g.append(s("rect", { x: -W / 2, y: -H / 2, width: 6, height: H, rx: 3, class: "stripe" }));
      g.append(s("text", { x: -W / 2 + 16, y: -6, class: "label" }, n.label));
      g.append(s("text", { x: -W / 2 + 16, y: 18, class: "sub" }, `${meta.icon} ${n.status.label}`));
    }
    const pick = () => select(n.id);
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
    svg.append(g);
  }
  return svg;
}

function select(id) {
  selected = id;
  renderBrainMap(state.data);
  document.getElementById("map-panel")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function summary(d) {
  const counts = {};
  for (const n of d.brain.nodes) if (n.kind !== "you") counts[n.status.state] = (counts[n.status.state] ?? 0) + 1;
  const order = ["live", "manual", "test", "warn", "error", "off", "planned", "parked"];
  return h(
    "div",
    { class: "state-chips", role: "group", "aria-label": "Status van alle onderdelen" },
    order
      .filter((k) => counts[k])
      .map((k) =>
        h(
          "button",
          {
            class: `state-chip tone-${NODE_STATE[k].tone}`,
            "aria-pressed": String(highlight === k),
            title: STATE_HELP[k],
            onclick: () => {
              highlight = highlight === k ? null : k;
              renderBrainMap(state.data);
            },
          },
          h("span", { class: "chip-icon", "aria-hidden": "true" }, NODE_STATE[k].icon),
          `${counts[k]} ${NODE_STATE[k].label.toLowerCase()}`,
        ),
      ),
  );
}

function panel(d) {
  const n = d.brain.nodes.find((x) => x.id === selected) ?? d.brain.nodes[0];
  const meta = NODE_STATE[n.status.state] ?? NODE_STATE.off;
  const steps = d.plan.filter((p) => p.node === n.id);
  const agentId = n.id.startsWith("agent:") ? n.id.slice(6) : null;
  const bizId = n.id.startsWith("biz:") ? n.id.slice(4) : null;
  const problems = agentId ? d.problems.filter((p) => p.agentId === agentId) : [];

  return h(
    "aside",
    { class: "panel map-panel", id: "map-panel", "aria-live": "polite" },
    h("div", { class: "kind" }, { you: "Eigenaar", brain: "Kern", agent: "Agent", business: "Bedrijf", service: "Koppeling" }[n.kind]),
    h("h2", { class: "flush" }, n.label),
    h(
      "div",
      { class: `state-line tone-${meta.tone}` },
      h("span", { class: "chip-icon", "aria-hidden": "true" }, meta.icon),
      h("strong", {}, n.status.label),
      n.status.detail && h("span", {}, ` · ${n.status.detail}`),
    ),
    h("p", { class: "what" }, n.explain.what),
    h("h3", {}, "Hoe werkt het"),
    h("ol", { class: "how" }, n.explain.how.map((x) => h("li", {}, x))),
    n.explain.you && h("div", { class: "you-box" }, h("strong", {}, "Jouw deel: "), n.explain.you),
    steps.length > 0 &&
      h(
        "div",
        { class: "panel-steps" },
        h("h3", {}, "Stappen in het bouwplan"),
        steps.map((p) => planLine(p)),
      ),
    problems.length > 0 &&
      h("div", { class: "you-box error-box" }, `${problems.length} open probleem/problemen. `, h("button", { class: "link-btn", onclick: () => openSection("problems") }, "Bekijk →")),
    h("p", { class: "muted where" }, `Op het dashboard: ${n.explain.where}`),
    h(
      "div",
      { class: "actions" },
      agentId && h("button", { class: "btn btn-primary btn-sm", onclick: () => openChat(agentId) }, "Chat met deze agent"),
      agentId && h("button", { class: "btn btn-sm", onclick: () => openSection("agents", `agent-${agentId}`) }, "Bekijk agent"),
      bizId && h("button", { class: "btn btn-sm", onclick: () => openBusiness(bizId) }, "Bekijk bedrijf"),
    ),
  );
}

/** One plan step with a tick button when it's Jarne's own step. */
export function planLine(p) {
  const done = p.status === "done";
  return h(
    "div",
    { class: `plan-line status-${p.status}` },
    h("span", { class: "plan-mark", "aria-hidden": "true" }, done ? "✓" : p.status === "doing" ? "≈" : p.status === "parked" ? "‖" : "○"),
    h("div", {}, h("div", { class: "plan-title" }, p.title), h("div", { class: "muted" }, p.detail)),
    p.owner === "jarne" &&
      h(
        "button",
        {
          class: `btn btn-sm ${done ? "" : "btn-primary"}`,
          onclick: (e) => act(e.currentTarget, `/api/plan/${p.id}`, { status: done ? "todo" : "done" }),
        },
        done ? "Toch niet klaar" : "Klaar",
      ),
  );
}

function listView(d) {
  const groups = [
    ["Jij en het brein", ["you", "brain"]],
    ["Agents", ["agent"]],
    ["Bedrijven", ["business"]],
    ["Koppelingen", ["service"]],
  ];
  return h(
    "div",
    { class: "map-list" },
    groups.map(([title, kinds]) =>
      h(
        "div",
        {},
        h("h3", {}, title),
        d.brain.nodes
          .filter((n) => kinds.includes(n.kind) || kinds.includes(n.id))
          .map((n) => {
            const meta = NODE_STATE[n.status.state] ?? NODE_STATE.off;
            return h(
              "button",
              { class: `map-item tone-${meta.tone}`, "aria-pressed": String(n.id === selected), onclick: () => select(n.id) },
              h("span", { class: "chip-icon", "aria-hidden": "true" }, meta.icon),
              h("span", { class: "map-item-label" }, n.label),
              h("span", { class: "muted" }, n.status.label),
            );
          }),
      ),
    ),
  );
}

export function renderBrainMap(d) {
  if (!d?.brain) {
    fill("map", empty("Laden…"));
    return;
  }
  const liveCount = d.brain.nodes.filter((n) => n.status.state === "live").length;
  fill(
    "map",
    h(
      "div",
      { class: "map-head" },
      h(
        "div",
        {},
        h("h1", { class: "flush" }, "Het brein van je bedrijf"),
        h(
          "p",
          { class: "muted flush" },
          `Elk blok is een onderdeel van je bedrijf, elke lijn een verbinding. De kleur, het teken en het woord tonen de echte status. ${liveCount} onderdelen zijn nu live. Klik op een blok voor uitleg.`,
        ),
      ),
      summary(d),
    ),
    h("div", { class: "map-wrap" }, h("div", { class: "panel map-canvas" }, drawMap(d)), panel(d)),
    h("details", { class: "panel legend-box" }, h("summary", {}, "Wat betekenen de kleuren?"), h("dl", { class: "legend-list" }, Object.entries(NODE_STATE).flatMap(([k, m]) => [h("dt", { class: `tone-${m.tone}` }, h("span", { class: "chip-icon" }, m.icon), m.label), h("dd", {}, STATE_HELP[k])]))),
    h("div", { class: "panel map-list-panel" }, h("h2", {}, "Alle onderdelen"), listView(d)),
  );
}
