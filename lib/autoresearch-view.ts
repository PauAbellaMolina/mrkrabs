import { api } from "../convex/_generated/api";
import { getConvexClient } from "./convex-client";

// Read-only view loader for the autoresearch UI page. Data comes from
// Convex queries in a single parallel fetch.

const DEFAULT_BUDGET_USD = 50;

export interface LedgerEntryView {
  iteration: number;
  ranAt: string;
  runId: string;
  publicAgentVersion: string | null;
  score: number | null;
  championScoreAtStart: number;
  kept: boolean;
  skipReason?: string;
  estimatedCostUsd: number;
  proposedRule?: string;
  rulesInEffect?: number;
  // Legacy alias kept so `app/autoresearch/page.tsx` (authored against the
  // pre-migration ledger shape) still renders. Always mirrors proposedRule.
  mutationSummary?: string;
}

export interface ChampionScoreView {
  score: number;
  iteration: number;
  publicAgentVersion: string | null;
  updatedAt: string;
}

export interface AutoresearchState {
  championScore: ChampionScoreView;
  championPrompt: string | null;
  ledger: LedgerEntryView[];
  spentUsd: number;
  budgetCapUsd: number;
  isLive: boolean;
}

function getBudgetCapUsd(): number {
  const raw = process.env.AUTORESEARCH_BUDGET_USD;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_BUDGET_USD;
}

export async function loadAutoresearchState(
  ledgerLimit = 50,
): Promise<AutoresearchState> {
  const client = getConvexClient();
  const [champion, ledger, spentUsd] = await Promise.all([
    client.query(api.autoresearch.getChampion, {}),
    client.query(api.autoresearch.recentLedger, { limit: ledgerLimit }),
    client.query(api.autoresearch.getSpent, {}),
  ]);

  const ledgerView = (ledger as unknown as LedgerEntryView[]).map(entry => ({
    iteration: entry.iteration,
    ranAt: entry.ranAt,
    runId: entry.runId,
    publicAgentVersion: entry.publicAgentVersion,
    score: entry.score,
    championScoreAtStart: entry.championScoreAtStart,
    kept: entry.kept,
    skipReason: entry.skipReason,
    estimatedCostUsd: entry.estimatedCostUsd,
    proposedRule: entry.proposedRule,
    rulesInEffect: entry.rulesInEffect,
    mutationSummary: entry.proposedRule,
  }));

  const championView: ChampionScoreView = {
    score: (champion as ChampionScoreView)?.score ?? 0,
    iteration: (champion as ChampionScoreView)?.iteration ?? 0,
    publicAgentVersion:
      (champion as ChampionScoreView)?.publicAgentVersion ?? null,
    updatedAt:
      (champion as ChampionScoreView)?.updatedAt ?? new Date(0).toISOString(),
  };

  return {
    championScore: championView,
    championPrompt: null,
    ledger: ledgerView,
    spentUsd: typeof spentUsd === "number" ? spentUsd : 0,
    budgetCapUsd: getBudgetCapUsd(),
    isLive: championView.score > 0 || ledgerView.length > 0,
  };
}
