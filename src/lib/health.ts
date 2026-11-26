import { config } from "../config.js";
import { db, getSetting } from "../db.js";
import { isEtsyConfigured, isEtsyConnected, isEtsyListingReady } from "../integrations/etsy.js";
import { isMetaConfigured, metaConnection } from "../integrations/meta.js";
import { getCatalog } from "./catalogSetup.js";
import { isEbayConfigured, isEbayConnected } from "../integrations/ebay.js";
import { isRoutifyConfigured } from "../integrations/routify.js";
import { isPinterestConfigured, isPinterestConnected, pinterestUser } from "../integrations/pinterest.js";
import { hasPrintfulToken, isPrintfulConfigured, pf } from "../integrations/printful.js";
import { schedulerState } from "../scheduler.js";
import { apiSpendTodayCents } from "./budget.js";
import { currentTask } from "./tasks.js";
import { isClaudeConfigured } from "./claude.js";
import { isGrokConfigured } from "./grok.js";
import { isTelegramConfigured } from "./telegram.js";

// ok: working · warn: works but needs attention · error: broken · off: not set up yet
export type CheckStatus = "ok" | "warn" | "error" | "off";

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

const WORKER_STALE_MS = 2 * 60 * 1000;
const BUSY_WARN_MS = 2 * 60 * 60 * 1000;
const BUSY_ERROR_MS = 4 * 60 * 60 * 1000;

export interface WorkerState {
  startedAt: Date | null;
  lastWorkerTickAt: Date | null;
  /** Set while a task runs: one long task (e.g. redoing 20 listings) is not a stopped worker. */
  busySince: Date | null;
  busyWith: string | null;
}

export function workerCheck(w: WorkerState, now: Date): HealthCheck {
  const base = { id: "worker", label: "Takenwachtrij" } as const;
  const min = (d: Date) => Math.round((now.getTime() - d.getTime()) / 60000);
  if (w.busySince) {
    const busy = now.getTime() - w.busySince.getTime();
    if (busy < BUSY_WARN_MS) return { ...base, status: "ok", detail: `Bezig met ${w.busyWith} (${min(w.busySince)} min)` };
    return {
      ...base,
      status: busy < BUSY_ERROR_MS ? "warn" : "error",
      detail: `Al ${min(w.busySince)} min bezig met ${w.busyWith}`,
      fix: "Eén taak duurt erg lang. Kijk in Problemen of het serverlog of ze vastzit; herstart de server als ze niet verder gaat.",
    };
  }
  const fresh = w.lastWorkerTickAt && now.getTime() - w.lastWorkerTickAt.getTime() < WORKER_STALE_MS;
  const justStarted = w.startedAt && now.getTime() - w.startedAt.getTime() < WORKER_STALE_MS;
  if (fresh || justStarted) return { ...base, status: "ok", detail: "Pakt elke 15 seconden taken op" };
  return {
    ...base,
    status: "error",
    detail: w.lastWorkerTickAt ? `Laatst gedraaid ${min(w.lastWorkerTickAt)} min geleden` : "Heeft nog niet gedraaid",
    fix: "De takenwachtrij is gestopt. Herstart de server en kijk in het serverlog naar een crash.",
  };
}

