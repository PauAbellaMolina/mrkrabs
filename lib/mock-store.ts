import type { AgentRunRecord, AgentRunSummary } from "./agent-runs";
import { buildFreshRunningFixture, buildMockRunRecords } from "./mock-fixtures";

const STORAGE_KEY = "mrkrabs.mockMode.runs";
const ENABLED_KEY = "mrkrabs.mockMode.enabled";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function isMockModeEnabled(): boolean {
  if (!hasStorage()) return false;
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMockModeEnabled(enabled: boolean): void {
  if (!hasStorage()) return;
  try {
    if (enabled) window.localStorage.setItem(ENABLED_KEY, "1");
    else window.localStorage.removeItem(ENABLED_KEY);
  } catch {}
}

export function readMockRunRecords(): AgentRunRecord[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as AgentRunRecord[];
  } catch {
    return [];
  }
}

export function writeMockRunRecords(records: AgentRunRecord[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {}
}

export function clearMockRunRecords(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function seedMockRunRecords(): AgentRunRecord[] {
  const records = buildMockRunRecords();
  writeMockRunRecords(records);
  return records;
}

export function appendMockRunRecord(record: AgentRunRecord): AgentRunRecord[] {
  const next = [record, ...readMockRunRecords()];
  writeMockRunRecords(next);
  return next;
}

export function addFreshRunningRun(): AgentRunRecord[] {
  return appendMockRunRecord(buildFreshRunningFixture());
}

export function updateMockRunRecord(
  runId: string,
  mutator: (record: AgentRunRecord) => AgentRunRecord,
): AgentRunRecord[] {
  const next = readMockRunRecords().map(record =>
    record.id === runId ? mutator(record) : record,
  );
  writeMockRunRecords(next);
  return next;
}

export function readMockRunRecord(runId: string): AgentRunRecord | null {
  return readMockRunRecords().find(record => record.id === runId) ?? null;
}

function toRunSummary(record: AgentRunRecord): AgentRunSummary {
  const submission = record.leaderboardSubmission;
  return {
    id: record.id,
    prompt: record.prompt,
    agentName: record.agentName,
    agentVersion: record.agentVersion,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
    model: record.model,
    eventCount: record.eventCount,
    stepCount: record.stepCount,
    toolCallCount: record.toolCallCount,
    positionCount: record.result?.output.positions.length ?? 0,
    requestId: record.requestId,
    leaderboardStatus: submission?.status,
    leaderboardResponse:
      submission?.status === "submitted" ? submission.response : undefined,
    leaderboardDetails:
      submission?.status === "failed" ? submission.details : undefined,
    leaderboardUpstreamStatus:
      submission?.status === "failed" ? submission.upstreamStatus : undefined,
    errorMessage: record.error?.message,
  };
}

export function listMockRunSummaries(): AgentRunSummary[] {
  return readMockRunRecords()
    .slice()
    .sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .map(toRunSummary);
}

const CHANGE_EVENT = "mrkrabs:mock-store-changed";

export function emitMockStoreChanged(): void {
  if (!hasStorage()) return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// Forwards cross-tab `storage` events through the same channel so listeners
// don't need to care about which side of the tab boundary the write came from.
export function subscribeToMockStore(listener: () => void): () => void {
  if (!hasStorage()) return () => {};
  const wrapped = () => listener();
  window.addEventListener(CHANGE_EVENT, wrapped);
  window.addEventListener("storage", wrapped);
  return () => {
    window.removeEventListener(CHANGE_EVENT, wrapped);
    window.removeEventListener("storage", wrapped);
  };
}
