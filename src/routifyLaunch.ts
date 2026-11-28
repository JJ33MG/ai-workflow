// RoamGem's road to launch: every step for the soft and the hard launch, who does it (Jarne or
// Claude), and ideas for later. Steps that RoamGem can report on tick themselves off from its
// daily numbers; the rest Jarne ticks on the dashboard (kept in the setting below).
import type { RoutifyStats } from "./integrations/routify.js";

/** waiting: Jarne applied and waits for a partner or service to approve. */
export type LaunchStatus = "todo" | "doing" | "waiting" | "done";
export type LaunchStage = "soft" | "hard";
export type LaunchOwner = "jarne" | "claude";

/** What RoamGem reports about its own setup (since 22 Nov 2026; older numbers lack it). */
export type RoamGemSetup = {
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
  /** Done as soon as RoamGem's numbers say so. */
  doneWhen?: (s: RoamGemSetup) => boolean;
}

export const LAUNCH_KEY = "routify.launch";

const partner = (...ids: string[]) => (s: RoamGemSetup) => ids.some((id) => s.setup?.partners?.includes(id));

export const LAUNCH: LaunchItem[] = [
  // Soft launch: real people can use it and pay, with a small group of testers (target mid-December).
  { id: "j-travelpayouts", stage: "soft", owner: "jarne", status: "done", title: "Aanmelden bij Travelpayouts", detail: "Klaar (26 nov). Goedgekeurd: Tiqets, Klook, Localrent, GetRentacar, Airalo en meer. Op RoamGem staan nu: Tiqets (tickets per stad), Localrent (huurauto) en Airalo (eSIM buiten de EU). Je project wordt nog nagekeken; nieuwe merken komen vanzelf bij Programs.",
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
  { id: "j-cj-more", stage: "soft", owner: "jarne", status: "todo", title: "In CJ ook aanvragen: Vrbo, Rentalcars.com, Roadsurfer, Indie Campers, Pitchup", detail: "Die knoppen staan al op RoamGem maar betalen nog niets. Zoek elk merk in CJ (Advertisers) en klik Apply to program. Na een goedkeuring: stuur Claude een link.",
    link: "https://members.cj.com/" },
  { id: "j-discovercars", stage: "soft", owner: "jarne", status: "done", title: "Aanmelden bij DiscoverCars (autoverhuur)", detail: "Klaar (26 nov): partner-ID routify33 staat in Railway. 'Compare cars' op elke trip gaat nu naar DiscoverCars met jouw ID.",
    link: "https://www.discovercars.com/affiliate",
    doneWhen: partner("discovercars") },
  { id: "j-gyg", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden bij GetYourGuide Partner", detail: "Voor 'Things to do in …' op elke dag. Niet bij jouw Travelpayouts-programma's: meld je rechtstreeks aan.",
    link: "https://partner.getyourguide.com/en-us/signup",
    steps: ["Maak een partneraccount met de RoamGem-preview als website.", "Zet je partner-ID in Railway als GETYOURGUIDE_AFFILIATE_ID."],
    doneWhen: partner("getyourguide") },
  { id: "j-vrbo", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden bij Expedia Group (Vrbo)", detail: "Vakantiehuizen. Tot 4% commissie.",
    link: "https://creator.expediagroup.com/affiliates",
    steps: ["Meld je aan voor het Travel Creator Program.", "Na goedkeuring: maak een deep link en zet hem in Railway als VRBO_DEEPLINK (met {url})."],
    doneWhen: partner("vrbo") },
  { id: "j-maps", stage: "soft", owner: "jarne", status: "done", title: "Google-sleutel met de nieuwe diensten", detail: "Klaar (27 nov): sleutel uit My First Project (met facturering) met Places API (New), Routes API en Maps Static API. De oude sleutel in My Maps Project mag weg." },
  { id: "j-admin", stage: "soft", owner: "jarne", status: "todo", title: "ADMIN_EMAILS zetten (2 min)", detail: "Dan kun jij community-foto's goedkeuren en posten als 'RoamGem team'. Zet het op de live service roamgem.", link: "https://railway.com/project/b1ed4444-48a6-4e40-ad44-f4142df4f6b2/service/180b3298-1101-43ef-82a7-75e605097d50/variables", steps: ["Open de link (service roamgem → Variables) → + New Variable.", "Naam ADMIN_EMAILS, waarde het e-mailadres van je RoamGem-account.", "Deploy, en log daarna in op roamgem.com met dat account."], doneWhen: (s) => s.setup?.adminEmails === true },
  { id: "j-legal", stage: "soft", owner: "jarne", status: "todo", title: "Bedrijfsgegevens voor /privacy en /terms", detail: "Stuur Claude: bedrijfsnaam, adres, contact-e-mail, land, ondernemingsnummer, btw-nummer (als je dat hebt).",
    link: "https://routify-preview-production.up.railway.app/privacy" },
  { id: "j-tax", stage: "soft", owner: "jarne", status: "todo", title: "Bedrijfsvorm en belasting met een boekhouder", detail: "Je bent Belg en woont in Praag: vraag een boekhouder waar je RoamGem registreert (Tsjechische živnost of Belgische zaak), hoe btw werkt op Plus en Trip pass in de EU (OSS) en hoe affiliate-inkomsten belast worden. Daarna krijg je een ondernemingsnummer voor /terms en Stripe.",
    steps: ["Zoek een boekhouder in Praag die Engels spreekt en met freelancers/online verkoop werkt.", "Vraag: welke vorm (živnost of Belgische eenmanszaak), btw-registratie en OSS, en wat je per maand moet bijhouden.", "Stuur Claude daarna het ondernemingsnummer en adres; dat komt in /privacy, /terms en Stripe."] },
  { id: "j-domain", stage: "soft", owner: "jarne", status: "done", title: "Domeinnaam kopen", detail: "Klaar (27 nov): roamgem.com bij Cloudflare, auto-verlengen aan. \"RoamGem\" werd al gebruikt door andere routeplanners; de app heet nu RoamGem." },
  { id: "j-stripe", stage: "soft", owner: "jarne", status: "done", title: "Stripe live", detail: "Klaar (27 nov): Stripe geverifieerd met Managed Payments (Stripe regelt de btw), live sleutels en webhook op roamgem.com. RoamGem Plus (€9/maand, €59/jaar) maakt de app zelf aan; Trip pass €4,99.", link: "https://dashboard.stripe.com/" },
  { id: "j-seed", stage: "soft", owner: "jarne", status: "todo", title: "Gem-bibliotheek vullen (ongeveer €150)", detail: "Zeg 'start de seed' tegen Claude: zo'n 5.000 Google-zoekopdrachten langs Europa's wegen, eenmalig.", doneWhen: (s) => (s.gems?.seedBudget ?? 0) > 0 },
  { id: "j-testers", stage: "soft", owner: "jarne", status: "todo", title: "10 tot 20 testers zoeken", detail: "Vrienden, campergroepen op Facebook, forums. Hun feedback is de testronde." },
  { id: "j-oldservice", stage: "soft", owner: "jarne", status: "done", title: "Oude roadgem-deployment verwijderen in Railway", detail: "Klaar (26 nov). RoamGem leende nog zeven instellingen van die service; die staan nu in routify-preview zelf (jij zette de vier sleutels opnieuw). Wie eerder ingelogd was, moet één keer opnieuw inloggen."},

  { id: "c-map", stage: "soft", owner: "claude", status: "done", title: "Echte Google-kaart van de trip", detail: "De dag in donker bovenop de route; de globe als reserve. Wacht alleen op de Maps Static API." },
  { id: "c-tolls", stage: "soft", owner: "claude", status: "done", title: "Goedkoopste route (tolvrij) met besparing", detail: "Plus wisselt met één tik." },
  { id: "c-prices", stage: "soft", owner: "claude", status: "done", title: "Slaapplekken met prijs per nacht op elke dag", detail: "" },
  { id: "c-library", stage: "soft", owner: "claude", status: "done", title: "Gem-bibliotheek en dichtere gems (elke 50 km)", detail: "" },
  { id: "c-partners", stage: "soft", owner: "claude", status: "done", title: "Alle boekingslinks via de server (affiliate-ID, geteld)", detail: "Pitchup, Vrbo, Roadsurfer, Indie Campers, GetYourGuide; sinds 26 nov ook DiscoverCars (routify33), Tiqets per stad, Localrent en Airalo via Travelpayouts. Booking.com volgt na goedkeuring." },
  { id: "c-pricing", stage: "soft", owner: "claude", status: "done", title: "Homepagina met één knop, prijspagina met Free, Trip pass en Plus", detail: "" },
  { id: "c-prod", stage: "soft", owner: "claude", status: "done", title: "Live site roamgem.com", detail: "Klaar (27 nov): eigen service en database (Amsterdam), dagelijkse back-ups, https, live Stripe. De preview blijft voor testen (iedereen Plus, geen betalingen)." },
  { id: "c-speed", stage: "soft", owner: "claude", status: "done", title: "Sneller plannen", detail: "Klaar (26 nov): de trippagina opent na ~15 s met route, kaart en kosten; de dagen verschijnen één voor één (alles na ~25 s). Mislukt een dag, dan staat er een knop 'Try again'." },
  { id: "c-pay", stage: "soft", owner: "claude", status: "done", title: "Betalen klaar: Plus per maand of jaar, Trip pass", detail: "Werkt zodra jouw Stripe-sleutels in Railway staan. Plus stopt vanzelf na de betaalde periode." },
  { id: "c-legal", stage: "soft", owner: "claude", status: "done", title: "Privacybeleid en voorwaarden", detail: "Op /privacy en /terms. Geen cookiebanner nodig: RoamGem gebruikt geen tracking-cookies." },
  { id: "c-security", stage: "soft", owner: "claude", status: "done", title: "Geldlekken dicht", detail: "Limieten op alles wat geld kost (3 trips per uur zonder account), Plus niet meer gratis te krijgen, de oude open agents-route weg." },
  { id: "c-cleanup", stage: "soft", owner: "claude", status: "done", title: "Oude RoadGem-pagina's weg", detail: "Templates, agents, oude dag- en hotelpagina's; een eigen titel per pagina en een nieuwe 404." },
  // Extra inkomsten die nu al kunnen (26 nov), deze week te starten.
  { id: "c-gift", stage: "soft", owner: "claude", status: "todo", title: "RoamGem cadeau geven (kerst)", detail: "Cadeaubon voor Plus (een jaar) en de Trip pass: kopen, een mooie bon als pdf/mail, inwisselen met een code. Klaar voor de soft launch half december." },
  { id: "c-poster", stage: "soft", owner: "claude", status: "todo", title: "Je route als poster", detail: "Een kaart van je eigen route met stops en gems als poster (€29–39), gedrukt en verstuurd via Printify (dezelfde koppeling als de Etsy-agent). Knop op elke trip." },
  { id: "c-routes", stage: "soft", owner: "claude", status: "todo", title: "Kant-en-klare premium routes", detail: "Uitgewerkte routes (Noorse fjorden met de camper, kerstmarkten, Toscane met kinderen) voor €4,99–9,99 of in Plus; dezelfde routes ook als download in de Etsy-winkel." },
  { id: "c-buy-costs", stage: "soft", owner: "claude", status: "todo", title: "Knoppen: vignet kopen en reisverzekering", detail: "In het kostenblok van elke dag een knop 'Koop vignet/tolbadge' naar een officiële verkoper, en één keer per trip een reis- en pechverzekering. Wacht op jouw aanmelding bij die partners." },
  { id: "c-videos", stage: "soft", owner: "claude", status: "doing", title: "RoamGem-video's (TikTok, Reels, Shorts)", detail: "Video 1 t/m 4 gemaakt (27 nov; 2, 3 en 4 klaar om te posten). Elke maandag onderzoek naar wat viraal gaat (Grok op X + web) en ma/wo/vr 3 videoplannen ter goedkeuring; tot half december teasers ('RoamGem komt eraan'). Volgende stap: de goedgekeurde plannen echt laten maken (professionele montage). Regel: elke post gaat eerst met de video zelf naar jou op Telegram; pas na jouw Goedkeuren gaat hij online." },
  { id: "j-email", stage: "soft", owner: "jarne", status: "todo", title: "Stap 0: e-mailadres hello@roamgem.com (10 min, gratis)", detail: "Zodat je privé-Gmail niet aan de accounts hangt. Gebruik dit adres voor alle accounts hieronder.", link: "https://dash.cloudflare.com/", steps: ["Cloudflare → roamgem.com → Email → Email Routing → Enable (klik 'Add records').", "Maak hello@roamgem.com aan en laat het doorsturen naar je Gmail.", "Bevestig de mail die Cloudflare naar je Gmail stuurt."] },
  { id: "j-tiktok", stage: "soft", owner: "jarne", status: "todo", title: "TikTok-account @roamgem", detail: "Bedrijfsaccount, categorie Reizen. Profielfoto en banner maakt Claude.", link: "https://www.tiktok.com/signup", steps: ["Maak een account met hello@roamgem.com, gebruikersnaam @roamgem (bezet? @roamgem.app).", "Instellingen → Account → Overschakelen naar zakelijk account → categorie Reizen.", "Bio: Road trips through Europe. Real gems on your route, checked. Costs per day, before you drive. Launching December. Link: https://roamgem.com", "Zet tweestapsverificatie aan."] },
  { id: "j-instagram", stage: "soft", owner: "jarne", status: "todo", title: "Instagram-account @roamgem", detail: "Zakelijk account, nodig voor statistieken en later automatisch posten (Reels).", link: "https://www.instagram.com/accounts/emailsignup/", steps: ["Maak een account met hello@roamgem.com, gebruikersnaam @roamgem.", "Instellingen → Accounttype → Professioneel account → Bedrijf, categorie Travel Company.", "Zelfde bio en link als TikTok; tweestapsverificatie aan."] },
  { id: "j-facebook", stage: "soft", owner: "jarne", status: "todo", title: "Facebook-pagina RoamGem", detail: "Nodig om Instagram automatisch te laten posten en later advertenties te draaien, ook als je er zelf niet post.", link: "https://www.facebook.com/pages/create", steps: ["Maak een pagina 'RoamGem', categorie Travel Company.", "Koppel Instagram: pagina-instellingen → Gekoppelde accounts → Instagram."] },
  { id: "j-youtube", stage: "soft", owner: "jarne", status: "todo", title: "YouTube-kanaal @roamgem (Shorts)", detail: "Als merkkanaal, niet onder je eigen naam. Dezelfde video's als TikTok.", link: "https://www.youtube.com/channel_switcher", steps: ["Log in met een Google-account (bij voorkeur nieuw, met hello@roamgem.com).", "Kanaal maken → 'Een kanaal met een zakelijke of andere naam' → RoamGem → handle @roamgem.", "Bio en link zoals bij TikTok."] },
  { id: "j-pinterest", stage: "soft", owner: "jarne", status: "todo", title: "Pinterest-bedrijfsaccount @roamgem", detail: "Voor reizen een grote bron van gratis verkeer; pins blijven jaren werken. De Brain kan hier later automatisch pinnen.", link: "https://www.pinterest.com/business/create/", steps: ["Maak een bedrijfsaccount met hello@roamgem.com, naam RoamGem, @roamgem.", "Claim je website: Instellingen → Geclaimde accounts → roamgem.com (Claude zet de code op de site als je hem stuurt)."] },
  { id: "j-x", stage: "soft", owner: "jarne", status: "todo", title: "X-account @roamgem (alleen de naam claimen)", detail: "Niet nodig om er te posten; wel zodat niemand anders de naam neemt.", link: "https://x.com/i/flow/signup" },
  { id: "j-grok-video", stage: "soft", owner: "jarne", status: "done", title: "Grok-video's toestaan (AI-beelden voor de video's)", detail: "Klaar (27 nov): xAI-sleutel staat veilig in de cloudomgeving. Eerste testclip gemaakt: 8 s staand, $1,12. Vergelijking met Pexels gestuurd." },
  { id: "j-pexels", stage: "soft", owner: "jarne", status: "done", title: "Pexels (gratis drone- en wegbeelden)", detail: "Niet nodig (27 nov): Pexels geeft geen nieuwe API-sleutels uit, maar Claude downloadt de gratis clips gewoon zelf." },
  { id: "j-fomo", stage: "soft", owner: "jarne", status: "todo", title: "Gratis FOMO-sleutel voor de copy-trade-test (fomoapi.io/dashboard)", detail: "Log in op https://fomoapi.io/dashboard met een e-mailcode; de sleutel staat er meteen. Zet hem in Railway als FOMO_API_KEY (of laat Claude het formulier openen). Gratis, geen kaart. Daarna start de papieren test van 21 dagen vanzelf." },
  { id: "j-videos", stage: "soft", owner: "jarne", status: "todo", title: "Videoplannen goedkeuren en video's posten", detail: "Videoplannen komen ma, wo en vr op Telegram. Post video 2, 3 en 4 deze week als eerste teasers (één per dag, 12–13 u of 19–21 u), met een trending geluid uit de app en het label 'AI-generated' bij AI-beelden." },
  { id: "j-tolls", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden: vignetten en tol (partnerprogramma)", detail: "Bijvoorbeeld Tolltickets (vignetten en tolbadges voor heel Europa). Stuur Claude daarna je partnerlink; dan komt de koopknop in het kostenblok." },
  { id: "j-insurance", stage: "soft", owner: "jarne", status: "todo", title: "Aanmelden: reis- en pechverzekering (partnerprogramma)", detail: "Een reisverzekeraar met een affiliateprogramma (vaak 15–30% commissie). Claude helpt kiezen; stuur daarna je partnerlink." },
  { id: "c-testers", stage: "soft", owner: "claude", status: "done", title: "Klaar voor testers", detail: "Klaar (27 nov): feedbackknop op elke pagina (naar jouw Telegram), foutmeldingen op Telegram, dagelijkse back-ups, updates breken geen trips meer af." },
  { id: "c-google", stage: "soft", owner: "claude", status: "done", title: "Naar Google's nieuwe diensten", detail: "Klaar (27 nov): Places API (New) en Routes API voor gems, slaapplekken, foto's, route en kosten; Google's reden staat in de logs als het misgaat." },
  { id: "c-gems", stage: "soft", owner: "claude", status: "done", title: "Gems elke dag, altijd met foto, met filters", detail: "Klaar (27 nov): gems per dag (ook op stadsdagen), foto die echt de plek toont (Wikimedia/Wikipedia), belevenissen voor gezin, koppels en vrienden, filters voor Plus, nieuwe indeling per dag." },
  { id: "c-social-post", stage: "soft", owner: "claude", status: "todo", title: "Automatisch posten (na jouw akkoord)", detail: "Koppelknoppen in de Brain voor Instagram, Facebook, YouTube en Pinterest; elke dag een video naar jouw Telegram met Goedkeuren, pas dan online. TikTok post je zelf tot de audit rond is." },
  { id: "c-brand", stage: "soft", owner: "claude", status: "todo", title: "Logo, profielfoto en banners", detail: "Rond logo voor de profielen en banners voor YouTube en Facebook, zodra je accounts bestaan." },
  { id: "c-feedback", stage: "soft", owner: "claude", status: "todo", title: "Testronde verwerken", detail: "Alles wat testers tegenkomen oplossen." },

  // Hard launch: everything a traveller expects, with marketing (target end of January / February).
  { id: "c-road", stage: "hard", owner: "claude", status: "todo", title: "Onderweg-modus", detail: "Start trip, je live positie, gems en campings in de buurt, route naar Google Maps of Waze in twee tikken." },
  { id: "c-lang", stage: "hard", owner: "claude", status: "todo", title: "Nederlands en Duits", detail: "De grootste campermarkten van Europa." },
  { id: "c-seo", stage: "hard", owner: "claude", status: "todo", title: "Een pagina per populaire route", detail: "\"Amsterdam naar het Gardameer met de camper\": gratis verkeer uit Google, gevuld uit de gem-bibliotheek." },
  { id: "c-yearly", stage: "hard", owner: "claude", status: "todo", title: "Jaarpas en vroegboek-actie", detail: "Plus per jaar; een actie van januari tot maart tegen het seizoensdal." },
  { id: "c-feedback2", stage: "hard", owner: "claude", status: "todo", title: "Tweede verbeterronde", detail: "Op basis van de eerste echte gebruikers." },
  { id: "c-marketing", stage: "hard", owner: "claude", status: "todo", title: "RoamGem-video's op volle kracht", detail: "Makers (5.000–50.000 volgers) laten posten, met jouw akkoord per uitgave; meten welke video trips en boekingen oplevert." },
  { id: "j-marketing", stage: "hard", owner: "jarne", status: "todo", title: "Lanceringsplan februari goedkeuren", detail: "Kanalen, budget en planning; Claude schrijft het voorstel." },
  { id: "j-feedback", stage: "hard", owner: "jarne", status: "todo", title: "Na de soft launch: wat vind je goed en slecht", detail: "Jouw lijst stuurt de tweede verbeterronde." },
];

/** Ideas from earlier talks and new ones: not planned yet. */
export const IDEAS: { title: string; detail: string }[] = [
  { title: "Wandelroutes bij je stops (idee van Jarne, 27 nov)", detail: "Veel roadtrippers stoppen een nacht of een paar uur en gaan wandelen (bv. Brussel–Luxemburg–Zwitserland). In de trip: wandelroutes rond je overnachting of een gem, met lengte, hoogtemeters en de gems onderweg. Nog uit te werken met Jarne (bron van routes, gratis of Plus)." },
  { title: "Elektrische auto: bereik en laadpalen", detail: "Laadstops op de route op basis van het bereik van je auto; daarna de camper met elektrische aandrijving." },
  { title: "Live verkeer (TomTom)", detail: "Files en wegwerkzaamheden op de dag van vertrek." },
  { title: "Beperkingen voor campers", detail: "Hoogte, gewicht en breedte: tunnels, smalle bergwegen en ZTL-zones vermijden." },
  { title: "Samen plannen", detail: "De trip delen met reisgenoten en samen stemmen over gems en slaapplekken." },
  { title: "Offline onderweg", detail: "De hele trip op de telefoon bewaren voor plekken zonder bereik." },
  { title: "Reisverslag na afloop", detail: "Een fotoboek of kaart van de echte route met je foto's van de gems (te koop)." },
  { title: "Prijsalarm voor campings", detail: "Een melding als een camping op je route goedkoper wordt of plek vrijkomt." },
  { title: "Nieuwsbrief: route van de week", detail: "Een mooie route met gems en kosten, met links die commissie opleveren." },
  { title: "Samenwerking met camperverhuurders", detail: "RoamGem als routeplanner bij een verhuurder (white label), met een vaste vergoeding." },
  { title: "Weer onderweg", detail: "Het weer per dag op de plek waar je die dag rijdt, met een seintje bij slecht weer." },
  { title: "Eventtrips (Tour de France en meer)", detail: "Kant-en-klare trips rond evenementen: met de camper de etappes van de Tour de France volgen, met campings en mooie kijkpunten langs het parcours; daarna andere evenementen (festivals, kerstmarkten, F1, skiwedstrijden)." },
  { title: "App in de stores", detail: "Later een iOS- en Android-app; tot dan werkt RoamGem als app vanaf het beginscherm." },
];

export function launchView(stats: (RoutifyStats & RoamGemSetup) | RoamGemSetup | null, ticks: Record<string, LaunchStatus>) {
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
