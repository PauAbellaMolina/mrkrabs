import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CalaAgentResult } from "./cala-agent";

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
    // The public identifiers that actually went to Cala. Stamped by
    // `submitToLeaderboard`, not by the agent, so they're authoritative.
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

const RUNS_DIR = path.join(process.cwd(), ".data", "agent-runs");

const jsonReplacer = (_key: string, value: unknown) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
};

async function ensureRunsDir() {
  await mkdir(RUNS_DIR, { recursive: true });
}

function getRunPath(runId: string) {
  return path.join(RUNS_DIR, `${runId}.json`);
}

async function writeRun(record: AgentRunRecord) {
  await ensureRunsDir();
  // Write to a temp file then rename, so a reader never sees a half-written
  // record. Two concurrent writers on the same runId are still last-writer-
  // wins — the per-runId mutation queue below serializes them.
  const targetPath = getRunPath(record.id);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(record, jsonReplacer, 2), "utf8");
  await rename(tmpPath, targetPath);
}

// Per-runId serialization. All read-modify-write operations on a single run
// record (appendRunEvent, completeRunRecord, failRunRecord, recordRunSubmission)
// must go through this. Without it, concurrent telemetry callbacks racing on
// the same file produced half-written JSON that later reads choked on.
const mutationChains = new Map<string, Promise<unknown>>();

function serializeMutation<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const previous = mutationChains.get(runId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  mutationChains.set(
    runId,
    next.catch(() => undefined),
  );
  return next;
}

export async function createRunRecord(input: {
  id: string;
  requestId: string;
  prompt: string;
  agentName: string;
  agentVersion: string;
  model?: string;
}) {
  const record: AgentRunRecord = {
    id: input.id,
    requestId: input.requestId,
    prompt: input.prompt,
    agentName: input.agentName,
    agentVersion: input.agentVersion,
    model: input.model,
    status: "running",
    startedAt: new Date().toISOString(),
    eventCount: 1,
    stepCount: 0,
    toolCallCount: 0,
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        level: "info",
        type: "run-started",
        title: "Run started",
        data: {
          requestId: input.requestId,
          promptPreview: input.prompt.slice(0, 240),
        },
      },
    ],
  };

  await writeRun(record);
  return record;
}

export async function readRunRecord(runId: string) {
  const raw = await readFile(getRunPath(runId), "utf8");
  return JSON.parse(raw) as AgentRunRecord;
}

export function appendRunEvent(
  runId: string,
  event: Omit<AgentRunEvent, "id" | "at"> & { at?: string },
) {
  return serializeMutation(runId, async () => {
    const record = await readRunRecord(runId);
    const nextEvent: AgentRunEvent = {
      id: crypto.randomUUID(),
      at: event.at ?? new Date().toISOString(),
      level: event.level,
      type: event.type,
      title: event.title,
      data: event.data,
    };

    record.events.push(nextEvent);
    record.eventCount = record.events.length;

    if (event.type === "step-finished") {
      record.stepCount += 1;
    }

    if (event.type === "tool-started") {
      record.toolCallCount += 1;
    }

    await writeRun(record);
  });
}

export function completeRunRecord(
  runId: string,
  input: {
    model: string;
    result: CalaAgentResult;
    telemetry?: AgentRunRecord["telemetry"];
  },
) {
  return serializeMutation(runId, async () => {
    const record = await readRunRecord(runId);
    const finishedAt = new Date().toISOString();

    record.status = "completed";
    record.model = input.model;
    record.finishedAt = finishedAt;
    record.durationMs =
      new Date(finishedAt).getTime() - new Date(record.startedAt).getTime();
    record.result = input.result;
    record.telemetry = input.telemetry;
    record.stepCount = input.result.steps.length;
    record.toolCallCount = input.result.steps.reduce(
      (total, step) => total + step.toolCalls.length,
      0,
    );
    record.events.push({
      id: crypto.randomUUID(),
      at: finishedAt,
      level: "info",
      type: "run-finished",
      title: "Run finished",
      data: {
        positions: input.result.output.positions.length,
        transactions: input.result.output.submissionPayload.transactions.length,
      },
    });
    record.eventCount = record.events.length;

    await writeRun(record);
    return record;
  });
}

export function failRunRecord(
  runId: string,
  input: {
    message: string;
    details?: unknown;
  },
) {
  return serializeMutation(runId, async () => {
    const record = await readRunRecord(runId);
    const finishedAt = new Date().toISOString();

    record.status = "failed";
    record.finishedAt = finishedAt;
    record.durationMs =
      new Date(finishedAt).getTime() - new Date(record.startedAt).getTime();
    record.error = {
      message: input.message,
      details: input.details,
    };
    record.events.push({
      id: crypto.randomUUID(),
      at: finishedAt,
      level: "error",
      type: "run-failed",
      title: "Run failed",
      data: input.details,
    });
    record.eventCount = record.events.length;

    await writeRun(record);
    return record;
  });
}

export async function listRunSummaries(): Promise<AgentRunSummary[]> {
  await ensureRunsDir();
  const files = await readdir(RUNS_DIR);

  // Skip anything that isn't a valid JSON record instead of taking down the
  // whole dashboard. Half-written files, `.tmp` leftovers from a crashed
  // write, and manually-quarantined `.json.corrupt` files all get ignored.
  const runs = (
    await Promise.all(
      files
        .filter((fileName) => fileName.endsWith(".json"))
        .map(async (fileName): Promise<AgentRunRecord | null> => {
          try {
            const raw = await readFile(path.join(RUNS_DIR, fileName), "utf8");
            return JSON.parse(raw) as AgentRunRecord;
          } catch (error) {
            console.warn(
              `[agent-runs] skipping malformed run file ${fileName}: ${error instanceof Error ? error.message : error}`,
            );
            return null;
          }
        }),
    )
  ).filter((run): run is AgentRunRecord => run !== null);

  return runs
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .map((run) => ({
      id: run.id,
      prompt: run.prompt,
      agentName: run.agentName,
      agentVersion: run.agentVersion,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      model: run.model,
      eventCount: run.eventCount,
      stepCount: run.stepCount,
      toolCallCount: run.toolCallCount,
      positionCount: run.result?.output.positions.length ?? 0,
      requestId: run.requestId,
      leaderboardStatus: run.leaderboardSubmission?.status,
    }));
}

export function recordRunSubmission(
  runId: string,
  submission: NonNullable<AgentRunRecord["leaderboardSubmission"]>,
) {
  return serializeMutation(runId, async () => {
    const record = await readRunRecord(runId);
    record.leaderboardSubmission = submission;
    await writeRun(record);
    return record;
  });
}
