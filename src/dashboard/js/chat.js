import { AGENT_LABEL, $, api, fill, h, openSection, state, statusPill, stamp } from "./core.js";

let current = null; // agent id
const threads = new Map(); // agent id → messages
const pending = new Set(); // agent ids waiting for a reply

const SUGGESTIONS = {
  ceo: ["How is the company doing today?", "What should I focus on this week?", "Which business is closest to its target?"],
  debug: ["Is anything broken right now?", "Explain the open problems and how to fix them", "Run a health check now"],
  "etsy-pod": ["What have you made so far?", "Make 3 new mug designs", "Which niches are you trying next and why?"],
};
const DEFAULT_SUGGESTIONS = ["How are things going?", "What's blocking you?", "What do you need from me?"];

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
    fill(box, h("div", { class: "empty" }, "Loading conversation…"));
    return;
  }
  const items = msgs.map(messageView);
  if (busy) items.push(h("div", { class: "msg msg-assistant typing" }, h("span", {}), h("span", {}), h("span", {}), h("span", { class: "sr-only" }, "Agent is typing")));
  if (msgs.length === 0 && !busy) {
    items.push(
      h(
        "div",
        { class: "chat-empty" },
        h("p", {}, loadError ? `Couldn't load the conversation: ${loadError}` : "Ask anything. The agent answers from its live data and can start its own jobs when you ask."),
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
  if (a.name === "start_task") return `Started ${a.input.agent}:${a.input.task}`;
  if (a.name === "retry_task") return "Retried a failed task";
  if (a.name === "save_to_brain") return `Saved to brain: ${a.input.title}`;
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
      content: err.message === "unauthorized" ? "Your session expired. Sign in again." : `Couldn't reach the agent: ${err.message}`,
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
