// Handbook: how the whole company works, every part explained in plain Dutch.
import { fill, h } from "./core.js";
import { NODE_STATE, STATE_HELP } from "./brainmap.js";

const TERMS = [
  ["Agent", "Een AI-medewerker met één taak, bijvoorbeeld de Etsy-winkel runnen. Hij denkt via Claude en werkt via taken."],
  ["Taak", "Eén klus voor een agent, zoals \"maak 5 ontwerpen\". Taken staan in een wachtrij en worden opnieuw geprobeerd als ze mislukken."],
  ["Dry run", "Oefenstand: alles werkt, maar er gaat niets naar Etsy of Printful en er wordt niets uitgegeven. Staat aan tot jij zegt dat het live mag."],
  ["Goedkeuring", "Alles wat geld kost boven de limiet, of risico heeft, wacht op jouw ja of nee."],
  ["Gedeeld geheugen", "Wat de agents geleerd hebben: welke niches verkopen, welke fouten opgelost zijn, jouw beslissingen. Elke agent leest het voor hij begint."],
  ["Print-on-demand", "Een product wordt pas gemaakt als iemand het koopt. Geen voorraad, geen risico op overschot."],
  ["Sjabloon (Printful)", "Een ontwerp dat al op een product staat in Printful, klaar om naar je winkel te sturen."],
  ["Listing", "Een productpagina op Etsy: foto's, titel, beschrijving, tags en prijs."],
  ["Mockup", "Een foto van het product met het ontwerp erop, gemaakt door Printful."],
  ["KDP", "Kindle Direct Publishing: Amazons platform om zelf boeken uit te geven. Amazon drukt en verstuurt elk boek."],
  ["Claude-budget", "Het maximum dat de agents per dag aan Claude mogen uitgeven. Daarboven stoppen ze tot middernacht."],
  ["Railway", "De dienst waar het systeem online komt te staan, zodat het 24/7 draait."],
];

const FLOW = [
  ["Een idee", "De agent kiest een niche of thema en leest eerst wat al werkt in het gedeelde geheugen."],
  ["Een product", "Claude ontwerpt het; het systeem controleert het automatisch (randen, kwaliteit)."],
  ["Online", "Jij (nu) of de agent (later) zet het product op Etsy of Amazon."],
  ["Een verkoop", "Een klant koopt. Printful of Amazon maakt en verstuurt het product."],
  ["Geld", "De opbrengst min de kosten komt bij jou; het dashboard telt alles op richting €10.000 per maand."],
  ["Leren", "Wat verkoopt gaat naar het gedeelde geheugen, zodat de volgende ontwerpen beter worden."],
];

export function renderHandbook(d) {
  if (!d?.brain) return;
  const byKind = (kinds) => d.brain.nodes.filter((n) => kinds.includes(n.kind));
  const article = (n) =>
    h(
      "article",
      { class: "hb-item", id: `hb-${n.id.replace(/[^a-z0-9-]/gi, "-")}` },
      h("h3", {}, n.label, h("span", { class: `hb-state tone-${(NODE_STATE[n.status.state] ?? NODE_STATE.off).tone}` }, `${(NODE_STATE[n.status.state] ?? NODE_STATE.off).icon} ${n.status.label}`)),
      h("p", {}, n.explain.what),
      h("ol", {}, n.explain.how.map((x) => h("li", {}, x))),
      n.explain.you && h("p", { class: "you-line" }, h("strong", {}, "Jouw deel: "), n.explain.you),
      h("p", { class: "muted" }, `Waar: ${n.explain.where}`),
    );

  fill(
    "handbook",
    h(
      "div",
      { class: "panel hb-intro" },
      h("h1", { class: "flush" }, "Hoe je bedrijf werkt"),
      h(
        "p",
        {},
        "Je bedrijf is een team van AI-agents. Elke agent runt één bedrijf of houdt het systeem draaiende. Ze delen één geheugen en één takenlijst: het brein. Jij bent de eigenaar: je geeft richting, keurt uitgaven goed en praat met de agents. De CEO Agent houdt je elke ochtend op de hoogte.",
      ),
      h("h2", {}, "Van idee tot geld"),
      h("ol", { class: "flow" }, FLOW.map(([t, x]) => h("li", {}, h("strong", {}, t), h("span", {}, x)))),
    ),
    h("div", { class: "panel" }, h("h2", {}, "Jij en het brein"), byKind(["you", "brain"]).map(article)),
    h("div", { class: "panel" }, h("h2", {}, "De agents"), byKind(["agent"]).map(article)),
    h("div", { class: "panel" }, h("h2", {}, "De bedrijven"), byKind(["business"]).map(article)),
    h("div", { class: "panel" }, h("h2", {}, "De koppelingen"), byKind(["service"]).map(article)),
    h(
      "div",
      { class: "panel" },
      h("h2", {}, "Wat betekent elke status"),
      h("dl", { class: "legend-list" }, Object.entries(NODE_STATE).flatMap(([k, m]) => [h("dt", { class: `tone-${m.tone}` }, h("span", { class: "chip-icon" }, m.icon), m.label), h("dd", {}, STATE_HELP[k])])),
    ),
    h("div", { class: "panel" }, h("h2", {}, "Woordenlijst"), h("dl", { class: "terms" }, TERMS.flatMap(([t, x]) => [h("dt", {}, t), h("dd", {}, x)]))),
  );
}
