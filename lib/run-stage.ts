import type { AgentRunRecord, AgentRunSummary } from "./agent-runs";

export type RunStage =
  | "running"
  | "failed"
  | "done"
  | "submit-failed"
  | "submitted";

export function deriveRunStage(run: {
  status: AgentRunRecord["status"];
  result?: AgentRunRecord["result"];
  leaderboardSubmission?: AgentRunRecord["leaderboardSubmission"];
}): RunStage {
  if (run.status === "running") return "running";
  if (run.status === "failed") return "failed";

  const submission = run.leaderboardSubmission;
  if (submission?.status === "submitted") return "submitted";
  if (submission?.status === "failed") return "submit-failed";

  return run.result ? "done" : "failed";
}

export function deriveSummaryStage(summary: AgentRunSummary): RunStage {
  if (summary.status === "running") return "running";
  if (summary.status === "failed") return "failed";
  if (summary.leaderboardStatus === "submitted") return "submitted";
  if (summary.leaderboardStatus === "failed") return "submit-failed";
  return "done";
}

export const STAGE_LABELS: Record<RunStage, string> = {
  running: "Running",
  failed: "Failed",
  done: "Ready",
  "submit-failed": "Submit failed",
  submitted: "Submitted",
};

export const STAGE_GLYPHS: Record<RunStage, string> = {
  running: "◦",
  failed: "×",
  done: "●",
  "submit-failed": "!",
  submitted: "✓",
};

export function stageIsActive(stage: RunStage): boolean {
  return stage === "running";
}

export function stageIsTerminal(stage: RunStage): boolean {
  return stage === "submitted" || stage === "failed";
}
