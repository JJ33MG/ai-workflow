// Agency Brain dashboard entry: login, navigation, polling and rendering.
import { renderActivity, renderBrain } from "./js/activity.js";
import { renderAgents } from "./js/agents.js";
import { renderBusinesses } from "./js/businesses.js";
import { initChat, renderChat } from "./js/chat.js";
import { $, api, openSection, state, toast } from "./js/core.js";
import { renderOverview } from "./js/overview.js";
import { renderGuide, renderProblems } from "./js/problems.js";

const TOKEN_KEY = "agency-brain-token";
const REFRESH_MS = 30_000;
let timer = null;
let active = "overview";

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveToken(v) {
  state.token = v;
  try {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the token lives only for this page load */
  }
}

function render() {
  const d = state.data;
  if (!d) return;
  $("mode-badge").textContent = window.AGENCY_PREVIEW ? "Example data" : d.dryRun ? "Dry run" : "Live";
  $("mode-badge").dataset.live = String(!d.dryRun && !window.AGENCY_PREVIEW);
  $("updated").textContent = `Updated ${new Date(d.generatedAt).toLocaleTimeString()}`;
  const count = $("problem-count");
  count.hidden = d.problems.length === 0;
  count.textContent = d.problems.length;
  const sideStatus = $("side-status");
  sideStatus.className = `side-status s-${d.overall.status}`;
  sideStatus.textContent = d.overall.headline;

  renderOverview(d);
  renderAgents(d);
  renderProblems(d);
  renderGuide(d);
  renderActivity(d);
  renderBrain(d);
  // These two keep local state (selection, typed text), so only refresh when visible.
  if (active === "businesses") renderBusinesses(d);
  if (active === "chat") renderChat(d);
}

async function load() {
  try {
    state.data = await api("/api/dashboard");
    render();
  } catch (err) {
    if (err.message !== "unauthorized") toast(`Could not load: ${err.message}`);
  }
}
state.onReload = load;

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

window.addEventListener("unauthorized", () => showLogin("That token was not accepted."));
window.addEventListener("section", (e) => {
  active = e.detail;
  if (active === "businesses") renderBusinesses(state.data);
  if (active === "chat") renderChat(state.data);
});

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveToken($("token").value.trim());
  start();
});
$("logout").addEventListener("click", () => {
  saveToken("");
  showLogin();
});
$("refresh").addEventListener("click", load);
document.querySelectorAll("[data-section]").forEach((b) => b.addEventListener("click", () => openSection(b.dataset.section)));
$("guide-search").addEventListener("input", () => state.data && renderGuide(state.data));
$("filter-agent").addEventListener("change", () => state.data && renderActivity(state.data));
$("filter-level").addEventListener("change", () => state.data && renderActivity(state.data));
$("brain-kind").addEventListener("change", () => state.data && renderBrain(state.data));
$("brain-search").addEventListener("input", () => state.data && renderBrain(state.data));
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && state.data && load());
initChat();

try {
  const saved = sessionStorage.getItem("agency-brain-section");
  if (saved && document.getElementById(`section-${saved}`)) openSection(saved);
} catch {
  /* storage unavailable */
}

if (window.AGENCY_PREVIEW) {
  $("logout").hidden = true;
  start();
} else {
  state.token = readToken();
  if (state.token) start();
  else showLogin();
}
