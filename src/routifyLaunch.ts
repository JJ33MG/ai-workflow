// Routify's road to launch: every step for the soft and the hard launch, who does it (Jarne or
// Claude), and ideas for later. Steps that Routify can report on tick themselves off from its
// daily numbers; the rest Jarne ticks on the dashboard (kept in the setting below).
import type { RoutifyStats } from "./integrations/routify.js";

/** waiting: Jarne applied and waits for a partner or service to approve. */
export type LaunchStatus = "todo" | "doing" | "waiting" | "done";
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
  /** Where to go (sign-up page, settings). */
  link?: string;
  /** Short how-to, in order. */
  steps?: string[];
  /** Done as soon as Routify's numbers say so. */
  doneWhen?: (s: RoutifySetup) => boolean;
}

export const LAUNCH_KEY = "routify.launch";

const partner = (...ids: string[]) => (s: RoutifySetup) => ids.some((id) => s.setup?.partners?.includes(id));

export const LAUNCH: LaunchItem[] = [
  // Soft launch: real people can use it and pay, with a small group of testers (target mid-December).
  { id: "j-travelpayouts", stage: "soft", owner: "jarne", status: "done", title: "Aanmelden bij Travelpayouts", detail: "Klaar (26 nov). Goedgekeurd: Tiqets, Klook, Localrent, GetRentacar, Airalo en meer. Op Routify staan nu: Tiqets (tickets per stad), Localrent (huurauto) en Airalo (eSIM buiten de EU). Je project wordt nog nagekeken; nieuwe merken komen vanzelf bij Programs.",
    link: "https://app.travelpayouts.com/programs" },
  { id: "j-tp-check", stage: "soft", owner: "jarne", status: "todo", title: "Travelpayouts: kijk of de testkliks binnenkomen", detail: "Open Statistics in Travelpayouts. Claude klikte op 26 nov één keer op Tiqets en Klook; staan die erbij, dan werkt het tellen.",
    link: "https://app.travelpayouts.com/" },
  { id: "j-stay22", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden bij Stay22 (vanavond, 10 min)", detail: "Slaapplekken bij Booking.com, Expedia en meer via één partnerlink.",
    link: "https://www.stay22.com/",
    steps: ["Klik Sign up / Get started, kies 'Creator' of 'Publisher'.", "Vul de website in: https://routify-preview-production.up.railway.app.", "Zoek in het dashboard je 'Allez'-link of affiliate-ID en zet die in Railway (routify-preview, Variables) als STAY22_DEEPLINK; vraag Claude welk formaat met {url}."] },
  { id: "j-booking", stage: "soft", owner: "jarne", status: "waiting", title: "Booking.com (via CJ): wacht op goedkeuring", detail: "CJ-account gemaakt en aanvraag bij Booking.com BENELUX verstuurd (26 nov). Booking keurt met de hand goed: een paar dagen tot twee weken. Bij een nee: opnieuw na de lancering.",
    link: "https://members.cj.com/",
    steps: ["Rond in CJ de onboarding-checklist af (betaalgegevens, W-8BEN, website), anders blokkeert CJ elke aanvraag.", "Wacht op de mail van Booking.com BENELUX (status 'Pending Application').", "Na goedkeuring: Links → 'Evergreen Link for Booking.com BENELUX' → groene + → kopieer de link en stuur hem naar Claude."],
    doneWhen: partner("booking") },
  { id: "j-cj-more", stage: "soft", owner: "jarne", status: "todo", title: "In CJ ook aanvragen: Vrbo, Rentalcars.com, Roadsurfer, Indie Campers, Pitchup", detail: "Die knoppen staan al op Routify maar betalen nog niets. Zoek elk merk in CJ (Advertisers) en klik Apply to program. Na een goedkeuring: stuur Claude een link.",
    link: "https://members.cj.com/" },
  { id: "j-discovercars", stage: "soft", owner: "jarne", status: "done", title: "Aanmelden bij DiscoverCars (autoverhuur)", detail: "Klaar (26 nov): partner-ID routify33 staat in Railway. 'Compare cars' op elke trip gaat nu naar DiscoverCars met jouw ID.",
    link: "https://www.discovercars.com/affiliate",
    doneWhen: partner("discovercars") },
  { id: "j-gyg", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden bij GetYourGuide Partner", detail: "Voor 'Things to do in …' op elke dag. Niet bij jouw Travelpayouts-programma's: meld je rechtstreeks aan.",
    link: "https://partner.getyourguide.com/en-us/signup",
    steps: ["Maak een partneraccount met de Routify-preview als website.", "Zet je partner-ID in Railway als GETYOURGUIDE_AFFILIATE_ID."],
    doneWhen: partner("getyourguide") },
  { id: "j-vrbo", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden bij Expedia Group (Vrbo)", detail: "Vakantiehuizen. Tot 4% commissie.",
    link: "https://creator.expediagroup.com/affiliates",
    steps: ["Meld je aan voor het Travel Creator Program.", "Na goedkeuring: maak een deep link en zet hem in Railway als VRBO_DEEPLINK (met {url})."],
    doneWhen: partner("vrbo") },
  { id: "j-maps", stage: "soft", owner: "jarne", status: "todo", title: "Maps Static API aanzetten (2 min)", detail: "Dan toont elke trip een echte Google-kaart in plaats van de globe.",
    link: "https://console.cloud.google.com/apis/library/static-maps-backend.googleapis.com",
    steps: ["Open de link, kies bovenaan hetzelfde project als je Google Maps-sleutel.", "Klik Enable. Klaar: dit vinkt zichzelf af zodra een kaart lukt."],
    doneWhen: (s) => s.setup?.mapsStatic === "ok" },
  { id: "j-admin", stage: "soft", owner: "jarne", status: "todo", title: "ADMIN_EMAILS zetten (2 min)", detail: "Dan kun jij community-foto's goedkeuren en posten als 'Routify team'.",
    link: "https://railway.com/dashboard",
    steps: ["Railway → project renewed-growth → service routify-preview → Variables.", "Nieuwe variabele ADMIN_EMAILS = het e-mailadres van je Routify-account.", "Log daarna in op Routify met dat account."],
    doneWhen: (s) => s.setup?.adminEmails === true },
  { id: "j-legal", stage: "soft", owner: "jarne", status: "todo", title: "Bedrijfsgegevens voor /privacy en /terms", detail: "Stuur Claude: bedrijfsnaam, adres, contact-e-mail, land, ondernemingsnummer, btw-nummer (als je dat hebt).",
    link: "https://routify-preview-production.up.railway.app/privacy" },
  { id: "j-tax", stage: "soft", owner: "jarne", status: "todo", title: "Bedrijfsvorm en belasting met een boekhouder", detail: "Je bent Belg en woont in Praag: vraag een boekhouder waar je Routify registreert (Tsjechische živnost of Belgische zaak), hoe btw werkt op Plus en Trip pass in de EU (OSS) en hoe affiliate-inkomsten belast worden. Daarna krijg je een ondernemingsnummer voor /terms en Stripe.",
    steps: ["Zoek een boekhouder in Praag die Engels spreekt en met freelancers/online verkoop werkt.", "Vraag: welke vorm (živnost of Belgische eenmanszaak), btw-registratie en OSS, en wat je per maand moet bijhouden.", "Stuur Claude daarna het ondernemingsnummer en adres; dat komt in /privacy, /terms en Stripe."] },
  { id: "j-domain", stage: "soft", owner: "jarne", status: "todo", title: "Domeinnaam kopen", detail: "Bijvoorbeeld routify.eu of routify.app (kijk of hij vrij is). Claude koppelt hem aan Railway.",
    link: "https://www.namecheap.com/" },
  { id: "j-stripe", stage: "soft", owner: "jarne", status: "todo", title: "Stripe-verificatie afronden", detail: "Maak in Stripe twee prijzen voor Plus (€9 per maand en €59 per jaar) en een webhook naar /api/stripe/webhook. Zet STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID en STRIPE_PRICE_ID_YEARLY in Railway.",
    link: "https://dashboard.stripe.com/", doneWhen: (s) => s.setup?.stripe === true },
  { id: "j-seed", stage: "soft", owner: "jarne", status: "todo", title: "Gem-bibliotheek vullen (ongeveer €150)", detail: "Zeg 'start de seed' tegen Claude: zo'n 5.000 Google-zoekopdrachten langs Europa's wegen, eenmalig.", doneWhen: (s) => (s.gems?.seedBudget ?? 0) > 0 },
  { id: "j-testers", stage: "soft", owner: "jarne", status: "todo", title: "10 tot 20 testers zoeken", detail: "Vrienden, campergroepen op Facebook, forums. Hun feedback is de testronde." },
  { id: "j-oldservice", stage: "soft", owner: "jarne", status: "done", title: "Oude roadgem-deployment verwijderen in Railway", detail: "Klaar (26 nov). Routify leende nog zeven instellingen van die service; die staan nu in routify-preview zelf (jij zette de vier sleutels opnieuw). Wie eerder ingelogd was, moet één keer opnieuw inloggen."},

  { id: "c-map", stage: "soft", owner: "claude", status: "done", title: "Echte Google-kaart van de trip", detail: "De dag in donker bovenop de route; de globe als reserve. Wacht alleen op de Maps Static API." },
  { id: "c-tolls", stage: "soft", owner: "claude", status: "done", title: "Goedkoopste route (tolvrij) met besparing", detail: "Plus wisselt met één tik." },
  { id: "c-prices", stage: "soft", owner: "claude", status: "done", title: "Slaapplekken met prijs per nacht op elke dag", detail: "" },
  { id: "c-library", stage: "soft", owner: "claude", status: "done", title: "Gem-bibliotheek en dichtere gems (elke 50 km)", detail: "" },
  { id: "c-partners", stage: "soft", owner: "claude", status: "done", title: "Alle boekingslinks via de server (affiliate-ID, geteld)", detail: "Pitchup, Vrbo, Roadsurfer, Indie Campers, GetYourGuide; sinds 26 nov ook DiscoverCars (routify33), Tiqets per stad, Localrent en Airalo via Travelpayouts. Booking.com volgt na goedkeuring." },
  { id: "c-pricing", stage: "soft", owner: "claude", status: "done", title: "Homepagina met één knop, prijspagina met Free, Trip pass en Plus", detail: "" },
  { id: "c-prod", stage: "soft", owner: "claude", status: "doing", title: "Productie-omgeving", detail: "Eigen domein, aparte live-omgeving naast de preview, dagelijkse back-ups van de database, foutmeldingen naar Telegram." },
  { id: "c-speed", stage: "soft", owner: "claude", status: "done", title: "Sneller plannen", detail: "Klaar (26 nov): de trippagina opent na ~15 s met route, kaart en kosten; de dagen verschijnen één voor één (alles na ~25 s). Mislukt een dag, dan staat er een knop 'Try again'." },
  { id: "c-pay", stage: "soft", owner: "claude", status: "done", title: "Betalen klaar: Plus per maand of jaar, Trip pass", detail: "Werkt zodra jouw Stripe-sleutels in Railway staan. Plus stopt vanzelf na de betaalde periode." },
  { id: "c-legal", stage: "soft", owner: "claude", status: "done", title: "Privacybeleid en voorwaarden", detail: "Op /privacy en /terms. Geen cookiebanner nodig: Routify gebruikt geen tracking-cookies." },
  { id: "c-security", stage: "soft", owner: "claude", status: "done", title: "Geldlekken dicht", detail: "Limieten op alles wat geld kost (3 trips per uur zonder account), Plus niet meer gratis te krijgen, de oude open agents-route weg." },
  { id: "c-cleanup", stage: "soft", owner: "claude", status: "done", title: "Oude RoadGem-pagina's weg", detail: "Templates, agents, oude dag- en hotelpagina's; een eigen titel per pagina en een nieuwe 404." },
  // Extra inkomsten die nu al kunnen (26 nov), deze week te starten.
  { id: "c-gift", stage: "soft", owner: "claude", status: "todo", title: "Routify cadeau geven (kerst)", detail: "Cadeaubon voor Plus (een jaar) en de Trip pass: kopen, een mooie bon als pdf/mail, inwisselen met een code. Klaar voor de soft launch half december." },
  { id: "c-poster", stage: "soft", owner: "claude", status: "todo", title: "Je route als poster", detail: "Een kaart van je eigen route met stops en gems als poster (€29–39), gedrukt en verstuurd via Printify (dezelfde koppeling als de Etsy-agent). Knop op elke trip." },
  { id: "c-routes", stage: "soft", owner: "claude", status: "todo", title: "Kant-en-klare premium routes", detail: "Uitgewerkte routes (Noorse fjorden met de camper, kerstmarkten, Toscane met kinderen) voor €4,99–9,99 of in Plus; dezelfde routes ook als download in de Etsy-winkel." },
  { id: "c-buy-costs", stage: "soft", owner: "claude", status: "todo", title: "Knoppen: vignet kopen en reisverzekering", detail: "In het kostenblok van elke dag een knop 'Koop vignet/tolbadge' naar een officiële verkoper, en één keer per trip een reis- en pechverzekering. Wacht op jouw aanmelding bij die partners." },
  { id: "c-videos", stage: "soft", owner: "claude", status: "doing", title: "Routify-video's (TikTok, Reels, Shorts)", detail: "Elke maandag onderzoek naar wat viraal gaat (Grok op X + web) en ma/wo/vr 3 videoplannen ter goedkeuring; tot half december teasers ('Routify komt eraan'). Volgende stap: de goedgekeurde plannen echt laten maken (professionele montage). Regel: elke post gaat eerst met de video zelf naar jou op Telegram; pas na jouw Goedkeuren gaat hij online." },
  { id: "j-socials-now", stage: "soft", owner: "jarne", status: "todo", title: "Routify-accounts op TikTok, Instagram en YouTube (nu)", detail: "Op naam van Routify met een apart Routify-e-mailadres, los van jou persoonlijk. Nodig voor de eerste teasers." },
  { id: "j-videos", stage: "soft", owner: "jarne", status: "todo", title: "Videoplannen goedkeuren (ma, wo, vr)", detail: "In Telegram of op het dashboard bij Akkoorden: tik Goedkeuren of Afwijzen. Een paar minuten per keer." },
  { id: "j-tolls", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden: vignetten en tol (partnerprogramma)", detail: "Bijvoorbeeld Tolltickets (vignetten en tolbadges voor heel Europa). Stuur Claude daarna je partnerlink; dan komt de koopknop in het kostenblok." },
  { id: "j-insurance", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden: reis- en pechverzekering (partnerprogramma)", detail: "Een reisverzekeraar met een affiliateprogramma (vaak 15–30% commissie). Claude helpt kiezen; stuur daarna je partnerlink." },
  { id: "c-feedback", stage: "soft", owner: "claude", status: "todo", title: "Testronde verwerken", detail: "Alles wat testers tegenkomen oplossen." },

  // Hard launch: everything a traveller expects, with marketing (target end of January / February).
  { id: "c-road", stage: "hard", owner: "claude", status: "todo", title: "Onderweg-modus", detail: "Start trip, je live positie, gems en campings in de buurt, route naar Google Maps of Waze in twee tikken." },
  { id: "c-lang", stage: "hard", owner: "claude", status: "todo", title: "Nederlands en Duits", detail: "De grootste campermarkten van Europa." },
  { id: "c-seo", stage: "hard", owner: "claude", status: "todo", title: "Een pagina per populaire route", detail: "\"Amsterdam naar het Gardameer met de camper\": gratis verkeer uit Google, gevuld uit de gem-bibliotheek." },
  { id: "c-yearly", stage: "hard", owner: "claude", status: "todo", title: "Jaarpas en vroegboek-actie", detail: "Plus per jaar; een actie van januari tot maart tegen het seizoensdal." },
  { id: "c-feedback2", stage: "hard", owner: "claude", status: "todo", title: "Tweede verbeterronde", detail: "Op basis van de eerste echte gebruikers." },
  { id: "c-marketing", stage: "hard", owner: "claude", status: "todo", title: "Routify-video's op volle kracht", detail: "Makers (5.000–50.000 volgers) laten posten, met jouw akkoord per uitgave; meten welke video trips en boekingen oplevert." },
  { id: "j-marketing", stage: "hard", owner: "jarne", status: "todo", title: "Lanceringsplan februari goedkeuren", detail: "Kanalen, budget en planning; Claude schrijft het voorstel." },
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
  { title: "Eventtrips (Tour de France en meer)", detail: "Kant-en-klare trips rond evenementen: met de camper de etappes van de Tour de France volgen, met campings en mooie kijkpunten langs het parcours; daarna andere evenementen (festivals, kerstmarkten, F1, skiwedstrijden)." },
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
