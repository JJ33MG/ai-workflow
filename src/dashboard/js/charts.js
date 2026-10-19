import { eur, h } from "./core.js";

const SVG = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function tooltip() {
  return document.querySelector(".tooltip") ?? document.body.appendChild(h("div", { class: "tooltip", hidden: true }));
}
function showTip(e, text) {
  const tip = tooltip();
  tip.hidden = false;
  tip.textContent = text;
  const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${e.clientY - 38}px`;
}
const hideTip = () => (tooltip().hidden = true);

function niceMax(v, ticks = 4) {
  if (v <= 0) return ticks;
  const raw = v / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw);
  return step * ticks;
}

function axis(svg, { L, W, y, top, ticks, fmt }) {
  const g = s("g", { class: "axis" });
  for (let i = 0; i <= ticks; i++) {
    const v = (top / ticks) * i;
    g.append(s("line", { class: "gridline", x1: L, x2: W, y1: y(v), y2: y(v) }));
    const t = s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = fmt(v);
    g.append(t);
  }
  svg.append(g);
}

function dateLabel(svg, x, H, date) {
  const t = s("text", { x, y: H - 6, "text-anchor": "middle", class: "axis-label" });
  t.textContent = date.slice(5).replace("-", "/");
  svg.append(t);
}

function tableView(headers, rows) {
  return h(
    "details",
    {},
    h("summary", {}, "Show as table"),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))),
        h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c))))),
      ),
    ),
  );
}

/** Stacked daily bars: done (blue) under failed (red), rounded data end, 2px gap. */
export function taskRunsChart(days) {
  const W = 560, H = 200, L = 30, B = 22, T = 8;
  const top = niceMax(Math.max(...days.map((d) => d.done + d.failed)));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const colW = (W - L) / days.length;
  const barW = Math.min(22, colW * 0.6);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Tasks completed and failed per day" });
  axis(svg, { L, W, y, top, ticks: 4, fmt: (v) => String(Math.round(v)) });

  days.forEach((d, i) => {
    const x = L + i * colW + (colW - barW) / 2;
    const segs = [
      { v: d.done, cls: "bar-done" },
      { v: d.failed, cls: "bar-failed" },
    ].filter((g) => g.v > 0);
    let base = 0;
    segs.forEach((g, gi) => {
      const y0 = y(base), y1 = y(base + g.v);
      const gap = gi > 0 ? 2 : 0;
      const hh = Math.max(1, y0 - y1 - gap);
      const r = gi === segs.length - 1 ? Math.min(4, hh / 2, barW / 2) : 0;
      svg.append(
        s("path", {
          class: g.cls,
          d: `M${x},${y1 + hh} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y1 + hh} Z`,
        }),
      );
      base += g.v;
    });
    if (i % 2 === (days.length - 1) % 2) dateLabel(svg, x + barW / 2, H, d.date);
    const hit = s("rect", { class: "hit", x: L + i * colW, y: T, width: colW, height: H - T - B });
    hit.addEventListener("mousemove", (e) => showTip(e, `${d.date}: ${d.done} done, ${d.failed} failed`));
    hit.addEventListener("mouseleave", hideTip);
    svg.append(hit);
  });

  const total = days.reduce((a, d) => ({ done: a.done + d.done, failed: a.failed + d.failed }), { done: 0, failed: 0 });
  return h(
    "div",
    { class: "chart" },
    h(
      "div",
      { class: "legend" },
      h("span", {}, h("i", { class: "swatch-done" }), `Done (${total.done})`),
      h("span", {}, h("i", { class: "swatch-failed" }), `Failed (${total.failed})`),
    ),
    svg,
    tableView(["Day", "Done", "Failed"], days.map((d) => [d.date, d.done, d.failed])),
  );
}

/** Revenue vs costs per day: two 2px lines on one euro axis, crosshair tooltip. */
export function moneyChart(series) {
  const W = 560, H = 210, L = 50, B = 22, T = 10, R = 18;
  const top = niceMax(Math.max(...series.map((d) => Math.max(d.revenue, d.costs))) / 100) * 100;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const x = (i) => L + ((W - L - R) * i) / (series.length - 1);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Revenue and costs per day, last 30 days" });
  axis(svg, { L, W: W - R, y, top, ticks: 4, fmt: (v) => eur(v, 0) });

  const line = (key, cls) => {
    const d = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
    svg.append(s("path", { d, class: `line ${cls}` }));
    const last = series.length - 1;
    svg.append(s("circle", { cx: x(last), cy: y(series[last][key]), r: 4, class: `end ${cls}` }));
  };
  line("costs", "line-costs");
  line("revenue", "line-revenue");
  series.forEach((d, i) => {
    if (i % 5 === (series.length - 1) % 5) dateLabel(svg, x(i), H, d.date);
  });

  const cross = s("line", { class: "crosshair", y1: T, y2: H - B, x1: 0, x2: 0, visibility: "hidden" });
  svg.append(cross);
  const hit = s("rect", { class: "hit", x: L, y: T, width: W - L - R, height: H - T - B });
  hit.addEventListener("mousemove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(((px - L) / (W - L - R)) * (series.length - 1))));
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    const d = series[i];
    showTip(e, `${d.date}: revenue ${eur(d.revenue)}, costs ${eur(d.costs)}`);
  });
  hit.addEventListener("mouseleave", () => {
    cross.setAttribute("visibility", "hidden");
    hideTip();
  });
  svg.append(hit);

  const sum = (k) => series.reduce((a, d) => a + d[k], 0);
  return h(
    "div",
    { class: "chart" },
    h(
      "div",
      { class: "legend" },
      h("span", {}, h("i", { class: "swatch-revenue" }), `Revenue (${eur(sum("revenue"))})`),
      h("span", {}, h("i", { class: "swatch-costs" }), `Costs (${eur(sum("costs"))})`),
    ),
    svg,
    tableView(["Day", "Revenue", "Costs"], series.map((d) => [d.date, eur(d.revenue), eur(d.costs)])),
  );
}
