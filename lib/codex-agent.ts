import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { generateObject } from "ai"
import { codexExec } from "ai-sdk-provider-codex-cli"

import {
  portfolioOutputSchema,
  type PortfolioOutput,
  type PortfolioPosition,
} from "@/lib/portfolio-schema"

const DEFAULT_MODEL = process.env.CODEX_MODEL?.trim() || "gpt-5.4-mini"
const DEFAULT_AGENT_NAME = "mrkrabs-codex-cli"
const DEFAULT_AGENT_VERSION = "v0.1"
const CALA_MCP_URL = process.env.CALA_MCP_URL?.trim() || "https://api.cala.ai/mcp/"
const CALA_MCP_PROXY_PATH = path.join(process.cwd(), "scripts", "cala-mcp-proxy.sh")
const MIN_POSITION_SIZE = 5_000
const REQUIRED_PORTFOLIO_BUDGET = 1_000_000
const MIN_POSITION_COUNT = 50
const PLACEHOLDER_TICKER_PATTERN =
  /^(UNVERIFIABLE|UNAVAILABLE|DO-NOT-|INVALID-|PLACEHOLDER|REMOVE_|CALA_|BLOCKED|MISSING|NO_SUBMISSION|OMIT|THIS|PAYLOAD)/i

const findBundledCodexPath = () => {
  const pnpmDir = path.join(process.cwd(), "node_modules", ".pnpm")

  try {
    const match = readdirSync(pnpmDir).find((entry) =>
      entry.startsWith("@openai+codex@"),
    )

    if (!match) {
      return undefined
    }

    const candidate = path.join(
      pnpmDir,
      match,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    )

    return existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

const BUNDLED_CODEX_PATH = findBundledCodexPath()

export interface CalaAgentStep {
  text: string
  finishReason: string
  toolCalls: unknown[]
  toolResults: unknown[]
}

export interface CalaAgentResult {
  model: string
  output: PortfolioOutput
  steps: CalaAgentStep[]
}

interface RunCalaAgentOptions {
  onTelemetryEvent?: (event: {
    level: "info" | "error"
    type:
      | "step-started"
      | "tool-started"
      | "tool-finished"
      | "step-finished"
    title: string
    data?: unknown
  }) => Promise<void> | void
  onFinish?: (event: {
    functionId?: string
    metadata?: Record<string, unknown>
    totalUsage: unknown
    result: CalaAgentResult
  }) => Promise<void> | void
}

export const CALA_AGENT_MODEL = DEFAULT_MODEL
export const CALA_AGENT_NAME = DEFAULT_AGENT_NAME
export const CALA_AGENT_VERSION = DEFAULT_AGENT_VERSION

class PortfolioValidationError extends Error {
  issues: string[]

  constructor(issues: string[]) {
    super(issues.join(" "))
    this.name = "PortfolioValidationError"
    this.issues = issues
  }
}

const normalizeTicker = (ticker: string) => ticker.trim().toUpperCase()

const dedupeStrings = (values: string[]) =>
  Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  )

const normalizeText = (value: string, fallback: string) => {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : fallback
}

const safeJsonPreview = (value: unknown, maxLength = 800) => {
  try {
    const serialized = JSON.stringify(value, null, 2)
    return serialized.length > maxLength
      ? `${serialized.slice(0, maxLength)}...`
      : serialized
  } catch {
    return String(value)
  }
}

const mergePositions = (positions: PortfolioPosition[]) => {
  const merged = new Map<string, PortfolioPosition>()

  for (const position of positions) {
    const ticker = normalizeTicker(position.nasdaqCode)
    if (!ticker) {
      continue
    }

    const existing = merged.get(ticker)
    if (!existing) {
      merged.set(ticker, {
        ...position,
        nasdaqCode: ticker,
        companyName: normalizeText(position.companyName, ticker),
        companyEntityId: position.companyEntityId.trim(),
        thesis: normalizeText(position.thesis, `Cala-backed thesis for ${ticker}.`),
        cutoffComplianceNote: normalizeText(
          position.cutoffComplianceNote,
          "Reasoning was intended to avoid data after 2025-04-15.",
        ),
        calaEvidence: dedupeStrings(position.calaEvidence),
        supportingEntityIds: dedupeStrings(position.supportingEntityIds),
        riskNotes: dedupeStrings(position.riskNotes),
      })
      continue
    }

    merged.set(ticker, {
      ...existing,
      amount: Math.max(existing.amount, position.amount),
      companyName:
        existing.companyName.length >= position.companyName.trim().length
          ? existing.companyName
          : normalizeText(position.companyName, existing.companyName),
      companyEntityId:
        existing.companyEntityId.length > 0
          ? existing.companyEntityId
          : position.companyEntityId.trim(),
      thesis:
        existing.thesis.length >= position.thesis.trim().length
          ? existing.thesis
          : normalizeText(position.thesis, existing.thesis),
      cutoffComplianceNote:
        existing.cutoffComplianceNote.length >=
        position.cutoffComplianceNote.trim().length
          ? existing.cutoffComplianceNote
          : normalizeText(
              position.cutoffComplianceNote,
              existing.cutoffComplianceNote,
            ),
      calaEvidence: dedupeStrings([
        ...existing.calaEvidence,
        ...position.calaEvidence,
      ]),
      supportingEntityIds: dedupeStrings([
        ...existing.supportingEntityIds,
        ...position.supportingEntityIds,
      ]),
      riskNotes: dedupeStrings([...existing.riskNotes, ...position.riskNotes]),
    })
  }

  return Array.from(merged.values())
}

const allocatePortfolioAmounts = (positions: PortfolioPosition[]) => {
  const minimumBudget = positions.length * MIN_POSITION_SIZE

  if (minimumBudget > REQUIRED_PORTFOLIO_BUDGET) {
    throw new PortfolioValidationError([
      `Portfolio has ${positions.length} positions, which exceeds the maximum supported count for a $${REQUIRED_PORTFOLIO_BUDGET.toLocaleString()} budget with a $${MIN_POSITION_SIZE.toLocaleString()} minimum.`,
    ])
  }

  const remainingBudget = REQUIRED_PORTFOLIO_BUDGET - minimumBudget
  const weights = positions.map((position) =>
    Math.max(position.amount - MIN_POSITION_SIZE, 0),
  )
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const normalizedWeights = weightSum > 0 ? weights : positions.map(() => 1)
  const normalizedWeightSum = normalizedWeights.reduce(
    (sum, weight) => sum + weight,
    0,
  )

  const provisionalExtras = normalizedWeights.map(
    (weight) => (remainingBudget * weight) / normalizedWeightSum,
  )
  const flooredExtras = provisionalExtras.map((extra) => Math.floor(extra))
  let remainder =
    REQUIRED_PORTFOLIO_BUDGET -
    (minimumBudget + flooredExtras.reduce((sum, extra) => sum + extra, 0))

  const fractionalOrder = provisionalExtras
    .map((extra, index) => ({
      index,
      remainder: extra - flooredExtras[index],
    }))
    .sort((a, b) => b.remainder - a.remainder)

  const extras = [...flooredExtras]
  for (const entry of fractionalOrder) {
    if (remainder <= 0) {
      break
    }
    extras[entry.index] += 1
    remainder -= 1
  }

  return positions.map((position, index) => ({
    ...position,
    amount: MIN_POSITION_SIZE + extras[index],
  }))
}

const renderReportMarkdown = (output: Omit<PortfolioOutput, "reportMarkdown">) => {
  const portfolioLines = output.positions.flatMap((position) => {
    const evidenceLines =
      position.calaEvidence.length > 0
        ? position.calaEvidence.map((item) => `- ${item}`)
        : ["- No additional evidence captured."]
    const riskLines =
      position.riskNotes.length > 0
        ? position.riskNotes.map((item) => `- ${item}`)
        : ["- No explicit risks captured."]

    return [
      `### ${position.companyName} (${position.nasdaqCode})`,
      `- Company: <entity UUID="${position.companyEntityId}">${position.companyName}</entity>`,
      `- Ticker: ${position.nasdaqCode}`,
      `- Allocation: $${position.amount.toLocaleString("en-US")}`,
      `- Thesis: ${position.thesis}`,
      `- Cutoff note: ${position.cutoffComplianceNote}`,
      "- Cala-backed evidence:",
      ...evidenceLines,
      "- Risks:",
      ...riskLines,
      "",
    ]
  })

  const openGapLines =
    output.openGaps.length > 0
      ? output.openGaps.map((gap) => `- ${gap}`)
      : ["- No additional open gaps recorded."]

  const cutoffLines =
    output.cutoffAudit.bannedDataChecks.length > 0
      ? output.cutoffAudit.bannedDataChecks.map((check) => `- ${check}`)
      : ["- No explicit banned-data checks recorded."]

  return [
    "# Lobster of Wall Street: NASDAQ Portfolio Challenge Submission",
    "",
    "## Thesis",
    output.portfolioThesis,
    "",
    "## Portfolio Decisions",
    ...portfolioLines,
    "## Time Cutoff Audit",
    `- Post-cutoff data used: ${output.cutoffAudit.postCutoffDataUsed ? "yes" : "no"}`,
    `- Summary: ${output.cutoffAudit.complianceSummary}`,
    ...cutoffLines,
    "",
    "## Open Gaps",
    ...openGapLines,
  ].join("\n")
}

const normalizeAndValidateOutput = (
  output: PortfolioOutput,
  teamId: string,
): PortfolioOutput => {
  const issues: string[] = []

  const mergedPositions = mergePositions(output.positions).filter(
    (position) => position.companyEntityId.length > 0,
  )

  if (mergedPositions.length < MIN_POSITION_COUNT) {
    issues.push(
      `Portfolio has only ${mergedPositions.length} unique positions with Cala UUIDs after deduplication; at least ${MIN_POSITION_COUNT} are required.`,
    )
  }

  for (const position of mergedPositions) {
    if (!position.nasdaqCode) {
      issues.push("A position is missing a NASDAQ ticker.")
    }
    if (!position.companyEntityId) {
      issues.push(`Position ${position.nasdaqCode} is missing a Cala entity UUID.`)
    }
    if (PLACEHOLDER_TICKER_PATTERN.test(position.nasdaqCode)) {
      issues.push(
        `Position ${position.nasdaqCode} looks like a placeholder ticker rather than a real NASDAQ symbol.`,
      )
    }
  }

  if (output.cutoffAudit.postCutoffDataUsed) {
    issues.push(
      "cutoffAudit.postCutoffDataUsed was true; the portfolio must explicitly avoid post-2025-04-15 data.",
    )
  }

  if (issues.length > 0) {
    throw new PortfolioValidationError(issues)
  }

  const normalizedPositions = allocatePortfolioAmounts(mergedPositions)
  const normalizedOutput: PortfolioOutput = {
    portfolioThesis: normalizeText(
      output.portfolioThesis,
      "Cala-grounded NASDAQ portfolio thesis.",
    ),
    submissionPayload: {
      team_id: teamId,
      model_agent_name: DEFAULT_AGENT_NAME,
      model_agent_version: DEFAULT_AGENT_VERSION,
      transactions: normalizedPositions.map((position) => ({
        nasdaq_code: position.nasdaqCode,
        amount: position.amount,
      })),
    },
    positions: normalizedPositions,
    cutoffAudit: {
      postCutoffDataUsed: false,
      complianceSummary: normalizeText(
        output.cutoffAudit.complianceSummary,
        "Portfolio reasoning was normalized to a Cala-grounded, pre-2025-04-15 research workflow.",
      ),
      bannedDataChecks: dedupeStrings(output.cutoffAudit.bannedDataChecks),
    },
    openGaps: dedupeStrings(output.openGaps),
    reportMarkdown: "",
  }

  normalizedOutput.reportMarkdown = renderReportMarkdown({
    portfolioThesis: normalizedOutput.portfolioThesis,
    submissionPayload: normalizedOutput.submissionPayload,
    positions: normalizedOutput.positions,
    cutoffAudit: normalizedOutput.cutoffAudit,
    openGaps: normalizedOutput.openGaps,
  })

  return normalizedOutput
}

const buildCodexPrompt = (prompt: string) => `
You are building a submission-ready portfolio for Cala's "Lobster of Wall Street" challenge.

Hard constraints:
- Use Cala as the knowledge source via MCP.
- At least 50 unique NASDAQ tickers.
- Each position must be at least $5,000.
- Total allocation must equal exactly $1,000,000.
- No duplicate tickers.
- Do not use stock prices, returns, or events after 2025-04-15.
- Only recommend companies with verified Cala UUIDs.
- Use <entity UUID="...">Company Name</entity> tags in reportMarkdown.
- submissionPayload.transactions[].nasdaq_code and positions[].nasdaqCode must be the exact tradable ticker symbol, not the company name.
- Never use a spelled-out company name where a ticker symbol is required.
- Examples of correct symbol formatting: WDAY not WORKDAY, PYPL not PAYPAL, MDLZ not MONDELEZ, GOOGL not GOOGLE.

Required identifiers:
- TEAM_ID: ${process.env.TEAM_ID}
- MODEL_AGENT_NAME: ${DEFAULT_AGENT_NAME}
- MODEL_AGENT_VERSION: ${DEFAULT_AGENT_VERSION}

Instructions:
- Use Cala MCP tools for research.
- Prefer entity_search, entity_introspection, and retrieve_entity for company verification.
- Use knowledge_search only if you need broader discovery, then verify companies with Cala entity tools.
- For every selected company, verify both:
  1. the Cala company UUID
  2. the exact NASDAQ ticker symbol used in submissionPayload.transactions[].nasdaq_code
- Treat ticker verification as mandatory. If you cannot verify the exact ticker symbol, exclude the company.
- Every position must include a real Cala company UUID in companyEntityId.
- supportingEntityIds must contain only Cala UUID strings when present.
- Do not emit placeholders, fake tickers, fake UUIDs, or blocker payloads.
- Do not infer ticker symbols from company names and do not expand ticker symbols into company names.
- Before finalizing, re-check that every nasdaq_code is a short market symbol rather than a human-readable company label.
- If you cannot verify a company in Cala, exclude it.
- Return only the final JSON object matching the provided schema.

User request:
${prompt}
`.trim()

const createModel = () =>
  codexExec(DEFAULT_MODEL, {
    codexPath: BUNDLED_CODEX_PATH,
    allowNpx: true,
    approvalMode: "never",
    sandboxMode: "read-only",
    skipGitRepoCheck: true,
    cwd: process.cwd(),
    verbose: true,
    logger: {
      debug: (message) => console.debug("[codex-provider][debug]", message),
      info: (message) => console.info("[codex-provider][info]", message),
      warn: (message) => console.warn("[codex-provider][warn]", message),
      error: (message) => console.error("[codex-provider][error]", message),
    },
    mcpServers: {
      Cala: {
        transport: "stdio",
        command: "sh",
        args: [CALA_MCP_PROXY_PATH],
        env: {
          CALA_API_KEY: process.env.CALA_API_KEY ?? "",
        },
        enabledTools: [
          "knowledge_search",
          "knowledge_query",
          "entity_search",
          "entity_introspection",
          "retrieve_entity",
        ],
      },
    },
  })

export async function runCalaAgent(
  prompt: string,
  options?: RunCalaAgentOptions,
): Promise<CalaAgentResult> {
  if (!process.env.TEAM_ID) {
    throw new Error("TEAM_ID is required")
  }

  if (!process.env.CALA_API_KEY) {
    throw new Error("CALA_API_KEY is required")
  }

  console.info("[codex-agent][start]", {
    model: DEFAULT_MODEL,
    promptLength: prompt.length,
    calaMcpUrl: CALA_MCP_URL,
    calaMcpProxyPath: CALA_MCP_PROXY_PATH,
    codexPath: BUNDLED_CODEX_PATH ?? "npx:@openai/codex",
    enabledTools: [
      "knowledge_search",
      "knowledge_query",
      "entity_search",
      "entity_introspection",
      "retrieve_entity",
    ],
  })

  const result = await generateObject({
    model: createModel(),
    schema: portfolioOutputSchema,
    prompt: buildCodexPrompt(prompt),
  })

  const usage = (result as { usage?: unknown }).usage
  const providerMetadata = (result as { providerMetadata?: unknown }).providerMetadata

  console.info("[codex-agent][raw-output]", {
    model: DEFAULT_MODEL,
    usage: safeJsonPreview(usage, 600),
    providerMetadata: safeJsonPreview(providerMetadata, 1200),
    preview: safeJsonPreview(
      {
        firstPositions: result.object.positions.slice(0, 3),
        firstTransactions: result.object.submissionPayload.transactions.slice(0, 3),
        cutoffAudit: result.object.cutoffAudit,
      },
      2000,
    ),
  })

  let normalizedOutput: PortfolioOutput
  try {
    normalizedOutput = normalizeAndValidateOutput(result.object, process.env.TEAM_ID)
  } catch (error) {
    if (error instanceof PortfolioValidationError) {
      console.error("[codex-agent][validation][failed]", {
        issues: error.issues,
        preview: safeJsonPreview(
          {
            firstPositions: result.object.positions.slice(0, 5),
            firstTransactions: result.object.submissionPayload.transactions.slice(0, 5),
          },
          2000,
        ),
      })
    }
    throw error
  }

  console.info("[codex-agent][success]", {
    model: DEFAULT_MODEL,
    positions: normalizedOutput.positions.length,
    transactions: normalizedOutput.submissionPayload.transactions.length,
    preview: safeJsonPreview(
      {
        portfolioThesis: normalizedOutput.portfolioThesis,
        firstTransactions: normalizedOutput.submissionPayload.transactions.slice(0, 5),
      },
      900,
    ),
  })

  const finalResult = {
    model: DEFAULT_MODEL,
    output: normalizedOutput,
    steps: [],
  } satisfies CalaAgentResult

  await options?.onFinish?.({
    totalUsage: usage,
    metadata:
      providerMetadata && typeof providerMetadata === "object"
        ? (providerMetadata as Record<string, unknown>)
        : undefined,
    result: finalResult,
  })

  return finalResult
}
