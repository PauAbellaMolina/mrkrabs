// One-off script: extracts positions from all completed runs in Convex
// and saves a deduplicated research universe to data/research-universe.json.
//
// Usage: node --env-file=.env.local --import tsx scripts/build-universe.ts

import { api } from "../convex/_generated/api";
import { getConvexClient } from "../lib/convex-client";
import {
  saveResearchUniverse,
  type ResearchedCompany,
} from "../lib/research-universe";
import type { PortfolioPosition } from "../lib/portfolio-schema";

async function main() {
  const client = getConvexClient();
  const summaries = (await client.query(api.runs.listSummaries, {})) as Array<{
    id: string;
    status: string;
    positionCount: number;
    model?: string;
  }>;

  const completed = summaries.filter(
    (r) => r.status === "completed" && r.positionCount >= 50,
  );
  console.info(`[build-universe] found ${completed.length} completed runs with 50+ positions`);

  const allCompanies = new Map<string, ResearchedCompany>();

  for (const run of completed) {
    try {
      const record = await client.query(api.runs.getByRunId, {
        runId: run.id,
      });
      const positions = (record as { result?: { output?: { positions?: PortfolioPosition[] } } })
        ?.result?.output?.positions;
      if (!positions?.length) continue;

      for (const p of positions) {
        const key = p.nasdaqCode.toUpperCase();
        if (allCompanies.has(key)) continue;
        allCompanies.set(key, {
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
      console.info(
        `  run ${run.id.slice(0, 8)} (${run.model}): ${positions.length} positions → universe now ${allCompanies.size} unique`,
      );
    } catch (e) {
      console.warn(`  run ${run.id.slice(0, 8)}: failed to read —`, e instanceof Error ? e.message : e);
    }
  }

  if (allCompanies.size === 0) {
    console.error("[build-universe] no positions found in any run");
    process.exit(1);
  }

  // saveResearchUniverse expects PortfolioPosition[], build minimal ones
  const fakePositions: PortfolioPosition[] = [...allCompanies.values()].map((c) => ({
    nasdaqCode: c.ticker,
    companyName: c.companyName,
    companyEntityId: c.entityId,
    amount: 20000,
    thesis: "",
    currentAnnualFilingDate: c.currentAnnualFilingDate,
    priorAnnualFilingDate: c.priorAnnualFilingDate,
    subsidiaryCount: c.subsidiaryCount,
    jurisdictionCount: c.jurisdictionCount,
    hierarchyDepth: c.hierarchyDepth,
    complexityScore: c.complexityScore,
    complexityChangeVsPrior: c.complexityChangeVsPrior,
    calaEvidence: c.evidence,
    supportingEntityIds: [],
    riskNotes: [""],
    cutoffComplianceNote: "",
  }));

  saveResearchUniverse(fakePositions);
  console.info(`[build-universe] done — ${allCompanies.size} unique companies saved`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
