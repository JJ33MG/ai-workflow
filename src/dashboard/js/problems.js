import { $, LEVEL, act, ago, empty, fill, h, renderGuideBox, stamp, statusPill, table, until } from "./core.js";
import { openChat } from "./chat.js";
import { renderCheck } from "./overview.js";

export function renderProblems(d) {
  fill(
    "problems",
    d.problems.length === 0
      ? empty("Geen mislukte taken.", true)
      : d.problems.map((p) =>
          h(
            "div",
            { class: `problem ${p.state}` },
            h(
              "header",
              {},
              h("div", {}, h("strong", {}, p.agentName), " · ", h("code", {}, p.type)),
              statusPill(
                p.state === "needs-you" ? "error" : "warn",
                p.state === "needs-you" ? "Wacht op jou" : `Probeert opnieuw (poging ${p.attempts} van ${p.maxAttempts})`,
              ),
            ),
            h(
              "div",
              { class: "muted" },
              `Eerst gezien ${stamp(p.firstSeenAt)} · laatst bijgewerkt ${ago(p.updatedAt)}`,
              p.nextRetryAt ? ` · volgende poging ${until(p.nextRetryAt)}` : "",
            ),
            h("code", { class: "error-text" }, p.error ?? "Geen foutmelding"),
            renderGuideBox(p.guide),
            p.payload &&
              Object.keys(p.payload).length > 0 &&
              h("details", {}, h("summary", {}, "Invoer van de taak"), h("code", { class: "error-text" }, JSON.stringify(p.payload, null, 2))),
            h(
              "div",
              { class: "actions" },
              h("button", { class: "btn btn-primary btn-sm", onclick: (e) => act(e.currentTarget, `/api/tasks/${p.taskId}/retry`) }, "Nu opnieuw"),
              h("button", { class: "btn btn-sm", onclick: () => openChat(p.agentId) }, "Vraag de agent"),
              h(
                "button",
                { class: "btn btn-sm", onclick: (e) => act(e.currentTarget, `/api/tasks/${p.taskId}/dismiss`, null, "Deze fout negeren? Hij wordt niet meer geprobeerd of getoond.") },
                "Negeren",
              ),
            ),
          ),
        ),
  );

  fill(
    "issues",
    d.recentIssues.length === 0
      ? empty("Geen fouten of waarschuwingen in de laatste 48 uur.", true)
      : table(
          ["Wanneer", "Agent", "Soort", "Bericht"],
          d.recentIssues.map((i) =>
            h(
              "tr",
              {},
              h("td", { class: "nowrap", title: stamp(i.createdAt) }, ago(i.createdAt)),
              h("td", { class: "nowrap" }, i.agentName),
              h("td", { class: "nowrap" }, h("span", { class: `level level-${i.level}` }, LEVEL[i.level] ?? i.level)),
              h("td", {}, i.message, i.guide && i.guide.id !== "unknown" && h("div", { class: "muted" }, `→ ${i.guide.title}: ${i.guide.fix[0]}`)),
            ),
          ),
        ),
  );
}

export function renderGuide(d) {
  const todo = d.checks.filter((c) => c.status !== "ok");
  fill("setup", todo.length === 0 ? empty("Alles is ingesteld.", true) : todo.map(renderCheck));
  const q = $("guide-search").value.trim().toLowerCase();
  const guides = d.guides.filter((g) => !q || [g.title, g.area, g.why, ...g.fix].join(" ").toLowerCase().includes(q));
  fill("guides", guides.length ? h("div", { class: "guides" }, guides.map(renderGuideBox)) : empty("Geen uitleg gevonden voor die zoekterm."));
}
