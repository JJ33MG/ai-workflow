// Tests must never call the real Claude API (it costs money). An empty key wins over
// a key in .env, because dotenv never overwrites a variable that is already set.
process.env.ANTHROPIC_API_KEY = "";
process.env.TELEGRAM_BOT_TOKEN = "";
