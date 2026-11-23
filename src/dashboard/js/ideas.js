// Scout's ideas: new ones first with vote buttons, then what Jarne chose to build, later, or not.
import { act, ago, empty, fill, h } from "./core.js";

const KIND = { new_business: "Nieuw bedrijf", grow: "Meer verdienen", brain: "Brain beter maken", trend: "Trend" };
const GROUPS = [
  ["new", "Nieuw: wacht op jouw stem"],
  ["build", "Bouwen (Claude bouwt ze in je volgende sessie)"],
  ["later", "Later"],
  ["done", "Gebouwd"],
  ["no", "Afgewezen"],
];
const VOTES = [
  ["build", "👍 Bouwen", "btn-primary"],
  ["later", "🕐 Later", ""],
  ["no", "👎 Nee", ""],
];

function card(i) {
  return h(
    "div",
    { class: "panel idea-card" },
    h(
      "div",
      { class: "muted" },
      `${KIND[i.kind] ?? i.kind}${i.outsideBox ? " · buiten de lijntjes" : ""} · ${ago(i.createdAt)}${i.origin === "weekly" ? " · Brain-review" : ""}`,
    ),
    h("h3", { class: "flush" }, i.title),
    h("p", {}, i.summary),
    h("p", {}, h("strong", {}, "Waarom nu: "), i.whyNow),
    h("p", { class: "muted" }, `Opbrengst: ${i.money} · Kosten: ${i.cost} · Moeite: ${i.effort}`),
    h("p", {}, h("strong", {}, "Eerste stap: "), i.firstStep),
    h("p", { class: "muted" }, h("strong", {}, "Risico's: "), i.risks),
    i.sources?.length &&
      h(
        "ul",
        { class: "idea-sources" },
        i.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url))),
      ),
    i.feedback && h("p", { class: "muted" }, `Jouw reden: ${i.feedback}`),
    h(
      "div",
      { class: "idea-actions" },
      VOTES.filter(([v]) => v !== i.status).map(([v, label, cls]) =>
        h("button", { class: `btn btn-sm ${cls}`, onclick: (e) => act(e.currentTarget, `/api/ideas/${i.id}/${v}`, {}) }, label),
      ),
      i.status === "build" &&
        h("button", { class: "btn btn-sm", onclick: (e) => act(e.currentTarget, `/api/ideas/${i.id}/done`, {}) }, "✓ Gebouwd"),
    ),
  );
}

export function renderIdeas(d) {
  const ideas = d?.ideas ?? [];
  if (!ideas.length) {
    fill("ideas-list", empty("Nog geen ideeën. Scout stuurt de eerste morgen om 08:00, of vraag er nu één met /idee in Telegram."));
    return;
  }
  fill(
    "ideas-list",
    ...GROUPS.filter(([status]) => ideas.some((i) => i.status === status)).map(([status, label]) =>
      h("div", { class: "stack" }, h("h2", {}, label), ideas.filter((i) => i.status === status).map(card)),
    ),
  );
}
