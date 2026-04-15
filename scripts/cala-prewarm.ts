// Pre-warm the Cala tool cache on a fresh machine.
//
// Runs entity_search for a curated list of ~100 top NASDAQ tickers via the
// same MCP tool path the agent uses, so every call lands in the shared
// cache keyed by (toolName, argsHash). After this runs once, iteration 1
// of the next autoresearch session skips the discovery wave entirely —
// the model's entity_search calls hit the disk cache instead of Cala.
//
// Usage:
//   pnpm cala:prewarm
//
// Idempotent. Re-running produces cache hits (no extra Cala API spend).

import { createMCPClient } from "@ai-sdk/mcp";
import { persistCacheToDisk, wrapToolsWithCache } from "../lib/cala-tool-cache";

const CALA_MCP_URL =
  process.env.CALA_MCP_URL?.trim() || "https://api.cala.ai/mcp/";

// ~100 large/mid-cap NASDAQ names that recur across autoresearch iterations.
// Hand-picked to cover the sectors the filing-linked complexity thesis
// typically surfaces. Not an exhaustive universe — the agent can still
// search for anything not in this list.
const SEED_TICKERS: string[] = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO",
  "COST", "NFLX", "AMD", "ADBE", "PEP", "CSCO", "INTC", "TMUS", "QCOM",
  "INTU", "TXN", "CMCSA", "AMGN", "HON", "BKNG", "ISRG", "AMAT", "SBUX",
  "VRTX", "ADP", "PANW", "GILD", "MDLZ", "LRCX", "REGN", "MU", "ADI",
  "PYPL", "KLAC", "SNPS", "CDNS", "CRWD", "CSX", "ABNB", "MAR", "MRVL",
  "ORLY", "FTNT", "ASML", "MELI", "CHTR", "WDAY", "PCAR", "PDD", "ROP",
  "MNST", "NXPI", "ADSK", "KDP", "DASH", "AEP", "CTAS", "PAYX", "FAST",
  "ODFL", "AZN", "CPRT", "EA", "EXC", "TEAM", "DDOG", "GEHC", "KHC",
  "XEL", "VRSK", "FANG", "BIIB", "ZS", "MCHP", "IDXX", "DXCM", "ANSS",
  "CCEP", "WBD", "ON", "ILMN", "TTD", "CDW", "MDB", "LULU", "WBA",
  "CSGP", "GFS", "SIRI", "SPLK", "NTES", "JD", "LI", "BIDU", "ATVI",
];

const ENTITY_TYPES = ["Company"] as const;

async function main() {
  if (!process.env.CALA_API_KEY) {
    console.error("[cala-prewarm] CALA_API_KEY is required");
    process.exit(1);
  }

  console.info(
    `[cala-prewarm] resolving ${SEED_TICKERS.length} NASDAQ tickers → Cala UUIDs`,
  );

  const client = await createMCPClient({
    transport: {
      type: "http",
      url: CALA_MCP_URL,
      headers: { "X-API-KEY": process.env.CALA_API_KEY!.trim() },
    },
  });

  try {
    const tools = await client.tools();
    wrapToolsWithCache(tools);

    const entitySearch = tools["entity_search"];
    if (!entitySearch || typeof entitySearch.execute !== "function") {
      throw new Error(
        "Cala MCP server did not expose entity_search — can't pre-warm.",
      );
    }

    let resolved = 0;
    let failed = 0;

    // Fire all searches in parallel. The cache layer memoizes each result
    // on success, persistCacheToDisk flushes once at the end.
    await Promise.all(
      SEED_TICKERS.map(async (ticker) => {
        try {
          await entitySearch.execute(
            {
              name: ticker,
              entity_types: ENTITY_TYPES,
              limit: 3,
            },
            // AI SDK tool execute signature expects a second "options" arg;
            // MCP tools don't use it but we pass an empty object to be safe.
            {},
          );
          resolved += 1;
        } catch (error) {
          failed += 1;
          console.warn(
            `[cala-prewarm] ${ticker} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );

    console.info(
      `[cala-prewarm] done — ${resolved} resolved, ${failed} failed`,
    );
  } finally {
    await client.close().catch(() => undefined);
    persistCacheToDisk();
  }
}

main().catch((error) => {
  console.error("[cala-prewarm] fatal", error);
  process.exit(1);
});
