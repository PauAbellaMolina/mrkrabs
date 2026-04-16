import fs from "node:fs";
import path from "node:path";
import type { PortfolioPosition } from "./portfolio-schema";

// Pre-researched company data that persists across autoresearch iterations.
// Built from the positions of any successful portfolio run. When injected
// into the agent's prompt, the agent skips entity_search/introspection/
// retrieve_entity entirely and goes straight to ranking + submit_portfolio,
// cutting iteration time from ~30 min to ~3 min.

const UNIVERSE_FILE = path.join(process.cwd(), "data", "research-universe.json");

export interface ResearchedCompany {
  ticker: string;
  companyName: string;
  entityId: string;
  subsidiaryCount: number;
  jurisdictionCount: number;
  hierarchyDepth: number;
  complexityScore: number;
  complexityChangeVsPrior: number | null;
  currentAnnualFilingDate: string;
  priorAnnualFilingDate: string | null;
  evidence: string[];
}

export function hasResearchUniverse(): boolean {
  return fs.existsSync(UNIVERSE_FILE);
}

export function loadResearchUniverse(): ResearchedCompany[] {
  if (!fs.existsSync(UNIVERSE_FILE)) return [];
  const raw = fs.readFileSync(UNIVERSE_FILE, "utf8");
  return JSON.parse(raw) as ResearchedCompany[];
}

export function saveResearchUniverse(positions: PortfolioPosition[]): void {
  // Merge with existing universe — never shrink, only grow or update.
  const existing = fs.existsSync(UNIVERSE_FILE)
    ? (JSON.parse(fs.readFileSync(UNIVERSE_FILE, "utf8")) as ResearchedCompany[])
    : [];
  const merged = new Map<string, ResearchedCompany>();
  for (const c of existing) merged.set(c.ticker, c);
  for (const p of positions) {
    const key = p.nasdaqCode.toUpperCase();
    if (merged.has(key)) continue;
    merged.set(key, {
      ticker: key,
      companyName: p.companyName,
      entityId: p.companyEntityId,
      subsidiaryCount: p.subsidiaryCount,
      jurisdictionCount: p.jurisdictionCount,
      hierarchyDepth: p.hierarchyDepth,
      complexityScore: p.complexityScore,
      complexityChangeVsPrior: p.complexityChangeVsPrior,
      currentAnnualFilingDate: p.currentAnnualFilingDate,
      priorAnnualFilingDate: p.priorAnnualFilingDate,
      evidence: p.calaEvidence.slice(0, 3),
    });
  }
  const sorted = [...merged.values()].sort(
    (a, b) => a.complexityScore - b.complexityScore,
  );
  const dir = path.dirname(UNIVERSE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(UNIVERSE_FILE, JSON.stringify(sorted, null, 2), "utf8");
  console.info(
    `[research-universe] saved ${sorted.length} companies to ${UNIVERSE_FILE}`,
  );
}

export function buildUniversePromptBlock(
  companies: ResearchedCompany[],
): string {
  if (companies.length === 0) return "";

  const rows = companies.map(
    (c) =>
      `  ${c.ticker} | ${c.companyName} | entity=${c.entityId} | subs=${c.subsidiaryCount} jur=${c.jurisdictionCount} depth=${c.hierarchyDepth} | score=${c.complexityScore.toFixed(3)}${c.complexityChangeVsPrior != null ? ` Δ=${c.complexityChangeVsPrior.toFixed(3)}` : ""} | filing=${c.currentAnnualFilingDate}${c.priorAnnualFilingDate ? ` prior=${c.priorAnnualFilingDate}` : ""}`,
  );

  return [
    "",
    "=== PRE-RESEARCHED COMPANY UNIVERSE (SKIP ENTITY RESEARCH) ===",
    `${companies.length} NASDAQ companies have been pre-researched with verified Cala entity data.`,
    "DO NOT call entity_search, entity_introspection, or retrieve_entity for these companies.",
    "Use the data below directly for ranking, selection, and portfolio construction.",
    "You MAY call entity tools for companies NOT in this list if you need replacements.",
    "",
    "Ticker | Company | Entity UUID | Complexity Metrics | Filing Dates",
    ...rows,
    "",
    "=== YOUR TASK ===",
    "Apply the strategy rules to rank these companies, select the best 50,",
    "allocate $20,000 each, and call submit_portfolio immediately.",
    "Do NOT re-research companies already in the list above.",
  ].join("\n");
}
