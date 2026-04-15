import { readRunRecord, updateRunCheckpoint } from "./agent-runs";
import {
  researchCheckpointSchema,
  type ResearchCheckpoint,
} from "./research-checkpoint";

export type LoadResearchCheckpointResult =
  | { exists: false }
  | { exists: true; checkpoint: ResearchCheckpoint };

export function createResearchCheckpointState(runId?: string) {
  let checkpoint: ResearchCheckpoint | null = null;

  return {
    async save(nextCheckpoint: ResearchCheckpoint): Promise<ResearchCheckpoint> {
      const parsed = researchCheckpointSchema.parse(nextCheckpoint);
      checkpoint = parsed;
      if (runId) {
        await updateRunCheckpoint(runId, parsed);
      }
      return parsed;
    },

    async load(): Promise<LoadResearchCheckpointResult> {
      if (checkpoint) {
        return { exists: true, checkpoint };
      }

      if (!runId) {
        return { exists: false };
      }

      const run = await readRunRecord(runId);
      const persisted = run.checkpoint;
      if (!persisted) {
        return { exists: false };
      }

      const parsed = researchCheckpointSchema.parse(persisted);
      checkpoint = parsed;
      return { exists: true, checkpoint: parsed };
    },

    hasCheckpoint(): boolean {
      return checkpoint !== null;
    },
  };
}

export type ResearchCheckpointState = ReturnType<
  typeof createResearchCheckpointState
>;
