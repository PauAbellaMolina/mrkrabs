# Hackathon leaderboard & evaluation

**Canonical source (keep in sync):** [Hacker Guide — The Lobster of Wall Street: AI Version](https://cala-leaderboard.apps.rebolt.ai/guide)

This page is for coding agents: how submissions are scored, what the API enforces, and where humans register. If the live guide disagrees with this file, trust the URL.

---

## Challenge setup (what “good” means)

- **Capital:** $1,000,000 to allocate across **at least 50** distinct NASDAQ-listed stocks.
- **Per-name minimum:** **$5,000** per ticker (each `amount` in the submission).
- **Per-name uniqueness:** each `nasdaq_code` appears **once** (case-insensitive).
- **Budget:** sum of all `amount` values must equal **exactly 1,000,000**.
- **Purchase prices:** fixed at the **closing price on April 15, 2025** (server-side when you submit).
- **Marked-to-market:** portfolio value uses **today’s** prices (the guide frames “today” as the live evaluation date, e.g. April 15, 2026 in the published example).
- **Baseline:** passive **S&P 500 (SPY)** buy-and-hold — you are expected to **beat** it on the leaderboard.
- **Look-ahead / leakage rule:** the agent must **not** use stock prices or market events **after April 15, 2025**. Research signal should come from fundamentals, Cala knowledge, and strategy — not hindsight.

**Cala** is mandatory as the knowledge layer (REST or MCP); submission and scoring are **not** part of Cala’s core product API — they use the hackathon endpoints below.

---

## How portfolio value is computed

For each holding:

1. `shares = amount / purchase_price` (purchase_price = Apr 15, 2025 close, from the server).
2. `position_value = shares * eval_price` (today’s price from the server).

**Total portfolio value** = sum of all position values. Leaderboard ranks teams by **highest total value first**.

---

## Winning criteria (two parts)

1. **~50% — Quantitative:** leaderboard position / total portfolio value (vs SPY baseline).
2. **~50% — Qualitative:** judges look for:
   - Clear, **data-driven** rationale powered by **Cala’s knowledge APIs**;
   - An agent that can **explain why** each stock was chosen;
   - **No** use of market data or news **after April 15, 2025**.

---

## Human / team setup

| Step | Detail |
| --- | --- |
| Register | [Team registration](https://cala-leaderboard.apps.rebolt.ai/register) — team name, profile pic, emails → you receive a **`team_id`** slug for every submission. |
| API key | Cala API key arrives by email after registration (`X-API-KEY` on Cala calls). |
| Live board | [cala-leaderboard.apps.rebolt.ai](https://cala-leaderboard.apps.rebolt.ai/) |

---

## Submission API (Convex)

**Endpoint**

```http
POST https://different-cormorant-663.convex.site/api/submit
Content-Type: application/json
```

**Body (top-level)**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `team_id` | string | Yes | Team slug from registration. |
| `model_agent_name` | string | Yes | Name of the model or agent. |
| `model_agent_version` | string | Yes | Version string (e.g. `v1.0`). |
| `transactions` | array | Yes | Investment objects (see below). |

**`transactions[]` object**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `nasdaq_code` | string | Yes | NASDAQ ticker (e.g. `AAPL`). Case-insensitive. |
| `amount` | number | Yes | USD to invest; must be **> 0**. |

**Validation:** all rules are **enforced server-side**. Invalid body → **400** with a descriptive message (duplicate tickers, wrong total, fewer than 50 names, any amount below 5000, unknown team, bad ticker / price fetch, etc.).

**Successful response (shape from guide):** includes `submission_id`, `total_invested`, `total_value`, `purchase_prices_apr15`, `eval_prices_today`.

You may **resubmit** freely; submissions show on the leaderboard (experimentation is expected).

---

## Cala capabilities (from the guide)

Agents use Cala for **verified** company knowledge — not for scraping arbitrary sites.

| Tool / surface | Use when |
| --- | --- |
| Entity search | Resolve company/person by name → UUID. |
| Entity introspection | Discover queryable properties, relationships, numerical observations for a UUID. |
| Retrieve entity | Pull chosen fields/relationships for a known UUID. |
| `knowledge_query` | Structured filters (dot-notation), e.g. sector/fundamental cuts. |
| `knowledge_search` | Natural-language questions with synthesized answers. |

REST examples and MCP config (`https://api.cala.ai/mcp/` + `X-API-KEY`) are in the [official guide](https://cala-leaderboard.apps.rebolt.ai/guide) and [Cala MCP docs](https://docs.cala.ai/integrations/mcp).

---

## Agent checklist before submit

- [ ] ≥ 50 unique NASDAQ tickers, each ≥ $5,000, total exactly $1,000,000.
- [ ] Research and features respect the **April 15, 2025** cutoff (no post-cutoff market data in the signal).
- [ ] Rationale is **Cala-grounded** and explainable (qualitative half of the score).
- [ ] `team_id`, `model_agent_name`, and `model_agent_version` filled correctly.

---

## Prizes (FYI)

Documented on the guide: top team gets travel grant + Cala credits + case study; runner-up credits; participants get swag. Details may change — see the live guide.
