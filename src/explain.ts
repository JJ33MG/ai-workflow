// The "brain map": every part of the company, how they connect, and a plain-language
// explanation of each, plus the build plan. Shown on the dashboard's Brain, Plan and
// Handbook sections. Written for Jarne, in Dutch. Keep it honest and current.

export type NodeKind = "you" | "brain" | "agent" | "business" | "service";

export interface Explanation {
  /** Wat is het, in één of twee zinnen. */
  what: string;
  /** Hoe werkt het: korte stappen. */
  how: string[];
  /** Waar zie je het op het dashboard. */
  where: string;
  /** Wat moet Jarne doen (leeg = niets). */
  you?: string;
}

export interface BrainNode {
  id: string;
  kind: NodeKind;
  label: string;
  explain: Explanation;
}

export const NODES: BrainNode[] = [
  {
    id: "you",
    kind: "you",
    label: "Jij (Jarne)",
    explain: {
      what: "De eigenaar. Jij beslist over alles wat geld kost of risico heeft, en je geeft de richting aan.",
      how: [
        "Agents vragen jouw akkoord voor uitgaven boven de limiet, nieuwe platforms en alles wat een account kan laten blokkeren.",
        "Je keurt goed of af op het dashboard (Overzicht → Beslissingen) of via Telegram.",
        "Je kunt met elke agent praten in Chat en ze opdrachten geven.",
        "Elke ochtend om 07:00 krijg je de briefing van de CEO Agent.",
      ],
      where: "Overzicht → Beslissingen, en Chat.",
    },
  },
  {
    id: "brain",
    kind: "brain",
    label: "Het brein",
    explain: {
      what: "Het hart van het systeem: één gedeeld geheugen en één takenlijst voor alle agents.",
      how: [
        "Alles wat een agent doet, verkoopt of uitgeeft wordt opgeslagen in de database. Daardoor klopt de briefing en dit dashboard.",
        "Werk loopt als taken in een wachtrij. Elke 15 seconden pakt het systeem de volgende taak op.",
        "Mislukt een taak, dan probeert de Debug Agent het opnieuw: na 2, 4, 8 minuten. Lukt het 3 keer niet, dan krijg jij een melding met de oorzaak.",
        "Het gedeelde geheugen bewaart wat werkt: welke niches verkopen, welke fouten opgelost zijn, jouw beslissingen. Elke agent leest dit voor hij begint.",
        "Een harde dagelijkse limiet op Claude-kosten voorkomt dat er ongemerkt te veel wordt uitgegeven.",
      ],
      where: "Geheugen (wat er geleerd is), Activiteit (alles wat er gebeurt), Problemen (wat mislukt).",
    },
  },
  {
    id: "agent:ceo",
    kind: "agent",
    label: "CEO Agent",
    explain: {
      what: "De leidinggevende: kijkt naar het hele bedrijf en houdt jou op de hoogte.",
      how: [
        "Elke dag om 07:00 (Praagse tijd) verzamelt hij omzet, kosten, wat elke agent deed, wat er misging en welke beslissingen wachten.",
        "Hij schrijft daar een korte briefing van met 2 tot 4 punten om vandaag op te focussen, en stuurt die via Telegram.",
        "In Chat ziet hij het hele bedrijf en kan hij taken van andere agents starten.",
      ],
      where: "Agents → CEO Agent, en Chat → CEO Agent.",
      you: "Telegram instellen, anders komt de briefing alleen in het serverlog terecht.",
    },
  },
  {
    id: "agent:debug",
    kind: "agent",
    label: "Debug Agent",
    explain: {
      what: "De technische bewaker: houdt alles draaiende.",
      how: [
        "Elke 30 minuten controleert hij alle taken.",
        "Mislukte taken probeert hij opnieuw; vastgelopen taken (bijvoorbeeld na een herstart) zet hij terug.",
        "Wat 3 keer mislukt, meldt hij aan jou, met de waarschijnlijke oorzaak en de oplossing.",
        "Hij waarschuwt als de dagelijkse Claude-limiet bijna bereikt is.",
      ],
      where: "Problemen, en Agents → Debug Agent.",
    },
  },
  {
    id: "agent:etsy-pod",
    kind: "agent",
    label: "Etsy-agent",
    explain: {
      what: "Runt de Etsy-winkel: bedenkt mokken, ontwerpt ze en maakt de teksten.",
      how: [
        "Hij kiest cadeau-niches (beroepen, hobby's) en leest eerst in het gedeelde brein wat al verkoopt.",
        "Per idee tekent Claude één kant van de mok; het systeem controleert dat niets van de rand valt, centreert het ontwerp en zet het op beide kanten.",
        "Hij schrijft de titel, beschrijving en 13 tags volgens de regels van Etsy.",
        "Nu (dry run): ontwerpen worden klaargezet als pakket dat jij in Printful uploadt.",
        "Later (online + Etsy-koppeling): hij zet listings zelf op Etsy, vraagt jouw akkoord voor de listingkosten, haalt verkopen op en maakt de Printful-bestelling.",
      ],
      where: "Bedrijven → Etsy-winkel (producten, verkopen) en Chat → Etsy-agent.",
      you: "Vraag nieuwe ontwerpen in Chat, bijvoorbeeld: \"Maak 5 mokken voor verpleegkundigen\".",
    },
  },
  {
    id: "agent:kdp-coloring",
    kind: "agent",
    label: "Kleurboek-agent",
    explain: {
      what: "Maakt kinderkleurboeken voor Amazon KDP.",
      how: [
        "Hij kiest een thema dat ouders zoeken (bijvoorbeeld dinosaurussen voor peuters) en bedenkt titel, beschrijving en 7 zoekwoorden.",
        "Hij tekent 30 kleurplaten met dikke lijnen. Claude bekijkt elke pagina en keurt hem af bij fouten; een afgekeurde pagina wordt opnieuw getekend.",
        "Hij maakt het binnenwerk (8,5 × 11 inch, elke tekening met een lege achterkant) en de omslag met de juiste rugbreedte.",
        "Hij zet alles in een uploadpakket met alle velden voor het KDP-formulier. Uploaden doe jij: Amazon heeft daar geen koppeling voor.",
      ],
      where: "Bedrijven → Kleurboeken, en Chat → Kleurboek-agent.",
      you: "Zeg wanneer hij een boek mag maken (kost ongeveer €2–3 aan Claude per boek).",
    },
  },
  {
    id: "biz:etsy-pod",
    kind: "business",
    label: "Etsy-winkel",
    explain: {
      what: "Print-on-demand mokken op Etsy. Jij koopt geen voorraad: een mok wordt pas gemaakt als iemand hem koopt.",
      how: [
        "Een klant koopt een mok op Etsy (€19,99 + verzending).",
        "Printful krijgt de bestelling automatisch, print de mok en verstuurt hem.",
        "Printful rekent de kostprijs af van jouw kaart; de verkoopprijs komt via Etsy bij jou.",
        "Na kosten blijft er ongeveer €8 per mok over (schatting).",
      ],
      where: "Bedrijven → Etsy-winkel.",
    },
  },
  {
    id: "biz:kdp-coloring",
    kind: "business",
    label: "Kleurboeken",
    explain: {
      what: "Kinderkleurboeken als paperback op Amazon, gedrukt wanneer iemand bestelt.",
      how: [
        "De kleurboek-agent maakt het boek; jij uploadt het in KDP (maximaal een paar nieuwe boeken per dag).",
        "Amazon drukt en verstuurt elk boek zelf.",
        "Jij krijgt 60% van de prijs min de drukkosten: ongeveer $3 per boek bij $7,99 (schatting, check de KDP-calculator).",
      ],
      where: "Bedrijven → Kleurboeken.",
    },
  },
  {
    id: "biz:dropshipping",
    kind: "business",
    label: "Dropshipping",
    explain: {
      what: "Webwinkels met trending producten die de leverancier zelf verstuurt. Gepland voor fase 3.",
      how: [
        "Een agent zoekt producten, bouwt de winkel en schrijft advertenties.",
        "Bezoekers komen vooral via betaalde advertenties: daar is budget voor nodig, met een harde limiet.",
      ],
      where: "Bedrijven → Dropshipping.",
    },
  },
  {
    id: "biz:cartoon-content",
    kind: "business",
    label: "AI-cartoonkanaal",
    explain: {
      what: "AI-cartoonvideo's voor YouTube, TikTok en Instagram. Gepland voor fase 4.",
      how: ["Inkomsten uit advertenties en affiliate-links; stuurt ook bezoekers naar de winkels."],
      where: "Bedrijven → AI-cartoonkanaal.",
    },
  },
  {
    id: "biz:roadgem",
    kind: "business",
    label: "RoadGem",
    explain: {
      what: "Je roadtrip-app. Bewust geparkeerd: eerst geld verdienen met de simpelere bedrijven.",
      how: ["Komt terug zodra de andere bedrijven geld opleveren."],
      where: "Bedrijven → RoadGem.",
    },
  },
  {
    id: "svc:claude",
    kind: "service",
    label: "Claude (AI)",
    explain: {
      what: "Het denkvermogen van alle agents: ideeën, ontwerpen, teksten, controles en chat.",
      how: [
        "Elke aanvraag wordt geteld en de kosten worden opgeslagen.",
        "Boven de dagelijkse limiet stoppen de agents met Claude tot middernacht.",
      ],
      where: "Overzicht → Claude-budget vandaag en Overzicht → Systemen.",
    },
  },
  {
    id: "svc:etsy",
    kind: "service",
    label: "Etsy",
    explain: {
      what: "De marktplaats waar de mokken verkocht worden.",
      how: [
        "Nu: jouw winkel wordt handmatig gevuld via Printful.",
        "Automatisch (later): het systeem zet listings op Etsy en haalt verkopen op. Daarvoor moet Etsy een developer-app goedkeuren en moet je de winkel één keer koppelen.",
      ],
      where: "Overzicht → Systemen → Etsy, en Bouwplan.",
      you: "Etsy-winkel openen (loopt), later de developer-app aanvragen.",
    },
  },
  {
    id: "svc:printful",
    kind: "service",
    label: "Printful",
    explain: {
      what: "Print en verstuurt de mokken. Gekoppeld aan je Etsy-winkel, zodat bestellingen automatisch doorkomen.",
      how: [
        "Nu: jij hebt de ontwerpen als sjablonen in Printful gezet.",
        "Automatisch (later, met een Printful-sleutel op de server): het systeem maakt mockups en bestellingen.",
      ],
      where: "Overzicht → Systemen → Printful, en Bouwplan.",
      you: "Printful aan Etsy koppelen zodra de winkel open is.",
    },
  },
  {
    id: "svc:kdp",
    kind: "service",
    label: "Amazon KDP",
    explain: {
      what: "Amazons zelfpublicatie-platform voor de kleurboeken.",
      how: [
        "Er is geen koppeling om automatisch te publiceren: jij uploadt elk boek in het KDP-formulier.",
        "De agent levert alle bestanden en alle velden in de juiste volgorde.",
      ],
      where: "Bedrijven → Kleurboeken, en Bouwplan.",
      you: "Een KDP-account aanmaken (kdp.amazon.com).",
    },
  },
  {
    id: "svc:telegram",
    kind: "service",
    label: "Telegram",
    explain: {
      what: "Je berichtenkanaal met het bedrijf: ochtendbriefing, meldingen en goedkeuren met /approve.",
      how: ["Alleen berichten uit jouw chat worden geaccepteerd, zodat niemand anders iets kan goedkeuren."],
      where: "Overzicht → Systemen → Telegram.",
      you: "Een bot maken via @BotFather en de twee codes instellen.",
    },
  },
  {
    id: "svc:database",
    kind: "service",
    label: "Database",
    explain: {
      what: "Waar alles bewaard wordt: taken, logboek, verkopen, kosten, producten, chats en het gedeelde brein.",
      how: ["PostgreSQL. Online komt die bij Railway te staan."],
      where: "Overzicht → Systemen → Database.",
    },
  },
  {
    id: "svc:server",
    kind: "service",
    label: "Server (online)",
    explain: {
      what: "De computer waarop het systeem 24/7 draait, zodat agents ook werken als jij slaapt en dit dashboard altijd bereikbaar is.",
      how: [
        "Zolang het systeem niet online staat, werkt alles alleen tijdens onze sessies.",
        "Plan: Railway (ongeveer €5–20 per maand), met de database erbij.",
      ],
      where: "Het brein → Server (online), en Bouwplan.",
      you: "Railway-account aanmaken en de stappen volgen (ik help).",
    },
  },
];

