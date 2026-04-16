import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  RESEARCH_CHECKPOINT_CUTOFF_DATE,
  RESEARCH_CHECKPOINT_THESIS,
  researchCheckpointSchema,
  type ResearchCheckpoint,
} from "./research-checkpoint";

const CODEX_CHECKPOINT_DIR = path.join(
  process.cwd(),
  ".data",
  "codex-checkpoints",
);

function createInitialCheckpoint(): ResearchCheckpoint {
  return {
    phase: "discovery",
    thesis: RESEARCH_CHECKPOINT_THESIS,
    cutoffDate: RESEARCH_CHECKPOINT_CUTOFF_DATE,
    candidateCompanies: [],
    portfolioDraft: [],
    openGaps: [],
    notes: [],
    lastUpdatedAtStep: 0,
  };
}

export function getCodexCheckpointFilePath(runId: string) {
  return path.join(CODEX_CHECKPOINT_DIR, `${runId}.json`);
}

export async function ensureCodexCheckpointFile(
  runId: string,
): Promise<string> {
  const filePath = getCodexCheckpointFilePath(runId);
  await mkdir(CODEX_CHECKPOINT_DIR, { recursive: true });
  await writeCodexCheckpointToPath(filePath, createInitialCheckpoint());
  return filePath;
}

export async function writeCodexCheckpointToPath(
  filePath: string,
  checkpoint: ResearchCheckpoint,
) {
  const parsed = researchCheckpointSchema.parse(checkpoint);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function writeCodexCheckpointFile(
  runId: string,
  checkpoint: ResearchCheckpoint,
) {
  const filePath = getCodexCheckpointFilePath(runId);
  await mkdir(CODEX_CHECKPOINT_DIR, { recursive: true });
  await writeCodexCheckpointToPath(filePath, checkpoint);
}

export async function readCodexCheckpointFile(
  runId: string,
): Promise<ResearchCheckpoint | null> {
  const filePath = getCodexCheckpointFilePath(runId);
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(contents);
    return researchCheckpointSchema.parse(parsed);
  } catch {
    return null;
  }
}
