import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Public identifiers sent to the Cala leaderboard.
//
// Manual one-off runs use the raw model name — the "Mr. Krabs Autoresearch"
// brand is reserved for the outer-loop experimentation flow (scripts/autoresearch.ts),
// which passes PUBLIC_AUTORESEARCH_AGENT_NAME explicitly when it submits.
// This prevents a single Run-agent click from being labeled as autoresearch.
export const PUBLIC_AGENT_NAME = "Mr. Krabs";
export const PUBLIC_AUTORESEARCH_AGENT_NAME = "Mr. MegaKrabs";

const COUNTER_DIR = path.join(process.cwd(), ".data", "autoresearch");
const COUNTER_PATH = path.join(COUNTER_DIR, "version-counter.json");

interface CounterFile {
  next: number;
}

async function readCounter(): Promise<number> {
  try {
    const raw = await readFile(COUNTER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CounterFile>;
    if (typeof parsed.next === "number" && parsed.next > 0) {
      return parsed.next;
    }
  } catch {
    // Missing or malformed file — fall through to the default.
  }
  return 1;
}

async function writeCounter(next: number): Promise<void> {
  await mkdir(COUNTER_DIR, { recursive: true });
  await writeFile(
    COUNTER_PATH,
    JSON.stringify({ next } satisfies CounterFile, null, 2),
    "utf8",
  );
}

// Allocate a fresh monotonic `vN` string for a submission and persist the
// increment. Not atomic across concurrent processes — for a single-process
// dev loop that's fine; if we ever run parallel experiments we'll swap this
// for an advisory lock.
export async function allocateNextVersion(): Promise<string> {
  const current = await readCounter();
  await writeCounter(current + 1);
  return `v${current}`;
}

// Read-only peek at the most recently allocated version, without mutating.
export async function peekLastVersion(): Promise<string> {
  const current = await readCounter();
  return current > 1 ? `v${current - 1}` : "v0";
}
