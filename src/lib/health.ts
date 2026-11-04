import { config } from "../config.js";
import { db } from "../db.js";
import { isEtsyConfigured, isEtsyConnected, isEtsyListingReady } from "../integrations/etsy.js";
import { hasPrintfulToken, isPrintfulConfigured, pf } from "../integrations/printful.js";
import { schedulerState } from "../scheduler.js";
import { apiSpendTodayCents } from "./budget.js";
import { isClaudeConfigured } from "./claude.js";
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

  const tick = schedulerState.lastWorkerTickAt;
  const started = schedulerState.startedAt;
  const workerFresh = tick && now.getTime() - tick.getTime() < WORKER_STALE_MS;
  const justStarted = started && now.getTime() - started.getTime() < WORKER_STALE_MS;
  checks.push(
    workerFresh || justStarted
      ? { id: "worker", label: "Takenwachtrij", status: "ok", detail: "Pakt elke 15 seconden taken op" }
      : {
          id: "worker",
          label: "Takenwachtrij",
          status: "error",
          detail: tick ? `Laatst gedraaid ${Math.round((now.getTime() - tick.getTime()) / 60000)} min geleden` : "Heeft nog niet gedraaid",
          fix: "De takenwachtrij is gestopt. Herstart de server en kijk in het serverlog naar een crash.",
        },
  );

  if (!isClaudeConfigured()) {
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
