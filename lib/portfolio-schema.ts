import { z } from "zod";

// Anthropic's structured-output API only accepts a limited subset of JSON schema.
// We keep a strict schema for application-level validation, and a lenient schema
// for model output parsing.

const nonEmptyString = z.string().trim().min(1);
const uuidString = z.string().uuid();
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

const laxString = z.string();
const laxNumber = z.number();

const positionSchema = z.object({
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
  complexityScore: z.number(),
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
});

const laxPositionSchema = z.object({
  nasdaqCode: laxString,
  companyName: laxString,
  companyEntityId: laxString,
  amount: laxNumber,
  thesis: laxString,
  currentAnnualFilingDate: laxString,
  priorAnnualFilingDate: laxString.nullable(),
  subsidiaryCount: laxNumber,
  jurisdictionCount: laxNumber,
  hierarchyDepth: laxNumber,
  complexityScore: laxNumber,
  complexityChangeVsPrior: laxNumber.nullable(),
  calaEvidence: z.array(laxString),
  supportingEntityIds: z.array(laxString),
  riskNotes: z.array(laxString),
  cutoffComplianceNote: laxString,
});

const submissionTransactionSchema = z.object({
  nasdaq_code: nonEmptyString,
  amount: z.number().min(5000),
});

const laxSubmissionTransactionSchema = z.object({
  nasdaq_code: laxString,
  amount: laxNumber,
});

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
});

export const portfolioOutputSchemaForAnthropic = z.object({
  portfolioThesis: laxString,
  submissionPayload: z.object({
    team_id: laxString,
    model_agent_name: laxString,
    model_agent_version: laxString,
    transactions: z.array(laxSubmissionTransactionSchema),
  }),
  positions: z.array(laxPositionSchema),
  cutoffAudit: z.object({
    postCutoffDataUsed: z.boolean(),
    complianceSummary: laxString,
    bannedDataChecks: z.array(laxString),
  }),
  openGaps: z.array(laxString),
  reportMarkdown: laxString,
});

export const portfolioOutputSchemaStrict = z.object({
  portfolioThesis: nonEmptyString,
  submissionPayload: z.object({
    team_id: nonEmptyString,
    model_agent_name: nonEmptyString,
    model_agent_version: nonEmptyString,
    transactions: z.array(submissionTransactionSchema).min(50),
  }),
  positions: z.array(positionSchema).min(50),
  cutoffAudit: z.object({
    postCutoffDataUsed: z.boolean(),
    complianceSummary: nonEmptyString,
    bannedDataChecks: z.array(nonEmptyString),
  }),
  openGaps: z.array(nonEmptyString),
  reportMarkdown: nonEmptyString,
});

export type PortfolioOutput = z.infer<typeof portfolioOutputSchemaStrict>;
export type PortfolioOutputForAnthropic = z.infer<typeof portfolioOutputSchemaForAnthropic>;
export type PortfolioPosition = PortfolioOutput["positions"][number];
