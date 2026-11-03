// Known failure patterns → plain-language explanation and fix steps.
// Shown on the dashboard next to every failure and in Debug Agent escalations.
// Add a rule whenever a new kind of failure is figured out.

export interface FixGuide {
  id: string;
  title: string;
  area: string; // which integration or part of the system
  why: string;
  fix: string[];
}

interface Rule extends FixGuide {
  match: RegExp;
}

const RULES: Rule[] = [
  {
    id: "budget-reached",
    match: /Daily API budget reached/i,
    area: "Claude",
    title: "Dagbudget voor Claude is op",
    why: "De agents stoppen met Claude zodra de kosten van vandaag DAILY_API_BUDGET_EUR bereiken. Zo kan een fout je nooit veel geld kosten.",
    fix: [
      "Er is niets kapot: na middernacht (Praagse tijd) gaat het werk vanzelf verder.",
      "Hebben de agents echt meer nodig, verhoog dan DAILY_API_BUDGET_EUR en herstart de server.",
      "Zijn de kosten onverwacht hoog, kijk dan bij de kosten welke agent ze maakte en waarvoor.",
    ],
  },
  {
    id: "claude-credits",
    match: /credit balance is too low/i,
    area: "Claude",
    title: "Anthropic-account heeft geen tegoed",
    why: "De sleutel is geldig, maar het Anthropic-account erachter heeft geen tegoed meer, dus elke Claude-aanvraag wordt geweigerd.",
    fix: [
      "Ga naar console.anthropic.com → Settings → Billing en koop tegoed (of zet automatisch bijvullen aan).",
      "Binnen een minuut werkt het weer; druk op Opnieuw bij de mislukte taken.",
      "Houd DAILY_API_BUDGET_EUR ingesteld, zodat een drukke dag het tegoed niet opmaakt.",
    ],
  },
  {
    id: "claude-auth",
    match: /(authentication_error|invalid x-api-key|Could not resolve authentication|ANTHROPIC_API_KEY|401[^\n]*anthropic)/i,
    area: "Claude",
    title: "Claude-sleutel ontbreekt of is ongeldig",
    why: "De server kan niet inloggen bij de Anthropic API.",
    fix: [
      "Maak of kopieer een sleutel op console.anthropic.com → API keys.",
      "Zet ANTHROPIC_API_KEY in de instellingen van de server (Railway → Variables) en start opnieuw.",
      "Controleer of het account tegoed heeft.",
    ],
  },
  {
    id: "claude-rate-limit",
    match: /(rate_limit_error|overloaded_error|\b529\b|Claude[^\n]*\b429\b)/i,
    area: "Claude",
    title: "Claude is overbelast of remt af",
    why: "Te veel aanvragen tegelijk, of Anthropic is tijdelijk druk.",
    fix: [
      "Meestal tijdelijk: de Debug Agent probeert het vanzelf opnieuw.",
      "Gebeurt het vaak, laat dan minder per keer maken (POD_LISTINGS_PER_RUN) of bekijk je limieten in de Anthropic-console.",
    ],
  },
  {
    id: "claude-refusal",
    match: /Claude declined the request/i,
    area: "Claude",
    title: "Claude weigerde een verzoek",
    why: "Het verzoek raakte iets wat Claude niet maakt, bijvoorbeeld een merknaam of gevoelig onderwerp.",
    fix: [
      "Kijk in Activiteit welke niche of tekst het was; waarschijnlijk iets met een merk.",
      "Negeer de taak. De volgende keer kiest de agent andere niches.",
    ],
  },
  {
    id: "claude-output",
    match: /(did not match the schema|cut off at max_tokens)/i,
    area: "Claude",
    title: "Antwoord van Claude was onbruikbaar",
    why: "Het antwoord was afgekapt of had niet de verwachte vorm.",
    fix: [
      "Druk één keer op Opnieuw; meestal is het eenmalig.",
      "Gebeurt het vaker, laat dan minder per keer maken.",
    ],
  },
  {
    id: "etsy-not-connected",
    match: /(Etsy is not connected|OAuth state mismatch)/i,
    area: "Etsy",
    title: "Etsy-winkel niet gekoppeld",
    why: "De server heeft nog geen geldige Etsy-toegang tot je winkel, of het koppelen is onderbroken.",
    fix: [
      "Open PUBLIC_URL/auth/etsy/start?token=ADMIN_TOKEN in je browser en geef toegang.",
      "Controleer dat de callback-URL van je Etsy-app precies PUBLIC_URL/auth/etsy/callback is.",
    ],
  },
  {
    id: "etsy-token",
    match: /(Etsy token request failed|Etsy [A-Z]+ \S+ failed: 40[13])/i,
    area: "Etsy",
    title: "Etsy weigert de toegang",
    why: "De opgeslagen Etsy-toegang is verlopen, de sleutel klopt niet, of de app heeft geen toestemming meer.",
    fix: [
      "Controleer ETSY_API_KEY en ETSY_SHARED_SECRET op etsy.com/developers/your-apps.",
      "Koppel opnieuw: open PUBLIC_URL/auth/etsy/start?token=ADMIN_TOKEN.",
      "Staat de app bij Etsy nog op ‘wacht op goedkeuring’, dan werkt het pas na goedkeuring.",
    ],
  },
  {
    id: "etsy-bad-listing",
    match: /Etsy POST \S+\/listings failed: 400/i,
    area: "Etsy",
    title: "Etsy weigert een listing",
    why: "Meestal een verkeerde winkelinstelling: verzendprofiel, retourbeleid, categorie of productiepartner.",
    fix: [
      "Lees de foutmelding van Etsy: daarin staat welk veld fout is.",
      "Controleer ETSY_SHIPPING_PROFILE_ID, ETSY_RETURN_POLICY_ID, ETSY_TAXONOMY_ID en ETSY_PRODUCTION_PARTNER_ID in Shop Manager.",
      "Pas de instelling aan, start opnieuw en druk op Opnieuw bij de taak.",
    ],
  },
  {
    id: "etsy-rate-limit",
    match: /Etsy [A-Z]+ \S+ failed: 429/i,
    area: "Etsy",
    title: "Etsy remt af",
    why: "Te veel Etsy-aanvragen in korte tijd.",
    fix: [
      "Tijdelijk: de Debug Agent probeert het opnieuw met steeds langere pauzes.",
      "Gebeurt het vaak, laat dan minder per keer maken.",
    ],
  },
  {
    id: "printful-auth",
    match: /Printful [A-Z]+ \S+ failed: 40[13]/i,
    area: "Printful",
    title: "Printful weigert de sleutel",
    why: "PRINTFUL_TOKEN klopt niet, is verlopen of mist rechten.",
    fix: [
      "Maak een nieuwe sleutel op developers.printful.com met rechten voor bestellingen en bestanden.",
      "Stel PRINTFUL_TOKEN in (en PRINTFUL_STORE_ID bij meerdere winkels), start opnieuw en druk op Opnieuw.",
    ],
  },
  {
    id: "printful-order",
    match: /Printful [A-Z]+ \S+(orders|mockup)[^\n]*failed: 400|Printful mockup failed/i,
    area: "Printful",
    title: "Printful kan het ontwerp of product niet gebruiken",
    why: "Verkeerde variant, een printplek die het product niet heeft, of Printful kan het ontwerpbestand niet downloaden.",
    fix: [
      "Draai `npm run printful:catalog -- PRINTFUL_PRODUCT_ID` en controleer PRINTFUL_VARIANT_ID en PRINTFUL_PLACEMENT.",
      "Zorg dat PUBLIC_URL een publiek https-adres is (geen localhost), zodat Printful /files/designs/… kan ophalen.",
      "Bij een bestelling: rond hem met de hand af in Printful, zodat de klant niet hoeft te wachten.",
    ],
  },
  {
    id: "printful-timeout",
    match: /Printful mockup timed out/i,
    area: "Printful",
    title: "Printful-mockup duurde te lang",
    why: "De mockup-maker van Printful is traag of druk. De listing krijgt dan het platte ontwerp als foto.",
    fix: [
      "Niets doen, tenzij het bij elke listing gebeurt; kijk dan op de statuspagina van Printful.",
    ],
  },
  {
    id: "telegram",
    match: /Telegram \w+ failed/i,
    area: "Telegram",
    title: "Telegram-bericht kon niet verstuurd worden",
    why: "Verkeerde bot-code of chat-ID, of je hebt nog niet op Start gedrukt bij de bot.",
    fix: [
      "Open je bot in Telegram en druk op Start.",
      "Controleer TELEGRAM_BOT_TOKEN (van @BotFather) en TELEGRAM_CHAT_ID (van @userinfobot) en start opnieuw.",
    ],
  },
  {
    id: "stuck",
    match: /Stuck in running state/i,
    area: "Server",
    title: "Taak werd onderbroken",
    why: "De server herstartte of liep vast tijdens de taak (update, crash of te weinig geheugen).",
    fix: [
      "De Debug Agent probeert het vanzelf opnieuw.",
      "Gebeurt het vaak, kijk dan in het serverlog naar crashes of geheugenlimieten.",
    ],
  },
  {
    id: "no-handler",
    match: /No handler for/i,
    area: "Server",
    title: "Onbekend soort taak",
    why: "Er staat een taak in de wachtrij die deze versie van de code niet kent (meestal na een update).",
    fix: [
      "Negeer de taak. Heb je hem zelf gestart, kijk dan bij Agents welke taaknamen bestaan.",
    ],
  },
  {
    id: "database",
    match: /(Can't reach database server|P1001|P1017|ECONNREFUSED[^\n]*5432|PrismaClient)/i,
    area: "Database",
    title: "Database niet bereikbaar",
    why: "De server kan PostgreSQL niet bereiken.",
    fix: [
      "Controleer DATABASE_URL en of de database draait (Railway → PostgreSQL).",
      "Daarna worden mislukte taken vanzelf opnieuw geprobeerd.",
    ],
  },
  {
    id: "design",
    match: /(forbidden construct|did not contain an <svg>)/i,
    area: "Ontwerpen",
    title: "Een ontwerp werd door de veiligheidscontrole afgewezen",
    why: "Het ontwerp bevatte iets wat niet in een printbestand mag (links, afbeeldingen, scripts). Alleen dat idee is overgeslagen.",
    fix: [
      "Niets doen bij af en toe een overgeslagen idee.",
      "Worden de meeste ideeën overgeslagen, laat het ontwerp-prompt dan nakijken.",
    ],
  },
  {
    id: "network",
    match: /(fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up)/i,
    area: "Netwerk",
    title: "Netwerkprobleem",
    why: "Een aanvraag naar een externe dienst kwam niet door.",
    fix: [
      "Meestal tijdelijk: wordt automatisch opnieuw geprobeerd.",
      "Blijft het, kijk dan op de statuspagina van je hostingprovider.",
    ],
  },
];

const FALLBACK: FixGuide = {
  id: "unknown",
  title: "Onbekende fout",
  area: "Onbekend",
  why: "Deze fout past nog bij geen bekend patroon.",
  fix: [
    "Lees de volledige foutmelding: meestal staat de dienst en het veld erin.",
    "Druk één keer op Opnieuw. Mislukt het weer, dan stuurt de Debug Agent je de waarschijnlijke oorzaak via Telegram.",
    "Is het opgelost, voeg dan een regel toe in src/lib/troubleshoot.ts, zodat de oplossing hier de volgende keer staat.",
  ],
};

export function diagnose(error: string | null | undefined): FixGuide {
  if (!error) return FALLBACK;
  const rule = RULES.find((r) => r.match.test(error));
  if (!rule) return FALLBACK;
  const { match: _match, ...guide } = rule;
  return guide;
}

/** All guides, for the dashboard's troubleshooting section. */
export function allGuides(): FixGuide[] {
  return [...RULES.map(({ match: _match, ...g }) => g), FALLBACK];
}
