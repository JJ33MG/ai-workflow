import { taskRunsChart } from "./charts.js";
import { AGENT_LABEL, STAGE, STATUS, act, ago, empty, eur, fill, h, kpi, money, openSection, statusPill } from "./core.js";
import { openChat } from "./chat.js";
import { openBusiness } from "./businesses.js";

export function renderCheck(c) {
  return h(
    "div",
    { class: "check" },
    h("div", {}, statusPill(c.status, c.label)),
    h("div", { class: "detail" }, c.detail),
    c.fix && c.status !== "ok" && h("div", { class: "fix" }, `→ ${c.fix}`),
  );
}

export function targetLabel(b) {
  const [lo, hi] = b.targetCents;
  return hi ? `Target ${eur(lo, 0)}–${eur(hi, 0)} / month` : "No revenue target yet";
}

export function businessCard(b) {
  const stage = STAGE[b.stage];
  const [, hi] = b.targetCents;
  const pct = hi ? (b.revenueMonth / b.targetCents[0]) * 100 : 0;
  return h(
    "button",
    { class: `biz-card stage-${b.stage}`, onclick: () => openBusiness(b.id) },
    h("div", { class: "biz-card-head" }, h("span", { class: "biz-kind" }, `${b.kind} · Phase ${b.phase}`), statusPill(stage.status, stage.label)),
    h("strong", { class: "biz-name" }, b.name),
    b.stage === "planned"
      ? h("p", { class: "biz-plan" }, b.plan)
      : h(
          "div",
          { class: "biz-figures" },
          h("div", {}, h("span", { class: "label" }, "Revenue this month"), h("b", {}, eur(b.revenueMonth))),
          h("div", {}, h("span", { class: "label" }, "Profit"), h("b", {}, eur(b.profitMonth))),
          h("div", {}, h("span", { class: "label" }, "Products"), h("b", {}, b.products.total)),
        ),
    hi > 0 &&
      b.stage !== "planned" &&
      h("div", { class: "meter", "aria-label": "Progress to target" }, h("span", { style: `width:${Math.min(100, pct)}%` })),
    h(
      "div",
      { class: "biz-foot" },
      h("span", {}, targetLabel(b)),
      b.openProblems > 0 && h("span", { class: "problem-chip" }, `${b.openProblems} problem${b.openProblems > 1 ? "s" : ""}`),
    ),
  );
}

export function renderOverview(d) {
  const banner = document.getElementById("banner");
  banner.className = `banner s-${d.overall.status}`;
  fill(
    banner,
    h("span", { class: `status s-${d.overall.status}` }, h("span", { class: "dot", "aria-hidden": "true" }, STATUS[d.overall.status].icon)),
    h(
      "div",
      {},
      h("h1", {}, d.overall.headline),
      d.overall.items.length
        ? h("ul", {}, d.overall.items.map((i) => h("li", {}, i)))
        : h("div", { class: "muted" }, d.overall.status === "ok" ? "Every business, agent and integration is healthy." : "See the warnings under Systems and Agents."),
    ),
    d.overall.status !== "ok" &&
      h("button", { class: "btn btn-sm banner-btn", onclick: () => openSection("problems") }, "Open problems"),
  );

  const m = d.money;
  const goalPct = (m.netMonth / m.goalMonth) * 100;
  const apiPct = (m.apiSpentToday / m.apiCapToday) * 100;
  const needsYou = d.problems.filter((p) => p.state === "needs-you").length;
  fill(
    "kpis",
    kpi("Revenue this month", eur(m.revenueMonth), `${eur(m.revenueToday)} today`),
    kpi("Costs this month", eur(m.costsMonth), `${eur(m.overheadMonth)} company-wide overhead`),
    kpi("Net towards €10,000", eur(m.netMonth), `${Math.max(0, goalPct).toFixed(1)}% of the monthly goal`, { pct: goalPct }),
    kpi("Claude budget today", `${Math.round(apiPct)}%`, `${eur(m.apiSpentToday)} of ${eur(m.apiCapToday)}`, {
      pct: apiPct,
      cls: apiPct >= 100 ? "error" : apiPct >= 80 ? "warn" : "",
    }),
    kpi("Open problems", String(d.problems.length), needsYou ? `${needsYou} need you` : d.problems.length ? "Being retried automatically" : "None"),
  );

  fill("overview-businesses", d.businesses.map(businessCard));
  fill("checks", d.checks.map(renderCheck));
  fill(
    "agent-summary",
    d.agents.map((a) =>
      h(
        "div",
        { class: "agent-row" },
        h(
          "div",
          {},
          h("button", { class: "link-btn", onclick: () => openSection("agents", `agent-${a.id}`) }, a.name),
          h("div", { class: "biz" }, a.business),
        ),
        h("div", { class: "agent-row-right" }, statusPill(a.severity, AGENT_LABEL[a.health]), h("button", { class: "btn btn-sm", onclick: () => openChat(a.id) }, "Chat")),
        a.health !== "ok" && h("div", { class: "reason" }, a.reason, a.error ? `: ${a.error}` : ""),
      ),
    ),
  );
  fill("chart", taskRunsChart(d.chart));
  fill(
    "approvals",
    d.approvals.length === 0
      ? empty("Nothing waiting for a decision.", true)
      : d.approvals.map((a) => {
          const amount = a.amountCents != null ? ` · ${money(a.amountCents, a.currency)}` : "";
          return h(
            "div",
            { class: "approval" },
            h("strong", {}, a.title),
            h("div", { class: "details" }, a.details, amount, ` · asked ${ago(a.createdAt)}`),
            h(
              "div",
              { class: "actions" },
              h("button", { class: "btn btn-primary btn-sm", onclick: (e) => act(e.currentTarget, `/api/approvals/${a.id}/approve`, null, `Approve "${a.title}"${amount}?`) }, "Approve"),
              h("button", { class: "btn btn-sm btn-danger", onclick: (e) => act(e.currentTarget, `/api/approvals/${a.id}/reject`) }, "Reject"),
            ),
          );
        }),
  );
}
