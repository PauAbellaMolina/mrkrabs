// Expand the research universe by querying Cala directly for NASDAQ companies.
// No LLM involved — pure API calls + complexity score computation.
//
// Usage: node --env-file=.env.local --import tsx scripts/expand-universe.ts
//
// Fetches entity data for ~300 NASDAQ tickers, computes complexity scores,
// merges with the existing universe, and saves the result. Uses the Cala
// tool cache for deduplication so re-runs are fast.

import { createCalaClient } from "../lib/cala";
import {
  hasResearchUniverse,
  loadResearchUniverse,
  type ResearchedCompany,
} from "../lib/research-universe";
import fs from "node:fs";
import path from "node:path";

const UNIVERSE_FILE = path.join(process.cwd(), "data", "research-universe.json");

// Large NASDAQ tickers to research. Covers NASDAQ-100 + extended large/mid caps.
const NASDAQ_TICKERS: Array<{ ticker: string; name: string }> = [
  { ticker: "AAPL", name: "Apple Inc" },
  { ticker: "ABNB", name: "Airbnb Inc" },
  { ticker: "ADBE", name: "Adobe Inc" },
  { ticker: "ADI", name: "Analog Devices Inc" },
  { ticker: "ADP", name: "Automatic Data Processing" },
  { ticker: "ADSK", name: "Autodesk Inc" },
  { ticker: "AEP", name: "American Electric Power" },
  { ticker: "ALGN", name: "Align Technology" },
  { ticker: "AMAT", name: "Applied Materials" },
  { ticker: "AMD", name: "Advanced Micro Devices" },
  { ticker: "AMGN", name: "Amgen Inc" },
  { ticker: "AMZN", name: "Amazon.com Inc" },
  { ticker: "ANSS", name: "ANSYS Inc" },
  { ticker: "APP", name: "AppLovin Corporation" },
  { ticker: "ARM", name: "Arm Holdings" },
  { ticker: "ASML", name: "ASML Holding" },
  { ticker: "AVGO", name: "Broadcom Inc" },
  { ticker: "AZN", name: "AstraZeneca" },
  { ticker: "BIIB", name: "Biogen Inc" },
  { ticker: "BKNG", name: "Booking Holdings" },
  { ticker: "BKR", name: "Baker Hughes" },
  { ticker: "CCEP", name: "Coca-Cola Europacific Partners" },
  { ticker: "CDNS", name: "Cadence Design Systems" },
  { ticker: "CDW", name: "CDW Corporation" },
  { ticker: "CEG", name: "Constellation Energy" },
  { ticker: "CHTR", name: "Charter Communications" },
  { ticker: "CMCSA", name: "Comcast Corporation" },
  { ticker: "COIN", name: "Coinbase Global" },
  { ticker: "COST", name: "Costco Wholesale" },
  { ticker: "CPRT", name: "Copart Inc" },
  { ticker: "CRWD", name: "CrowdStrike Holdings" },
  { ticker: "CSCO", name: "Cisco Systems" },
  { ticker: "CSGP", name: "CoStar Group" },
  { ticker: "CTAS", name: "Cintas Corporation" },
  { ticker: "CTSH", name: "Cognizant Technology Solutions" },
  { ticker: "DASH", name: "DoorDash Inc" },
  { ticker: "DDOG", name: "Datadog Inc" },
  { ticker: "DLTR", name: "Dollar Tree" },
  { ticker: "DXCM", name: "DexCom Inc" },
  { ticker: "EA", name: "Electronic Arts" },
  { ticker: "EBAY", name: "eBay Inc" },
  { ticker: "ENPH", name: "Enphase Energy" },
  { ticker: "EXC", name: "Exelon Corporation" },
  { ticker: "FANG", name: "Diamondback Energy" },
  { ticker: "FAST", name: "Fastenal Company" },
  { ticker: "FTNT", name: "Fortinet Inc" },
  { ticker: "GEHC", name: "GE HealthCare Technologies" },
  { ticker: "GFS", name: "GlobalFoundries" },
  { ticker: "GILD", name: "Gilead Sciences" },
  { ticker: "GOOGL", name: "Alphabet Inc" },
  { ticker: "HON", name: "Honeywell International" },
  { ticker: "IDXX", name: "IDEXX Laboratories" },
  { ticker: "ILMN", name: "Illumina Inc" },
  { ticker: "INTC", name: "Intel Corporation" },
  { ticker: "INTU", name: "Intuit Inc" },
  { ticker: "ISRG", name: "Intuitive Surgical" },
  { ticker: "KDP", name: "Keurig Dr Pepper" },
  { ticker: "KHC", name: "Kraft Heinz Company" },
  { ticker: "KLAC", name: "KLA Corporation" },
  { ticker: "LIN", name: "Linde plc" },
  { ticker: "LRCX", name: "Lam Research" },
  { ticker: "LULU", name: "Lululemon Athletica" },
  { ticker: "MAR", name: "Marriott International" },
  { ticker: "MCHP", name: "Microchip Technology" },
  { ticker: "MDB", name: "MongoDB Inc" },
  { ticker: "MDLZ", name: "Mondelez International" },
  { ticker: "MELI", name: "MercadoLibre Inc" },
  { ticker: "META", name: "Meta Platforms" },
  { ticker: "MNST", name: "Monster Beverage" },
  { ticker: "MRNA", name: "Moderna Inc" },
  { ticker: "MRVL", name: "Marvell Technology" },
  { ticker: "MSFT", name: "Microsoft Corporation" },
  { ticker: "MU", name: "Micron Technology" },
  { ticker: "NFLX", name: "Netflix Inc" },
  { ticker: "NVDA", name: "NVIDIA Corporation" },
  { ticker: "NXPI", name: "NXP Semiconductors" },
  { ticker: "ODFL", name: "Old Dominion Freight Line" },
  { ticker: "ON", name: "ON Semiconductor" },
  { ticker: "ORCL", name: "Oracle Corporation" },
  { ticker: "ORLY", name: "O'Reilly Automotive" },
  { ticker: "PANW", name: "Palo Alto Networks" },
  { ticker: "PAYX", name: "Paychex Inc" },
  { ticker: "PCAR", name: "PACCAR Inc" },
  { ticker: "PDD", name: "PDD Holdings" },
  { ticker: "PEP", name: "PepsiCo Inc" },
  { ticker: "PLTR", name: "Palantir Technologies" },
  { ticker: "PYPL", name: "PayPal Holdings" },
  { ticker: "QCOM", name: "Qualcomm Inc" },
  { ticker: "REGN", name: "Regeneron Pharmaceuticals" },
  { ticker: "RIVN", name: "Rivian Automotive" },
  { ticker: "ROST", name: "Ross Stores" },
  { ticker: "SBUX", name: "Starbucks Corporation" },
  { ticker: "SHOP", name: "Shopify Inc" },
  { ticker: "SMCI", name: "Super Micro Computer" },
  { ticker: "SNPS", name: "Synopsys Inc" },
  { ticker: "SNOW", name: "Snowflake Inc" },
  { ticker: "TEAM", name: "Atlassian Corporation" },
  { ticker: "TMUS", name: "T-Mobile US" },
  { ticker: "TSLA", name: "Tesla Inc" },
  { ticker: "TTD", name: "The Trade Desk" },
  { ticker: "TTWO", name: "Take-Two Interactive" },
  { ticker: "TXN", name: "Texas Instruments" },
  { ticker: "VRSK", name: "Verisk Analytics" },
  { ticker: "VRTX", name: "Vertex Pharmaceuticals" },
  { ticker: "WBD", name: "Warner Bros. Discovery" },
  { ticker: "WDAY", name: "Workday Inc" },
  { ticker: "XEL", name: "Xcel Energy" },
  { ticker: "ZS", name: "Zscaler Inc" },
  // Additional mid-caps often in Cala's graph
  { ticker: "AKAM", name: "Akamai Technologies" },
  { ticker: "ALGM", name: "Allegro MicroSystems" },
  { ticker: "BILL", name: "BILL Holdings" },
  { ticker: "BMRN", name: "BioMarin Pharmaceutical" },
  { ticker: "CELH", name: "Celsius Holdings" },
  { ticker: "CHRW", name: "C.H. Robinson Worldwide" },
  { ticker: "CSGP", name: "CoStar Group" },
  { ticker: "DKNG", name: "DraftKings Inc" },
  { ticker: "DOCU", name: "DocuSign Inc" },
  { ticker: "DXCM", name: "DexCom Inc" },
  { ticker: "EXPE", name: "Expedia Group" },
  { ticker: "FICO", name: "Fair Isaac Corporation" },
  { ticker: "FOX", name: "Fox Corporation" },
  { ticker: "GRAB", name: "Grab Holdings" },
  { ticker: "HOOD", name: "Robinhood Markets" },
  { ticker: "ICLR", name: "ICON plc" },
  { ticker: "LPLA", name: "LPL Financial" },
  { ticker: "LSCC", name: "Lattice Semiconductor" },
  { ticker: "MKTX", name: "MarketAxess Holdings" },
  { ticker: "MPWR", name: "Monolithic Power Systems" },
  { ticker: "NDAQ", name: "Nasdaq Inc" },
  { ticker: "NTAP", name: "NetApp Inc" },
  { ticker: "NTES", name: "NetEase Inc" },
  { ticker: "OKTA", name: "Okta Inc" },
  { ticker: "PCTY", name: "Paylocity Holding" },
  { ticker: "PINS", name: "Pinterest Inc" },
  { ticker: "PODD", name: "Insulet Corporation" },
  { ticker: "RPRX", name: "Royalty Pharma" },
  { ticker: "SIRI", name: "Sirius XM Holdings" },
  { ticker: "SPLK", name: "Splunk Inc" },
  { ticker: "SWKS", name: "Skyworks Solutions" },
  { ticker: "TRMB", name: "Trimble Inc" },
  { ticker: "UBER", name: "Uber Technologies" },
  { ticker: "VRSN", name: "VeriSign Inc" },
  { ticker: "VTRS", name: "Viatris Inc" },
  { ticker: "WBA", name: "Walgreens Boots Alliance" },
  { ticker: "ZBRA", name: "Zebra Technologies" },
  { ticker: "ZM", name: "Zoom Video Communications" },
  { ticker: "ZTO", name: "ZTO Express" },
];

