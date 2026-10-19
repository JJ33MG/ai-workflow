# AI Agency Brain — Agent Context

Read README.md first. The build brief lives in Jarne's doc "AI Agency Brain — Build Brief for Claude Code".

## Stack

Node 22 + TypeScript (ESM, run with `tsx`), Express 5, Prisma 5 + PostgreSQL, node-cron, `@anthropic-ai/sdk`, sharp.

## Conventions

- Every Claude call goes through `src/lib/claude.ts` (`askText` / `askJson`): it enforces the daily budget and records the cost. Never construct an Anthropic client elsewhere.
- Every spend above `SPEND_APPROVAL_LIMIT_EUR`, every new platform, and anything that risks an account ban goes through `requestApproval`.
- Work runs as tasks (`enqueue`) so failures are retried by the Debug Agent. Handlers must be safe to re-run (check before creating anything external).
- Log with `agentLogger(agentId)`; the briefing is built from the database, so unlogged work is invisible.
- Money: sales in integer cents; costs in fractional cents (API calls cost less than a cent). Convert with `toEurCents`.
- Respect `DRY_RUN`: no external writes while it is true.
- Imports use `.js` extensions (NodeNext).
- Businesses live in `src/businesses.ts`; an agent's `businessId` ties its sales and costs to a business.
- Chat tools (`src/chat.ts`) may only start jobs listed in an agent's `chatTasks`. Never add a job that spends money there.
- Dashboard frontend (`src/dashboard/`) is plain ES modules with no build step. Insert server text with `h()` (text nodes), never `innerHTML`.

## Checks

```
npm run typecheck
TEST_DATABASE_URL=postgresql://... npm test
```
