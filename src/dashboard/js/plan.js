// Build plan: what's built, what's in progress, what's next. Jarne ticks off his own steps.
import { $, fill, h } from "./core.js";
import { planLine } from "./brainmap.js";

const COLUMNS = [
  ["done", "Klaar"],
  ["doing", "Bezig"],
  ["todo", "Nog te doen"],
  ["parked", "Geparkeerd"],
];

export function renderPlan(d) {
  if (!d?.plan) return;
  const mine = $("plan-mine")?.checked;
  const items = d.plan.filter((p) => !mine || p.owner === "jarne");
  const done = d.plan.filter((p) => p.status === "done").length;
  const jarneOpen = d.plan.filter((p) => p.owner === "jarne" && p.status !== "done").length;
  const pct = Math.round((done / d.plan.length) * 100);

  fill(
    "plan-progress",
    h(
      "div",
      { class: "plan-progress" },
      h("div", {}, h("strong", {}, `${done} van ${d.plan.length} stappen klaar`), h("span", { class: "muted" }, ` · ${jarneOpen} stap(pen) wachten op jou`)),
      h("div", { class: "meter", role: "meter", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Voortgang" }, h("span", { style: `width:${pct}%` })),
    ),
  );

  fill(
    "plan-board",
    COLUMNS.map(([status, title]) => {
      const list = items.filter((p) => p.status === status);
      if (list.length === 0) return null;
      const phases = [...new Set(list.map((p) => p.phase))];
      return h(
        "section",
        { class: `panel plan-col col-${status}` },
        h("h2", {}, `${title} (${list.length})`),
        phases.map((phase) =>
          h(
            "div",
            { class: "plan-phase" },
            h("div", { class: "kind" }, phase),
            list
              .filter((p) => p.phase === phase)
              .map((p) => h("div", { class: "plan-item" }, h("span", { class: `owner owner-${p.owner}` }, p.owner === "jarne" ? "Jij" : "Systeem"), planLine(p))),
          ),
        ),
      );
    }),
  );
}
