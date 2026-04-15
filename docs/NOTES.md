# Notes

> _Running scratchpad: decisions, open questions, things learned at the booth, commands that worked._
> _Newest on top. Feel free to be messy here._

## 2026-04-15

### Decisions

- **Stack:** Next.js 16 (App Router, Turbopack) + TypeScript + Vercel AI SDK. Locked in.
- **OmniGraph: not using it.** Rust-binary graph DB, `curl | bash` install, custom `.pg`/`.gq` query files, no TS SDK. Zero leverage for a one-shot portfolio backtest; pure setup risk. [Landing page](https://www.omnigraph.dev/) · [Starters](https://github.com/ModernRelay/omnigraph-starters)
- **Scaffold:** `pnpm create next-app` with `--ts --tailwind --app --no-src-dir --turbopack`, then `pnpm add ai @ai-sdk/anthropic @ai-sdk/openai zod`.

### 📌 Cala staff guidance (from booth, 2026-04-15)

A Cala engineer at the booth told us to **focus on these three endpoints** — ignore `knowledge/search` and `knowledge/query` unless we have a reason to reach for them:

1. **Entity search** — `GET /v1/entities?name=...` → https://docs.cala.ai/api-reference/search-entities
2. **Entity introspection** — `GET /v1/entities/{id}/introspection` → https://docs.cala.ai/api-reference/entity-introspection
3. **Retrieve entity** — `POST /v1/entities/{id}` → https://docs.cala.ai/api-reference/entities

**Implied workflow:** start from a ticker/company name → `entity_search` to resolve to a UUID → `entity_introspection` to discover what fields/relationships/numerical_observations are actually populated for _that specific company_ → `retrieve_entity` to pull the fields we care about. No natural-language search, no dot-notation query language — just the graph primitives.

**For our build:** `lib/cala.ts` wraps these three first; `knowledge_search` / `knowledge_query` go in a "later / stretch" pile. The MCP tools `entity_search`, `entity_introspection`, `retrieve_entity` are the 1:1 equivalents if we swap transports.

### 🚨 Big finding: Cala is a knowledge graph, not a trading API

Full API research lives in the agent's report; the load-bearing facts:

- **No submission endpoint in Cala's public API.** The hackathon submission/leaderboard infra is separate — we _must_ ask at the booth for the URL and payload before we can submit anything. This is a hard blocker for end-to-end.
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

### Open questions (for the Cala booth — ask ASAP)

- [ ] **Submission endpoint** — URL, auth, exact payload shape, dry-run / validation mode, resubmission rate cap
- [ ] **Leaderboard endpoint** — how do we poll our current rank
- [ ] **Point-in-time / look-ahead** — is there any hackathon-only "as-of 2025-04-15" mode? Are we expected to pretend we don't know the future, or is it accepted that we do?
- [ ] **Rate limits** — actual RPM/RPD for hackathon keys (may be bumped)
- [ ] **Pricing** — free tier quota, is there a hackathon-sponsored key, is it unlimited as advertised?
- [ ] **NASDAQ universe** — does Cala expose a canonical list of NASDAQ-listed tickers? Try `companies.exchange=NASDAQ` but undocumented
- [ ] **Historical prices** — anywhere in the graph, or do we bring our own?
- [ ] **Scoring** — absolute return? Sharpe? Max drawdown? Narrative?

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
