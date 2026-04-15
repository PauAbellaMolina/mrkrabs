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
      const checkpoint = await state.save(input);
      return {
        saved: true as const,
        ...summarizeResearchCheckpoint(checkpoint),
      };
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
    },
  });
}
