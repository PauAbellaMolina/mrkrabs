# mrkrabs

An AI agent that builds a $1M NASDAQ portfolio for Cala's **"Lobster of Wall Street"** hackathon challenge.

## The challenge

Turn the clock back 365 days — it's April 15th 2025. You have $1,000,000 and access to [Cala](https://cala.ai)'s verified-knowledge API. Build an agent that researches NASDAQ-listed companies and allocates that capital across **at least 50 stocks**. One year later (today, 2026-04-15) the portfolio is scored on real market data and ranked on a live leaderboard. Beat the S&P 500 buy-and-hold, win €10k in Cala credits + a travel grant.

**Hard constraints:**

- ≥ 50 distinct NASDAQ tickers (no duplicates)
- ≥ $5,000 per position
- $1,000,000 total exactly
- Resubmit as many times as we want

## Team

- [Pau](https://github.com/) — frontend / infra
- Anton — agent / AI

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript
- **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) — agent loop with tool-calling
- **Cala API + MCP** — verified financial knowledge (see [docs](https://docs.cala.ai))
- **Tailwind v4** for UI

## Knowledge base

We keep living docs in [`docs/`](./docs):

- [`VISION.md`](./docs/VISION.md) — what we're building and why
- [`PRD.md`](./docs/PRD.md) — product requirements / spec
- [`STRATEGY.md`](./docs/STRATEGY.md) — trading thesis and the data signals we rely on
- [`NOTES.md`](./docs/NOTES.md) — running decisions, open questions, scratchpad

## Getting started

```bash
pnpm install
cp .env.local.example .env.local   # then fill in CALA_API_KEY + model key
pnpm dev
```

Open http://localhost:3000.
