# Notes

> _Running scratchpad: decisions, open questions, things learned at the booth, commands that worked._
> _Newest on top. Feel free to be messy here._

## 2026-04-15

### Implementation notes

- ✅ Added `lib/cala.ts` with REST client wrappers for: `GET /v1/entities?name=...`, `GET /v1/entities/{id}/introspection`, and `POST /v1/entities/{id}` using typed responses, endpoint-specific normalization, and Cala API error handling.
- ✅ Added an Anthropic-backed Cala MCP agent path: `lib/cala-agent.ts` + `app/api/agent/route.ts` + homepage playground UI. Current test model is `claude-haiku-4-5`, talking to Cala over remote HTTP MCP with `X-API-KEY`.
- ✅ Tightened the agent output contract: report-first markdown with buy recommendations and `<entity UUID="...">...</entity>` tags for Cala-backed company citations.
- ✅ Switched the agent contract to validated structured output: submission payload + per-position records + cutoff audit + markdown report. `TEAM_ID` is now required server-side.
- ✅ Added `/api/submit` plus a UI submit button. The app can now POST the generated `submissionPayload` to the hackathon Convex endpoint and show the raw submission response in-page.

## 2026-04-15

### Decisions

- **Stack:** Next.js 16 (App Router, Turbopack) + TypeScript + Vercel AI SDK. Locked in.
- **OmniGraph: not using it.** Rust-binary graph DB, `curl | bash` install, custom `.pg`/`.gq` query files, no TS SDK. Zero leverage for a one-shot portfolio backtest; pure setup risk. [Landing page](https://www.omnigraph.dev/) · [Starters](https://github.com/ModernRelay/omnigraph-starters)
- **Scaffold:** `pnpm create next-app` with `--ts --tailwind --app --no-src-dir --turbopack`, then `pnpm add ai @ai-sdk/anthropic @ai-sdk/openai zod`.

### 🔥 Live probes of the Cala graph (2026-04-15, from `pnpm cala:sanity`)

_Much of what the earlier API research agent told us was theoretical. These are what the live endpoints actually return. Trust these over the theory._

**Probe 1 — `entity_search("Apple", entity_types=["Company"])`**

- Top 5 results are Apple Hospitality REIT, Apple Operations Mexico, Apple Canada, Six Apples Finance OÜ, Apple Spire India. **Apple Inc. does not appear.**
- Lesson: `entity_search` is fuzzy and **not ranked by market cap, centrality, or "how famous"**. Don't rely on "top hit" being the canonical public company.

**Probe 2 — `entity_search("NVIDIA")` and `entity_search("NVIDIA CORP")`**

- For "NVIDIA": top hit is _NVIDIA Brasil Computação Visual Limitada_ (subsidiary). NVIDIA CORP is 3rd. Microsoft Corp inexplicably 4th.
- For "NVIDIA CORP": top hit IS NVIDIA CORP. Searching with the full SEC legal name works.
- **Lesson: search with `legal_name`, not with ticker or casual name.**

**Probe 3 — `entity_introspection(NVIDIA_CORP_UUID)` → `5f7ca504-01d8-4aa9-b1ac-889202fd17c9`**

Populated fields on NVIDIA CORP:

- **Properties (13):** `bics`, `aliases`, `cik`, `lei`, `name`, `headquarters_address`, `employee_count`, `founding_date`, `description`, `esg_policy`, `legal_name`, `id`, `registered_address`
- **Relationships:** outgoing = `[IS_DIRECT_OWNER_OF, IS_ULTIMATE_PARENT_OF, LISTED_ON, IS_REGISTERED_IN, IS_BENEFICIARY_OWNER_OF, IS_AFFILIATE_OF, HAS_HEADQUARTERS_IN, HAS_PRIVATE_FUND, PARTICIPATES_IN_CORPORATE_EVENT, IS_DIRECT_PARENT_OF, ...]`, incoming = similar breadth.
- **🔥 numerical_observations → FinancialMetric is POPULATED.** Example observations on NVIDIA CORP:
  - `1d3eae40-0ba8-5baf-9907-6a4823b067bb` — "Cash and Cash Equivalents, at Carrying Value" · taxonomy=`us-gaap` · unit=`USD` · cadence=`i`
  - `db56d5ab-c493-5600-b0ec-ef5e4beada6b` — "Other Assets" · us-gaap · USD · `i`
  - ... plus more (list truncated in terminal output, explore more via MCP or a re-run)
- **Why this matters:** Cala ingests **SEC XBRL facts** (us-gaap taxonomy). That means _numerical, auditable, point-in-time financial data_ for real SEC filers — balance sheet, income statement, cash flow. Our "Cala is only qualitative" assumption was wrong.
- **Open question — MUST probe:** calling `retrieve_entity` with `numerical_observations: { FinancialMetric: [<uuid>] }` — does it return just the latest value, a full time series of reported values with filing dates, or something else? This determines whether Cala can be our **sole** data source or we still need a market-data API for returns.

**Probe 4 — `entity_introspection(APPLE_HOSPITALITY_REIT_UUID)`**

- Only 9 populated properties (no `cik`, no `numerical_observations`, no `employee_count`, no `esg_policy`). Confirms **field population is highly variable** by entity size/filer status. Smaller/foreign entities are nearly empty.
- **Lesson:** always introspect before retrieving; never hard-code a property list.

**Probe 5 — `retrieve_entity` response shape**

- By default relationships come back empty — you have to **explicitly request them in the query body** (`relationships: { outgoing: { IS_LISTED_ON: [...] } }`, shape TBD).
- Sources are rich: each property value carries a `sources[]` array with `name` (e.g. `GLEIF`, `SEC`), `document` (URL or {endpoint, params, response_hash}), and `date` (when Cala scraped it). Example: `"date": "2026-02-26"` — **a month old**, well past our 2025-04-15 start date. Look-ahead bias is real but at least the date is visible so we could filter.
- The `SEC` source on NVIDIA's `name` property points to `https://www.sec.gov/files/company_tickers.json` — **this is the canonical SEC ticker↔CIK↔name mapping, freely available as JSON.** We can fetch it ourselves and drive our Cala lookups from it: `ticker → CIK → resolve to Cala entity → introspect → retrieve`.
- Aliases contain ticker symbols! NVIDIA CORP aliases include `"NVDA"`, `"NVIDIA"`, `"NVIDIA Corporation"`, `"Nvidia"`, `"NVIDIA (NVDA)"`, `"NVIA"`. So once we have a Cala entity we can confirm its ticker; the reverse (ticker → entity) is less direct but doable via legal name or CIK.

### 📌 Cala staff guidance (from booth, 2026-04-15)

A Cala engineer at the booth told us to **focus on these three endpoints** — ignore `knowledge/search` and `knowledge/query` unless we have a reason to reach for them:

1. **Entity search** — `GET /v1/entities?name=...` → https://docs.cala.ai/api-reference/search-entities
2. **Entity introspection** — `GET /v1/entities/{id}/introspection` → https://docs.cala.ai/api-reference/entity-introspection
3. **Retrieve entity** — `POST /v1/entities/{id}` → https://docs.cala.ai/api-reference/entities

**Implied workflow:** start from a ticker/company name → `entity_search` to resolve to a UUID → `entity_introspection` to discover what fields/relationships/numerical_observations are actually populated for _that specific company_ → `retrieve_entity` to pull the fields we care about. No natural-language search, no dot-notation query language — just the graph primitives.

**For our build:** `lib/cala.ts` wraps these three first; `knowledge_search` / `knowledge_query` go in a "later / stretch" pile. The MCP tools `entity_search`, `entity_introspection`, `retrieve_entity` are the 1:1 equivalents if we swap transports.

### 🚨 Big finding: Cala is a knowledge graph, not a trading API

Full API research lives in the agent's report; the load-bearing facts:

- **Submission is not on Cala's public API.** Portfolio submit uses the hackathon Convex endpoint and rules documented in [`LEADERBOARD.md`](./LEADERBOARD.md) (source: [Hacker Guide](https://cala-leaderboard.apps.rebolt.ai/guide)).
- **No market data in Cala.** Zero prices, OHLC, earnings, analyst ratings, insider transactions, or ownership data. Cala is entity-graph shaped: companies, people, filings-as-entities, relationships. Sources: **SEC EDGAR + GLEIF**. We need a second data source for prices (see task #8).
- **No point-in-time queries.** Cala always returns latest known facts. Sources carry a `date` (when Cala scraped it) but you can't ask "as of 2025-04-15". → real **look-ahead-bias** risk in our backtest.
- **Rate limits undocumented.** HTTP 429 returns `rate_limit_exceeded` with no published RPM. Assume tens/minute until we test.

### Cala MCP — connection snippets (verbatim from docs)

**Remote HTTP endpoint:** `https://api.cala.ai/mcp/` · **Auth:** `X-API-KEY` header, per-connection.

**Cursor** — `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "Cala": {
      "url": "https://api.cala.ai/mcp/",
      "headers": { "X-API-KEY": "YOUR_CALA_API_KEY" }
    }
  }
}
```

**VS Code** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "Cala": {
      "type": "http",
      "url": "https://api.cala.ai/mcp/",
      "headers": { "X-API-KEY": "YOUR_CALA_API_KEY" }
    }
  }
}
```

**Claude Desktop / any client without remote-MCP support** — use `mcp-remote` as a stdio bridge:

```json
{
  "mcpServers": {
    "Cala": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://api.cala.ai/mcp/",
        "--header",
        "X-API-KEY: YOUR_CALA_API_KEY"
      ]
    }
  }
}
```

**MCP tools (5, verbatim descriptions):**

| Tool                   | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `knowledge_search`     | Search for verified knowledge using natural language queries |
| `knowledge_query`      | Search for verified knowledge using structured query syntax  |
| `entity_search`        | Search entities by name with fuzzy matching                  |
| `entity_introspection` | Get the field schema for an entity by its UUID               |
| `retrieve_entity`      | Retrieve information about an entity by its UUID             |

**⚠️ OpenAI strict-mode gotcha (docs explicitly warn):** the MCP server uses dynamic JSON objects and is **incompatible with OpenAI's strict mode**. When using OpenAI-style tool-calling you must set `strict: false`. (Anthropic/Claude tool-calling is unaffected — no strict-schema requirement.)

### 🔴 Vercel AI SDK v6 dropped the MCP client

We installed `ai@6.0.161`. Grepping the package: **zero `mcp` exports.** The `experimental_createMCPClient` helper that shipped in `ai` v5 was removed in v6 and hasn't been re-added. There is no bundled `@modelcontextprotocol/sdk` either.

So **"wire Cala MCP into the Vercel AI SDK" is not one import** — it needs a transport layer we bring ourselves. Our realistic options:

1. **REST wrappers as AI SDK `tool()`s** (recommended). Cala's REST surface is exactly 5 endpoints with well-known shapes. Writing 5 thin tools with Zod schemas is ~50 lines, type-safe, zero extra processes, zero strict-mode workarounds, works with both Anthropic and OpenAI models. We lose MCP's auto-discovery but Cala isn't changing its 5 tools on us during a hackathon.
2. **Install `@modelcontextprotocol/sdk` manually** + write a small adapter that exposes MCP tools as AI SDK tools. More moving parts, buys us nothing over option 1 because the tools are fixed.
3. **Spawn `npx mcp-remote` as a subprocess** and use stdio transport. Extra process + extra failure mode, worst of the three.

**Decision (pending confirmation):** go with option 1 — REST wrappers exposed as AI SDK tools. We can still use the Cala MCP from Cursor / Claude Desktop while _building_, for human-driven research.

### Cala REST — copy-pasteable quickstart snippets

**JavaScript (from quickstart docs, verbatim):**

```javascript
const options = {
  method: 'POST',
  headers: { 'X-API-KEY': '<api-key>', 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: '<string>' }),
};
fetch('https://api.cala.ai/v1/knowledge/search', options)
  .then(res => res.json())
  .then(res => console.log(res));
