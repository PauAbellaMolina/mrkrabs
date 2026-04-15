# Strategy

> _Our trading thesis and the Cala signals we lean on. Fill in as we learn what data is available._

## Constraint: Cala ≠ market data

Cala is an **entity knowledge graph** (companies, people, filings metadata, corporate events, relationships), sourced from **SEC EDGAR + GLEIF**. It has **no prices, no OHLC, no earnings numbers, no analyst ratings, no insider transactions, no point-in-time queries.** See `NOTES.md` for the full research writeup.

This kills the obvious quant-factor theses we'd normally reach for. Momentum, earnings-surprise, insider-buying-from-Form-4 — none of those can be driven from Cala alone. Our thesis has to leverage what Cala _is_ strong at: **qualitative, structural, relationship-driven reasoning about companies**.

## Thesis candidates (TBD — after booth chat)

_Pick one and commit, or invent a fifth. All must be explainable with Cala signals._

1. **Corporate-event driven** — spin-offs, subsidiary IPO announcements, M&A rumors, major product launches surfaced through `CorporateEvent` entities. Story: "Cala's graph flagged these structural events ahead of the market."
2. **Executive / relationship signal** — new CEO appointments, founder returns, board changes, cross-company director links. Story: "Leadership changes → operational inflection → price response."
3. **Regulatory / filings exposure** — companies newly affected by (or exempted from) a specific `Law` entity; rollups via the graph. Story: "Cala's verified regulatory knowledge surfaces winners of policy shifts."
4. **Supply-chain / subsidiary graph** — reason about a company through its parents, subsidiaries, suppliers, customers, partners. Story: "Who benefits when X does Y?" Pure graph-reasoning flex.
5. **???** — something weirder the Cala API makes uniquely possible.

**Gut pick to beat:** thesis #4 (supply-chain / subsidiary graph) is the most distinctively Cala-flavored and hardest for a non-graph-based competitor to replicate. It's also the most compatible with a multi-step agentic research loop, which plays to the Vercel AI SDK's strengths.

## Why this thesis (TBD)

We need to beat SPX **and** explain it with Cala data. That means whatever signal we pick should:

- Be present in Cala's verified knowledge but _not_ trivially available elsewhere
- Have point-in-time integrity (no lookahead) — the data we use must have been knowable on 2025-04-15
- Fit a concentrated-but-diversified 50-name portfolio

## Signals we're actually using (TBD)

_Fill in as the Cala API research agent comes back._

## Allocation rule (TBD)

Possible approaches:

- Equal weight ($20k × 50 = $1M). Simple, hard to mess up, explicitly mediocre.
- Rank-weighted (top-ranked names get more, min $5k floor).
- Conviction-weighted (agent assigns a score, we normalize to dollars).

## Risks / what could go wrong

- **Lookahead bias:** if Cala data for 2025-04-15 is actually "as-of today" we'd be cheating our own backtest.
- **Concentration blow-ups:** one bad $50k bet matters way more than one bad $5k bet.
- **NASDAQ-only skew:** the index is already tech-heavy; overweighting tech doesn't help us vs SPX.
- **Agent hallucination:** the LLM may "remember" winners from its training data. We need to force it to cite Cala signals.
