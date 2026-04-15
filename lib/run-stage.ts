import type { AgentRunRecord, AgentRunSummary } from "./agent-runs";

// A run walks through five observable stages from the UI's perspective.
// "running"       — agent is working, no result yet
// "failed"        — agent never produced a result
// "done"          — result exists, nothing submitted yet
// "submit-failed" — submitted to the leaderboard but Convex rejected it
// "submitted"     — submitted and the upstream accepted it
//
// These are the UI states; the persisted AgentRunRecord doesn't carry a
// "stage" field directly. We derive it from (status, result, leaderboardSubmission).

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

// Summary shape doesn't carry result, only leaderboardStatus + status. We
// rebuild the stage from what we have.
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

// Short glyph for the monochrome stage badge. No color — state is carried
// by glyph + weight + pulse animation on "running" and "submitting".
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
