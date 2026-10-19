# AI Agency Brain

A team of AI agents that each run an online business, share one database and
knowledge base, and report to Jarne through a CEO agent and a daily Telegram
briefing. Goal: €10,000/month net.

This repository is **Phase 1**: foundation + the first money-maker.

| Agent | What it does | Schedule (Europe/Prague) |
|---|---|---|
| **CEO** (`ceo`) | Collects revenue, costs, agent activity, incidents and pending decisions; sends the morning briefing with a short "focus for today" | 07:00 daily |
| **Etsy / POD** (`etsy-pod`) | Picks gift niches, writes listings, designs typography mugs (SVG → print PNG), uploads drafts to Etsy, publishes after approval, syncs sales, creates Printful orders | Listings 10:00 daily · sales hourly |
| **Debug** (`debug`) | Retries failed tasks with backoff, escalates what keeps failing (with a Claude diagnosis), watches the API budget | Every 30 min |

## How it fits together

```
cron ──► Task queue (Postgres) ──► worker ──► agent handlers ──► Etsy / Printful / Claude
                     ▲                              │
                     └──── Debug Agent retries ◄────┘  (failures)
Everything writes to: logs · sales · costs · knowledge · approvals
CEO Agent reads it all ──► Telegram briefing 07:00
Jarne ──► Telegram /approve /reject /status /run
```

**Safety rails**

- `DRY_RUN=true` (the default): designs and listings are created locally, nothing is sent to Etsy or Printful.
- Daily hard cap on Claude spend (`DAILY_API_BUDGET_EUR`). Every call is costed and logged.
- Etsy listing fees: publishing waits for `/approve` unless `ETSY_AUTO_PUBLISH=true`.
- Printful orders above `SPEND_APPROVAL_LIMIT_EUR` wait for `/approve`.
- Telegram commands are accepted only from `TELEGRAM_CHAT_ID`.
- The HTTP API requires `ADMIN_TOKEN`.

## Run it locally

```bash
cp .env.example .env          # fill in what you have; everything else can stay empty
npm install
npx prisma migrate deploy     # needs DATABASE_URL pointing at PostgreSQL
npm run dev
```

Try an agent once, outside the schedule:

```bash
npm run agent:run -- ceo briefing
npm run agent:run -- etsy-pod create_listings '{"count":2}'   # needs ANTHROPIC_API_KEY
```

Designs end up in `storage/designs/`.

Tests (the database tests need a throwaway Postgres):

```bash
npm run typecheck
TEST_DATABASE_URL=postgresql://... npm test
```

## Going live: checklist

1. **Claude**: set `ANTHROPIC_API_KEY`, and pick `DAILY_API_BUDGET_EUR`.
2. **Telegram**: create a bot with @BotFather, send it `/start`, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
3. **Printful**: create a private token, choose the product (e.g. an 11oz white mug), run
   `npm run printful:catalog -- <productId>` and set `PRINTFUL_PRODUCT_ID`, `PRINTFUL_VARIANT_ID`,
   and `POD_DESIGN_WIDTH/HEIGHT` to the print-file size it prints.
4. **Etsy**: register an app at etsy.com/developers (approval can take a few days), set its callback URL to
   `${PUBLIC_URL}/auth/etsy/callback`, fill in the `ETSY_*` values, add Printful as a production partner in
   Shop Manager, then open `${PUBLIC_URL}/auth/etsy/start?token=ADMIN_TOKEN` once to connect the shop.
5. **Deploy** (Railway): deploy with the Dockerfile, add a PostgreSQL plugin, mount a volume at `STORAGE_DIR`,
   set `PUBLIC_URL` to the public https domain.
6. Watch a few days with `DRY_RUN=true`, check the designs, then set `DRY_RUN=false`.

## Dashboard

The dashboard is the company's control centre. Open `${PUBLIC_URL}/dashboard` (locally: http://localhost:4000/dashboard)
and enter `ADMIN_TOKEN`. It refreshes every 30 seconds.

