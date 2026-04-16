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
// Set by the spawn route when the outer loop is kicked off from the UI.
// Manual `pnpm autoresearch` invocations from a terminal leave it unset and
// the script runs sessionless — iterations still land in runs + ledger,
// just without a parent session row.
const SESSION_ID = process.env.AUTORESEARCH_SESSION_ID?.trim() || null;
import { submitToLeaderboard } from "../lib/leaderboard-submit";
import { PUBLIC_AUTORESEARCH_AGENT_NAME } from "../lib/agent-version";
import {
  finalizeAutoresearchSession,
  getAutoresearchSessionPlannedIterations,
  incrementAutoresearchSessionProgress,
} from "../lib/autoresearch-session";

// Same prompt the UI dispatches.
const DEFAULT_RUN_PROMPT =
  "Build the first full challenge submission using one thesis only: favor NASDAQ companies with low or improving legal-entity complexity from filing-linked subsidiary/control graphs available on or before 2025-04-15. Use 50 equal $20,000 positions and explain the picks with Cala-backed evidence only.";

// Bigger step budget than manual UI runs. Research + validation retries
// under a strict schema need room; 20 was getting blown through on Sonnet
// before the agent emitted the final portfolio. Autoresearch spend is
// capped by AUTORESEARCH_BUDGET_USD so this is safe to crank. The
// submit_portfolio tool lets the agent stop as soon as it commits, so the
// budget is a ceiling, not a target.
import { isBaselineMode } from "../lib/portfolio-baseline";
import {
  buildUniversePromptBlock,
  hasResearchUniverse,
  loadResearchUniverse,
  saveResearchUniverse,
} from "../lib/research-universe";

