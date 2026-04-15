import { api } from "../convex/_generated/api";
import { getConvexClient } from "./convex-client";
import type { CalaAgentResult } from "./cala-agent";

// Shared run state — backed by Convex. Previously this file owned a
// filesystem-backed store with a per-runId mutex and atomic temp-file
// writes; all of that is gone now because Convex mutations are already
// serializable transactions. The public function signatures are
// preserved so route handlers, server components, and scripts didn't
// have to change.

export type AgentRunStatus = "running" | "completed" | "failed";

export interface AgentRunEvent {
  id: string;
  at: string;
  level: "info" | "error";
  type:
    | "run-started"
    | "step-started"
    | "tool-started"
    | "tool-finished"
    | "step-finished"
    | "run-finished"
    | "run-failed";
  title: string;
  data?: unknown;
}

export interface AgentRunRecord {
  id: string;
  runId: string;
  requestId: string;
  prompt: string;
  agentName: string;
  agentVersion: string;
  status: AgentRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  model?: string;
  eventCount: number;
  stepCount: number;
  toolCallCount: number;
  result?: CalaAgentResult;
  telemetry?: {
    functionId?: string;
    metadata?: Record<string, unknown>;
    totalUsage?: unknown;
  };
  leaderboardSubmission?: {
    status: "submitted" | "failed";
    submittedAt: string;
    requestId: string;
    publicAgentName?: string;
    publicAgentVersion?: string;
    upstreamStatus?: number;
    upstreamStatusText?: string;
    response?: unknown;
    details?: unknown;
  };
  error?: {
    message: string;
    details?: unknown;
  };
  events: AgentRunEvent[];
}

export interface AgentRunSummary {
  id: string;
  prompt: string;
  agentName: string;
  agentVersion: string;
  status: AgentRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  model?: string;
  eventCount: number;
  stepCount: number;
  toolCallCount: number;
  positionCount: number;
  requestId: string;
  leaderboardStatus?: "submitted" | "failed";
}

export async function createRunRecord(input: {
  id: string;
  requestId: string;
  prompt: string;
  agentName: string;
  agentVersion: string;
  model?: string;
}) {
  await getConvexClient().mutation(api.runs.create, {
    runId: input.id,
    requestId: input.requestId,
    prompt: input.prompt,
    agentName: input.agentName,
    agentVersion: input.agentVersion,
    model: input.model,
  });
}

export async function readRunRecord(runId: string): Promise<AgentRunRecord> {
  const record = await getConvexClient().query(api.runs.getByRunId, { runId });
  if (!record) {
    throw new Error(`run ${runId} not found`);
  }
  return record as unknown as AgentRunRecord;
}

export async function appendRunEvent(
  runId: string,
  event: Omit<AgentRunEvent, "id" | "at"> & { at?: string },
) {
  await getConvexClient().mutation(api.runs.appendEvent, {
    runId,
    event: {
      level: event.level,
      type: event.type,
      title: event.title,
      at: event.at,
      data: event.data,
    },
  });
}

export async function completeRunRecord(
  runId: string,
  input: {
    model: string;
    result: CalaAgentResult;
    telemetry?: AgentRunRecord["telemetry"];
  },
) {
  await getConvexClient().mutation(api.runs.complete, {
    runId,
    model: input.model,
    result: input.result,
    telemetry: input.telemetry,
  });
}

export async function failRunRecord(
  runId: string,
  input: {
    message: string;
    details?: unknown;
  },
) {
  await getConvexClient().mutation(api.runs.fail, {
    runId,
    message: input.message,
    details: input.details,
  });
}

export async function listRunSummaries(): Promise<AgentRunSummary[]> {
  const summaries = await getConvexClient().query(api.runs.listSummaries, {});
  return summaries as unknown as AgentRunSummary[];
}

export async function recordRunSubmission(
  runId: string,
  submission: NonNullable<AgentRunRecord["leaderboardSubmission"]>,
) {
  await getConvexClient().mutation(api.runs.recordSubmission, {
    runId,
    submission,
  });
}
