import type { AgentRunRecord, AgentRunSummary } from "./agent-runs";
import { buildFreshRunningFixture, buildMockRunRecords } from "./mock-fixtures";

// Browser-only mock store. Persists fake AgentRunRecord[] in localStorage so
// the UI can be iterated on without running the real agent. Every accessor
// is SSR-safe: on the server, reads return empty / defaults and writes
// no-op. The hybrid wrappers gate on `isMockModeEnabled()` before calling.

const STORAGE_KEY = "mrkrabs.mockMode.runs";
const ENABLED_KEY = "mrkrabs.mockMode.enabled";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

// ---------- mode toggle --------------------------------------------------

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
  } catch {
    // Ignore quota / disabled-storage errors — mission control just won't persist.
  }
}

// ---------- records CRUD -------------------------------------------------

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
  } catch {
    // Quota exceeded or similar — best effort.
  }
}

export function clearMockRunRecords(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function seedMockRunRecords(): AgentRunRecord[] {
  const records = buildMockRunRecords();
  writeMockRunRecords(records);
  return records;
}

export function appendMockRunRecord(record: AgentRunRecord): AgentRunRecord[] {
  const existing = readMockRunRecords();
  const next = [record, ...existing];
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
  const existing = readMockRunRecords();
  const next = existing.map(record =>
    record.id === runId ? mutator(record) : record,
  );
  writeMockRunRecords(next);
  return next;
}

export function readMockRunRecord(runId: string): AgentRunRecord | null {
  const records = readMockRunRecords();
  return records.find(record => record.id === runId) ?? null;
}

// ---------- summary projection ------------------------------------------
//
// Mirrors lib/agent-runs.ts#listRunSummaries(): strips the heavy `result`
// and `events` fields so the list page matches exactly.

export function toRunSummary(record: AgentRunRecord): AgentRunSummary {
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
    leaderboardStatus: record.leaderboardSubmission?.status,
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

// ---------- change notification -----------------------------------------
//
// Mission control mutates the store, and the hybrid wrappers render from
// it. We dispatch a custom event so wrappers can re-read the store
// without a full router.refresh() round-trip. `storage` events also fire
// on cross-tab edits, so we forward those through the same channel.

const CHANGE_EVENT = "mrkrabs:mock-store-changed";

export function emitMockStoreChanged(): void {
  if (!hasStorage()) return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

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
