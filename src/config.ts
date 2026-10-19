import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

const str = (name: string, fallback = "") => process.env[name] ?? fallback;

export const config = {
  port: num("PORT", 4000),
  publicUrl: str("PUBLIC_URL", "http://localhost:4000"),
  adminToken: str("ADMIN_TOKEN"),
  timezone: str("TIMEZONE", "Europe/Prague"),
  storageDir: str("STORAGE_DIR", "./storage"),

  // Nothing touches a real platform or spends money while this is true.
  dryRun: bool("DRY_RUN", true),

  claude: {
    model: str("CLAUDE_MODEL", "claude-opus-5-5"),
  },

  budget: {
    currency: "EUR",
    // Hard cap on API spend per day; agents stop calling Claude above it.
    dailyApiCapCents: num("DAILY_API_BUDGET_EUR", 5) * 100,
    // Any single spend above this needs Jarne's approval.
    approvalLimitCents: num("SPEND_APPROVAL_LIMIT_EUR", 20) * 100,
    usdToEur: num("USD_TO_EUR", 0.92),
  },

  telegram: {
    botToken: str("TELEGRAM_BOT_TOKEN"),
    chatId: str("TELEGRAM_CHAT_ID"),
  },

  etsy: {
    apiKey: str("ETSY_API_KEY"), // keystring
    sharedSecret: str("ETSY_SHARED_SECRET"),
    shopId: str("ETSY_SHOP_ID"),
    shippingProfileId: str("ETSY_SHIPPING_PROFILE_ID"),
    returnPolicyId: str("ETSY_RETURN_POLICY_ID"),
    taxonomyId: num("ETSY_TAXONOMY_ID", 0),
    // Etsy charges a listing fee on publish, so going live is a separate step.
    autoPublish: bool("ETSY_AUTO_PUBLISH", false),
  },

  printful: {
    token: str("PRINTFUL_TOKEN"),
    storeId: str("PRINTFUL_STORE_ID"),
    productId: num("PRINTFUL_PRODUCT_ID", 0),
    variantId: num("PRINTFUL_VARIANT_ID", 0),
    placement: str("PRINTFUL_PLACEMENT", "default"),
  },

  pod: {
    priceCents: Math.round(num("POD_PRICE_EUR", 17.99) * 100),
    currency: str("POD_CURRENCY", "EUR"),
    listingsPerRun: num("POD_LISTINGS_PER_RUN", 5),
    designWidth: num("POD_DESIGN_WIDTH", 2700),
    designHeight: num("POD_DESIGN_HEIGHT", 1050),
  },
};

export type Config = typeof config;
