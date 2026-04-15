import { z } from "zod"

// Anthropic's structured-output API only accepts a tiny subset of JSON
// Schema: no `minItems > 1`, no numeric `minimum`/`maximum`, no string
// `pattern`/`format`/`minLength`. Codex CLI accepts all of those, but this
// schema is shared, so we strip every constraint and let each agent's
// post-generation validator enforce the real leaderboard rules.

export const portfolioOutputSchema = z.object({
  portfolioThesis: z.string(),
  submissionPayload: z.object({
    team_id: z.string(),
    model_agent_name: z.string(),
    model_agent_version: z.string(),
    transactions: z.array(
      z.object({
        nasdaq_code: z.string(),
        amount: z.number(),
      }),
    ),
  }),
  positions: z.array(
    z.object({
      nasdaqCode: z.string(),
      companyName: z.string(),
      companyEntityId: z.string(),
      amount: z.number(),
      thesis: z.string(),
      currentAnnualFilingDate: z
        .string()
        .describe("Latest annual filing date used for this pick (YYYY-MM-DD), on or before 2025-04-15."),
      priorAnnualFilingDate: z
        .string()
        .nullable()
        .describe(
          "Immediately previous annual filing date (YYYY-MM-DD) used for change detection, or null if unavailable.",
        ),
      subsidiaryCount: z
        .number()
        .describe("Count of subsidiaries/legal entities observed in the filing-linked graph."),
      jurisdictionCount: z
        .number()
        .describe("Count of distinct jurisdictions in the filing-linked company structure."),
      hierarchyDepth: z
        .number()
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
      calaEvidence: z.array(z.string()),
      supportingEntityIds: z.array(z.string()),
      riskNotes: z.array(z.string()),
      cutoffComplianceNote: z.string(),
    }),
  ),
  cutoffAudit: z.object({
    postCutoffDataUsed: z.boolean(),
    complianceSummary: z.string(),
    bannedDataChecks: z.array(z.string()),
  }),
  openGaps: z.array(z.string()),
  reportMarkdown: z.string(),
})

export type PortfolioOutput = z.infer<typeof portfolioOutputSchema>
export type PortfolioPosition = PortfolioOutput["positions"][number]
