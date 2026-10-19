import { $, ago, empty, fill, h, stamp, table } from "./core.js";

const KIND_LABEL = {
  niche: "Niche",
  product: "Product",
  hook: "Hook",
  fix: "Fix",
  lesson: "Lesson",
  opportunity: "Opportunity",
  note: "Note",
};

export function renderActivity(d) {
  const agentSel = $("filter-agent");
  if (agentSel.options.length === 0) {
    agentSel.append(h("option", { value: "" }, "All agents"), ...d.agents.map((a) => h("option", { value: a.id }, a.name)));
  }
  const agent = agentSel.value;
  const level = $("filter-level").value;
  const rows = d.activity.filter((l) => (!agent || l.agentId === agent) && (!level || l.level === level));
  fill(
    "activity",
    rows.length === 0
      ? empty("Nothing logged yet.")
      : table(
          ["When", "Agent", "Level", "Message"],
          rows.map((l) =>
            h(
              "tr",
              {},
              h("td", { class: "nowrap", title: stamp(l.createdAt) }, ago(l.createdAt)),
              h("td", { class: "nowrap" }, l.agentName),
              h("td", { class: "nowrap" }, h("span", { class: `level level-${l.level}` }, l.level)),
              h("td", {}, l.message),
            ),
          ),
        ),
  );
}

export function renderBrain(d) {
  const kindSel = $("brain-kind");
  if (kindSel.options.length === 0) {
    kindSel.append(h("option", { value: "" }, "Everything"), ...Object.entries(KIND_LABEL).map(([k, v]) => h("option", { value: k }, v)));
  }
  const kind = kindSel.value;
  const q = $("brain-search").value.trim().toLowerCase();
  const items = d.knowledge.filter(
    (k) => (!kind || k.kind === kind) && (!q || `${k.title} ${k.body} ${k.tags.join(" ")}`.toLowerCase().includes(q)),
  );
  fill(
    "brain",
    d.knowledge.length === 0
      ? empty("The shared brain is empty. Agents add what sells, what works and what they fixed; you can also ask an agent in Chat to remember something.")
      : items.length === 0
        ? empty("Nothing matches.")
        : h(
            "div",
            { class: "brain-grid" },
            items.map((k) =>
              h(
                "article",
                { class: "note" },
                h("div", { class: "note-head" }, h("span", { class: "chip" }, KIND_LABEL[k.kind] ?? k.kind), h("span", { class: "muted" }, `${k.agentName} · ${ago(k.updatedAt)}`)),
                h("h3", {}, k.title),
                h("p", {}, k.body),
              ),
            ),
          ),
  );
}