export async function runHealthChecks(now = new Date()): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  checks.push(
    dbOk
      ? { id: "database", label: "Database", status: "ok", detail: "PostgreSQL bereikbaar" }
      : {
          id: "database",
          label: "Database",
          status: "error",
          detail: "PostgreSQL is niet bereikbaar",
          fix: "Controleer DATABASE_URL en of de database-dienst draait.",
        },
  );

  checks.push(
    workerCheck(
      { startedAt: schedulerState.startedAt, lastWorkerTickAt: schedulerState.lastWorkerTickAt, busySince: currentTask.since, busyWith: currentTask.label },
      now,
    ),
  );

  const [creditError, lastCall] = await Promise.all([
    db.log.findFirst({ where: { message: { contains: "credit balance is too low" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.cost.findFirst({ where: { category: "claude_api" }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
  ]);
  if (isClaudeConfigured() && creditOut(creditError?.createdAt ?? null, lastCall?.occurredAt ?? null, now)) {
    checks.push({
      id: "claude",
      label: "Claude API",
      status: "error",
      detail: "Anthropic-tegoed is op: ontwerpen, teksten, Scout en de Debug-diagnose staan stil",
      fix: "console.anthropic.com → Settings → Billing: tegoed kopen en automatisch bijvullen aanzetten. Daarna 'Opnieuw' bij de mislukte taken (of zeg het tegen Claude).",
    });
  } else if (!isClaudeConfigured()) {
    checks.push({
      id: "claude",
      label: "Claude API",
      status: "error",
      detail: "ANTHROPIC_API_KEY ontbreekt: de agents kunnen niet denken",
      fix: "Maak een sleutel op console.anthropic.com en stel ANTHROPIC_API_KEY in.",
    });
  } else {
    const spent = await apiSpendTodayCents(now);
    const cap = config.budget.dailyApiCapCents;
    const pct = Math.round((spent / cap) * 100);
    const detail = `Sleutel ingesteld · ${pct}% van het dagbudget van €${(cap / 100).toFixed(2)} gebruikt`;
    checks.push(
      spent >= cap
        ? {
            id: "claude",
            label: "Claude API",
            status: "error",
            detail,
            fix: "Budget bereikt: de agents pauzeren tot middernacht. Verhoog DAILY_API_BUDGET_EUR als dat nodig is.",
          }
        : spent >= cap * 0.8
          ? { id: "claude", label: "Claude API", status: "warn", detail, fix: "Bijna aan de daglimiet." }
          : { id: "claude", label: "Claude API", status: "ok", detail },
    );
  }

  checks.push(
    isGrokConfigured()
      ? { id: "grok", label: "Grok (xAI)", status: "ok", detail: `Gekoppeld (${config.grok.model}): zoekt live op X voor Scout en in de chat` }
      : {
          id: "grok",
          label: "Grok (xAI)",
          status: "off",
          detail: "Niet gekoppeld: Scout en de chat zien X (Twitter) nog niet",
          fix: "Maak een sleutel op console.x.ai (API Keys), zet er tegoed op en zet hem in Railway als XAI_API_KEY.",
        },
  );
  checks.push(
    isTelegramConfigured()
      ? { id: "telegram", label: "Telegram", status: "ok", detail: "Briefings en meldingen gaan naar je chat" }
      : {
          id: "telegram",
          label: "Telegram",
          status: "warn",
          detail: "Niet ingesteld: briefings en meldingen komen alleen in het serverlog",
          fix: "Maak een bot via @BotFather en stel TELEGRAM_BOT_TOKEN en TELEGRAM_CHAT_ID in.",
        },
  );

  if (!isEtsyConfigured()) {
    checks.push({
      id: "etsy",
      label: "Etsy",
      status: "off",
      detail: "Niet gekoppeld: listings blijven lokale concepten",
      fix: "Vraag een app aan op etsy.com/developers en vul de ETSY_*-instellingen in.",
    });
  } else if (!(await isEtsyConnected())) {
    checks.push({
      id: "etsy",
      label: "Etsy",
      status: "error",
      detail: "Sleutels ingesteld, maar de winkel is niet gekoppeld",
      fix: "Open /auth/etsy/start?token=ADMIN_TOKEN en geef toegang.",
    });
  } else {
    checks.push(
      isEtsyListingReady()
        ? { id: "etsy", label: "Etsy", status: "ok", detail: "Winkel gekoppeld" }
        : {
            id: "etsy",
            label: "Etsy",
            status: "warn",
            detail: "Winkel gekoppeld; winkelinstellingen voor nieuwe listings zijn nog niet opgehaald",
            fix: "Start bij Agents → Etsy-agent de taak etsy_setup (gebeurt ook vanzelf na het koppelen).",
          },
    );
  }

  checks.push(
    isPrintfulConfigured()
      ? { id: "printful", label: "Printful", status: "ok", detail: `Gekoppeld · product ${pf.productId}, variant ${pf.variantId}` }
      : hasPrintfulToken()
        ? {
            id: "printful",
            label: "Printful",
            status: "warn",
            detail: "Sleutel ingesteld; product en printmaat zijn nog niet opgehaald",
            fix: "Start bij Agents → Etsy-agent de taak printful_setup (gebeurt ook vanzelf bij het opstarten).",
          }
      : {
          id: "printful",
          label: "Printful",
          status: "off",
          detail: "Niet gekoppeld: bestellingen worden niet automatisch doorgezet",
          fix: "Stel PRINTFUL_TOKEN, PRINTFUL_PRODUCT_ID en PRINTFUL_VARIANT_ID in (zie npm run printful:catalog).",
        },
  );

  if (!isPinterestConfigured()) {
    checks.push({
      id: "pinterest",
      label: "Pinterest",
      status: "off",
      detail: "Niet gekoppeld: de marketing-agent pint nog niet",
      fix: "Maak een app op developers.pinterest.com, zet PINTEREST_APP_ID en PINTEREST_APP_SECRET in Railway en open /auth/pinterest/start?token=ADMIN_TOKEN.",
    });
  } else if (!(await isPinterestConnected())) {
    checks.push({
      id: "pinterest",
      label: "Pinterest",
      status: "error",
      detail: "Sleutels ingesteld, maar het account is niet gekoppeld",
      fix: "Open /auth/pinterest/start?token=ADMIN_TOKEN en geef toegang.",
    });
  } else {
    checks.push({ id: "pinterest", label: "Pinterest", status: "ok", detail: `Gekoppeld als ${(await pinterestUser()) ?? "?"}` });
  }

  if (!isRoutifyConfigured()) {
    checks.push({
      id: "routify",
      label: "Routify",
      status: "off",
      detail: "Niet gekoppeld: de Brain leest de Routify-cijfers nog niet",
      fix: "Zet ROUTIFY_URL (adres van de Routify-site) en ROUTIFY_STATS_TOKEN (gelijk aan STATS_TOKEN van Routify) in Railway.",
    });
  } else {
    const last = await getSetting<RoutifyHealthStats>("routify.stats");
    const up = await fetch(`${config.routify.url.replace(/\/+$/, "")}/api/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.ok)
      .catch(() => false);
    checks.push(routifyCheck(last, up));
  }

  if (!isEbayConfigured()) {
    checks.push({
      id: "ebay",
      label: "eBay",
      status: "off",
      detail: "Niet gekoppeld: producten staan alleen op Etsy",
      fix: "Maak een eBay-verkoopaccount en een developer-app (developer.ebay.com), zet EBAY_CLIENT_ID, EBAY_CLIENT_SECRET en EBAY_RUNAME in Railway en open /auth/ebay/start?token=ADMIN_TOKEN.",
    });
  } else if (!(await isEbayConnected())) {
    checks.push({ id: "ebay", label: "eBay", status: "error", detail: "Sleutels ingesteld, maar het verkoopaccount is niet gekoppeld", fix: "Open /auth/ebay/start?token=ADMIN_TOKEN en geef toegang." });
  } else {
    checks.push(ebayCheck(await getSetting<EbayStatus>("ebay.status"), await getSetting<string>("ebay.limitUntil")));
  }

  const catalog = getCatalog();
  if (catalog.length) {
    const on = catalog.filter((c) => c.enabled);
    const off = catalog.filter((c) => !c.enabled);
    checks.push({
      id: "catalog",
      label: "Productaanbod",
      status: on.length === 0 ? "error" : off.length ? "warn" : "ok",
      detail: `Actief: ${on.map((c) => c.label).join(", ") || "geen"}${off.length ? ` · Uit: ${off.map((c) => c.label).join(", ")}` : ""}`,
      fix: off.length ? off.map((c) => `${c.label}: ${c.reason}`).join(" · ") : undefined,
    });
  }

  const metaConn = isMetaConfigured() ? await metaConnection() : null;
  checks.push(
    !isMetaConfigured()
      ? {
          id: "meta",
          label: "Instagram + Facebook",
          status: "off",
          detail: "Niet gekoppeld: de marketing-agent post nog niet op Instagram en Facebook",
          fix: "Maak een Facebook-pagina en een Instagram-bedrijfsaccount, koppel ze, maak een app op developers.facebook.com, zet META_APP_ID en META_APP_SECRET in Railway en open /auth/meta/start?token=ADMIN_TOKEN.",
        }
      : !metaConn
        ? {
            id: "meta",
            label: "Instagram + Facebook",
            status: "error",
            detail: "Sleutels ingesteld, maar de accounts zijn niet gekoppeld",
            fix: "Open /auth/meta/start?token=ADMIN_TOKEN en geef toegang tot je pagina en Instagram.",
          }
        : metaConn.instagramId
          ? { id: "meta", label: "Instagram + Facebook", status: "ok", detail: `Pagina ${metaConn.pageName} · Instagram ${metaConn.instagramUsername}` }
          : {
              id: "meta",
              label: "Instagram + Facebook",
              status: "warn",
              detail: `Pagina ${metaConn.pageName} gekoppeld, maar geen Instagram-bedrijfsaccount aan die pagina`,
              fix: "Koppel je Instagram-bedrijfsaccount aan de Facebook-pagina (Instagram → Instellingen → Account → Gedeelde profielen) en koppel opnieuw.",
            },
  );

  if (!config.dryRun && config.publicUrl.includes("localhost")) {
    checks.push({
      id: "public-url",
      label: "Publiek adres",
      status: "warn",
      detail: "PUBLIC_URL is localhost: Printful kan de ontwerpen niet downloaden",
      fix: "Zet PUBLIC_URL op het publieke https-adres van de server.",
    });
  }

  checks.push(
    config.dryRun
      ? {
          id: "mode",
          label: "Modus",
          status: "warn",
          detail: "Dry run: niets gaat live en er wordt niets uitgegeven op Etsy of Printful",
          fix: "Als de ontwerpen goed zijn en de sleutels ingesteld, zet DRY_RUN=false.",
        }
      : { id: "mode", label: "Modus", status: "ok", detail: "Live" },
  );

  const oldApprovals = await db.approval.count({
    where: { status: "pending", createdAt: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } },
  });
  if (oldApprovals > 0) {
    checks.push({
      id: "approvals",
      label: "Beslissingen",
      status: "warn",
      detail: `${oldApprovals} beslissing(en) wachten al langer dan een dag`,
      fix: "Keur goed of af in Overzicht, of met /approve in Telegram.",
    });
  }

  return checks;
}

type RoutifyHealthStats = { generatedAt: string; health?: { errors24h: number; lastError: { at: string; message: string } | null } };

/** Routify on the health list: down is an error, server errors in the last day a warning. */
export function routifyCheck(last: RoutifyHealthStats | null, up: boolean): HealthCheck {
  const when = last ? `Cijfers van ${new Date(last.generatedAt).toLocaleString("nl-BE", { timeZone: config.timezone })}` : "Gekoppeld; de eerste cijfers komen om 08:10";
  if (!up) {
    return { id: "routify", label: "Routify", status: "error", detail: "De Routify-site antwoordt niet (of de database is onbereikbaar)", fix: "Kijk in Railway bij de Routify-service naar de logs en de laatste deploy." };
  }
  const h = last?.health;
  if (h && h.errors24h > 0) {
    return {
      id: "routify",
      label: "Routify",
      status: "warn",
      detail: `${h.errors24h} serverfout(en) in de laatste 24 uur${h.lastError ? `; laatste: ${h.lastError.message}` : ""}. ${when}`,
      fix: "Vraag Claude de Routify-logs in Railway te bekijken.",
    };
  }
  return { id: "routify", label: "Routify", status: "ok", detail: `Online. ${when}` };
}

export type EbayStatus = { at: string; live: number; offers: number; limit: { quantity: number | null; amount: string | null } | null };

/** eBay on the health list: listings live, eBay's monthly limit, and whether new listings wait. */
export function ebayCheck(st: EbayStatus | null, limitUntil: string | null, now = new Date()): HealthCheck {
  if (!st) return { id: "ebay", label: "eBay", status: "ok", detail: "Gekoppeld · nog geen controle bij eBay (elke ochtend om 07:30)" };
  const parts = [`Gekoppeld · ${st.live} listings live${st.offers > st.live ? ` (${st.offers} klaargezet bij eBay)` : ""}`];
  if (st.limit?.quantity != null) parts.push(`limiet ${st.limit.quantity} stuks${st.limit.amount ? ` of ${st.limit.amount}` : ""} per maand`);
  const waiting = limitUntil && new Date(limitUntil) > now;
  if (waiting) parts.push(`nieuwe listings wachten tot ${new Date(limitUntil).toLocaleDateString("nl-BE", { day: "numeric", month: "long", timeZone: "UTC" })} (maandlimiet)`);
  return {
    id: "ebay",
    label: "eBay",
    status: st.live === 0 ? "warn" : "ok",
    detail: parts.join(" · "),
    ...(st.live === 0 ? { fix: "Nog niets live op eBay. De bot probeert opnieuw zodra de maandlimiet vrij is; vraag Claude om de laatste eBay-check als het dan nog niet lukt." } : {}),
  };
}

/** The Anthropic credit ran out: a credit error in the last 6 hours and no successful Claude call since. */
export function creditOut(lastCreditError: Date | null, lastSuccess: Date | null, now = new Date()): boolean {
  if (!lastCreditError || now.getTime() - lastCreditError.getTime() > 6 * 60 * 60 * 1000) return false;
  return !lastSuccess || lastSuccess < lastCreditError;
}
