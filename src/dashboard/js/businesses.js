import { moneyChart } from "./charts.js";
import { AGENT_LABEL, STAGE, notStarted, api, empty, eur, fill, h, kpi, money, openSection, stamp, state, statusPill, table, ago } from "./core.js";
import { openChat } from "./chat.js";
import { targetLabel } from "./overview.js";

/** Product states as shown on the dashboard. */
const PRODUCT_STATUS = {
  draft: "concept",
  uploaded: "geüpload",
  active: "live",
  failed: "mislukt",
  drawing: "wordt getekend",
  ready: "klaar om te uploaden",
  published: "gepubliceerd",
};

let selected = null;
const details = new Map(); // business id → detail payload

export function openBusiness(id) {
  selected = id;
  openSection("businesses");
  renderBusinesses(state.data);
}

export function renderBusinesses(d) {
  if (!d) return;
  if (!selected || !d.businesses.some((b) => b.id === selected)) selected = d.businesses[0]?.id;
  fill(
    "business-picker",
    d.businesses.map((b) =>
      h(
        "button",
        { class: "picker-btn", "aria-pressed": String(b.id === selected), onclick: () => openBusiness(b.id) },
        h("span", { class: `picker-dot s-${STAGE[b.stage].status}`, "aria-hidden": "true" }),
        b.name,
      ),
    ),
  );
  const b = d.businesses.find((x) => x.id === selected);
  if (!b) return;
  renderDetail(d, b, details.get(b.id));
  if (!notStarted(b)) {
    api(`/api/businesses/${b.id}`)
      .then((detail) => {
        details.set(b.id, detail);
        if (selected === b.id) renderDetail(state.data, b, detail);
      })
      .catch(() => {});
  }
}

function renderDetail(d, b, detail) {
  const stage = STAGE[b.stage];
  const team = d.agents.filter((a) => a.businessId === b.id);
  const problems = d.problems.filter((p) => team.some((a) => a.id === p.agentId));

  const head = h(
    "div",
    { class: "panel biz-head" },
    h(
      "div",
      { class: "biz-head-top" },
      h("div", {}, h("div", { class: "biz-kind" }, `${b.kind} · Fase ${b.phase} · ${b.channels.join(", ")}`), h("h1", {}, b.name)),
      statusPill(stage.status, stage.label),
    ),
    h("p", {}, b.description),
    notStarted(b) &&
      h(
        "div",
        { class: "plan-box" },
        h("strong", {}, "Plan: "),
        b.plan,
        h(
          "div",
          { class: "muted" },
          b.stage === "parked"
            ? "Voorlopig geparkeerd; komt terug zodra de simpelere bedrijven verdienen."
            : `${targetLabel(b)}. Start in fase ${b.phase}, zodra de bedrijven ervoor verdienen.`,
        ),
      ),
  );
  if (notStarted(b)) {
    fill("business-detail", head);
    return;
  }

  const [lo, hi] = b.targetCents;
  const kpis = h(
    "div",
    { class: "kpis" },
    kpi("Omzet deze maand", eur(b.revenueMonth), `${eur(b.revenueToday)} vandaag · ${b.salesMonth} verkoop/verkopen`),
    kpi("Kosten deze maand", eur(b.costsMonth), detail ? costLine(detail.costsByCategory) : ""),
    kpi("Winst deze maand", eur(b.profitMonth), hi ? targetLabel(b) : "", hi ? { pct: (b.profitMonth / lo) * 100 } : null),
    kpi("Producten", String(b.products.total), Object.entries(b.products.byStatus).map(([k, v]) => `${v} ${PRODUCT_STATUS[k] ?? k}`).join(" · ") || "Nog geen"),
  );

  const teamPanel = h(
    "div",
    { class: "panel" },
    h("h2", {}, "Team"),
    team.map((a) =>
      h(
        "div",
        { class: "agent-row" },
        h("div", {}, h("strong", {}, a.name), h("div", { class: "biz" }, a.description)),
        h("div", { class: "agent-row-right" }, statusPill(a.severity, AGENT_LABEL[a.health]), h("button", { class: "btn btn-sm", onclick: () => openChat(a.id) }, "Chat")),
        a.health !== "ok" && h("div", { class: "reason" }, a.reason),
      ),
    ),
    problems.length > 0 &&
      h(
        "div",
        { class: "plan-box s-error-box" },
        `${problems.length} open probleem/problemen: `,
        problems.map((p) => p.type).join(", "),
        " ",
        h("button", { class: "link-btn", onclick: () => openSection("problems") }, "Bekijk problemen →"),
      ),
  );

  const chartPanel = h("div", { class: "panel" }, h("h2", {}, "Omzet en kosten, laatste 30 dagen"), detail ? moneyChart(detail.series) : empty("Laden…"));

  const productsPanel = h(
    "div",
    { class: "panel" },
    h("h2", {}, `Producten (${detail?.products.length ?? b.products.total})`),
    !detail
      ? empty("Laden…")
      : detail.products.length === 0
        ? empty("Nog geen producten. De agent maakt ze volgens schema, of vraag het in Chat.")
        : h(
            "div",
            { class: "products" },
            detail.products.map((p) =>
              h(
                "div",
                { class: "product" },
                h("div", { class: "product-img" }, p.image ? h("img", { src: p.image, alt: `Design: ${p.title}`, loading: "lazy" }) : h("span", { class: "muted" }, "Geen afbeelding")),
                h("div", { class: "product-body" }, h("div", { class: "product-title" }, p.title), p.detail && h("div", { class: "muted" }, p.detail)),
                h(
                  "div",
                  { class: "product-foot" },
                  h("span", { class: `chip chip-${p.status}` }, PRODUCT_STATUS[p.status] ?? p.status),
                  h("span", {}, money(p.priceCents, p.currency)),
                  h("span", { class: "muted" }, `${p.salesCount} verkocht`),
                ),
              ),
            ),
          ),
  );

  const salesPanel = h(
    "div",
    { class: "panel" },
    h("h2", {}, "Laatste verkopen"),
    !detail
      ? empty("Laden…")
      : detail.sales.length === 0
        ? empty("Nog geen verkopen.")
        : table(
            ["Wanneer", "Bestelling", "Aantal", "Bedrag"],
            detail.sales.map((s) =>
              h("tr", {}, h("td", { class: "nowrap", title: stamp(s.occurredAt) }, ago(s.occurredAt)), h("td", {}, `${s.source} #${s.externalId}`), h("td", { class: "num" }, s.items || "—"), h("td", { class: "num" }, money(s.amountCents, s.currency))),
            ),
          ),
  );

  fill("business-detail", head, kpis, h("div", { class: "grid-2" }, chartPanel, teamPanel), productsPanel, salesPanel);
}

function costLine(byCategory) {
  const names = { claude_api: "Claude", etsy_fee: "Etsy-kosten", printful: "Printful", ads: "Advertenties" };
  const parts = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${names[k] ?? k} ${eur(v)}`);
  return parts.join(" · ") || "Nog geen kosten";
}
