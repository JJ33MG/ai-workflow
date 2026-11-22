// Routify's road to launch: every step for the soft and the hard launch, who does it (Jarne or
// Claude), and ideas for later. Steps that Routify can report on tick themselves off from its
// daily numbers; the rest Jarne ticks on the dashboard (kept in the setting below).
import type { RoutifyStats } from "./integrations/routify.js";

export type LaunchStatus = "todo" | "doing" | "done";
export type LaunchStage = "soft" | "hard";
export type LaunchOwner = "jarne" | "claude";

/** What Routify reports about its own setup (since 22 Nov 2026; older numbers lack it). */
export type RoutifySetup = {
  setup?: { mapsStatic?: string; stripe?: boolean; partners?: string[]; adminEmails?: boolean };
  gems?: { library: number; seedSearches: number; seedBudget: number };
};

export interface LaunchItem {
  id: string;
  stage: LaunchStage;
  owner: LaunchOwner;
  title: string;
  detail: string;
  status: LaunchStatus;
  /** Done as soon as Routify's numbers say so. */
  doneWhen?: (s: RoutifySetup) => boolean;
}

export const LAUNCH_KEY = "routify.launch";

const partner = (...ids: string[]) => (s: RoutifySetup) => ids.some((id) => s.setup?.partners?.includes(id));

