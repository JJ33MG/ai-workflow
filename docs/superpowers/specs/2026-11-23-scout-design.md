# Scout: daily ideas, trends and Brain improvements

## Why
Jarne: the Brain only does what it is told. He wants an agent that brings new business ideas, money-making
strategies, trends and improvements to the Brain itself every day, thinks outside the box, and learns
from his reactions.

## What (approved by Jarne, 23 Nov 2026)
- Agent "Scout", every day at 08:00 (Prague): 3 ideas. Each: kind (new business / grow existing /
  improve the Brain / trend), title, why now (with source links), rough money, cost, effort, first step,
  risks. At least one is deliberately outside the box.
- Inputs: live web search (trends, seasons 4-8 weeks ahead, new platforms and models, competitors),
  the Brain's own state (money, agents, failures, plan), and Jarne's past votes and reasons.
- Delivery: Telegram with buttons Build it / Later / No, and an Ideas page on the dashboard.
- Every Sunday: a Brain review (what is slow, failing or still manual; the 3 best improvements).
- Chat: "think about X" starts a research run on that topic.
- "Build it" marks the idea as approved for building. The agent never spends money and never changes
  code; Claude Code builds approved ideas in a session when Jarne asks.
- Cost: about EUR 0.30-0.60 a day (web search plus tokens), inside the daily budget.

## Approaches
- Ideas only from the Brain's own data: cheap but blind to trends (Jarne explicitly wants trends). No.
- One Claude call with web search and structured output together: fewer calls, but citations and
  structured output don't combine. No.
- Chosen: a research call with web search (sources kept), then a structured call that turns the notes
  into ideas.

## Left to the builder
Exact prompt wording, how many searches per run (max 8), storage shape.
