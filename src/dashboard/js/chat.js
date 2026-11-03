import { AGENT_LABEL, $, api, fill, h, openSection, state, statusPill, stamp } from "./core.js";

let current = null; // agent id
const threads = new Map(); // agent id → messages
const pending = new Set(); // agent ids waiting for a reply

const SUGGESTIONS = {
  ceo: ["Hoe gaat het vandaag met het bedrijf?", "Waar moet ik deze week op focussen?", "Welk bedrijf zit het dichtst bij zijn doel?"],
  debug: ["Is er nu iets kapot?", "Leg de open problemen uit en hoe ik ze oplos", "Doe nu een controle"],
  "etsy-pod": ["Wat heb je tot nu toe gemaakt?", "Maak 3 nieuwe mokontwerpen", "Welke niches probeer je hierna en waarom?"],
  "kdp-coloring": ["Welk kleurboek zou je als eerste maken?", "Maak een kleurboek over dinosaurussen", "Hoe weet je of een pagina goed genoeg is?"],
};
const DEFAULT_SUGGESTIONS = ["Hoe gaat het?", "Wat houdt je tegen?", "Wat heb je van mij nodig?"];

export function openChat(agentId) {
  current = agentId;
  openSection("chat");
  renderChat(state.data);
  $("chat-input")?.focus();
}

export function renderChat(d) {
  if (!d) return;
  current ??= d.agents[0]?.id;
  fill(
    "chat-agents",
    d.agents.map((a) =>
      h(
        "button",
        { class: "chat-agent", "aria-pressed": String(a.id === current), onclick: () => openChat(a.id) },
        h("span", { class: `picker-dot s-${a.severity}`, "aria-hidden": "true" }),
        h("span", {}, h("strong", {}, a.name), h("span", { class: "chat-agent-biz" }, a.business)),
      ),
    ),
  );
  const agent = d.agents.find((a) => a.id === current);
  if (!agent) return;
  fill(
    "chat-head",
    h("div", {}, h("h2", { class: "flush" }, agent.name), h("div", { class: "muted" }, agent.business)),
    statusPill(agent.severity, AGENT_LABEL[agent.health]),
  );
  if (!threads.has(agent.id)) {
    threads.set(agent.id, null);
    api(`/api/agents/${agent.id}/chat`)
      .then((msgs) => {
        threads.set(agent.id, msgs);
        if (current === agent.id) renderThread();
      })
      .catch((err) => {
        threads.set(agent.id, []);
        if (current === agent.id) renderThread(err.message);
      });
  }
  renderThread();
}

function renderThread(loadError) {
  const msgs = threads.get(current);
  const box = $("chat-messages");
  const busy = pending.has(current);
  $("chat-send").disabled = busy;
  if (msgs === null || msgs === undefined) {
    fill(box, h("div", { class: "empty" }, "Gesprek laden…"));
    return;
  }
  const items = msgs.map(messageView);
  if (busy) items.push(h("div", { class: "msg msg-assistant typing" }, h("span", {}), h("span", {}), h("span", {}), h("span", { class: "sr-only" }, "Agent is aan het typen")));
  if (msgs.length === 0 && !busy) {
    items.push(
      h(
        "div",
        { class: "chat-empty" },
        h("p", {}, loadError ? `Gesprek laden mislukt: ${loadError}` : "Vraag wat je wilt. De agent antwoordt vanuit zijn live gegevens en kan zijn eigen taken starten als je dat vraagt."),
        h("div", { class: "suggestions" }, (SUGGESTIONS[current] ?? DEFAULT_SUGGESTIONS).map((s) => h("button", { class: "chip-btn", onclick: () => send(s) }, s))),
      ),
    );
  }
  fill(box, items);
  box.scrollTop = box.scrollHeight;
}

function messageView(m) {
  const failed = m.actions && !Array.isArray(m.actions) && m.actions.error;
  const actions = Array.isArray(m.actions) ? m.actions : [];
  return h(
    "div",
    { class: `msg msg-${m.role} ${failed ? "msg-error" : ""}` },
    h("div", { class: "msg-text" }, m.content),
    actions.length > 0 &&
      h(
        "div",
        { class: "msg-actions" },
        actions.map((a) => h("span", { class: `action-chip ${a.isError ? "action-failed" : ""}`, title: a.result }, `${a.isError ? "✕" : "✓"} ${actionLabel(a)}`)),
      ),
    h("div", { class: "msg-time" }, stamp(m.createdAt)),
  );
}

function actionLabel(a) {
  if (a.name === "start_task") return `Gestart: ${a.input.agent}:${a.input.task}`;
  if (a.name === "retry_task") return "Mislukte taak opnieuw gestart";
  if (a.name === "save_to_brain") return `Bewaard in het brein: ${a.input.title}`;
  return a.name;
}

async function send(text) {
  const agentId = current;
  const message = text.trim();
  if (!message || pending.has(agentId)) return;
  const thread = threads.get(agentId) ?? [];
  thread.push({ id: `local-${Date.now()}`, role: "user", content: message, createdAt: new Date().toISOString() });
  threads.set(agentId, thread);
  pending.add(agentId);
  $("chat-input").value = "";
  renderThread();
  try {
    const res = await api(`/api/agents/${agentId}/chat`, { method: "POST", body: JSON.stringify({ message }) });
    thread.pop();
    thread.push(res.question, res.reply);
    if (res.reply.actions && Array.isArray(res.reply.actions)) state.onReload();
  } catch (err) {
    thread.push({
      id: `err-${Date.now()}`,
      role: "assistant",
      content: err.message === "unauthorized" ? "Je sessie is verlopen. Log opnieuw in." : `Kon de agent niet bereiken: ${err.message}`,
      actions: { error: true },
      createdAt: new Date().toISOString(),
    });
  } finally {
    pending.delete(agentId);
    if (current === agentId) renderThread();
  }
}

export function initChat() {
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    send($("chat-input").value);
  });
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send($("chat-input").value);
    }
  });
}
