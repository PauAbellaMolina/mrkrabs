import { inspect } from "node:util";

import { readRunRecord, type AgentRunEvent } from "../lib/agent-runs";
import { loadAutoresearchLedgerForRun } from "../lib/autoresearch-run-view";
import { validatePortfolio } from "../lib/portfolio";
import {
  formatSubmissionMetric,
  parseSubmissionResponse,
} from "../lib/submission-result";
import { deriveRunStage } from "../lib/run-stage";
import { summarizeResearchCheckpoint } from "../lib/research-checkpoint";

type ToolStats = {
  totalCalls: number;
  byName: Map<string, number>;
};

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) return "null";
  return inspect(value, { depth: 3, breakLength: 120, maxArrayLength: 12 });
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function detectBackend(agentName: string) {
  return agentName.includes("codex") ? "codex-cli" : "anthropic";
}

function summarizeEvents(events: AgentRunEvent[]) {
  const byType = new Map<string, number>();
  for (const event of events) {
    byType.set(event.type, (byType.get(event.type) ?? 0) + 1);
  }
  return byType;
}

function extractToolName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidates = [
    record.toolName,
    record.tool_name,
    record.name,
    record.tool,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function summarizeStepTools(
  steps: Array<{ toolCalls: unknown[] }>,
): ToolStats {
  const byName = new Map<string, number>();
  let totalCalls = 0;

  for (const step of steps) {
    for (const toolCall of step.toolCalls) {
      totalCalls += 1;
      const toolName = extractToolName(toolCall) ?? "unknown";
      byName.set(toolName, (byName.get(toolName) ?? 0) + 1);
    }
  }

  return { totalCalls, byName };
}

function printSection(title: string, lines: string[]) {
  console.log(`\n## ${title}`);
  for (const line of lines) {
    console.log(line);
  }
}

async function main() {
  const runId = process.argv[2]?.trim();
  if (!runId) {
    console.error(
      "Usage: node --env-file=.env.local --import tsx scripts/analyze-run.ts <run-id>",
    );
    process.exit(2);
  }

  const run = await readRunRecord(runId);
  const ledger = await loadAutoresearchLedgerForRun(runId).catch(() => null);
  const stage = deriveRunStage(run);
  const backend = detectBackend(run.agentName);
  const result = run.result;
  const positions = result?.output.positions ?? [];
  const transactions = result?.output.submissionPayload.transactions ?? [];
  const totalAllocated = transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const uniqueTickers = new Set(
    transactions.map((transaction) => transaction.nasdaq_code.trim().toUpperCase()),
  );
  const portfolioValidation = result
    ? validatePortfolio({
        positions: positions.map((position) => ({
          ticker: position.nasdaqCode,
          notional_usd: position.amount,
          thesis: position.thesis,
          cala_entity_id: position.companyEntityId,
        })),
      })
    : null;
  const stepToolStats = summarizeStepTools(result?.steps ?? []);
  const eventSummary = summarizeEvents(run.events);
  const successes: string[] = [];
  const failures: string[] = [];

  if (run.status === "completed") {
    successes.push("Run completed without throwing an agent-level failure.");
  } else if (run.status === "failed") {
    failures.push(`Run failed: ${run.error?.message ?? "unknown error"}`);
  }

  if (result) {
    successes.push(
      `Produced a portfolio object with ${positions.length} positions and ${transactions.length} submission rows.`,
    );
  } else {
    failures.push("No final portfolio result was persisted on the run record.");
  }

  if (portfolioValidation?.ok) {
    successes.push(
      `Portfolio passes the shared validator with ${uniqueTickers.size} unique tickers and ${formatUsd(totalAllocated)} allocated.`,
    );
  } else if (portfolioValidation && !portfolioValidation.ok) {
    failures.push(...portfolioValidation.errors);
  }

  if (result?.output.cutoffAudit.postCutoffDataUsed === false) {
    successes.push("Cutoff audit says no post-2025-04-15 data was used.");
  } else if (result?.output.cutoffAudit.postCutoffDataUsed === true) {
    failures.push("Cutoff audit says post-2025-04-15 data was used.");
  }

  if (run.checkpoint) {
    const checkpointSummary = summarizeResearchCheckpoint(run.checkpoint);
    successes.push(
      `Checkpoint saved: phase=${checkpointSummary.phase}, candidates=${checkpointSummary.candidateCount}, draft=${checkpointSummary.draftCount}.`,
    );
  } else if (backend === "codex-cli") {
    failures.push(
      "No checkpoint persisted for this Codex run. The current Codex path still lacks checkpoint tools/state wiring.",
    );
  } else {
    failures.push("No research checkpoint was persisted for this run.");
  }

  if (backend === "codex-cli" && (result?.steps.length ?? 0) === 0) {
    failures.push(
      "Codex result has no persisted step transcript, so tool-by-tool reasoning is not inspectable from the run record.",
    );
  } else if ((result?.steps.length ?? 0) > 0) {
    successes.push(
      `Persisted ${result?.steps.length ?? 0} model steps with ${stepToolStats.totalCalls} tool calls.`,
    );
  }

  if (run.leaderboardSubmission?.status === "submitted") {
    const parsed = parseSubmissionResponse(run.leaderboardSubmission.response);
    const headline = parsed.headline
      ? `${parsed.headline.label}: ${formatSubmissionMetric(parsed.headline)}`
      : "no headline metric found";
    successes.push(`Leaderboard submission succeeded. ${headline}.`);
  } else if (run.leaderboardSubmission?.status === "failed") {
    failures.push(
      `Leaderboard submission failed${run.leaderboardSubmission.upstreamStatus ? ` (HTTP ${run.leaderboardSubmission.upstreamStatus})` : ""}.`,
    );
  } else {
    failures.push("Run never reached a leaderboard submission.");
  }

  if ((result?.output.openGaps.length ?? 0) > 0) {
    failures.push(
      `Open gaps remained in the final output (${result?.output.openGaps.length ?? 0}).`,
    );
  }

  const overviewLines = [
    `Run ID: ${run.id}`,
    `Stage: ${stage}`,
    `Status: ${run.status}`,
    `Backend: ${backend}`,
    `Agent: ${run.agentName} ${run.agentVersion}`,
    `Model: ${run.model ?? "unknown"}`,
    `Started: ${run.startedAt}`,
    `Finished: ${run.finishedAt ?? "still running"}`,
    `Duration: ${run.durationMs != null ? `${run.durationMs} ms` : "unknown"}`,
    `Events: ${run.eventCount}`,
    `Recorded stepCount: ${run.stepCount}`,
    `Recorded toolCallCount: ${run.toolCallCount}`,
    `Prompt mode: ${run.systemPromptMode ?? "n/a"}`,
  ];

  if (ledger) {
    overviewLines.push(
      `Autoresearch iteration: ${ledger.iteration} | kept=${ledger.kept} | score=${ledger.score ?? "n/a"} | championAtStart=${ledger.championScoreAtStart}`,
    );
    if (ledger.skipReason) {
      overviewLines.push(`Autoresearch skip reason: ${ledger.skipReason}`);
    }
  }

  printSection("Overview", overviewLines);
  printSection(
    "What Went Right",
    successes.length > 0 ? successes.map((line) => `- ${line}`) : ["- None detected."],
  );
  printSection(
    "What Went Wrong",
    failures.length > 0 ? failures.map((line) => `- ${line}`) : ["- No obvious problems detected."],
  );

  const eventLines = [
    ...Array.from(eventSummary.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, count]) => `- ${type}: ${count}`),
  ];
  printSection(
    "Event Summary",
    eventLines.length > 0 ? eventLines : ["- No persisted events."],
  );

  const toolLines = [
    `- Persisted steps: ${result?.steps.length ?? 0}`,
    `- Tool calls found in steps: ${stepToolStats.totalCalls}`,
    ...Array.from(stepToolStats.byName.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([toolName, count]) => `- ${toolName}: ${count}`),
  ];
  printSection("Tool Summary", toolLines);

  if (result) {
    const outputLines = [
      `- Positions: ${positions.length}`,
      `- Transactions: ${transactions.length}`,
      `- Unique tickers: ${uniqueTickers.size}`,
      `- Total allocated: ${formatUsd(totalAllocated)}`,
      `- Post-cutoff data used: ${result.output.cutoffAudit.postCutoffDataUsed ? "yes" : "no"}`,
      `- Open gaps: ${result.output.openGaps.length}`,
      `- Supporting entity IDs across positions: ${new Set(positions.flatMap((position) => position.supportingEntityIds)).size}`,
    ];
    printSection("Output Summary", outputLines);

    if (result.output.openGaps.length > 0) {
      printSection(
        "Open Gaps",
        result.output.openGaps.map((gap) => `- ${gap}`),
      );
    }
  }

  if (run.checkpoint) {
    const checkpointSummary = summarizeResearchCheckpoint(run.checkpoint);
    printSection("Checkpoint", [
      `- Phase: ${checkpointSummary.phase}`,
      `- Candidate companies: ${checkpointSummary.candidateCount}`,
      `- Selected companies: ${checkpointSummary.selectedCount}`,
      `- Draft positions: ${checkpointSummary.draftCount}`,
      `- Open gaps: ${checkpointSummary.openGapCount}`,
      `- Last updated at step: ${checkpointSummary.lastUpdatedAtStep}`,
    ]);
  }

  if (run.leaderboardSubmission?.status === "submitted") {
    const parsed = parseSubmissionResponse(run.leaderboardSubmission.response);
    printSection("Submission", [
      `- Status: submitted`,
      `- Submitted at: ${run.leaderboardSubmission.submittedAt}`,
      `- Public agent: ${run.leaderboardSubmission.publicAgentName ?? "n/a"} ${run.leaderboardSubmission.publicAgentVersion ?? ""}`.trim(),
      `- Headline: ${parsed.headline ? `${parsed.headline.label} ${formatSubmissionMetric(parsed.headline)}` : "none"}`,
      ...parsed.metrics.slice(0, 8).map(
        (metric) =>
          `- ${metric.label}: ${formatSubmissionMetric(metric)}`,
      ),
    ]);
  } else if (run.leaderboardSubmission?.status === "failed") {
    printSection("Submission", [
      `- Status: failed`,
      `- Submitted at: ${run.leaderboardSubmission.submittedAt}`,
      `- Upstream status: ${formatValue(run.leaderboardSubmission.upstreamStatus)}`,
      `- Details: ${formatValue(run.leaderboardSubmission.details ?? run.leaderboardSubmission.response)}`,
    ]);
  }

  if (run.error) {
    printSection("Error", [
      `- Message: ${run.error.message}`,
      `- Details: ${formatValue(run.error.details)}`,
    ]);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
  process.exit(1);
});