export const LAUNCH: LaunchItem[] = [
  // Soft launch: real people can use it and pay, with a small group of testers (target mid-December).
  { id: "j-maps", stage: "soft", owner: "jarne", status: "todo", title: "Maps Static API aanzetten", detail: "Google Cloud → APIs & Services → Library → \"Maps Static API\" → Enable (zelfde project als de sleutel). Dan toont elke trip een echte Google-kaart.", doneWhen: (s) => s.setup?.mapsStatic === "ok" },
  { id: "j-stripe", stage: "soft", owner: "jarne", status: "todo", title: "Stripe-verificatie afronden", detail: "Maak in Stripe twee prijzen voor Plus (€9 per maand en €59 per jaar) en een webhook naar /api/stripe/webhook. Zet STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID en STRIPE_PRICE_ID_YEARLY in Railway. De Trip pass (€4.99) heeft geen prijs nodig.", doneWhen: (s) => s.setup?.stripe === true },
  { id: "j-domain", stage: "soft", owner: "jarne", status: "todo", title: "Domeinnaam kopen", detail: "Bijvoorbeeld routify.eu of routify.app (check of hij vrij is). Claude koppelt hem aan Railway." },
  { id: "j-booking", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden bij Booking.com Affiliate Partner", detail: "Zet je ID als BOOKING_AFFILIATE_ID op routify-preview. Hotels en campings betalen dan commissie.", doneWhen: partner("booking") },
  { id: "j-gyg", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden bij GetYourGuide Partner", detail: "ID als GETYOURGUIDE_AFFILIATE_ID. Voor \"Things to do in …\" op elke dag.", doneWhen: partner("getyourguide") },
  { id: "j-awin", stage: "soft", owner: "jarne", status: "todo", title: "Awin (of CJ) voor Pitchup, Vrbo, Roadsurfer, Indie Campers", detail: "Per partner de deep link met {url} als PITCHUP_DEEPLINK, VRBO_DEEPLINK, ROADSURFER_DEEPLINK of INDIECAMPERS_DEEPLINK.", doneWhen: partner("pitchup", "vrbo", "roadsurfer", "indiecampers") },
  { id: "j-admin", stage: "soft", owner: "jarne", status: "todo", title: "ADMIN_EMAILS zetten op routify-preview", detail: "Jouw e-mailadres, zodat jij community-foto's kunt goedkeuren.", doneWhen: (s) => s.setup?.adminEmails === true },
  { id: "j-seed", stage: "soft", owner: "jarne", status: "todo", title: "Gem-bibliotheek vullen (ongeveer €150)", detail: "Zeg \"start de seed\" tegen Claude: zo'n 5.000 Google-zoekopdrachten langs Europa's wegen, eenmalig.", doneWhen: (s) => (s.gems?.seedBudget ?? 0) > 0 },
  { id: "j-legal", stage: "soft", owner: "jarne", status: "todo", title: "Privacybeleid en voorwaarden nalezen", detail: "Ze staan op /privacy en /terms. Geef Claude je bedrijfsnaam, adres, contact-e-mail en land: die staan er nu als [tussen haakjes]." },
  { id: "j-testers", stage: "soft", owner: "jarne", status: "todo", title: "10 tot 20 testers zoeken", detail: "Vrienden, campergroepen op Facebook, forums. Hun feedback is de testronde." },
  { id: "j-oldservice", stage: "soft", owner: "jarne", status: "todo", title: "Oude roadgem-deployment verwijderen in Railway", detail: "De oude service crasht en slaapt; verwijderen voorkomt verwarring en kosten." },

  { id: "c-map", stage: "soft", owner: "claude", status: "done", title: "Echte Google-kaart van de trip", detail: "De dag in donker bovenop de route; de globe als reserve. Wacht alleen op de Maps Static API." },
  { id: "c-tolls", stage: "soft", owner: "claude", status: "done", title: "Goedkoopste route (tolvrij) met besparing", detail: "Plus wisselt met één tik." },
  { id: "c-prices", stage: "soft", owner: "claude", status: "done", title: "Slaapplekken met prijs per nacht op elke dag", detail: "" },
  { id: "c-library", stage: "soft", owner: "claude", status: "done", title: "Gem-bibliotheek en dichtere gems (elke 50 km)", detail: "" },
  { id: "c-partners", stage: "soft", owner: "claude", status: "done", title: "Alle boekingslinks via de server (affiliate-ID, geteld)", detail: "Pitchup, Vrbo, Roadsurfer, Indie Campers, GetYourGuide erbij." },
  { id: "c-pricing", stage: "soft", owner: "claude", status: "done", title: "Homepagina met één knop, prijspagina met Free, Trip pass en Plus", detail: "" },
  { id: "c-prod", stage: "soft", owner: "claude", status: "doing", title: "Productie-omgeving", detail: "Eigen domein, aparte live-omgeving naast de preview, dagelijkse back-ups van de database, foutmeldingen naar Telegram." },
  { id: "c-speed", stage: "soft", owner: "claude", status: "doing", title: "Sneller plannen", detail: "Van ~50 naar ~34 seconden; Claude schrijft 32 daarvan. Verder sneller vraagt een keuze van jou (sneller model of de dagen één voor één tonen)." },
  { id: "c-pay", stage: "soft", owner: "claude", status: "done", title: "Betalen klaar: Plus per maand of jaar, Trip pass", detail: "Werkt zodra jouw Stripe-sleutels in Railway staan. Plus stopt vanzelf na de betaalde periode." },
  { id: "c-legal", stage: "soft", owner: "claude", status: "done", title: "Privacybeleid en voorwaarden", detail: "Op /privacy en /terms. Geen cookiebanner nodig: Routify gebruikt geen tracking-cookies." },
  { id: "c-security", stage: "soft", owner: "claude", status: "done", title: "Geldlekken dicht", detail: "Limieten op alles wat geld kost (3 trips per uur zonder account), Plus niet meer gratis te krijgen, de oude open agents-route weg." },
  { id: "c-cleanup", stage: "soft", owner: "claude", status: "done", title: "Oude RoadGem-pagina's weg", detail: "Templates, agents, oude dag- en hotelpagina's; een eigen titel per pagina en een nieuwe 404." },
  { id: "c-feedback", stage: "soft", owner: "claude", status: "todo", title: "Testronde verwerken", detail: "Alles wat testers tegenkomen oplossen." },

  // Hard launch: everything a traveller expects, with marketing (target end of January / February).
  { id: "c-road", stage: "hard", owner: "claude", status: "todo", title: "Onderweg-modus", detail: "Start trip, je live positie, gems en campings in de buurt, route naar Google Maps of Waze in twee tikken." },
  { id: "c-lang", stage: "hard", owner: "claude", status: "todo", title: "Nederlands en Duits", detail: "De grootste campermarkten van Europa." },
  { id: "c-seo", stage: "hard", owner: "claude", status: "todo", title: "Een pagina per populaire route", detail: "\"Amsterdam naar het Gardameer met de camper\": gratis verkeer uit Google, gevuld uit de gem-bibliotheek." },
  { id: "c-yearly", stage: "hard", owner: "claude", status: "todo", title: "Jaarpas en vroegboek-actie", detail: "Plus per jaar; een actie van januari tot maart tegen het seizoensdal." },
  { id: "c-feedback2", stage: "hard", owner: "claude", status: "todo", title: "Tweede verbeterronde", detail: "Op basis van de eerste echte gebruikers." },
  { id: "c-marketing", stage: "hard", owner: "claude", status: "todo", title: "Routify in de marketing-agent", detail: "Korte video's en posts van echte gems per route, gepland vanuit de Brain." },
  { id: "j-marketing", stage: "hard", owner: "jarne", status: "todo", title: "Lanceringsplan februari goedkeuren", detail: "Kanalen, budget en planning; Claude schrijft het voorstel." },
  { id: "j-socials", stage: "hard", owner: "jarne", status: "todo", title: "Routify-accounts op Instagram en TikTok", detail: "Op naam van Routify, los van jou persoonlijk." },
  { id: "j-feedback", stage: "hard", owner: "jarne", status: "todo", title: "Na de soft launch: wat vind je goed en slecht", detail: "Jouw lijst stuurt de tweede verbeterronde." },
];

/** Ideas from earlier talks and new ones: not planned yet. */
export const IDEAS: { title: string; detail: string }[] = [
  { title: "Elektrische auto: bereik en laadpalen", detail: "Laadstops op de route op basis van het bereik van je auto; daarna de camper met elektrische aandrijving." },
  { title: "Live verkeer (TomTom)", detail: "Files en wegwerkzaamheden op de dag van vertrek." },
  { title: "Beperkingen voor campers", detail: "Hoogte, gewicht en breedte: tunnels, smalle bergwegen en ZTL-zones vermijden." },
  { title: "Samen plannen", detail: "De trip delen met reisgenoten en samen stemmen over gems en slaapplekken." },
  { title: "Offline onderweg", detail: "De hele trip op de telefoon bewaren voor plekken zonder bereik." },
  { title: "Reisverslag na afloop", detail: "Een fotoboek of kaart van de echte route met je foto's van de gems (te koop)." },
  { title: "Prijsalarm voor campings", detail: "Een melding als een camping op je route goedkoper wordt of plek vrijkomt." },
  { title: "Nieuwsbrief: route van de week", detail: "Een mooie route met gems en kosten, met links die commissie opleveren." },
  { title: "Samenwerking met camperverhuurders", detail: "Routify als routeplanner bij een verhuurder (white label), met een vaste vergoeding." },
  { title: "Weer onderweg", detail: "Het weer per dag op de plek waar je die dag rijdt, met een seintje bij slecht weer." },
  { title: "App in de stores", detail: "Later een iOS- en Android-app; tot dan werkt Routify als app vanaf het beginscherm." },
];

export function launchView(stats: (RoutifyStats & RoutifySetup) | RoutifySetup | null, ticks: Record<string, LaunchStatus>) {
  const items = LAUNCH.map(({ doneWhen, ...item }) => {
    const auto = Boolean(doneWhen && stats && doneWhen(stats));
    return { ...item, auto, status: auto ? ("done" as const) : (ticks[item.id] ?? item.status) };
  });
  const progress = (stage: LaunchStage) => {
    const list = items.filter((i) => i.stage === stage);
    return {
      done: list.filter((i) => i.status === "done").length,
      total: list.length,
      jarneOpen: list.filter((i) => i.owner === "jarne" && i.status !== "done").length,
      claudeOpen: list.filter((i) => i.owner === "claude" && i.status !== "done").length,
    };
  };
  return { items, ideas: IDEAS, progress: { soft: progress("soft"), hard: progress("hard") } };
}
