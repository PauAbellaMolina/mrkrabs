import { api } from "../convex/_generated/api";
import { getConvexClient, hasConvexClientConfig } from "./convex-client";
import type { CalaAgentResult } from "./cala-agent";

// Convex rejects values of type `undefined` — an object key either exists
// with a valid value or it's omitted entirely. Our upstream data (Error
// instances, AI SDK telemetry, tool-call results) is full of optional
// fields that frequently come through as `undefined`, so every blob we
// hand to a Convex mutation goes through this first.
//
// Also normalizes Error instances (which have non-enumerable fields and
// don't survive JSON.stringify round-trips) into plain objects so stack
// traces make it to the dashboard.
function sanitizeForConvex<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    const cause = (value as Error & { cause?: unknown }).cause;
    const normalized: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    if (cause !== undefined) {
      normalized.cause = sanitizeForConvex(cause);
    }
    return normalized as unknown as T;
  }
  if (Array.isArray(value)) {
    return value
      .filter(item => item !== undefined)
      .map(item => sanitizeForConvex(item)) as unknown as T;
  }
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = sanitizeForConvex(v);
  }
  return out as unknown as T;
}

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
    event: sanitizeForConvex({
      level: event.level,
      type: event.type,
      title: event.title,
      at: event.at,
      data: event.data,
    }),
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
    result: sanitizeForConvex(input.result),
    telemetry: sanitizeForConvex(input.telemetry),
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
    details: sanitizeForConvex(input.details),
  });
}

export async function listRunSummaries(): Promise<AgentRunSummary[]> {
  if (!hasConvexClientConfig()) {
    return [];
  }
  try {
    const summaries = await getConvexClient().query(api.runs.listSummaries, {});
    return summaries as unknown as AgentRunSummary[];
  } catch {
    return [];
  }
}

export async function recordRunSubmission(
  runId: string,
  submission: NonNullable<AgentRunRecord["leaderboardSubmission"]>,
) {
  await getConvexClient().mutation(api.runs.recordSubmission, {
    runId,
    submission: sanitizeForConvex(submission),
  });
}
