// Autoresearch outer loop.
//
// Usage:
//   pnpm autoresearch           # default 10 iterations
//   pnpm autoresearch 30        # 30 iterations
//   AUTORESEARCH_BUDGET_USD=25 pnpm autoresearch 50   # lower budget cap
//
// Each iteration:
//   1. Load the current rule playbook (starts empty; grows over time).
//   2. Iteration 1 (no score yet): run the BASE prompt verbatim to establish
//      a baseline score. No mutation attempted.
//   3. Iterations 2+: ask the mutator for ONE new rule, run the agent with
//      `BASE + current-rules + candidate-rule`, submit, compare to champion.
//   4. If the candidate rule produced a better score, APPEND it to the
//      playbook (capped at MAX_RULES; oldest drops).
//   5. Always append the outcome to the Convex `ledger` table and increment
//      accumulated spend.
//   6. Abort if cumulative spend crosses AUTORESEARCH_BUDGET_USD.
//
// Autoresearch runs appear in the dashboard like any other run. The public
// identity stamped on Cala submissions is "Mr. Krabs Agent vN".

import {
  appendRunEvent,
  completeRunRecord,
  createRunRecord,
  failRunRecord,
} from "../lib/agent-runs";
import {
  addSpentUsd,
  appendLedgerEntry,
  appendRule,
  composeSystemPrompt,
  loadChampionScore,
  loadRecentLedgerEntries,
  loadRules,
  loadSpentUsd,
  writeChampionScore,
  type LedgerEntry,
  type RuleEntry,
} from "../lib/autoresearch-ledger";
import { proposeRule } from "../lib/autoresearch-mutator";
import {
  estimateAnthropicCostUsd,
  getBudgetCapUsd,
} from "../lib/autoresearch-cost";
import {
  CALA_AGENT_MODEL,
  CALA_AGENT_VERSION,
  runCalaAgent,
  type CalaAgentResult,
} from "../lib/cala-agent";

// Model to run the outer loop on. The dashboard trigger passes this via
// AUTORESEARCH_MODEL; `pnpm autoresearch` from the CLI falls back to the
// cala-agent default (Sonnet 4.6). Whatever ends up here is the model used
// for every iteration in the run, stamped on every run record, and fed to
// the cost estimator.
const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6[1m]",
  "claude-opus-4-6",
  "claude-opus-4-6[1m]",
]);
const RESOLVED_MODEL =
  process.env.AUTORESEARCH_MODEL &&
  ALLOWED_MODELS.has(process.env.AUTORESEARCH_MODEL)
    ? process.env.AUTORESEARCH_MODEL
    : CALA_AGENT_MODEL;
import { submitToLeaderboard } from "../lib/leaderboard-submit";
import { PUBLIC_AUTORESEARCH_AGENT_NAME } from "../lib/agent-version";

// Same prompt the UI dispatches.
const DEFAULT_RUN_PROMPT =
  "Build the first full challenge submission using one thesis only: favor NASDAQ companies with low or improving legal-entity complexity from filing-linked subsidiary/control graphs available on or before 2025-04-15. Use 50 equal $20,000 positions and explain the picks with Cala-backed evidence only.";

// Bigger step budget than manual UI runs. Haiku needs room to research and
// compose a 50-position portfolio; 6 steps is too tight. Autoresearch spend
// is capped by AUTORESEARCH_BUDGET_USD so this is safe to crank.
const AUTORESEARCH_STEP_BUDGET = 20;

interface IterationOutcome {
  runId: string;
  publicAgentVersion: string | null;
  score: number | null;
  result?: CalaAgentResult;
  costUsd: number;
  skipReason?: string;
}

function parseIterations(): number {
  const raw = process.argv[2];
  if (!raw) return 10;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`[autoresearch] invalid iteration count: ${raw}`);
    process.exit(2);
  }
  return Math.floor(parsed);
}

function extractScoreFromResponse(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>).total_value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

