# PRD — mrkrabs

> _Product requirements. What ships, what doesn't, what "done" looks like._
>
> (Filename note: Pau said "VR detector" — interpreted as **P**roduct **R**equirements **D**oc. If that was wrong, rename me.)

## Ship targets

### MVP (must have before we submit once)

- [ ] Working Cala API client (auth, basic data query, submission endpoint)
- [ ] Agent that produces a portfolio satisfying all hard constraints:
  - ≥ 50 distinct NASDAQ tickers
  - ≥ $5,000 per position
  - exactly $1,000,000 total
  - no duplicates
- [ ] Backtest the portfolio locally so we know our expected score _before_ we submit
- [ ] A working submission (appears on leaderboard)

### V1 (iterate toward beating SPX)

- [ ] Defensible trading thesis written in [`STRATEGY.md`](./STRATEGY.md)
- [ ] Agent uses at least 2 independent Cala signals, not just "give me the S&P 500"
- [ ] Reproducible: re-running produces the same portfolio given the same seed

### Stretch (only if time)

- [ ] Next.js UI showing the portfolio, the thesis, and live leaderboard rank
- [ ] Multiple competing strategies and a "meta-agent" that picks between them
- [ ] Explainability: per-pick justification pulled from the Cala signal that drove it

## Out of scope

- Live / paper trading
- Options, shorts, leverage (the challenge is long-only cash allocation)
- Fundamental models we train ourselves

## Success criteria

1. **Constraint compliance:** submission is accepted by the Cala API on first try.
2. **Beats SPX:** end-of-window portfolio value > SPX buy-and-hold over the same window.
3. **Explainable:** for every pick, we can point to the Cala data that justified it.
4. **Cleanly presented:** we can demo the agent and the narrative in under 3 minutes.

## Hard constraints from the challenge

| Constraint          | Value                              |
| ------------------- | ---------------------------------- |
| Universe            | NASDAQ-listed only                 |
| Minimum positions   | 50                                 |
| Min per position    | $5,000                             |
| Total budget        | $1,000,000                         |
| Duplicates          | Not allowed                        |
| Start date          | 2025-04-15                         |
| Scoring date        | 2026-04-15 (today)                 |
| Resubmissions       | Unlimited                          |