function computeComplexity(subs: number, jur: number, depth: number): number {
  return 0.5 * Math.log(1 + subs) + 0.3 * Math.log(1 + jur) + 0.2 * depth;
}

function extractRelationshipCount(
  raw: Record<string, unknown>,
  relType: string,
): number {
  const relationships = raw.relationships as Record<string, unknown> | undefined;
  if (!relationships) return 0;
  const outgoing = relationships.outgoing as Record<string, unknown[]> | undefined;
  if (!outgoing) return 0;
  const entries = outgoing[relType];
  return Array.isArray(entries) ? entries.length : 0;
}

function extractJurisdictionCount(raw: Record<string, unknown>): number {
  const relationships = raw.relationships as Record<string, unknown> | undefined;
  if (!relationships) return 0;
  const outgoing = relationships.outgoing as Record<string, unknown[]> | undefined;
  if (!outgoing) return 0;
  const registered = outgoing["IS_REGISTERED_IN"];
  return Array.isArray(registered) ? registered.length : 0;
}

function extractFilingDate(raw: Record<string, unknown>): string | null {
  // Look for filing dates in properties.sources
  const props = raw.properties as Record<string, unknown> | undefined;
  if (!props) return null;
  // Check common date-bearing properties
  for (const key of ["founding_date", "legal_name", "name"]) {
    const prop = props[key] as { sources?: Array<{ date?: string }> } | undefined;
    if (prop?.sources) {
      for (const src of prop.sources) {
        if (src.date && src.date <= "2025-04-15") return src.date;
      }
    }
  }
  return null;
}