async function runOneExperiment(
  variantPrompt: string,
): Promise<IterationOutcome> {
  const runId = crypto.randomUUID();
  const requestId = crypto.randomUUID();

  await createRunRecord({
    id: runId,
    requestId,
    prompt: DEFAULT_RUN_PROMPT,
    agentName: PUBLIC_AUTORESEARCH_AGENT_NAME,
    agentVersion: CALA_AGENT_VERSION,
    model: RESOLVED_MODEL,
  });

  let agentCostUsd = 0;
  let agentResult: CalaAgentResult | null = null;

  try {
    agentResult = await runCalaAgent(DEFAULT_RUN_PROMPT, {
      systemPromptOverride: variantPrompt,
      stepBudget: AUTORESEARCH_STEP_BUDGET,
      model: RESOLVED_MODEL,
      onTelemetryEvent: (event) => appendRunEvent(runId, event),
      onFinish: async (event) => {
        agentCostUsd = estimateAnthropicCostUsd(event.totalUsage, RESOLVED_MODEL);
        await completeRunRecord(runId, {
          model: RESOLVED_MODEL,
          result: event.result,
          telemetry: {
            functionId: event.functionId,
            metadata: event.metadata,
            totalUsage: event.totalUsage,
          },
        });
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown agent error";
    await failRunRecord(runId, { message, details: error });
    return {
      runId,
      publicAgentVersion: null,
      score: null,
      costUsd: agentCostUsd,
      skipReason: `agent-error: ${message}`,
    };
  }

  if (!agentResult) {
    return {
      runId,
      publicAgentVersion: null,
      score: null,
      costUsd: agentCostUsd,
      skipReason: "agent returned no result",
    };
  }

  const transactionCount =
    agentResult.output.submissionPayload.transactions.length;
  if (transactionCount < 50) {
    // Haiku 4.5 at a tight step budget sometimes produces partial or empty
    // portfolios that the server will reject. Short-circuit so we don't waste
    // a submit call or a version slot.
    return {
      runId,
      publicAgentVersion: null,
      score: null,
      result: agentResult,
      costUsd: agentCostUsd,
      skipReason: `agent produced only ${transactionCount} positions (need 50)`,
    };
  }

  const submitResult = await submitToLeaderboard(
    agentResult.output.submissionPayload,
    { agentName: PUBLIC_AUTORESEARCH_AGENT_NAME },
  );

  if (!submitResult.ok) {
    const detailPreview =
      submitResult.upstreamStatus != null
        ? `HTTP ${submitResult.upstreamStatus}`
        : "unknown";
    return {
      runId,
      publicAgentVersion: submitResult.agentVersion,
      score: null,
      result: agentResult,
      costUsd: agentCostUsd,
      skipReason: `submit-rejected: ${detailPreview}`,
    };
  }

  const score = extractScoreFromResponse(submitResult.response);
  return {
    runId,
    publicAgentVersion: submitResult.agentVersion,
    score,
    result: agentResult,
    costUsd: agentCostUsd,
  };
}

async function main() {
  const iterations = parseIterations();
  const budgetCap = getBudgetCapUsd();
  let spent = await loadSpentUsd();

  console.info(
    `[autoresearch] starting — iterations=${iterations}, budgetCap=$${budgetCap.toFixed(2)}, spentSoFar=$${spent.toFixed(2)}`,
  );

  if (spent >= budgetCap) {
    console.error(
      `[autoresearch] accumulated spend $${spent.toFixed(2)} already at/over cap $${budgetCap.toFixed(2)}. Aborting. Reset via the Convex dashboard (spent table) or raise AUTORESEARCH_BUDGET_USD.`,
    );
    process.exit(1);
  }

  const startingLedger = await loadRecentLedgerEntries(50);
  let iterationCounter =
    startingLedger.length > 0
      ? startingLedger[startingLedger.length - 1].iteration + 1
      : 1;

  for (let i = 0; i < iterations; i++) {
    const iteration = iterationCounter++;
    const currentRules = await loadRules();
    const championScore = await loadChampionScore();
    const history = await loadRecentLedgerEntries(5);

    console.info(
      `\n[autoresearch] ── iteration ${iteration} ── champion $${championScore.score.toLocaleString()} | rules=${currentRules.length}/${8}`,
    );

    // First pass (no champion yet) runs the baseline verbatim so we establish
    // a score before mutating anything. Subsequent iterations consult the
    // mutator for a candidate rule.
    let proposedRule: string | null = null;
    let mutationCostUsd = 0;
    let candidateRules: RuleEntry[] = currentRules;

    if (championScore.score > 0) {
      try {
        const proposal = await proposeRule(
          currentRules,
          championScore.score,
          history,
        );
        if (proposal) {
          proposedRule = proposal.rule;
          mutationCostUsd = proposal.costUsd;
          // Dry-run candidate list — NOT persisted yet; we only write if the
          // score improves.
          candidateRules = [
            ...currentRules,
            {
              text: proposal.rule,
              addedAtIteration: iteration,
              addedAt: new Date().toISOString(),
            },
          ];
        } else {
          console.warn(
            `[autoresearch] mutator returned no usable rule; running champion verbatim`,
          );
        }
      } catch (error) {
        console.warn(
          `[autoresearch] mutator failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    } else {
      console.info(`[autoresearch] no champion yet — running baseline`);
    }

    const variantPrompt = composeSystemPrompt(candidateRules);
    const outcome = await runOneExperiment(variantPrompt);

    const iterationCost = outcome.costUsd + mutationCostUsd;
    spent = await addSpentUsd(iterationCost);

    const kept = outcome.score != null && outcome.score > championScore.score;

    if (kept) {
      if (proposedRule) {
        await appendRule({
          text: proposedRule,
          addedAtIteration: iteration,
        });
      }
      await writeChampionScore({
        score: outcome.score!,
        iteration,
        publicAgentVersion: outcome.publicAgentVersion,
        updatedAt: new Date().toISOString(),
      });
    }

    const entry: LedgerEntry = {
      iteration,
      ranAt: new Date().toISOString(),
      runId: outcome.runId,
      publicAgentVersion: outcome.publicAgentVersion,
      score: outcome.score,
      championScoreAtStart: championScore.score,
      kept,
      skipReason: outcome.skipReason,
      estimatedCostUsd: iterationCost,
      proposedRule: proposedRule ?? undefined,
      rulesInEffect: candidateRules.length,
    };
    await appendLedgerEntry(entry);

    const scoreStr =
      outcome.score != null ? `$${outcome.score.toLocaleString()}` : "—";
    const deltaStr =
      outcome.score != null && championScore.score > 0
        ? `${(((outcome.score - championScore.score) / championScore.score) * 100).toFixed(2)}%`
        : "—";
    const tag = kept ? "KEPT" : outcome.skipReason ? "SKIP" : "discard";
    console.info(
      `[autoresearch] iter=${iteration} score=${scoreStr} Δ=${deltaStr} cost=$${iterationCost.toFixed(4)} spent=$${spent.toFixed(2)}/$${budgetCap.toFixed(2)} [${tag}]${outcome.skipReason ? " " + outcome.skipReason : ""}`,
    );

    if (spent >= budgetCap) {
      console.error(
        `[autoresearch] budget cap reached ($${spent.toFixed(2)} / $${budgetCap.toFixed(2)}). Stopping after iteration ${iteration}.`,
      );
      break;
    }
  }

  const finalChampion = await loadChampionScore();
  const finalRules = await loadRules();
  console.info(
    `\n[autoresearch] done — champion $${finalChampion.score.toLocaleString()} (${finalChampion.publicAgentVersion ?? "none"}) — rules=${finalRules.length} — total spent $${spent.toFixed(2)}/$${budgetCap.toFixed(2)}`,
  );
}

main().catch((error) => {
  console.error("[autoresearch] fatal", error);
  process.exit(1);
});
