import { moneyChart } from "./charts.js";
import { AGENT_LABEL, STAGE, api, empty, eur, fill, h, kpi, money, openSection, stamp, state, statusPill, table, ago } from "./core.js";
import { openChat } from "./chat.js";
import { targetLabel } from "./overview.js";

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
  if (b.stage !== "planned") {
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
      h("div", {}, h("div", { class: "biz-kind" }, `${b.kind} · Phase ${b.phase} · ${b.channels.join(", ")}`), h("h1", {}, b.name)),
      statusPill(stage.status, stage.label),
    ),
    h("p", {}, b.description),
    b.stage === "planned" &&
      h(
        "div",
        { class: "plan-box" },
        h("strong", {}, "Plan: "),
        b.plan,
        h("div", { class: "muted" }, `${targetLabel(b)}. Starts in phase ${b.phase}, once the businesses before it are earning.`),
      ),
  );
  if (b.stage === "planned") {
    fill("business-detail", head);
    return;
  }

  const [lo, hi] = b.targetCents;
  const kpis = h(
    "div",
    { class: "kpis" },
    kpi("Revenue this month", eur(b.revenueMonth), `${eur(b.revenueToday)} today · ${b.salesMonth} sale(s)`),
    kpi("Costs this month", eur(b.costsMonth), detail ? costLine(detail.costsByCategory) : ""),
    kpi("Profit this month", eur(b.profitMonth), hi ? targetLabel(b) : "", hi ? { pct: (b.profitMonth / lo) * 100 } : null),
    kpi("Products", String(b.products.total), Object.entries(b.products.byStatus).map(([k, v]) => `${v} ${k}`).join(" · ") || "None yet"),
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
        `${problems.length} open problem(s): `,
        problems.map((p) => p.type).join(", "),
        " ",
        h("button", { class: "link-btn", onclick: () => openSection("problems") }, "See problems →"),
      ),
  );

  const chartPanel = h("div", { class: "panel" }, h("h2", {}, "Revenue and costs, last 30 days"), detail ? moneyChart(detail.series) : empty("Loading…"));

  const productsPanel = h(
    "div",
    { class: "panel" },
    h("h2", {}, `Products (${detail?.products.length ?? b.products.total})`),
    !detail
      ? empty("Loading…")
      : detail.products.length === 0
        ? empty("No products yet. The agent creates them on its schedule, or ask it in Chat.")
        : h(
            "div",
            { class: "products" },
            detail.products.map((p) =>
              h(
                "div",
                { class: "product" },
                h("div", { class: "product-img" }, p.image ? h("img", { src: p.image, alt: `Design: ${p.title}`, loading: "lazy" }) : h("span", { class: "muted" }, "No image")),
                h("div", { class: "product-body" }, h("div", { class: "product-title" }, p.title), p.detail && h("div", { class: "muted" }, p.detail)),
                h(
                  "div",
                  { class: "product-foot" },
                  h("span", { class: `chip chip-${p.status}` }, p.status),
                  h("span", {}, money(p.priceCents, p.currency)),
                  h("span", { class: "muted" }, `${p.salesCount} sold`),
                ),
              ),
            ),
          ),
  );

  const salesPanel = h(
    "div",
    { class: "panel" },
    h("h2", {}, "Latest sales"),
    !detail
      ? empty("Loading…")
      : detail.sales.length === 0
        ? empty("No sales yet.")
        : table(
            ["When", "Order", "Items", "Amount"],
            detail.sales.map((s) =>
              h("tr", {}, h("td", { class: "nowrap", title: stamp(s.occurredAt) }, ago(s.occurredAt)), h("td", {}, `${s.source} #${s.externalId}`), h("td", { class: "num" }, s.items || "—"), h("td", { class: "num" }, money(s.amountCents, s.currency))),
            ),
          ),
  );

  fill("business-detail", head, kpis, h("div", { class: "grid-2" }, chartPanel, teamPanel), productsPanel, salesPanel);
}

function costLine(byCategory) {
  const names = { claude_api: "Claude", etsy_fee: "Etsy fees", printful: "Printful", ads: "Ads" };
  const parts = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${names[k] ?? k} ${eur(v)}`);
  return parts.join(" · ") || "No costs yet";
}