```

**Python (from quickstart docs, verbatim):**

```python
import requests
url = "https://api.cala.ai/v1/knowledge/query"
query = "startups.location=Spain.funding>10M.funding<50M"
payload = { "input": query }
headers = {
    "X-API-KEY": "YOUR_API_KEY",
    "Content-Type": "application/json"
}
response = requests.post(url, json=payload, headers=headers)
print(response.json())
```

**Example response shape** (truncated):

```json
[
  { "name": "Luzia", "funding": "13M", "location": "Spain" },
  { "name": "Nomad Solar", "funding": "15M", "location": "Spain" }
]
```

### Cala API — what's actually there

- **Base URL:** `https://api.cala.ai`
- **Auth:** `X-API-KEY: <key>` header. Keys at https://console.cala.ai/api-keys. No OAuth.
- **REST endpoints (5 total):**
  - `POST /v1/knowledge/search` — NL questions; returns markdown answer + `explainability` + `context` (source docs) + `entities` (UUIDs). Body: `{"input": "..."}`
  - `POST /v1/knowledge/query` — structured dot-notation filtering, e.g. `companies.industry=fintech.founded_year>=2020`. Input field is literally `"input"` (not `"query"`)
  - `GET /v1/entities?name=...&entity_types=Company&limit=20` — fuzzy name search
  - `POST /v1/entities/{id}` — full entity profile (yes, POST — body optionally filters fields)
  - `GET /v1/entities/{id}/introspection` — schema for an entity's properties / relationships / `numerical_observations`