/** Who is connected to whom on the map. Dashed when one end hasn't started yet. */
export const EDGES: [string, string][] = [
  ["you", "brain"],
  ["you", "svc:telegram"],
  ["brain", "agent:ceo"],
  ["brain", "agent:debug"],
  ["brain", "agent:etsy-pod"],
  ["brain", "agent:kdp-coloring"],
  ["brain", "svc:claude"],
  ["brain", "svc:database"],
  ["brain", "svc:server"],
  ["agent:ceo", "svc:telegram"],
  ["agent:etsy-pod", "biz:etsy-pod"],
  ["agent:kdp-coloring", "biz:kdp-coloring"],
  ["biz:etsy-pod", "svc:etsy"],
  ["biz:etsy-pod", "svc:printful"],
  ["biz:kdp-coloring", "svc:kdp"],
  ["brain", "biz:dropshipping"],
  ["brain", "biz:cartoon-content"],
  ["brain", "biz:roadgem"],
];

export type PlanStatus = "done" | "doing" | "todo" | "parked";

export interface PlanItem {
  id: string;
  phase: string;
  title: string;
  detail: string;
  owner: "jarne" | "systeem";
  /** Starting status; Jarne's own steps can be ticked off on the dashboard. */
  status: PlanStatus;
  /** Map node this step unlocks (its status shows "done" steps). */
  node?: string;
}

