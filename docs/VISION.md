# Vision

> _One paragraph: what are we building, for whom, and why does it matter?_

## The one-liner

An AI agent that, given $1M and Cala's verified-knowledge API, picks a ≥50-stock NASDAQ portfolio that would have beaten the S&P 500 buy-and-hold over the past year — and can explain _why_ using the data it saw.

## Why this matters

Cala's challenge claims "the missing piece in AI-driven investing isn't the models, it's the data." Our agent is the existence proof: if Cala's data is good, a small agent using it should produce a **measurable, data-attributable edge** over a passive index.

Winning = beating SPX buy-and-hold _and_ having a clean story of which Cala signals drove the edge.

## Non-goals

- Live trading. The window is fixed (2025-04-15 → 2026-04-15); this is a one-shot historical allocation.
- A generic robo-advisor UI. We only need enough surface area to run the agent, show the picks, and submit.
- Beating the best human quants. We need to beat SPX buy-and-hold and be defensible on stage.

## Open questions

- [ ] What _specifically_ does Cala expose that Yahoo Finance doesn't? (research agent running)
- [ ] Do we go concentrated (50 bets, equal-ish weight) or barbell (big core + satellite tilts)?
- [ ] Do judges reward absolute return, Sharpe, or narrative quality? Need to ask at the Cala booth.
