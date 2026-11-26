import { AGENT_LABEL, $, api, fill, h, openSection, state, statusPill, stamp } from "./core.js";

let current = null; // agent id
const threads = new Map(); // agent id → messages
const pending = new Set(); // agent ids waiting for a reply

const SUGGESTIONS = {
  ceo: ["Be honest: how is the company really doing?", "What should I focus on this week?", "What am I wasting money on?"],
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

// ---------- voice: talk to an agent, hear the answer (browser speech, no extra cost) ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = null; // the active recognition

/** Reads a reply aloud with an English voice, cutting off anything still being said. */
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const say = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
  const voices = speechSynthesis.getVoices();
  say.voice =
    voices.find((v) => /en-GB/i.test(v.lang) && /Daniel|Google UK English Male|Arthur|male/i.test(v.name)) ??
    voices.find((v) => /en-GB/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null;
  say.lang = say.voice?.lang ?? "en-GB";
  say.rate = 1.03;
  speechSynthesis.speak(say);
}

function setMic(on) {
  const mic = $("chat-mic");
  if (!mic) return;
  mic.setAttribute("aria-pressed", String(on));
  mic.textContent = on ? "● Listening… (click to send)" : "🎙 Talk";
}

/** Click to talk, click again (or pause) to send. The transcript shows in the box while you speak. */
function toggleMic() {
  if (listening) {
    listening.stop();
    return;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  const rec = new Recognition();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let transcript = "";
  rec.onresult = (e) => {
    transcript = [...e.results].map((r) => r[0].transcript).join(" ");
    $("chat-input").value = transcript;
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") $("chat-input").placeholder = "Microphone blocked: allow it in your browser for this site.";
  };
  rec.onend = () => {
    listening = null;
    setMic(false);
    if (transcript.trim()) send(transcript, { voice: true });
  };
  listening = rec;
  setMic(true);
  rec.start();
}

// Screenshots and PDFs waiting to go with the next message.
let files = [];

function renderFiles() {
  const box = $("chat-files");
  box.hidden = files.length === 0;
  box.replaceChildren(
    ...files.map((f, i) =>
      h("span", { class: "chat-file" }, `📎 ${f.name}`, h("button", { type: "button", class: "btn btn-sm", "aria-label": `${f.name} weghalen`, onclick: () => { files.splice(i, 1); renderFiles(); } }, "×")),
    ),
  );
}

function addFiles(list) {
  for (const file of list) {
    if (file.size > 20 * 1024 * 1024) continue; // the server says why for other types; giant files never leave the browser
    const reader = new FileReader();
    reader.onload = () => {
      files.push({ name: file.name || `screenshot-${files.length + 1}.png`, type: file.type, data: String(reader.result).split(",")[1] ?? "" });
      renderFiles();
    };
    reader.readAsDataURL(file);
  }
}

async function send(text, opts = {}) {
  const agentId = current;
  const message = text.trim();
  if ((!message && !files.length) || pending.has(agentId)) return;
  const attachments = files;
  files = [];
  renderFiles();
  const thread = threads.get(agentId) ?? [];
  const note = attachments.length ? `\n📎 ${attachments.map((a) => a.name).join(", ")}` : "";
  thread.push({ id: `local-${Date.now()}`, role: "user", content: `${message}${note}`, createdAt: new Date().toISOString() });
  threads.set(agentId, thread);
  pending.add(agentId);
  $("chat-input").value = "";
  renderThread();
  try {
    const res = await api(`/api/agents/${agentId}/chat`, { method: "POST", body: JSON.stringify({ message, voice: Boolean(opts.voice), attachments }) });
    thread.pop();
    thread.push(res.question, res.reply);
    if (opts.voice) speak(res.reply.content);
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
  $("chat-attach").addEventListener("click", () => $("chat-file").click());
  $("chat-file").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });
  // Drag files from the downloads straight onto the chat.
  const drop = $("section-chat");
  drop.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.types ?? [])].includes("Files")) {
      e.preventDefault();
      drop.classList.add("drag-over");
    }
  });
  drop.addEventListener("dragleave", (e) => {
    if (e.target === drop) drop.classList.remove("drag-over");
  });
  drop.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    drop.classList.remove("drag-over");
    addFiles(e.dataTransfer.files);
  });
  // Paste a screenshot straight into the message box.
  $("chat-input").addEventListener("paste", (e) => {
    const pasted = [...(e.clipboardData?.files ?? [])];
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  });
  if (Recognition) {
    $("chat-mic").hidden = false;
    $("chat-mic").addEventListener("click", toggleMic);
    // Voices load asynchronously in some browsers; ask early so the first answer has one.
    if ("speechSynthesis" in window) speechSynthesis.getVoices();
  }
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