const HAS_UNIVERSE = hasResearchUniverse();
const AUTORESEARCH_STEP_BUDGET = isBaselineMode()
  ? 15
  : HAS_UNIVERSE
    ? 12
    : 50;

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
    sessionId: SESSION_ID ?? undefined,
  });

  let agentCostUsd = 0;
  let agentResult: CalaAgentResult | null = null;

  try {
    agentResult = await runCalaAgent(DEFAULT_RUN_PROMPT, {
      systemPromptOverride: variantPrompt,
      stepBudget: AUTORESEARCH_STEP_BUDGET,
      model: RESOLVED_MODEL,
      runId,
      submitFn: (payload) =>
        submitToLeaderboard(payload, {
          agentName: PUBLIC_AUTORESEARCH_AGENT_NAME,
        }),
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

  // submit_portfolio now submits to the leaderboard inside the agent
  // (via submitFn). If the agent exhausted its step budget without a
  // successful submission, leaderboardResponse is null.
  if (!agentResult.leaderboardResponse) {
    return {
      runId,
      publicAgentVersion: null,
      score: null,
      result: agentResult,
      costUsd: agentCostUsd,
      skipReason: "agent finished without successful leaderboard submission",
    };
  }

  const score = extractScoreFromResponse(agentResult.leaderboardResponse);
  return {
    runId,
    publicAgentVersion:
      typeof (agentResult.leaderboardResponse as Record<string, unknown>)
        ?.model_agent_version === "string"
        ? ((agentResult.leaderboardResponse as Record<string, unknown>)
            .model_agent_version as string)
        : null,
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

  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;
  let lastFailureReason = "";

  for (let i = 0; i < iterations; i++) {
    // Check if the session was shrunk from the UI while we were running.
    if (SESSION_ID) {
      const currentPlanned = await getAutoresearchSessionPlannedIterations(SESSION_ID).catch(() => null);
      if (currentPlanned != null && i >= currentPlanned) {
        console.info(
          `[autoresearch] session shrunk to ${currentPlanned} iterations — stopping after ${i} completed`,
        );
        break;
      }
    }

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

    let variantPrompt = composeSystemPrompt(candidateRules);

    // Inject pre-researched company data so the agent skips entity research
    // and goes straight to ranking + submit. Cuts iterations from ~30 min
    // to ~3 min. The universe file is built from previous successful runs.
    if (HAS_UNIVERSE) {
      const universe = loadResearchUniverse();
      if (universe.length > 0) {
        variantPrompt += "\n" + buildUniversePromptBlock(universe);
        console.info(
          `[autoresearch] injecting research universe (${universe.length} companies) — step budget ${AUTORESEARCH_STEP_BUDGET}`,
        );
      }
    }

    const outcome = await runOneExperiment(variantPrompt);

    const iterationCost = outcome.costUsd + mutationCostUsd;
    spent = await addSpentUsd(iterationCost);

    // Update the research universe from every iteration that produced a
    // valid portfolio, so subsequent iterations benefit from the latest data.
    if (outcome.result?.output.positions.length) {
      try {
        saveResearchUniverse(outcome.result.output.positions);
      } catch (e) {
        console.warn(
          "[autoresearch] failed to save research universe:",
          e instanceof Error ? e.message : e,
        );
      }
    }

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

    // When an iteration is skipped due to submission failure (not an agent
    // error or empty result), the proposed rule wasn't tested fairly.
    // Persist it so the next iteration inherits it instead of losing the
    // mutator's work.
    const isSubmitFailure =
      !kept &&
      proposedRule &&
      outcome.skipReason &&
      (outcome.skipReason.startsWith("submit-rejected") ||
        outcome.skipReason.startsWith("agent finished without"));
    if (isSubmitFailure) {
      console.info(
        `[autoresearch] preserving untested rule for next iteration: ${proposedRule}`,
      );
      await appendRule({
        text: proposedRule,
        addedAtIteration: iteration,
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
      systemPromptUsed: variantPrompt,
      sessionId: SESSION_ID ?? undefined,
    };
    await appendLedgerEntry(entry);

    if (SESSION_ID) {
      await incrementAutoresearchSessionProgress(SESSION_ID).catch(error => {
        console.warn(
          "[autoresearch] failed to bump session progress",
          error instanceof Error ? error.message : error,
        );
      });
    }

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

    if (outcome.skipReason) {
      if (outcome.skipReason === lastFailureReason) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 1;
        lastFailureReason = outcome.skipReason;
      }
    } else {
      consecutiveFailures = 0;
      lastFailureReason = "";
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const reason = `${MAX_CONSECUTIVE_FAILURES} consecutive failures with same error: ${lastFailureReason}`;
      console.error(`[autoresearch] ${reason}. Aborting session.`);
      await markSession("failed", reason);
      break;
    }

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

// Session lifecycle. When the outer loop is spawned by the UI a
// SESSION_ID is present and we mark the session completed/failed/stopped
// on exit so the UI can transition it out of the "running" list.

let sessionFinalized = false;

async function markSession(
  status: "completed" | "stopped" | "failed",
  errorMessage?: string,
) {
  if (!SESSION_ID || sessionFinalized) return;
  sessionFinalized = true;
  try {
    await finalizeAutoresearchSession(SESSION_ID, status, errorMessage);
  } catch (error) {
    console.warn(
      "[autoresearch] failed to finalize session",
      error instanceof Error ? error.message : error,
    );
  }
}

process.on("SIGTERM", () => {
  console.info("[autoresearch] SIGTERM received; marking session stopped");
  // fire-and-forget; the process is about to exit regardless
  markSession("stopped").finally(() => process.exit(143));
});
process.on("SIGINT", () => {
  console.info("[autoresearch] SIGINT received; marking session stopped");
  markSession("stopped").finally(() => process.exit(130));
});

main()
  .then(() => markSession("completed"))
  .catch(async (error) => {
    console.error("[autoresearch] fatal", error);
    const message = error instanceof Error ? error.message : String(error);
    await markSession("failed", message);
    process.exit(1);
  });