export const PLAN: PlanItem[] = [
  // Gebouwd
  { id: "core", phase: "Fundament", title: "Server, database, takenwachtrij en logboek", detail: "Alles wat agents doen wordt opgeslagen; mislukte taken worden opnieuw geprobeerd.", owner: "systeem", status: "done" },
  { id: "budget", phase: "Fundament", title: "Kostenbewaking en dagelijkse Claude-limiet", detail: "Elke Claude-aanvraag wordt geteld; boven de limiet stoppen de agents.", owner: "systeem", status: "done" },
  { id: "approvals", phase: "Fundament", title: "Goedkeuringen voor geld en risico", detail: "Uitgaven boven de limiet wachten op jouw akkoord (dashboard of Telegram).", owner: "systeem", status: "done" },
  { id: "debug", phase: "Fundament", title: "Debug Agent", detail: "Controleert elke 30 minuten, probeert opnieuw, meldt wat blijft mislukken met de oplossing.", owner: "systeem", status: "done" },
  { id: "ceo", phase: "Fundament", title: "CEO Agent met ochtendbriefing", detail: "Elke dag 07:00: cijfers, problemen, beslissingen en focus voor vandaag.", owner: "systeem", status: "done" },
  { id: "dashboard", phase: "Fundament", title: "Dashboard: brein, bedrijven, agents, chat, problemen", detail: "Alles op één plek, met uitleg en oplossingen per fout.", owner: "systeem", status: "done" },
  { id: "chat", phase: "Fundament", title: "Chat met elke agent", detail: "Agents antwoorden uit hun eigen gegevens en kunnen hun taken starten (nooit iets dat geld kost).", owner: "systeem", status: "done" },
  { id: "etsy-agent", phase: "Etsy-winkel", title: "Etsy-agent: ontwerpen, teksten, kwaliteitscontrole", detail: "20 mokken gemaakt. Controleert randen, centreert en zet het ontwerp op beide kanten.", owner: "systeem", status: "done" },
  { id: "kdp-agent", phase: "Kleurboeken", title: "Kleurboek-agent", detail: "Gebouwd en getest op de printmaten; nog geen echt boek gemaakt.", owner: "systeem", status: "done" },

  // Jouw stappen
  { id: "printful-account", phase: "Etsy-winkel", title: "Printful-account met betaalkaart", detail: "Printful rekent per bestelling de kostprijs af.", owner: "jarne", status: "done", node: "svc:printful" },
  { id: "printful-batch1", phase: "Etsy-winkel", title: "Eerste 10 mokken als sjabloon in Printful", detail: "Bijenhouders tot elektriciens.", owner: "jarne", status: "done" },
  { id: "printful-batch2", phase: "Etsy-winkel", title: "Tweede 10 mokken als sjabloon in Printful", detail: "Leraren tot koks.", owner: "jarne", status: "todo" },
  { id: "etsy-shop", phase: "Etsy-winkel", title: "Etsy-winkel geopend en goedgekeurd", detail: "Etsy controleert je identiteit; dat loopt.", owner: "jarne", status: "doing", node: "svc:etsy" },
  { id: "printful-etsy", phase: "Etsy-winkel", title: "Printful gekoppeld aan Etsy", detail: "Printful → Stores → Connect → Etsy.", owner: "jarne", status: "todo" },
  { id: "etsy-live", phase: "Etsy-winkel", title: "Mokken live op Etsy", detail: "Sjablonen naar je winkel zetten met de teksten uit listings.md.", owner: "jarne", status: "todo", node: "biz:etsy-pod" },
  { id: "sample", phase: "Etsy-winkel", title: "Proefmok bestellen (aanrader)", detail: "Echte printkwaliteit zien en eigen foto's maken.", owner: "jarne", status: "todo" },
  { id: "telegram", phase: "Fundament", title: "Telegram-bot aanmaken", detail: "Voor de ochtendbriefing en meldingen op je telefoon.", owner: "jarne", status: "todo", node: "svc:telegram" },
  { id: "online", phase: "Fundament", title: "Systeem online zetten (Railway)", detail: "Agents werken 24/7 en het dashboard is altijd bereikbaar, ook op je telefoon.", owner: "jarne", status: "todo", node: "svc:server" },
  { id: "kdp-account", phase: "Kleurboeken", title: "Amazon KDP-account", detail: "kdp.amazon.com, met belasting- en bankgegevens.", owner: "jarne", status: "todo", node: "svc:kdp" },
  { id: "first-book", phase: "Kleurboeken", title: "Eerste kleurboek maken, nakijken en uploaden", detail: "Op jouw sein; ongeveer €2–3 aan Claude.", owner: "jarne", status: "todo", node: "biz:kdp-coloring" },
  { id: "etsy-dev", phase: "Etsy-winkel", title: "Etsy developer-app aanvragen", detail: "Nodig om automatisch te uploaden en verkopen op te halen; goedkeuring duurt vaak enkele dagen.", owner: "jarne", status: "todo" },

  // Nog te bouwen
  { id: "etsy-auto", phase: "Etsy-winkel", title: "Etsy automatisch: listings en verkopen", detail: "De code is er al; werkt zodra het systeem online staat en Etsy gekoppeld is.", owner: "systeem", status: "todo" },
  { id: "more-products", phase: "Etsy-winkel", title: "Meer producten per ontwerp (t-shirt, poster, tas)", detail: "Eén ontwerp wordt 3–4 producten, zonder extra ontwerpwerk.", owner: "systeem", status: "todo" },
  { id: "kdp-sales", phase: "Kleurboeken", title: "KDP-verkopen in het dashboard", detail: "Amazon heeft geen koppeling: importeren uit het KDP-rapport.", owner: "systeem", status: "todo" },
  { id: "telegram-chat", phase: "Fundament", title: "Chatten met agents via Telegram", detail: "Zelfde chat als op het dashboard, vanaf je telefoon.", owner: "systeem", status: "todo" },
  { id: "scout", phase: "Groei", title: "Opportunity Scout Agent", detail: "Zoekt dagelijks nieuwe trends, platforms en manieren om geld te verdienen.", owner: "systeem", status: "todo" },
  { id: "routing", phase: "Groei", title: "Problemen doorgeven tussen agents", detail: "De CEO wijst een probleem toe aan de agent die het best kan oplossen.", owner: "systeem", status: "todo" },
  { id: "dropshipping", phase: "Dropshipping", title: "Dropshipping-agent en eerste winkel", detail: "Fase 3; vraagt advertentiebudget met harde limiet.", owner: "systeem", status: "todo" },
  { id: "cartoon", phase: "AI-cartoonkanaal", title: "AI-cartoonkanaal", detail: "Fase 4.", owner: "systeem", status: "todo" },
  { id: "roadgem", phase: "RoadGem", title: "RoadGem-agent", detail: "Geparkeerd tot de andere bedrijven geld opleveren.", owner: "systeem", status: "parked" },
];