- **MCP server:** `https://api.cala.ai/mcp/` with `X-API-KEY` header. Native clients connect directly; for ones without remote-MCP support, `npx mcp-remote`. Tools (5): `knowledge_search`, `knowledge_query`, `entity_search`, `entity_introspection`, `retrieve_entity`. **Flexible JSON schemas** → for OpenAI tool-calling, `strict: false`; for Zod, be lenient.
- **Entity types** include: `Company`, `Person`, `Product`, `Industry`, `Law`, `GPE`, `CorporateEvent`
- **Apple example fields:** name, aliases, registered/HQ address, **cik** (SEC identifier!), lei (GLEIF), bics, legal_name, + relationships (parent/subsidiary, executives, CEO, founders)
- **The `numerical_observations` field** on introspection is the one unknown worth probing — might contain some time-series. Test with a real UUID.

### Useful links (keep these handy)

- Docs index: https://docs.cala.ai/llms.txt
- **Full docs dump:** https://docs.cala.ai/llms-full.txt (cached at `/tmp/llms-full.txt` from this session)
- OpenAPI spec: https://api.cala.ai/openapi.json (cached at `/tmp/openapi.json`)
- Quickstart: https://docs.cala.ai/quickstart
- MCP setup: https://docs.cala.ai/integrations/mcp
- Console / API keys: https://console.cala.ai/api-keys
- Support: heyeli@cala.ai
- **Hackathon guide (evaluation + submit API):** https://cala-leaderboard.apps.rebolt.ai/guide · local summary: [`LEADERBOARD.md`](./LEADERBOARD.md)

