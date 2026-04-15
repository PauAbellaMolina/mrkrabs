import { z } from "zod"

const nonEmptyString = z.string().trim().min(1)
const uuidString = z.string().uuid()

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
