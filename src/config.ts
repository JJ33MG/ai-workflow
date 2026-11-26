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

  /**
   * Cheaper models for high-volume work (26 Nov: €8 a day was too much). Designs, ideas and strategy keep the
   * main model; long drawings (printable and coloring pages) start on the cheap one; chat uses the mid one.
   */
  models: {
    cheap: str("CHEAP_MODEL", "claude-haiku-5-5"),
    mid: str("MID_MODEL", "claude-sonnet-5-5"),
    chat: str("CHAT_MODEL", "claude-sonnet-5-5"),
  },

  /** Grok (xAI): searches X in real time; a helper next to Claude. */
  grok: {
    apiKey: str("XAI_API_KEY"),
    model: str("XAI_MODEL", "grok-4.7"),
    /** At most this many Grok questions a day (Scout's morning scan counts as one). */
    dailyCalls: num("GROK_DAILY_CALLS", 4),
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
    // Without ETSY_AUTO_PUBLISH: up to this many new listings a day go live by themselves ($0.20 each);
    // the rest still waits for Jarne's approval. 0 = always ask.
    autoPublishPerDay: num("ETSY_AUTO_PUBLISH_PER_DAY", 0),
  },

  ebay: {
    clientId: str("EBAY_CLIENT_ID"),
    clientSecret: str("EBAY_CLIENT_SECRET"),
    // The "RuName" eBay shows next to the redirect URL in the developer portal (User Tokens).
    ruName: str("EBAY_RUNAME"),
    marketplaceId: str("EBAY_MARKETPLACE", "EBAY_US"),
    currency: str("EBAY_CURRENCY", "USD"),
    // 32-80 letters/digits for eBay's account-deletion check; derived from ADMIN_TOKEN when not set.
    verificationToken: str("EBAY_VERIFICATION_TOKEN"),
    // New eBay sellers start with a limit (often about 10 items): list at most this many products.
    maxListings: num("EBAY_MAX_LISTINGS", 10),
    /** New listings per run: a slow start lets a problem show before it uses up the month's limit. */
    maxNewPerRun: num("EBAY_MAX_NEW_PER_RUN", 3),
    // Printful needs 2-5 working days to make an item; promising less earns late-shipment marks.
    handlingDays: num("EBAY_HANDLING_DAYS", 5),
    shippingCarrier: str("EBAY_SHIPPING_CARRIER", "USPS"),
    shippingService: str("EBAY_SHIPPING_SERVICE", "USPSGroundAdvantage"),
  },

  // The Routify app (repo roadgem): its /api/stats endpoint and the token it expects.
  routify: {
    url: str("ROUTIFY_URL"),
    statsToken: str("ROUTIFY_STATS_TOKEN"),
  },

  pinterest: {
    appId: str("PINTEREST_APP_ID"),
    appSecret: str("PINTEREST_APP_SECRET"),
    // Trial-access apps only work against the sandbox: https://api-sandbox.pinterest.com
    apiUrl: str("PINTEREST_API_URL", "https://api.pinterest.com"),
    // Few pins a day, every day: steady pinning works better on Pinterest than bursts, and looks less like spam.
    pinsPerDay: num("PINTEREST_PINS_PER_DAY", 3),
  },

  meta: {
    appId: str("META_APP_ID"),
    appSecret: str("META_APP_SECRET"),
    // Optional: which Facebook Page to post to when the account manages several.
    pageId: str("META_PAGE_ID"),
    // Without META_PAGE_ID the Page with this name is used (never just the first Page of the account).
    pageName: str("META_PAGE_NAME", "All You Can Wish"),
    graphVersion: str("META_GRAPH_VERSION", "v21.0"),
    // One post a day per platform: steady, and well below Instagram's limit of 50 a day.
    postsPerDay: num("META_POSTS_PER_DAY", 1),
  },

  printify: {
    token: str("PRINTIFY_API_TOKEN"),
  },
  printful: {
    token: str("PRINTFUL_TOKEN"),
    storeId: str("PRINTFUL_STORE_ID"),
    productId: num("PRINTFUL_PRODUCT_ID", 0),
    variantId: num("PRINTFUL_VARIANT_ID", 0),
    placement: str("PRINTFUL_PLACEMENT", "default"),
  },

  kdp: {
    // Pen name printed on the cover; Amazon shows it as the author.
    author: str("KDP_AUTHOR", "Little Crayon Studio"),
    picturesPerBook: num("KDP_PICTURES_PER_BOOK", 30),
    priceCents: Math.round(num("KDP_PRICE_USD", 7.99) * 100),
    currency: "USD",
    // Drawing the pages is most of a book's cost: a cheap model draws, a stronger one reviews,
    // and a page rejected twice gets one last try on CLAUDE_MODEL.
    drawModel: str("KDP_DRAW_MODEL", "claude-haiku-5-5"),
    reviewModel: str("KDP_REVIEW_MODEL", "claude-sonnet-5-5"),
  },

  scout: {
    ideasPerDay: num("SCOUT_IDEAS_PER_DAY", 3),
  },
  pod: {
    priceCents: Math.round(num("POD_PRICE", 21.99) * 100), // 11 oz mug
    currency: str("POD_CURRENCY", "EUR"),
    listingsPerRun: num("POD_LISTINGS_PER_RUN", 5),
    // Each design goes on up to this many products (mug, T-shirt, tote …), each its own listing.
    productsPerDesign: num("POD_PRODUCTS_PER_DESIGN", 3),
    // After the daily batch: this many extra niches with the buyer's name printed in the design (0 = off).
    personalizedPerRun: num("POD_PERSONALIZED_PER_RUN", 1),
    designWidth: num("POD_DESIGN_WIDTH", 2700),
    designHeight: num("POD_DESIGN_HEIGHT", 1050),
  },
};

export type Config = typeof config;