const BATCH_SIZE = 3;
const DELAY_MS = 2000;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const client = createCalaClient({ timeoutMs: 30000 });

  // Load existing universe
  const existing = hasResearchUniverse() ? loadResearchUniverse() : [];
  const universe = new Map<string, ResearchedCompany>();
  for (const c of existing) {
    universe.set(c.ticker, c);
  }
  console.info(`[expand-universe] starting with ${universe.size} existing companies`);

  // Deduplicate the ticker list
  const seen = new Set(universe.keys());
  const toResearch = NASDAQ_TICKERS.filter((t) => !seen.has(t.ticker));
  console.info(`[expand-universe] ${toResearch.length} new tickers to research`);

  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < toResearch.length; i += BATCH_SIZE) {
    const batch = toResearch.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async ({ ticker, name }) => {
        // Step 1: entity_search to find the UUID
        const searchResult = await client.searchEntities({
          name,
          entityTypes: ["Company"],
          limit: 3,
        });

        const entity = searchResult.entities[0];
        if (!entity?.id) {
          console.warn(`  ${ticker}: no entity found for "${name}"`);
          return null;
        }

        // Step 2: retrieve_entity for full data
        const retrieved = await client.retrieveEntity(entity.id);
        const raw = retrieved.raw;

        const subsidiaryCount =
          extractRelationshipCount(raw, "IS_ULTIMATE_PARENT_OF") +
          extractRelationshipCount(raw, "IS_DIRECT_PARENT_OF");
        const jurisdictionCount = extractJurisdictionCount(raw);
        const hierarchyDepth = subsidiaryCount > 0 ? 1 : 0;
        const complexityScore = computeComplexity(
          subsidiaryCount,
          jurisdictionCount,
          hierarchyDepth,
        );

        const filingDate = extractFilingDate(raw) ?? "2025-01-01";

        const company: ResearchedCompany = {
          ticker,
          companyName: entity.name || name,
          entityId: entity.id,
          subsidiaryCount,
          jurisdictionCount,
          hierarchyDepth,
          complexityScore,
          complexityChangeVsPrior: null,
          currentAnnualFilingDate: filingDate,
          priorAnnualFilingDate: null,
          evidence: [
            `entity_search: resolved as ${entity.name} (${entity.id})`,
            `retrieve_entity: ${subsidiaryCount} subsidiaries, ${jurisdictionCount} jurisdictions`,
          ],
        };

        return company;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        universe.set(result.value.ticker, result.value);
        fetched++;
      } else if (result.status === "rejected") {
        failed++;
      }
    }

    const progress = Math.min(i + BATCH_SIZE, toResearch.length);
    console.info(
      `[expand-universe] ${progress}/${toResearch.length} processed (${fetched} new, ${failed} failed) — universe: ${universe.size}`,
    );

    if (i + BATCH_SIZE < toResearch.length) {
      await sleep(DELAY_MS);
    }
  }

  // Save
  const sorted = [...universe.values()].sort(
    (a, b) => a.complexityScore - b.complexityScore,
  );
  const dir = path.dirname(UNIVERSE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(UNIVERSE_FILE, JSON.stringify(sorted, null, 2), "utf8");

  console.info(
    `[expand-universe] done — ${sorted.length} companies saved (${fetched} new from Cala, ${failed} failed)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
