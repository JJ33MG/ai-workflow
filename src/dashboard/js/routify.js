// Routify: its numbers from the app, the steps to the soft and the hard launch (Jarne's and
// Claude's), and ideas for later. Steps Routify reports on tick themselves off.
import { $, act, fill, h, kpi } from "./core.js";

const STAGES = [
  ["soft", "Soft launch", "Echte mensen kunnen plannen en betalen; een kleine groep testers. Doel: half december."],
  ["hard", "Harde lancering", "Alles wat een reiziger verwacht, met marketing. Doel: eind januari of februari."],
];
const OWNERS = [
  ["jarne", "Jij"],
  ["claude", "Claude"],
];
const MARK = { done: "✓", doing: "≈", todo: "○" };

function line(item) {
  const done = item.status === "done";
  return h(
    "div",
    { class: `plan-line status-${item.status}` },
    h("span", { class: "plan-mark", "aria-hidden": "true" }, MARK[item.status] ?? "○"),
    h(
      "div",
      {},
      h("div", { class: "plan-title" }, item.title),
      item.detail && h("div", { class: "muted" }, item.detail),
      item.link && h("div", {}, h("a", { href: item.link, target: "_blank", rel: "noopener noreferrer" }, item.link.replace(/^https?:\/\//, "").replace(/\/$/, ""))),
      item.steps && h("ol", { class: "launch-steps" }, item.steps.map((st) => h("li", {}, st))),
      item.auto && h("div", { class: "auto-note" }, "Automatisch afgevinkt: Routify meldt dat het klaar is"),
    ),
    !item.auto &&
      h(
        "button",
        {
          class: `btn btn-sm ${done ? "" : "btn-primary"}`,
          onclick: (e) => act(e.currentTarget, `/api/routify/launch/${item.id}`, { status: done ? "todo" : "done" }),
        },
        done ? "Toch niet klaar" : "Klaar",
      ),
  );
}

export function renderRoutify(d) {
  const r = d?.routify;
  if (!r) return;
  const s = r.stats;
  fill(
    "routify-kpis",
    s
      ? [
          kpi("Gebruikers", String(s.users.total), `${s.users.last7d} nieuw deze week`),
          kpi("Trips", String(s.trips.total), `${s.trips.last7d} deze week`),
          kpi("Plus-leden", String(s.plus)),
          kpi("Boekingskliks", String(s.affiliateClicks.last7d), "deze week"),
          s.gems && kpi("Gems in de bibliotheek", s.gems.library.toLocaleString("nl-NL"), s.gems.seedBudget ? `seed: ${s.gems.seedSearches} van ${s.gems.seedBudget} zoekopdrachten` : "seed nog niet gestart"),
        ]
      : [kpi("Routify", "Nog geen cijfers", "De Routify-agent haalt ze elke ochtend om 08:10 op")],
  );

  const mine = $("routify-mine")?.checked;
  fill(
    "routify-launch",
    STAGES.map(([stage, title, why]) => {
      const p = r.progress[stage];
      const pct = Math.round((p.done / p.total) * 100);
      return h(
        "section",
        { class: "panel routify-stage", "aria-label": title },
        h("h2", { class: "flush" }, title),
        h("p", { class: "muted flush" }, why),
        h(
          "div",
          { class: "plan-progress" },
          h("div", {}, h("strong", {}, `${p.done} van ${p.total} stappen klaar`), h("span", { class: "muted" }, ` · jij nog ${p.jarneOpen}, Claude nog ${p.claudeOpen}`)),
          h("div", { class: "meter", role: "meter", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": `Voortgang ${title}` }, h("span", { style: `width:${pct}%` })),
        ),
        h(
          "div",
          { class: "plan-board" },
          OWNERS.filter(([owner]) => !mine || owner === "jarne").map(([owner, who]) => {
            const list = r.items.filter((i) => i.stage === stage && i.owner === owner);
            // Open steps first, finished ones at the bottom.
            list.sort((a, b) => (a.status === "done") - (b.status === "done"));
            return h(
              "div",
              { class: "plan-col" },
              h("h3", { class: "flush" }, h("span", { class: `owner owner-${owner}` }, who), ` ${list.filter((i) => i.status !== "done").length} open`),
              list.map((i) => h("div", { class: "plan-item" }, line(i))),
            );
          }),
        ),
      );
    }),
  );
  fill("routify-ideas", r.ideas.map((i) => h("div", { class: "routify-idea" }, h("div", { class: "plan-title" }, i.title), h("div", { class: "muted" }, i.detail))));
}
