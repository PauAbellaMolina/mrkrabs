import { tool } from "ai";
import { z } from "zod";
import {
  researchCheckpointSchema,
  summarizeResearchCheckpoint,
} from "./research-checkpoint";
import type { ResearchCheckpointState } from "./research-checkpoint-state";

export function createSaveResearchCheckpointTool(
  state: ResearchCheckpointState,
) {
  return tool({
    description:
      "Save the latest full portfolio-research checkpoint. Use after meaningful research batches, ranking updates, portfolio-draft changes, and immediately before finalization. Always write the full snapshot, not a patch.",
    inputSchema: researchCheckpointSchema,
    execute: async (input) => {
      // Convex can occasionally return a transient "Server Error" on these
      // mutations (usually payload-size adjacent — the checkpoint can be
      // hundreds of KB). Don't let that throw the tool call: the agent
      // should see a clean error result and keep working with the
      // in-memory checkpoint, which the state layer still retains.
      try {
        const checkpoint = await state.save(input);
        return {
          saved: true as const,
          ...summarizeResearchCheckpoint(checkpoint),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          saved: false as const,
          error: message,
          hint:
            "Checkpoint persist failed. You can continue — the in-memory copy is retained. Try again later with a smaller payload (fewer candidateCompanies or shorter evidence/risks) if this repeats.",
        };
      }
    },
  });
}

export function createLoadResearchCheckpointTool(
  state: ResearchCheckpointState,
) {
  return tool({
    description:
      "Load the latest saved research checkpoint. Use before ranking, before finalization, and whenever earlier candidate state may have fallen out of context.",
    inputSchema: z.object({
      reason: z.string().trim().max(280).optional(),
    }),
    execute: async () => {
      try {
        const result = await state.load();
        if (!result.exists) {
          return {
            exists: false as const,
            message: "No checkpoint has been saved yet.",
          };
        }

        return {
          exists: true as const,
          checkpoint: result.checkpoint,
          ...summarizeResearchCheckpoint(result.checkpoint),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          exists: false as const,
          error: message,
          message:
            "Checkpoint load failed. Continue without prior state — re-research as needed.",
        };
      }
    },
  });
}
