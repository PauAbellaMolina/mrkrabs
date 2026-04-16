import { api } from "../convex/_generated/api";
import { getConvexClient } from "./convex-client";

// Single-iteration detail loader used by /autoresearch/runs/[id]. Returns
// null for runs the ledger has never heard of (e.g. an in-flight iteration
// that hasn't settled yet) — the caller still renders the run body without
// the autoresearch-specific context panel.

export interface AutoresearchLedgerView {
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
  rulesInEffect: number;
  systemPromptUsed?: string;
}

export async function loadAutoresearchLedgerForRun(
  runId: string,
): Promise<AutoresearchLedgerView | null> {
  const client = getConvexClient();
  const entry = await client.query(api.autoresearch.getLedgerByRunId, {
    runId,
  });
  return entry as AutoresearchLedgerView | null;
}
