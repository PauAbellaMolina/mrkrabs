import { z } from "zod"

const nonEmptyString = z.string().trim().min(1)
const uuidString = z.string().uuid()
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date")

export const portfolioOutputSchema = z.object({
  portfolioThesis: nonEmptyString,
  submissionPayload: z.object({
    team_id: nonEmptyString,
    model_agent_name: nonEmptyString,
    model_agent_version: nonEmptyString,
    transactions: z.array(
      z.object({
        nasdaq_code: nonEmptyString,
        amount: z.number().min(5000),
      }),
    ).min(50),
  }),
  positions: z.array(
    z.object({
      nasdaqCode: nonEmptyString,
      companyName: nonEmptyString,
      companyEntityId: uuidString,
      amount: z.number().min(5000),
      thesis: nonEmptyString,
      currentAnnualFilingDate: isoDateString.describe(
        "Latest annual filing date used for this pick, on or before 2025-04-15.",
      ),
      priorAnnualFilingDate: isoDateString
        .nullable()
        .describe(
          "Immediately previous annual filing date used for change detection, or null if unavailable.",
        ),
      subsidiaryCount: z
        .number()
        .int()
        .nonnegative()
        .describe("Count of subsidiaries/legal entities observed in the filing-linked graph."),
      jurisdictionCount: z
        .number()
        .int()
        .nonnegative()
        .describe("Count of distinct jurisdictions in the filing-linked company structure."),
      hierarchyDepth: z
        .number()
        .int()
        .nonnegative()
        .describe("Observed legal-entity hierarchy depth for the company structure."),
      complexityScore: z
        .number()
        .describe("Computed legal-entity complexity score used for ranking."),
      complexityChangeVsPrior: z
        .number()
        .nullable()
        .describe(
          "Change in complexity versus the prior annual filing; negative values mean improving/simplifying.",
        ),
      calaEvidence: z.array(nonEmptyString).min(1),
      supportingEntityIds: z.array(uuidString),
      riskNotes: z.array(nonEmptyString).min(1),
      cutoffComplianceNote: nonEmptyString,
    }),
  ).min(50),
  cutoffAudit: z.object({
    postCutoffDataUsed: z.boolean(),
    complianceSummary: nonEmptyString,
    bannedDataChecks: z.array(nonEmptyString).min(1),
  }),
  openGaps: z.array(nonEmptyString),
  reportMarkdown: nonEmptyString,
})

export type PortfolioOutput = z.infer<typeof portfolioOutputSchema>
export type PortfolioPosition = PortfolioOutput["positions"][number]
