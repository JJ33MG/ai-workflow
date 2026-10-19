// Agency Brain dashboard. Plain JS, no build step. Every piece of server text is
// inserted with textContent (via h()), never innerHTML: errors and logs can contain
// text from Etsy, Printful or Claude.

const TOKEN_KEY = "agency-brain-token";
const REFRESH_MS = 30_000;

const STATUS = {
  ok: { icon: "✓", label: "OK" },
  warn: { icon: "!", label: "Warning" },
  error: { icon: "✕", label: "Problem" },
  off: { icon: "–", label: "Not set up" },
};
const AGENT_LABEL = {
  ok: "Working",
  running: "Running",
  waiting: "Waiting",
  paused: "Paused",
  retrying: "Retrying",
  stale: "Late",
  blocked: "Blocked",
  failing: "Failing",
};

let data = null;
let timer = null;

// ---------- helpers ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (id) => document.getElementById(id);
const fill = (id, ...nodes) => $(id).replaceChildren(...nodes.flat().filter(Boolean));

function statusPill(status, label) {
  const s = STATUS[status] ?? STATUS.off;
  return h("span", { class: `status s-${status}` }, h("span", { class: "dot", "aria-hidden": "true" }, s.icon), label ?? s.label);
}

const eur = (cents) =>
  `${cents < 0 ? "-" : ""}€${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ago(iso) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < -60) return `in ${fromSeconds(-s)}`;
  if (s < 45) return "just now";
  return `${fromSeconds(s)} ago`;
}
function fromSeconds(s) {
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
const until = (iso) => (iso ? `in ${fromSeconds(Math.max(60, Math.round((new Date(iso).getTime() - Date.now()) / 1000)))}` : "—");
const stamp = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function setToken(v) {
  try {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: token lives only for this page load */
  }
  memoryToken = v;
}
let memoryToken = getToken();

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { authorization: `Bearer ${memoryToken}`, "content-type": "application/json", ...(options.headers ?? {}) },
  });
  if (res.status === 401) {
    showLogin("That token was not accepted.");
    throw new Error("unauthorized");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4000);
}

async function act(button, path, body, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  button.disabled = true;
  try {
    const res = await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
    toast(res.message ?? "Done");
    await load();
  } catch (err) {
    if (err.message !== "unauthorized") toast(`Failed: ${err.message}`);
  } finally {
    button.disabled = false;
  }
}

// ---------- rendering ----------
function render() {
  const d = data;
  $("mode-badge").textContent = d.dryRun ? "Dry run" : "";
  $("updated").textContent = `Updated ${new Date(d.generatedAt).toLocaleTimeString()}`;
  const needsYou = d.problems.length;
  $("problem-count").hidden = needsYou === 0;
  $("problem-count").textContent = needsYou;

  renderBanner(d);
  renderKpis(d);
  fill("checks", d.checks.map(renderCheck));
  renderAgentSummary(d);
  renderChart(d.chart);
  renderApprovals(d.approvals);
  fill("agents", d.agents.map(renderAgentCard));
  renderProblems(d);
  renderGuide(d);
  renderActivity(d);
}

function renderBanner(d) {
  const b = $("banner");
  b.className = `banner s-${d.overall.status}`;
  b.replaceChildren(
    h("span", { class: `status s-${d.overall.status}` }, h("span", { class: "dot", "aria-hidden": "true" }, STATUS[d.overall.status].icon)),
    h(
      "div",
      {},
      h("h1", {}, d.overall.headline),
      d.overall.items.length
        ? h("ul", {}, d.overall.items.map((i) => h("li", {}, i)))
        : h("div", { class: "muted" }, d.overall.status === "ok" ? "Every agent and integration is healthy." : "See the warnings under Systems and Agents."),
    ),
  );
}

function kpi(label, value, sub, meter) {
  return h(
    "div",
    { class: "kpi" },
    h("div", { class: "label" }, label),
    h("div", { class: "value" }, value),
    sub && h("div", { class: "sub" }, sub),
    meter &&
      h(
        "div",
        { class: `meter ${meter.cls ?? ""}`, role: "meter", "aria-valuenow": Math.round(meter.pct), "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": label },
        h("span", { style: `width:${Math.min(100, Math.max(0, meter.pct))}%` }),
      ),
  );
}

function renderKpis(d) {
  const m = d.money;
  const goalPct = (m.netMonth / m.goalMonth) * 100;
  const apiPct = (m.apiSpentToday / m.apiCapToday) * 100;
  const needsYou = d.problems.filter((p) => p.state === "needs-you").length;
  fill(
    "kpis",
    kpi("Revenue this month", eur(m.revenueMonth), `${eur(m.revenueToday)} today`),
    kpi("Costs this month", eur(m.costsMonth), `${eur(m.costsToday)} today`),
    kpi("Net towards €10,000", eur(m.netMonth), `${Math.max(0, goalPct).toFixed(1)}% of the monthly goal`, { pct: goalPct }),
    kpi("Claude budget today", `${Math.round(apiPct)}%`, `${eur(m.apiSpentToday)} of ${eur(m.apiCapToday)}`, {
      pct: apiPct,
      cls: apiPct >= 100 ? "error" : apiPct >= 80 ? "warn" : "",
    }),
    kpi("Open problems", String(d.problems.length), needsYou ? `${needsYou} need you` : "All being retried automatically"),
  );
}

function renderCheck(c) {
  return h(
    "div",
    { class: "check" },
    h("div", {}, statusPill(c.status, c.label)),
    h("div", { class: "detail" }, c.detail),
    c.fix && c.status !== "ok" && h("div", { class: "fix" }, `→ ${c.fix}`),
  );
}

function renderAgentSummary(d) {
  fill(
    "agent-summary",
    d.agents.map((a) =>
      h(
        "div",
        { class: "agent-row", onclick: () => openTab("agents", `agent-${a.id}`) },
        h("div", {}, h("strong", {}, a.name), h("div", { class: "biz" }, a.business)),
        h("div", {}, statusPill(a.severity, AGENT_LABEL[a.health])),
        a.health !== "ok" && h("div", { class: "reason" }, a.reason, a.error ? `: ${a.error}` : ""),
      ),
    ),
  );
}

function renderAgentCard(a) {
  return h(
    "article",
    { class: "panel agent-card", id: `agent-${a.id}` },
    h(
      "header",
      {},
      h("div", {}, h("h2", { style: "margin:0" }, a.name), h("div", { class: "business" }, `Works for: ${a.business} · Phase ${a.phase}`)),
      h(
        "div",
        { class: "actions", style: "margin:0" },
        statusPill(a.severity, AGENT_LABEL[a.health]),
        h(
          "button",
          { class: "btn btn-sm", onclick: (e) => act(e.currentTarget, `/api/agents/${a.id}/${a.enabled ? "pause" : "resume"}`, null, a.enabled ? `Pause ${a.name}? Its scheduled jobs will be skipped.` : null) },
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
          h("a", { href: "#", onclick: (e) => (e.preventDefault(), openTab("problems")) }, "See how to fix →"),
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
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", {}, "What it can do"), h("th", {}, "When"), h("th", {}, "Last success"), h("th", {}, "Next run"), h("th", {}, ""))),
        h(
          "tbody",
          {},
          a.tasks.map((t) =>
            h(
              "tr",
              {},
              h("td", {}, h("div", {}, t.description), h("code", { class: "muted" }, t.type)),
              h("td", { class: "nowrap" }, t.schedule),
              h("td", { class: `nowrap ${t.stale ? "stale" : ""}` }, ago(t.lastSuccessAt), t.stale ? " · late" : ""),
              h("td", { class: "nowrap" }, t.nextRunAt ? until(t.nextRunAt) : "—"),
              h(
                "td",
                {},
                h("button", { class: "btn btn-sm", onclick: (e) => act(e.currentTarget, `/api/agents/${a.id}/tasks`, { type: t.type }) }, "Run now"),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderGuideBox(g) {
  return h(
    "div",
    { class: "guide" },
    h("div", { class: "area" }, g.area),
    h("h3", {}, g.title),
    h("p", {}, g.why),
    h("ol", {}, g.fix.map((f) => h("li", {}, f))),
  );
}

function renderProblems(d) {
  if (d.problems.length === 0) {
    fill("problems", h("div", { class: "empty good" }, "No failed tasks."));
  } else {
    fill(
      "problems",
      d.problems.map((p) =>
        h(
          "div",
          { class: `problem ${p.state}` },
          h(
            "header",
            {},
            h("div", {}, h("strong", {}, p.agentName), " · ", h("code", {}, p.type)),
            statusPill(p.state === "needs-you" ? "error" : "warn", p.state === "needs-you" ? "Needs you" : `Retrying (attempt ${p.attempts} of ${p.maxAttempts})`),
          ),
          h("div", { class: "muted" }, `First seen ${stamp(p.firstSeenAt)} · last update ${ago(p.updatedAt)}`, p.nextRetryAt ? ` · next retry ${until(p.nextRetryAt)}` : ""),
          h("code", { class: "error-text" }, p.error ?? "No error message"),
          renderGuideBox(p.guide),
          p.payload && Object.keys(p.payload).length > 0 && h("details", {}, h("summary", {}, "Task input"), h("code", { class: "error-text" }, JSON.stringify(p.payload, null, 2))),
          h(
            "div",
            { class: "actions" },
            h("button", { class: "btn btn-primary btn-sm", onclick: (e) => act(e.currentTarget, `/api/tasks/${p.taskId}/retry`) }, "Retry now"),
            h("button", { class: "btn btn-sm", onclick: (e) => act(e.currentTarget, `/api/tasks/${p.taskId}/dismiss`, null, "Dismiss this failure? It will no longer be retried or shown.") }, "Dismiss"),
          ),
        ),
      ),
    );
  }

  fill(
    "issues",
    d.recentIssues.length === 0
      ? h("div", { class: "empty good" }, "No errors or warnings in the last 48 hours.")
      : h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Agent"), h("th", {}, "Level"), h("th", {}, "Message"))),
            h(
              "tbody",
              {},
              d.recentIssues.map((i) =>
                h(
                  "tr",
                  {},
                  h("td", { class: "nowrap" }, ago(i.createdAt)),
                  h("td", { class: "nowrap" }, i.agentName),
                  h("td", { class: "nowrap" }, h("span", { class: `level level-${i.level}` }, i.level)),
                  h(
                    "td",
                    {},
                    i.message,
                    i.guide && i.guide.id !== "unknown" && h("div", { class: "muted" }, `→ ${i.guide.title}: ${i.guide.fix[0]}`),
                  ),
                ),
              ),
            ),
          ),
        ),
  );
}

function renderGuide(d) {
  const todo = d.checks.filter((c) => c.status !== "ok");
  fill(
    "setup",
    todo.length === 0
      ? h("div", { class: "empty good" }, "Everything is set up.")
      : todo.map(renderCheck),
  );
  const q = $("guide-search").value.trim().toLowerCase();
  const guides = d.guides.filter((g) => !q || [g.title, g.area, g.why, ...g.fix].join(" ").toLowerCase().includes(q));
  fill("guides", guides.length ? h("div", { class: "guides" }, guides.map(renderGuideBox)) : h("div", { class: "empty" }, "No guide matches that search."));
}

function renderActivity(d) {
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
      ? h("div", { class: "empty" }, "Nothing logged yet.")
      : h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Agent"), h("th", {}, "Level"), h("th", {}, "Message"))),
            h(
              "tbody",
              {},
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
          ),
        ),
  );
}

function renderApprovals(list) {
  fill(
    "approvals",
    list.length === 0
      ? h("div", { class: "empty good" }, "Nothing waiting for a decision.")
      : list.map((a) => {
          const amount = a.amountCents != null ? ` · ${a.currency === "EUR" ? eur(a.amountCents) : `${(a.amountCents / 100).toFixed(2)} ${a.currency}`}` : "";
          return h(
            "div",
            { class: "approval" },
            h("strong", {}, a.title),
            h("div", { class: "details" }, a.details, amount, ` · asked ${ago(a.createdAt)}`),
            h(
              "div",
              { class: "actions" },
              h("button", { class: "btn btn-primary btn-sm", onclick: (e) => act(e.currentTarget, `/api/approvals/${a.id}/approve`, null, `Approve: ${a.title}?${amount}`) }, "Approve"),
              h("button", { class: "btn btn-sm btn-danger", onclick: (e) => act(e.currentTarget, `/api/approvals/${a.id}/reject`) }, "Reject"),
            ),
          );
        }),
  );
}

// Stacked bars: done (blue) under failed (red), 2px surface gap, rounded top end.
function renderChart(days) {
  const SVG = "http://www.w3.org/2000/svg";
  const s = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const W = 560, H = 200, L = 28, B = 22, T = 8;
  const max = Math.max(4, ...days.map((d) => d.done + d.failed));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const colW = (W - L) / days.length;
  const barW = Math.min(22, colW * 0.6);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Tasks completed and failed per day over the last 14 days" });
  const axis = s("g", { class: "axis" });
  for (let v = 0; v <= top; v += step) {
    axis.append(s("line", { class: "gridline", x1: L, x2: W, y1: y(v), y2: y(v) }));
    const t = s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = v;
    axis.append(t);
  }
  svg.append(axis);

  const tip = document.querySelector(".tooltip") ?? document.body.appendChild(h("div", { class: "tooltip", hidden: true }));
  days.forEach((d, i) => {
    const x = L + i * colW + (colW - barW) / 2;
    const col = s("g", { class: "col" });
    const segs = [
      { v: d.done, cls: "bar-done" },
      { v: d.failed, cls: "bar-failed" },
    ].filter((g) => g.v > 0);
    let base = 0;
    segs.forEach((g, gi) => {
      const y0 = y(base), y1 = y(base + g.v);
      const isTop = gi === segs.length - 1;
      const gap = gi > 0 ? 2 : 0;
      const hgt = Math.max(1, y0 - y1 - gap);
      const r = isTop ? Math.min(4, hgt / 2, barW / 2) : 0;
      const yy = y1;
      // Path with rounded top corners only (data end), square at the baseline.
      const p = `M${x},${yy + hgt} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${yy + hgt} Z`;
      col.append(s("path", { d: p, class: g.cls }));
      base += g.v;
    });
    if (i % 2 === days.length % 2 || days.length <= 7) {
      const lbl = s("text", { x: x + barW / 2, y: H - 6, "text-anchor": "middle", class: "axis" });
      lbl.textContent = d.date.slice(5).replace("-", "/");
      lbl.setAttribute("fill", "var(--muted)");
      lbl.setAttribute("font-size", "11");
      svg.append(lbl);
    }
    const hit = s("rect", { class: "hit", x: L + i * colW, y: T, width: colW, height: H - T - B });
    const show = (e) => {
      tip.hidden = false;
      tip.textContent = `${d.date}: ${d.done} done, ${d.failed} failed`;
      tip.style.left = `${e.clientX + 12}px`;
      tip.style.top = `${e.clientY - 34}px`;
    };
    hit.addEventListener("mousemove", show);
    hit.addEventListener("mouseleave", () => (tip.hidden = true));
    col.append(hit);
    svg.append(col);
  });

  const total = days.reduce((a, d) => ({ done: a.done + d.done, failed: a.failed + d.failed }), { done: 0, failed: 0 });
  fill(
    "chart",
    h(
      "div",
      { class: "chart" },
      h(
        "div",
        { class: "legend" },
        h("span", {}, h("i", { style: "background:var(--series-done)" }), `Done (${total.done})`),
        h("span", {}, h("i", { style: "background:var(--critical)" }), `Failed (${total.failed})`),
      ),
      svg,
      h(
        "details",
        {},
        h("summary", {}, "Show as table"),
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, h("th", {}, "Day"), h("th", {}, "Done"), h("th", {}, "Failed"))),
          h("tbody", {}, days.map((d) => h("tr", {}, h("td", {}, d.date), h("td", {}, d.done), h("td", {}, d.failed)))),
        ),
      ),
    ),
  );
}

// ---------- tabs, loading, login ----------
function openTab(name, scrollTo) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  try {
    sessionStorage.setItem("agency-brain-tab", name);
  } catch {
    /* ignore */
  }
  if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function load() {
  try {
    data = await api("/api/dashboard");
    render();
  } catch (err) {
    if (err.message !== "unauthorized") toast(`Could not load: ${err.message}`);
  }
}

function showLogin(message = "") {
  clearInterval(timer);
  $("app").hidden = true;
  $("login").hidden = false;
  $("login-error").textContent = message;
  $("token").focus();
}

async function start() {
  $("login").hidden = true;
  $("app").hidden = false;
  await load();
  clearInterval(timer);
  timer = setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
}

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  setToken($("token").value.trim());
  start();
});
$("logout").addEventListener("click", () => {
  setToken("");
  showLogin();
});
$("refresh").addEventListener("click", load);
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));
$("guide-search").addEventListener("input", () => data && renderGuide(data));
$("filter-agent").addEventListener("change", () => data && renderActivity(data));
$("filter-level").addEventListener("change", () => data && renderActivity(data));
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && data && load());

try {
  const tab = sessionStorage.getItem("agency-brain-tab");
  if (tab) openTab(tab);
} catch {
  /* ignore */
}
if (memoryToken) start();
else showLogin();
