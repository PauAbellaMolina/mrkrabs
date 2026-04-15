import { z } from "zod";

export const RESEARCH_CHECKPOINT_THESIS =
  "Favor NASDAQ companies with low or improving legal-entity complexity from filing-linked subsidiary/control graphs available on or before 2025-04-15.";

export const RESEARCH_CHECKPOINT_CUTOFF_DATE = "2025-04-15";

const shortText = z.string().trim().min(1).max(280);
const mediumText = z.string().trim().min(1).max(500);
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

export const researchCheckpointPhaseSchema = z.enum([
  "discovery",
  "screening",
  "ranking",
  "drafting",
  "finalized",
]);

export const candidateCompanyStatusSchema = z.enum([
  "candidate",
  "rejected",
  "selected",
  "watchlist",
]);

export const checkpointCandidateCompanySchema = z.object({
  ticker: z
    .string()
    .regex(/^[A-Z][A-Z.]{0,5}$/, "Ticker must be uppercase NASDAQ symbol"),
  companyName: mediumText,
  companyEntityId: z.string().uuid(),
  status: candidateCompanyStatusSchema,
  currentAnnualFilingDate: isoDateString,
  priorAnnualFilingDate: isoDateString.nullable(),
  subsidiaryCount: z.number().int().nonnegative(),
  jurisdictionCount: z.number().int().nonnegative(),
  hierarchyDepth: z.number().int().nonnegative(),
  complexityScore: z.number(),
  complexityChangeVsPrior: z.number().nullable(),
  levelScore: z.number(),
  changeScore: z.number(),
  finalScore: z.number(),
  evidence: z.array(shortText).max(12),
  risks: z.array(shortText).max(8),
  rejectionReason: shortText.optional(),
});

export const checkpointPortfolioDraftPositionSchema = z.object({
  ticker: z
    .string()
    .regex(/^[A-Z][A-Z.]{0,5}$/, "Ticker must be uppercase NASDAQ symbol"),
  companyEntityId: z.string().uuid(),
  amount: z.number().int().positive(),
  thesis: shortText,
});

export const researchCheckpointSchema = z.object({
  phase: researchCheckpointPhaseSchema,
  thesis: z.literal(RESEARCH_CHECKPOINT_THESIS),
  cutoffDate: z.literal(RESEARCH_CHECKPOINT_CUTOFF_DATE),
  candidateCompanies: z.array(checkpointCandidateCompanySchema).max(300),
  portfolioDraft: z.array(checkpointPortfolioDraftPositionSchema).max(100),
  openGaps: z.array(shortText).max(20),
  notes: z.array(shortText).max(20),
  lastUpdatedAtStep: z.number().int().nonnegative(),
});

export type ResearchCheckpoint = z.infer<typeof researchCheckpointSchema>;
export type ResearchCheckpointPhase = z.infer<
  typeof researchCheckpointPhaseSchema
>;

export function summarizeResearchCheckpoint(checkpoint: ResearchCheckpoint) {
  return {
    phase: checkpoint.phase,
    candidateCount: checkpoint.candidateCompanies.length,
    draftCount: checkpoint.portfolioDraft.length,
    selectedCount: checkpoint.candidateCompanies.filter(
      candidate => candidate.status === "selected",
    ).length,
    openGapCount: checkpoint.openGaps.length,
    lastUpdatedAtStep: checkpoint.lastUpdatedAtStep,
  };
}