- **Overview**: one verdict (all working / warnings / needs attention), money vs. the €10k goal, Claude budget,
  every business at a glance, integration status, each agent's state, 14 days of task runs, decisions to approve.
- **Businesses**: one page per business (`src/businesses.ts`): stage (planned / setting up / earning), revenue,
  costs by category, profit vs. target, 30-day revenue and cost chart, products with their designs and sales,
  latest sales, its agents and its open problems. Planned businesses show their plan and target.
- **Agents**: per agent, which business it works for, what it can do (each task, its schedule, last success,
  next run), what it depends on, today's numbers, and the exact error when it fails. Pause/resume, run a task now.
- **Chat**: talk with any agent. It answers from a live snapshot of its data (the CEO and Debug agents see the whole
  company) and can act when you ask: start its jobs, retry a failed task, save a note to the shared brain. Jobs that
  spend money are not available from chat; they go through approvals. Each message is a Claude call and is costed.
- **Problems**: every failed task with the exact error, whether it's being retried or gave up, the likely cause
  and fix steps. Retry, dismiss, or ask the agent. Also errors and warnings from the last 48 hours.
- **Shared brain**: what the agents have learned (niches, hooks, fixes, lessons, decisions), searchable.
- **Activity**: the log, filterable by agent and level.
- **Fix guide**: setup checklist and a searchable troubleshooting guide.

Error explanations come from `src/lib/troubleshoot.ts`. When you solve a new kind of failure, add a rule there so the
dashboard (and the Debug Agent's Telegram alerts) show the fix next time.

## API

All `/api` routes need `Authorization: Bearer $ADMIN_TOKEN`.

| Method | Path | |
|---|---|---|
| GET | `/health` | Public liveness check |
| GET | `/dashboard` | The dashboard page (asks for the admin token) |
| GET | `/api/dashboard` | Everything the dashboard shows, as JSON |
| POST | `/api/tasks/:id/retry` or `/dismiss` | Re-run or hide a failed task |
| POST | `/api/agents/:id/pause` or `/resume` | Stop or restart an agent's scheduled jobs |
| GET | `/api/businesses/:id` | One business: 30-day series, products, sales, costs by category |
| GET | `/api/agents/:id/chat` | Conversation history with an agent |
| POST | `/api/agents/:id/chat` | Send `{ "message": "..." }`; returns the agent's reply and what it did |
| GET | `/api/status` | Briefing data as JSON (dashboard source for Phase 3) |
| GET | `/api/briefing/preview` | Briefing as text |
| GET | `/api/approvals` | Pending decisions |
| POST | `/api/approvals/:id/approve` or `/reject` | Decide |
| POST | `/api/agents/:id/tasks` | Queue a task `{ "type": "...", "payload": {} }` |
| GET | `/api/logs?agent=etsy-pod` | Latest 100 log lines |
| GET | `/auth/etsy/start?token=…` | Connect the Etsy shop (OAuth) |

## Adding an agent (Phase 2+)

Create `src/agents/<name>.ts` exporting an `AgentDefinition` (id, name, phase, `businessId`, description, the
integrations it depends on, task handlers, a plain-language `taskInfo` line per task, and `chatTasks`: the jobs it may
start when asked in chat). If it runs a new business, add the business to `src/businesses.ts` with a `products()`
function so the Businesses page can show what it makes. Register the agent in
`src/agents/index.ts`, and add its schedule in `src/scheduler.ts`. Use `askText`/`askJson` from `src/lib/claude.ts`
(they enforce the budget and record costs), `agentLogger` for logs, `requestApproval` for anything that spends money,
and the `Knowledge` table to share what works.

## Known limits of Phase 1

- Niche research uses Claude's own knowledge plus the shared knowledge base; live trend data arrives with the
  Opportunity Scout Agent in Phase 2.
- One product type (single-variant, e.g. a mug). Multi-size products need Etsy inventory variations.
- Etsy and Printful calls are written against their public API docs but have not yet been exercised against
  live accounts; expect to adjust field details during the first dry run with real keys.
