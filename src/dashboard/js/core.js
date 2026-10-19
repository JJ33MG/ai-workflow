// Shared helpers. Every piece of server text goes in through h() as a text node,
// never as HTML: errors, logs and chat can contain text from Etsy, Printful or Claude.

export const STATUS = {
  ok: { icon: "✓", label: "OK" },
  warn: { icon: "!", label: "Warning" },
  error: { icon: "✕", label: "Problem" },
  off: { icon: "–", label: "Not set up" },
};

export const AGENT_LABEL = {
  ok: "Working",
  running: "Running",
  waiting: "Waiting",
  paused: "Paused",
  retrying: "Retrying",
  stale: "Late",
  blocked: "Blocked",
  failing: "Failing",
};

export const STAGE = {
  earning: { label: "Earning", status: "ok" },
  "setting-up": { label: "Setting up", status: "warn" },
  planned: { label: "Planned", status: "off" },
};

export const state = { data: null, token: "", onReload: async () => {} };

export function h(tag, attrs = {}, ...children) {
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

export const $ = (id) => document.getElementById(id);
export const fill = (target, ...nodes) =>
  (typeof target === "string" ? $(target) : target).replaceChildren(...nodes.flat().filter(Boolean));

export function statusPill(status, label) {
  const s = STATUS[status] ?? STATUS.off;
  return h(
    "span",
    { class: `status s-${status}` },
    h("span", { class: "dot", "aria-hidden": "true" }, s.icon),
    label ?? s.label,
  );
}

export const eur = (cents, digits = 2) =>
  `${cents < 0 ? "-" : ""}€${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;

export const money = (cents, currency) => (currency === "EUR" ? eur(cents) : `${(cents / 100).toFixed(2)} ${currency}`);

function span(s) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
export function ago(iso) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < -60) return `in ${span(-s)}`;
  if (s < 45) return "just now";
  return `${span(s)} ago`;
}
export const until = (iso) =>
  iso ? `in ${span(Math.max(60, Math.round((new Date(iso).getTime() - Date.now()) / 1000)))}` : "—";
export const stamp = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export async function api(path, options = {}) {
  // The published preview swaps in example data here.
  if (window.AGENCY_PREVIEW) return window.AGENCY_PREVIEW.api(path, options);
  const res = await fetch(path, {
    ...options,
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", ...(options.headers ?? {}) },
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("unauthorized"));
    throw new Error("unauthorized");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4500);
}

/** Runs a POST action from a button, with an optional in-page confirmation. */
export async function act(button, path, body, confirmText) {
  if (confirmText && !(await confirmInline(button, confirmText))) return;
  button.disabled = true;
  try {
    const res = await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
    toast(res.message ?? "Done");
    await state.onReload();
  } catch (err) {
    if (err.message !== "unauthorized") toast(`Failed: ${err.message}`);
  } finally {
    button.disabled = false;
  }
}

// A small confirm bar next to the button (browser confirm() dialogs are blocked in some viewers).
function confirmInline(button, text) {
  return new Promise((resolve) => {
    document.querySelectorAll(".confirm").forEach((c) => c.remove());
    const done = (ok) => {
      bar.remove();
      resolve(ok);
    };
    const bar = h(
      "div",
      { class: "confirm", role: "alertdialog" },
      h("span", {}, text),
      h("button", { class: "btn btn-primary btn-sm", onclick: () => done(true) }, "Yes"),
      h("button", { class: "btn btn-sm", onclick: () => done(false) }, "Cancel"),
    );
    button.closest(".actions, .agent-head-actions, td, div")?.after(bar);
    bar.querySelector("button")?.focus();
  });
}

export function openSection(name, scrollTo) {
  document.querySelectorAll("[data-section]").forEach((b) => {
    b.setAttribute("aria-current", String(b.dataset.section === name));
    if (b.dataset.section === name) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  document.querySelectorAll(".section").forEach((t) => (t.hidden = t.id !== `section-${name}`));
  try {
    sessionStorage.setItem("agency-brain-section", name);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent("section", { detail: name }));
  if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: 0 });
}

export function kpi(label, value, sub, meter) {
  return h(
    "div",
    { class: "kpi" },
    h("div", { class: "label" }, label),
    h("div", { class: "value" }, value),
    sub && h("div", { class: "sub" }, sub),
    meter &&
      h(
        "div",
        {
          class: `meter ${meter.cls ?? ""}`,
          role: "meter",
          "aria-valuenow": Math.round(meter.pct),
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-label": label,
        },
        h("span", { style: `width:${Math.min(100, Math.max(0, meter.pct))}%` }),
      ),
  );
}

export function renderGuideBox(g) {
  return h(
    "div",
    { class: "guide" },
    h("div", { class: "area" }, g.area),
    h("h3", {}, g.title),
    h("p", {}, g.why),
    h("ol", {}, g.fix.map((f) => h("li", {}, f))),
  );
}

export function table(headers, rows) {
  return h(
    "div",
    { class: "table-wrap" },
    h("table", {}, h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))), h("tbody", {}, rows)),
  );
}

export const empty = (text, good = false) => h("div", { class: `empty ${good ? "good" : ""}` }, text);
