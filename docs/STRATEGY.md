# Strategy

> _Our trading thesis and the Cala signals we lean on. Fill in as we learn what data is available._

## What Cala actually gives us (verified via live probes — see NOTES.md "Live probes")

Cala is an entity knowledge graph over **SEC EDGAR + GLEIF**. Our earlier "no quant data" take was wrong. Confirmed by poking NVIDIA CORP live:

- **Properties** — `cik`, `lei`, `legal_name`, `headquarters_address`, `employee_count`, `founding_date`, `bics`, `esg_policy`, plus relationships
- **🔥 `numerical_observations.FinancialMetric`** — XBRL `us-gaap` facts (Cash and Cash Equivalents, Other Assets, etc.). Shape of a _specific_ metric retrieval (scalar vs time-series) is not yet probed — see task #10
- **Rich relationships** — `LISTED_ON`, `IS_ULTIMATE_PARENT_OF`, `IS_DIRECT_OWNER_OF`, `IS_AFFILIATE_OF`, `PARTICIPATES_IN_CORPORATE_EVENT`, `HAS_PRIVATE_FUND`, more

Cala **still** does not give us prices / returns directly. We need at minimum a reference file for market values on 2025-04-15 and 2026-04-15 to compute P&L. But the signals that _inform_ the buy decision can plausibly live entirely in Cala.

**Constraint:** field population is sparse for smaller / foreign / non-SEC-filer entities. A REIT had 9 properties and zero FinancialMetrics; NVIDIA CORP had 13 and a FinancialMetric list. Our universe should skew toward large SEC-registered US filers — which matches the challenge's "NASDAQ-listed" requirement anyway.

## Thesis candidates (TBD — after booth chat)

_Pick one and commit, or invent a fifth. All must be explainable with Cala signals._

1. **Corporate-event driven** — spin-offs, subsidiary IPO announcements, M&A rumors, major product launches surfaced through `CorporateEvent` entities. Story: "Cala's graph flagged these structural events ahead of the market."
2. **Executive / relationship signal** — new CEO appointments, founder returns, board changes, cross-company director links. Story: "Leadership changes → operational inflection → price response."
3. **Regulatory / filings exposure** — companies newly affected by (or exempted from) a specific `Law` entity; rollups via the graph. Story: "Cala's verified regulatory knowledge surfaces winners of policy shifts."
4. **Supply-chain / subsidiary graph** — reason about a company through its parents, subsidiaries, suppliers, customers, partners. Story: "Who benefits when X does Y?" Pure graph-reasoning flex.
5. **???** — something weirder the Cala API makes uniquely possible.

**Gut pick to beat:** thesis #4 (supply-chain / subsidiary graph) is the most distinctively Cala-flavored and hardest for a non-graph-based competitor to replicate. It's also the most compatible with a multi-step agentic research loop, which plays to the Vercel AI SDK's strengths.

**Alternative to consider** (pending task #10 probe): if `FinancialMetric` retrieval returns a time series, we could build a **fundamentals-at-reasonable-price** quant screen — rank companies by, e.g., cash growth, low debt, steady employee count, using only Cala's us-gaap facts. Less storytelling, more defensible. Gate this decision on what the FinancialMetric probe actually returns.

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
