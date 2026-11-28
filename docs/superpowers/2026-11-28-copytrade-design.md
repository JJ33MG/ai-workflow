# Copy-trade paper test (FOMO leaderboard)

Status: approved by Jarne (28 Nov 2026): "test it first for 3 weeks; if we would have made a profit, start with the lowest amount". He wants a daily update with the trades followed, how it is going, and what went wrong, and every problem must be fixed.

## Why

FOMO (fomo.family) shows the traders with the most profit. Idea: an agent compares them every day and copies the best ones. Leaderboards reward luck and copiers are always late, so first prove it on paper: no money moves.

## Goals

- For 21 days, follow FOMO's top traders and paper-trade their buys and sells with a realistic delay and costs.
- Run several strategies side by side and compare them with simply holding SOL.
- Every evening a Telegram report: trades opened and closed today, result per strategy, the agent's own assessment, problems and what was done about them.
- Day 21: the report asks Jarne to decide. Going live is a separate step that needs his approval (real money, minimum amount, hard limit).

## Non-goals

- No real trades, no wallet, no private key.
- No logging in to FOMO, no scraping of the app.

## The design

**Data**
- fomoapi.io (free key, 250,000 credits/month):
  - `GET /v2/leaderboard/{30d|7d}` once a day (250 credits each);
  - the app feed WebSocket `/ws/alerts` (free; realtime for 7 days, then 15 s delayed, which is fine for a paper test). It carries buys and sells of positions from about $3,000.
- Prices: DexScreener (free, no key), at the moment an alert arrives and every 30 minutes for open positions. Chains without DexScreener support are skipped and counted.

**Strategies** (stake €10 per paper trade, costs 3 % on the way in and 3 % on the way out for slippage and fees)
- `top10`: the 10 best of the 30-day board; sell when the trader sells.
- `steady`: traders with profit on both the 30-day and 7-day board, the 15 best by 30-day profit; sell when the trader sells.
- `steady_safe`: the steady traders, only tokens with at least $250,000 liquidity; sell when the trader sells or after 4 hours.
- Every position closes after 7 days at the latest (a sell can be missed).

**Self-repair**
- The stream reconnects on its own (backoff) and a watchdog restarts it after 15 minutes of silence.
- Board and price jobs are retried by the task queue and the Debug agent.
- The report lists each problem with what was done; what cannot be fixed automatically is flagged so Claude Code fixes it.

**Where**: Brain agent `copytrade`, business `copy-trade`, tables `CopyAlert`, `CopyTrader`, `CopyPosition`. `FOMO_API_KEY` in Railway.
