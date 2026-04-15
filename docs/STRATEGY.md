# Strategy

> _Committed thesis and the exact Cala-native signal design we want the agent to execute._

## Locked thesis

Our single thesis is:

**Favor NASDAQ companies whose filing-linked legal-entity graph is simple, or getting simpler, as of 2025-04-15.**

The core idea is not "find bullish stories in Cala." The core idea is:

1. use Cala's entity graph to reconstruct legal-entity complexity from annual-filing-linked company structure
2. rank companies by low complexity and improving complexity
3. use Cala again to explain the picks with dated, filing-backed evidence

We are explicitly **not** asking the agent to choose between competing thesis families at runtime.

## Why this is the Cala-native edge

This thesis is the cleanest fit for Cala because it leans on what Cala is best at:

- typed company entities
- parent / subsidiary / control relationships
- jurisdictions and legal registrations
- source provenance on graph facts
- annual-filing-shaped company structure

It is also the safest thesis against look-ahead bias because it can be anchored to the latest annual filing available on or before **2025-04-15**, rather than to open-ended narrative/event knowledge that may have been enriched later.

## Signal definition

For each eligible NASDAQ company, the agent should try to build two filing-linked snapshots:

1. `current_snapshot`: the latest annual filing available on or before `2025-04-15`
2. `prior_snapshot`: the immediately previous annual filing

From those snapshots, extract:

- `subsidiaryCount`
- `jurisdictionCount`
- `hierarchyDepth`
- dated source evidence tying the structure to pre-cutoff filings

The operational score is:

```text
ComplexityScore =
  0.50 * log(1 + subsidiaryCount) +
  0.30 * log(1 + jurisdictionCount) +
  0.20 * hierarchyDepth
```

Selection prefers:

- lower current complexity
- negative `complexityChangeVsPrior` (improving / simplifying)
- stronger dated filing evidence

If the agent cannot retrieve filing-linked evidence for those fields, it should exclude the company rather than substitute another thesis.

## What the agent may and may not use

Primary ranking signal:

- filings / entity-relationship complexity only

Allowed as secondary support or risk notes only:

- executive changes
- corporate events
- regulatory/law context
- supply-chain / partner / affiliate context
- XBRL financial metrics

Those can help explain or break ties, but they must **not** become the main ranking logic.

## Portfolio construction

Default construction is intentionally simple:

- exactly 50 names
- equal weight
- `$20,000` per name

This keeps the submission focused on **selection edge**, not on optimizer noise.

## Time-cutoff discipline

The agent must treat Cala as a latest-known graph unless a fact can be tied to dated pre-cutoff provenance.

Required rules:

- never use a filing submitted after `2025-04-15`
- never use post-cutoff market outcomes
- prefer entity-search -> introspection -> targeted retrieval over natural-language search
- verify the final selected names manually against filing-linked evidence where possible

## Risks / failure modes

- **False simplification:** entity-tree shrinkage may reflect distress rather than healthy focus.
- **Legitimate complexity:** some excellent global businesses are structurally complex for good reasons.
- **Sparse coverage:** smaller or unusual filers may not have enough graph coverage to score safely.
- **Graph backfill:** old-looking facts may still have been ingested later, so source dates matter.

## Steering implications for the agent

The prompts and schemas should force this workflow:

1. resolve company -> UUID
2. introspect populated company structure
3. retrieve filing-linked structural evidence
4. compute / record complexity features
5. rank on the fixed thesis
6. only then generate the narrative
