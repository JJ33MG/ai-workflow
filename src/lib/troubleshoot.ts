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
    title: "Daily Claude budget used up",
    why: "Agents stop calling Claude once today's API spend hits DAILY_API_BUDGET_EUR. This protects you from runaway costs.",
    fix: [
      "Nothing is broken: work resumes automatically after midnight (Prague time).",
      "If agents legitimately need more, raise DAILY_API_BUDGET_EUR and restart the server.",
      "If spend is unexpectedly high, check the Costs panel for which agent and purpose used it.",
    ],
  },
  {
    id: "claude-credits",
    match: /credit balance is too low/i,
    area: "Claude",
    title: "Anthropic account has no credit",
    why: "The API key is valid, but the Anthropic account behind it has no prepaid credit left, so every Claude call is refused.",
    fix: [
      "Go to console.anthropic.com → Settings → Billing and buy credits (or turn on auto-reload).",
      "Calls work again within a minute; press Retry on the failed tasks.",
      "Keep DAILY_API_BUDGET_EUR set so a busy day can't use up the balance.",
    ],
  },
  {
    id: "claude-auth",
    match: /(authentication_error|invalid x-api-key|Could not resolve authentication|ANTHROPIC_API_KEY|401[^\n]*anthropic)/i,
    area: "Claude",
    title: "Claude API key missing or invalid",
    why: "The server cannot authenticate with the Anthropic API.",
    fix: [
      "Create or copy a key at console.anthropic.com → API keys.",
      "Set ANTHROPIC_API_KEY in the server's environment (Railway → Variables) and redeploy.",
      "Check the key's workspace has billing / credits.",
    ],
  },
  {
    id: "claude-rate-limit",
    match: /(rate_limit_error|overloaded_error|\b529\b|Claude[^\n]*\b429\b)/i,
    area: "Claude",
    title: "Claude is rate-limiting or overloaded",
    why: "Too many requests at once, or Anthropic is temporarily overloaded.",
    fix: [
      "Usually temporary: the Debug Agent retries automatically.",
      "If it keeps happening, lower POD_LISTINGS_PER_RUN or check your rate limits in the Anthropic console.",
    ],
  },
  {
    id: "claude-refusal",
    match: /Claude declined the request/i,
    area: "Claude",
    title: "Claude declined a request",
    why: "The request touched something Claude won't produce (for example trademarked or sensitive content).",
    fix: [
      "Look at the task's niche or slogan in Recent activity; it is probably near a trademark or sensitive topic.",
      "Dismiss the task. The next run picks different niches.",
    ],
  },
  {
    id: "claude-output",
    match: /(did not match the schema|cut off at max_tokens)/i,
    area: "Claude",
    title: "Claude's answer was unusable",
    why: "The answer was cut off or didn't have the expected structure.",
    fix: [
      "Retry the task once; this is usually a one-off.",
      "If it repeats, lower the count of items requested per run (POD_LISTINGS_PER_RUN).",
    ],
  },
  {
    id: "etsy-not-connected",
    match: /(Etsy is not connected|OAuth state mismatch)/i,
    area: "Etsy",
    title: "Etsy shop not connected",
    why: "The server has no valid Etsy login for your shop yet, or the connection flow was interrupted.",
    fix: [
      "Open PUBLIC_URL/auth/etsy/start?token=ADMIN_TOKEN in your browser and approve access.",
      "Make sure the Etsy app's callback URL is exactly PUBLIC_URL/auth/etsy/callback.",
    ],
  },
  {
    id: "etsy-token",
    match: /(Etsy token request failed|Etsy [A-Z]+ \S+ failed: 40[13])/i,
    area: "Etsy",
    title: "Etsy rejected the login",
    why: "The saved Etsy token expired and could not be refreshed, the app key is wrong, or the app lost permission.",
    fix: [
      "Check ETSY_API_KEY and ETSY_SHARED_SECRET match your app at etsy.com/developers/your-apps.",
      "Reconnect the shop: open PUBLIC_URL/auth/etsy/start?token=ADMIN_TOKEN.",
      "If the app is still 'pending approval' at Etsy, wait for approval; live calls fail until then.",
    ],
  },
  {
    id: "etsy-bad-listing",
    match: /Etsy POST \S+\/listings failed: 400/i,
    area: "Etsy",
    title: "Etsy refused a listing",
    why: "Usually a wrong shop setting: shipping profile, return policy, category (taxonomy) or production partner id.",
    fix: [
      "Read the exact Etsy message in the error. It names the field.",
      "Check ETSY_SHIPPING_PROFILE_ID, ETSY_RETURN_POLICY_ID, ETSY_TAXONOMY_ID and ETSY_PRODUCTION_PARTNER_ID in Shop Manager.",
      "Fix the variable, redeploy, then press Retry on the task.",
    ],
  },
  {
    id: "etsy-rate-limit",
    match: /Etsy [A-Z]+ \S+ failed: 429/i,
    area: "Etsy",
    title: "Etsy rate limit",
    why: "Too many Etsy API calls in a short time.",
    fix: ["Temporary: the Debug Agent retries with growing delays.", "If frequent, lower POD_LISTINGS_PER_RUN."],
  },
  {
    id: "printful-auth",
    match: /Printful [A-Z]+ \S+ failed: 40[13]/i,
    area: "Printful",
    title: "Printful rejected the token",
    why: "PRINTFUL_TOKEN is wrong, expired, or lacks the needed scopes.",
    fix: [
      "Create a new private token at developers.printful.com with orders and file library scopes.",
      "Set PRINTFUL_TOKEN (and PRINTFUL_STORE_ID if the token covers several stores), redeploy, press Retry.",
    ],
  },
  {
    id: "printful-order",
    match: /Printful [A-Z]+ \S+(orders|mockup)[^\n]*failed: 400|Printful mockup failed/i,
    area: "Printful",
    title: "Printful could not use the design or product",
    why: "Wrong variant id, a placement the product doesn't have, or Printful could not download the design file.",
    fix: [
      "Run `npm run printful:catalog -- PRINTFUL_PRODUCT_ID` and check PRINTFUL_VARIANT_ID and PRINTFUL_PLACEMENT.",
      "Make sure PUBLIC_URL is a public https address (not localhost) so Printful can fetch /files/designs/…",
      "For an order: open the order in the Printful dashboard and complete it by hand so the customer isn't delayed.",
    ],
  },
  {
    id: "printful-timeout",
    match: /Printful mockup timed out/i,
    area: "Printful",
    title: "Printful mockup took too long",
    why: "Printful's mockup generator is slow or busy. The listing still gets the flat design image.",
    fix: ["No action needed unless it happens on every listing; then check Printful's status page."],
  },
  {
    id: "telegram",
    match: /Telegram \w+ failed/i,
    area: "Telegram",
    title: "Telegram message could not be sent",
    why: "Wrong bot token or chat id, or you haven't started a chat with the bot yet.",
    fix: [
      "Open your bot in Telegram and press Start.",
      "Check TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (from @userinfobot), then redeploy.",
    ],
  },
  {
    id: "stuck",
    match: /Stuck in running state/i,
    area: "Server",
    title: "Task was interrupted",
    why: "The server restarted or froze while the task was running (deploy, crash, or out of memory).",
    fix: [
      "The Debug Agent retries it automatically.",
      "If this happens often, check the hosting logs for crashes or memory limits.",
    ],
  },
  {
    id: "no-handler",
    match: /No handler for/i,
    area: "Server",
    title: "Unknown task type",
    why: "A task was queued for a job this version of the code doesn't have (usually after a deploy renamed a task).",
    fix: ["Dismiss the task. If you queued it by hand, check the agent's task list on this dashboard for valid names."],
  },
  {
    id: "database",
    match: /(Can't reach database server|P1001|P1017|ECONNREFUSED[^\n]*5432|PrismaClient)/i,
    area: "Database",
    title: "Database unreachable",
    why: "The server can't talk to PostgreSQL.",
    fix: [
      "Check DATABASE_URL and that the database service is running (Railway → PostgreSQL).",
      "After it's back, failed tasks are retried automatically.",
    ],
  },
  {
    id: "design",
    match: /(forbidden construct|did not contain an <svg>)/i,
    area: "Designs",
    title: "A design was rejected by the safety check",
    why: "Claude's SVG contained something not allowed in a print file (links, images, scripts). That one idea was skipped.",
    fix: ["No action needed for occasional skips.", "If most ideas are skipped, review the design prompt in src/agents/etsyPod.ts."],
  },
  {
    id: "network",
    match: /(fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up)/i,
    area: "Network",
    title: "Network problem",
    why: "A request to an outside service didn't get through.",
    fix: ["Usually temporary: retried automatically.", "If it persists, check the hosting provider's status and outbound network."],
  },
];

const FALLBACK: FixGuide = {
  id: "unknown",
  title: "Unrecognised error",
  area: "Unknown",
  why: "This error doesn't match a known pattern yet.",
  fix: [
    "Read the full error message. It usually names the service and the field.",
    "Press Retry once. If it fails again, the Debug Agent's Telegram escalation includes Claude's diagnosis.",
    "Once solved, add a rule for it in src/lib/troubleshoot.ts so next time the fix shows here.",
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
