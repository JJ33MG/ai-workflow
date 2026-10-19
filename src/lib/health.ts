import { config } from "../config.js";
import { db } from "../db.js";
import { isEtsyConfigured, isEtsyConnected } from "../integrations/etsy.js";
import { isPrintfulConfigured } from "../integrations/printful.js";
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
      ? { id: "database", label: "Database", status: "ok", detail: "PostgreSQL reachable" }
      : {
          id: "database",
          label: "Database",
          status: "error",
          detail: "PostgreSQL is not reachable",
          fix: "Check DATABASE_URL and that the database service is running.",
        },
  );

  const tick = schedulerState.lastWorkerTickAt;
  const started = schedulerState.startedAt;
  const workerFresh = tick && now.getTime() - tick.getTime() < WORKER_STALE_MS;
  const justStarted = started && now.getTime() - started.getTime() < WORKER_STALE_MS;
  checks.push(
    workerFresh || justStarted
      ? { id: "worker", label: "Task worker", status: "ok", detail: "Picking up tasks every 15 seconds" }
      : {
          id: "worker",
          label: "Task worker",
          status: "error",
          detail: tick ? `Last ran ${Math.round((now.getTime() - tick.getTime()) / 60000)} min ago` : "Has not run",
          fix: "The worker loop has stopped. Restart the server and check its logs for a crash.",
        },
  );

  if (!isClaudeConfigured()) {
    checks.push({
      id: "claude",
      label: "Claude API",
      status: "error",
      detail: "ANTHROPIC_API_KEY is not set: agents cannot think",
      fix: "Create a key at console.anthropic.com and set ANTHROPIC_API_KEY.",
    });
  } else {
    const spent = await apiSpendTodayCents(now);
    const cap = config.budget.dailyApiCapCents;
    const pct = Math.round((spent / cap) * 100);
    const detail = `Key set · ${pct}% of today's €${(cap / 100).toFixed(2)} budget used`;
    checks.push(
      spent >= cap
        ? {
            id: "claude",
            label: "Claude API",
            status: "error",
            detail,
            fix: "Budget reached: agents pause Claude calls until midnight. Raise DAILY_API_BUDGET_EUR if needed.",
          }
        : spent >= cap * 0.8
          ? { id: "claude", label: "Claude API", status: "warn", detail, fix: "Close to the daily cap." }
          : { id: "claude", label: "Claude API", status: "ok", detail },
    );
  }

  checks.push(
    isTelegramConfigured()
      ? { id: "telegram", label: "Telegram", status: "ok", detail: "Briefings and alerts are sent to your chat" }
      : {
          id: "telegram",
          label: "Telegram",
          status: "warn",
          detail: "Not set up: briefings and alerts only go to the server log",
          fix: "Create a bot with @BotFather, then set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.",
        },
  );

  if (!isEtsyConfigured()) {
    checks.push({
      id: "etsy",
      label: "Etsy",
      status: "off",
      detail: "Not set up: listings stay as local drafts",
      fix: "Register an app at etsy.com/developers and fill in the ETSY_* variables.",
    });
  } else if (!(await isEtsyConnected())) {
    checks.push({
      id: "etsy",
      label: "Etsy",
      status: "error",
      detail: "Keys set, but the shop is not connected",
      fix: "Open /auth/etsy/start?token=ADMIN_TOKEN and approve access.",
    });
  } else {
    checks.push({ id: "etsy", label: "Etsy", status: "ok", detail: `Shop ${config.etsy.shopId} connected` });
  }

  checks.push(
    isPrintfulConfigured()
      ? { id: "printful", label: "Printful", status: "ok", detail: `Product ${config.printful.productId}, variant ${config.printful.variantId}` }
      : {
          id: "printful",
          label: "Printful",
          status: "off",
          detail: "Not set up: sales can't be fulfilled automatically",
          fix: "Set PRINTFUL_TOKEN, PRINTFUL_PRODUCT_ID and PRINTFUL_VARIANT_ID (see npm run printful:catalog).",
        },
  );

  if (!config.dryRun && config.publicUrl.includes("localhost")) {
    checks.push({
      id: "public-url",
      label: "Public URL",
      status: "warn",
      detail: "PUBLIC_URL is localhost: Printful can't download design files",
      fix: "Set PUBLIC_URL to the server's public https address.",
    });
  }

  checks.push(
    config.dryRun
      ? {
          id: "mode",
          label: "Mode",
          status: "warn",
          detail: "Dry run: nothing goes live and nothing is spent on Etsy or Printful",
          fix: "When designs look good and keys are set, set DRY_RUN=false.",
        }
      : { id: "mode", label: "Mode", status: "ok", detail: "Live" },
  );

  const oldApprovals = await db.approval.count({
    where: { status: "pending", createdAt: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } },
  });
  if (oldApprovals > 0) {
    checks.push({
      id: "approvals",
      label: "Approvals",
      status: "warn",
      detail: `${oldApprovals} decision(s) waiting more than a day`,
      fix: "Approve or reject them below, or with /approve in Telegram.",
    });
  }

  return checks;
}