### Open questions (for the Cala booth — ask ASAP)

- [x] **Submission endpoint** — documented in [`LEADERBOARD.md`](./LEADERBOARD.md) (`POST …/api/submit`, JSON body, server-side validation)
- [ ] **Leaderboard endpoint** — how do we poll our current rank
- [ ] **Point-in-time / look-ahead** — is there any hackathon-only "as-of 2025-04-15" mode? Are we expected to pretend we don't know the future, or is it accepted that we do?
- [ ] **Rate limits** — actual RPM/RPD for hackathon keys (may be bumped)
- [ ] **Pricing** — free tier quota, is there a hackathon-sponsored key, is it unlimited as advertised?
- [ ] **NASDAQ universe** — does Cala expose a canonical list of NASDAQ-listed tickers? Try `companies.exchange=NASDAQ` but undocumented
- [ ] **Historical prices** — anywhere in the graph, or do we bring our own?
- [x] **Scoring** — ~50% leaderboard total value (vs SPY); ~50% qualitative (Cala-grounded rationale, per-stock explanation, no post–2025-04-15 market data). See [`LEADERBOARD.md`](./LEADERBOARD.md).

### Architectural implications

- Cala is a **reasoning tool**, not a feed. Use it during the agent's _research_ step to pull qualitative verified signals: executives, subsidiaries, corporate events, industry / regulatory context, CIK → SEC filings metadata.
- Use a **separate market-data source** for: (1) the 2025-04-15 NASDAQ universe, (2) prices to compute portfolio value. See task #8.
- Our trading thesis has to lean on what Cala is actually strong at: qualitative / structural / relationship-based reasoning. Pure quant factor models are off the table.

### TODO backlog

- [ ] 🚨 Talk to Cala booth (task #7 — blocker)
- [ ] Pick market-data source (task #8)
- [ ] Wire Cala MCP into Vercel AI SDK agent (task #9)
- [ ] Fill in `STRATEGY.md` with a concrete thesis (after booth chat)
- [ ] Write `lib/cala.ts` client + sanity test
- [ ] Local backtester so we know the score before we submit
- [ ] First leaderboard submission (even if bad)
