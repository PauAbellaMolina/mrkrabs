import { api } from "../convex/_generated/api";
import { getConvexClient } from "./convex-client";
import { BASE_SYSTEM_PROMPT_FOR_RESEARCH } from "./system-prompt";

// Autoresearch outer-loop state — backed by Convex. Same exports as before,
// filesystem-backed internals replaced with mutations/queries. The cap on
// the rules playbook, the atomic spend increment, and the monotonic version
// allocator all live server-side now, so two machines running the loop at
// the same time can't corrupt each other's state.

// Cap on accumulated rules. Client-side constant only — the actual cap is
// enforced by the `appendRule` Convex mutation, which drops the oldest rule
// when the collection would exceed MAX_RULES. Exposing the constant here
// lets the UI render "rules=N/8" without a round trip.
export const MAX_RULES = 8;

export interface RuleEntry {
  text: string;
  addedAtIteration: number;
  addedAt: string;
}

export interface LedgerEntry {
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
  sessionId?: string;
}

export interface ChampionScore {
  score: number;
  iteration: number;
  publicAgentVersion: string | null;
  updatedAt: string;
}

// ─── Rules ──────────────────────────────────────────────────────────────

export async function loadRules(): Promise<RuleEntry[]> {
  const rules = await getConvexClient().query(api.autoresearch.loadRules, {});
  return rules as unknown as RuleEntry[];
}

export async function appendRule(
  rule: Omit<RuleEntry, "addedAt">,
): Promise<RuleEntry[]> {
  await getConvexClient().mutation(api.autoresearch.appendRule, {
    text: rule.text,
    addedAtIteration: rule.addedAtIteration,
  });
  return loadRules();
}

// Compose the full system prompt: base verbatim, plus accumulated rules
// if there are any. Pure function, no I/O — kept here so the autoresearch
// loop and the mutator can both reach for it.
export function composeSystemPrompt(rules: RuleEntry[]): string {
  if (rules.length === 0) return BASE_SYSTEM_PROMPT_FOR_RESEARCH;
  const rulesBlock = rules
    .map((rule, i) => `  ${i + 1}. ${rule.text}`)
    .join("\n");
  return (
    BASE_SYSTEM_PROMPT_FOR_RESEARCH +
    `\n\n## Accumulated strategy rules (from autoresearch)\n${rulesBlock}`
  );
}

// ─── Champion ───────────────────────────────────────────────────────────

export async function loadChampionScore(): Promise<ChampionScore> {
  const champion = await getConvexClient().query(
    api.autoresearch.getChampion,
    {},
  );
  return champion as unknown as ChampionScore;
}

export async function writeChampionScore(score: ChampionScore): Promise<void> {
  await getConvexClient().mutation(api.autoresearch.setChampion, {
    score: score.score,
    iteration: score.iteration,
    publicAgentVersion: score.publicAgentVersion ?? undefined,
  });
}

// ─── Ledger ─────────────────────────────────────────────────────────────

export async function appendLedgerEntry(entry: LedgerEntry): Promise<void> {
  await getConvexClient().mutation(api.autoresearch.appendLedger, {
    iteration: entry.iteration,
    ranAt: entry.ranAt,
    runId: entry.runId,
    publicAgentVersion: entry.publicAgentVersion ?? undefined,
    score: entry.score ?? undefined,
    championScoreAtStart: entry.championScoreAtStart,
    kept: entry.kept,
    skipReason: entry.skipReason,
    estimatedCostUsd: entry.estimatedCostUsd,
    proposedRule: entry.proposedRule,
    rulesInEffect: entry.rulesInEffect,
    sessionId: entry.sessionId,
  });
}

export async function loadRecentLedgerEntries(
  limit = 5,
): Promise<LedgerEntry[]> {
  const entries = await getConvexClient().query(
    api.autoresearch.recentLedger,
    { limit },
  );
  return entries as unknown as LedgerEntry[];
}

// ─── Spend ──────────────────────────────────────────────────────────────

export async function loadSpentUsd(): Promise<number> {
  return getConvexClient().query(api.autoresearch.getSpent, {});
}

export async function addSpentUsd(delta: number): Promise<number> {
  // Budget cap enforcement is opt-in via the `budgetCapUsd` arg on the
  // Convex mutation. The legacy callers of this shim don't pass a cap —
  // they still check the budget locally after this call returns — so
  // we preserve that behavior here. The CLI can upgrade to server-side
  // enforcement later by reaching for `getConvexClient()` directly.
  return getConvexClient().mutation(api.autoresearch.addSpent, { delta });
}
