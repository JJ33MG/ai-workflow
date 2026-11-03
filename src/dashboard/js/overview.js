import { taskRunsChart } from "./charts.js";
import { AGENT_LABEL, STAGE, STATUS, notStarted, act, ago, empty, eur, fill, h, kpi, money, openSection, statusPill } from "./core.js";
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
  return hi ? `Doel ${eur(lo, 0)}–${eur(hi, 0)} per maand` : "Nog geen omzetdoel";
}

export function businessCard(b) {
  const stage = STAGE[b.stage];
  const [, hi] = b.targetCents;
  const pct = hi ? (b.revenueMonth / b.targetCents[0]) * 100 : 0;
  return h(
    "button",
    { class: `biz-card stage-${b.stage}`, onclick: () => openBusiness(b.id) },
    h("div", { class: "biz-card-head" }, h("span", { class: "biz-kind" }, `${b.kind} · Fase ${b.phase}`), statusPill(stage.status, stage.label)),
    h("strong", { class: "biz-name" }, b.name),
    notStarted(b)
      ? h("p", { class: "biz-plan" }, b.plan)
      : h(
          "div",
          { class: "biz-figures" },
          h("div", {}, h("span", { class: "label" }, "Omzet deze maand"), h("b", {}, eur(b.revenueMonth))),
          h("div", {}, h("span", { class: "label" }, "Winst"), h("b", {}, eur(b.profitMonth))),
          h("div", {}, h("span", { class: "label" }, "Producten"), h("b", {}, b.products.total)),
        ),
    hi > 0 &&
      !notStarted(b) &&
      h("div", { class: "meter", "aria-label": "Voortgang naar doel" }, h("span", { style: `width:${Math.min(100, pct)}%` })),
    h(
      "div",
      { class: "biz-foot" },
      h("span", {}, targetLabel(b)),
      b.openProblems > 0 && h("span", { class: "problem-chip" }, `${b.openProblems} probleem${b.openProblems > 1 ? "en" : ""}`),
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
        : h("div", { class: "muted" }, d.overall.status === "ok" ? "Alle bedrijven, agents en koppelingen werken." : "Zie de waarschuwingen bij Systemen en Agents."),
    ),
    d.overall.status !== "ok" &&
      h("button", { class: "btn btn-sm banner-btn", onclick: () => openSection("problems") }, "Bekijk problemen"),
  );

  const m = d.money;
  const goalPct = (m.netMonth / m.goalMonth) * 100;
  const apiPct = (m.apiSpentToday / m.apiCapToday) * 100;
  const needsYou = d.problems.filter((p) => p.state === "needs-you").length;
  fill(
    "kpis",
    kpi("Omzet deze maand", eur(m.revenueMonth), `${eur(m.revenueToday)} vandaag`),
    kpi("Kosten deze maand", eur(m.costsMonth), `${eur(m.overheadMonth)} algemene kosten`),
    kpi("Netto richting €10.000", eur(m.netMonth), `${Math.max(0, goalPct).toFixed(1)}% van het maanddoel`, { pct: goalPct }),
    kpi("Claude-budget vandaag", `${Math.round(apiPct)}%`, `${eur(m.apiSpentToday)} van ${eur(m.apiCapToday)}`, {
      pct: apiPct,
      cls: apiPct >= 100 ? "error" : apiPct >= 80 ? "warn" : "",
    }),
    kpi("Open problemen", String(d.problems.length), needsYou ? `${needsYou} wachten op jou` : d.problems.length ? "Worden automatisch opnieuw geprobeerd" : "Geen"),
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
      ? empty("Er wacht niets op een beslissing.", true)
      : d.approvals.map((a) => {
          const amount = a.amountCents != null ? ` · ${money(a.amountCents, a.currency)}` : "";
          return h(
            "div",
            { class: "approval" },
            h("strong", {}, a.title),
            h("div", { class: "details" }, a.details, amount, ` · gevraagd ${ago(a.createdAt)}`),
            h(
              "div",
              { class: "actions" },
              h("button", { class: "btn btn-primary btn-sm", onclick: (e) => act(e.currentTarget, `/api/approvals/${a.id}/approve`, null, `"${a.title}"${amount} goedkeuren?`) }, "Goedkeuren"),
              h("button", { class: "btn btn-sm btn-danger", onclick: (e) => act(e.currentTarget, `/api/approvals/${a.id}/reject`) }, "Afwijzen"),
            ),
          );
        }),
  );
}
