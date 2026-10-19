import { AGENT_LABEL, act, ago, eur, fill, h, openSection, statusPill, table, until } from "./core.js";
import { openChat } from "./chat.js";

export function renderAgents(d) {
  fill("agents", d.agents.map(agentCard));
}

function agentCard(a) {
  return h(
    "article",
    { class: "panel agent-card", id: `agent-${a.id}` },
    h(
      "header",
      {},
      h("div", {}, h("h2", { class: "flush" }, a.name), h("div", { class: "business" }, `Works for: ${a.business} · Phase ${a.phase}`)),
      h(
        "div",
        { class: "agent-head-actions" },
        statusPill(a.severity, AGENT_LABEL[a.health]),
        h("button", { class: "btn btn-primary btn-sm", onclick: () => openChat(a.id) }, "Chat"),
        h(
          "button",
          {
            class: "btn btn-sm",
            onclick: (e) =>
              act(e.currentTarget, `/api/agents/${a.id}/${a.enabled ? "pause" : "resume"}`, null, a.enabled ? `Pause ${a.name}? Its scheduled jobs will be skipped.` : null),
          },
          a.enabled ? "Pause" : "Resume",
        ),
      ),
    ),
    h("p", { class: "desc" }, a.description),
    h(
      "div",
      { class: `reason-box s-${a.severity}` },
      h("strong", {}, `${AGENT_LABEL[a.health]}: `),
      a.reason,
      a.error && h("code", { class: "error-text" }, a.error),
      a.guide &&
        h(
          "div",
          {},
          a.guide.id === "unknown" ? "" : `Likely cause: ${a.guide.title}. `,
          h("button", { class: "link-btn", onclick: () => openSection("problems") }, "See how to fix →"),
        ),
    ),
    h(
      "div",
      { class: "facts" },
      h("span", {}, "Last run ", h("b", {}, ago(a.lastRunAt))),
      h("span", {}, "Done (24h) ", h("b", {}, a.stats.done24h)),
      h("span", {}, "Failed (24h) ", h("b", {}, a.stats.failed24h)),
      h("span", {}, "Queued ", h("b", {}, a.stats.open)),
      h("span", {}, "Cost this month ", h("b", {}, eur(a.stats.costMonth))),
    ),
    h("div", { class: "deps" }, h("span", { class: "muted" }, "Needs:"), a.dependsOn.map((dep) => statusPill(dep.status, dep.label))),
    table(
      ["What it can do", "When", "Last success", "Next run", ""],
      a.tasks.map((t) =>
        h(
          "tr",
          {},
          h("td", {}, h("div", {}, t.description), h("code", { class: "muted" }, t.type)),
          h("td", { class: "nowrap" }, t.schedule),
          h("td", { class: `nowrap ${t.stale ? "stale" : ""}` }, ago(t.lastSuccessAt), t.stale ? " · late" : ""),
          h("td", { class: "nowrap" }, t.nextRunAt ? until(t.nextRunAt) : "—"),
          h("td", {}, h("button", { class: "btn btn-sm", onclick: (e) => act(e.currentTarget, `/api/agents/${a.id}/tasks`, { type: t.type }) }, "Run now")),
        ),
      ),
    ),
  );
}
