import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";
import { createCalaTools } from "./cala-tools";
import { portfolioOutputSchema, type PortfolioOutput } from "./portfolio-schema";

const DEFAULT_MODEL = "claude-haiku-4-5"
// Local display name for manual runs. The autoresearch outer loop overrides
// this when it creates its own run records, so "Mr. Krabs Autoresearch" only
// ever labels runs produced by scripts/autoresearch.ts — never manual Run-agent
// clicks from the dashboard.
const DEFAULT_AGENT_NAME = "Mr. Krabs"
const DEFAULT_AGENT_VERSION = "—"

// Leaderboard constraints the server enforces. We re-check them here so a bad
// generation fails fast with a clear error instead of wasting a submission.
const MIN_POSITION_COUNT = 50
const MIN_POSITION_SIZE = 5_000
const REQUIRED_PORTFOLIO_BUDGET = 1_000_000

class PortfolioValidationError extends Error {
  issues: string[]
  constructor(issues: string[]) {
    super(issues.join(" "))
    this.name = "PortfolioValidationError"
    this.issues = issues
  }
}

const validatePortfolioOutput = (
  output: CalaAgentResult["output"],
): void => {
  const issues: string[] = []
  const transactions = output.submissionPayload.transactions
  const uniqueTickers = new Set(
    transactions.map(t => t.nasdaq_code.trim().toUpperCase()).filter(Boolean),
  )

  if (uniqueTickers.size !== transactions.length) {
    issues.push(
      `Duplicate tickers in submissionPayload.transactions (${transactions.length} entries, ${uniqueTickers.size} unique).`,
    )
  }

  if (uniqueTickers.size < MIN_POSITION_COUNT) {
    issues.push(
      `Only ${uniqueTickers.size} unique tickers; leaderboard requires at least ${MIN_POSITION_COUNT}.`,
    )
  }

  for (const t of transactions) {
    if (t.amount < MIN_POSITION_SIZE) {
      issues.push(
        `Ticker ${t.nasdaq_code} allocated $${t.amount} — minimum is $${MIN_POSITION_SIZE}.`,
      )
    }
    if (!Number.isInteger(t.amount)) {
      issues.push(`Ticker ${t.nasdaq_code} amount ${t.amount} is not an integer dollar value.`)
    }
  }

  const total = transactions.reduce((sum, t) => sum + t.amount, 0)
  if (total !== REQUIRED_PORTFOLIO_BUDGET) {
    issues.push(
      `Portfolio total is $${total}; leaderboard requires exactly $${REQUIRED_PORTFOLIO_BUDGET}.`,
    )
  }

  if (output.cutoffAudit.postCutoffDataUsed) {
    issues.push(
      "cutoffAudit.postCutoffDataUsed is true; reasoning must stay before 2025-04-15.",
    )
  }

  if (output.positions.length !== transactions.length) {
    issues.push(
      `positions (${output.positions.length}) and transactions (${transactions.length}) must describe the same portfolio.`,
    )
  }

  if (issues.length > 0) throw new PortfolioValidationError(issues)
}

export const CALA_AGENT_NAME = DEFAULT_AGENT_NAME;
export const CALA_AGENT_VERSION = DEFAULT_AGENT_VERSION;
export const CALA_AGENT_MODEL = DEFAULT_MODEL;

export interface CalaAgentStep {
  text: string;
  finishReason: string;
  toolCalls: unknown[];
  toolResults: unknown[];
}

export interface CalaAgentResult {
  model: string;
  output: PortfolioOutput;
  steps: CalaAgentStep[];
}

interface RunCalaAgentOptions {
  // Autoresearch hook. When provided, the outer loop's variant prompt is
  // used instead of BASE_SYSTEM_PROMPT. Manual runs from the UI leave this
  // unset and get the baseline prompt.
  systemPromptOverride?: string;
  // Override the default step budget. Autoresearch uses a higher cap so the
  // agent can research more candidates per run; manual UI runs keep the
  // default.
  stepBudget?: number;
  onTelemetryEvent?: (event: {
    level: "info" | "error";
    type: "step-started" | "tool-started" | "tool-finished" | "step-finished";
    title: string;
    data?: unknown;
  }) => Promise<void> | void;
  onFinish?: (event: {
    functionId?: string;
    metadata?: Record<string, unknown>;
    totalUsage: unknown;
    result: CalaAgentResult;
  }) => Promise<void> | void;
}

// Exported so the autoresearch script can bootstrap the baseline champion
// prompt in Convex and measure mutation drift against it.
export const BASE_SYSTEM_PROMPT = `
You are a financial research agent building a NASDAQ portfolio report for Cala's
"Lobster of Wall Street" challenge using Cala's verified entity graph tools.

Rules:
- Use Cala tools for factual claims about companies, entities, or relationships.
- Prefer the entity workflow when possible: entity_search -> entity_introspection -> retrieve_entity.
- Do not present unsupported facts from memory when Cala tools can verify them.
- If Cala does not contain the requested data, say that clearly.
- Your primary job is to produce a submission-ready challenge portfolio and an explainable markdown report.
- The primary alpha thesis is FIXED: favor companies with low or improving
  filing-linked legal-entity complexity. Do not invent a different thesis.
- The challenge constraints are strict:
  - at least 50 distinct NASDAQ tickers
  - each position must be at least 5000 USD
  - total invested must equal exactly 1000000 USD
  - no duplicate tickers
- Do not use or reference stock prices, returns, or market events after 2025-04-15.
- Research signals must be grounded in Cala filing-linked company structure on or
  before 2025-04-15.
- Use legal-entity complexity as the primary ranking signal:
  - currentAnnualFilingDate
  - priorAnnualFilingDate when available
  - subsidiaryCount
  - jurisdictionCount
  - hierarchyDepth
  - complexityScore
  - complexityChangeVsPrior
- Executive changes, corporate events, regulatory context, supply-chain context,
  and financial metrics may appear only as tie-breakers, evidence color, or risk notes.
- For every company you recommend buying, include its Cala entity UUID inline
  using this exact HTML tag format: <entity UUID="uuid">Company Name</entity>
- Never invent UUIDs. Only use UUIDs that came back from Cala tools.
- If you cite supporting non-company entities such as people, laws, products, or
  corporate events, you may tag them with the same <entity UUID="uuid">Name</entity> format.
- If a company lacks a verified Cala UUID, do not recommend it as a buy.
- Return only valid data matching the requested schema.
- The submissionPayload.transactions array and the positions array must refer to the same portfolio and the same amounts, same length.
- team_id must match the provided environment team id exactly.
- model_agent_name and model_agent_version must be stable identifiers for this agent.
- reportMarkdown must be concise and factual.
- Use exactly 50 positions at $20,000 each unless the schema or validator forces a repair.

Workflow:
1. Resolve companies with entity_search, preferring SEC legal names over casual ticker-name queries.
2. Introspect each company to discover populated ownership/control structure and dated evidence.
3. Retrieve only the filing-linked structural facts needed to estimate legal-entity complexity.
4. Exclude companies that cannot be tied to filing-linked pre-cutoff evidence.
5. Rank on low or improving complexity, then write the narrative.

reportMarkdown should follow this structure:
## Thesis
State the single fixed filings/entity-relationship complexity thesis.

## Signal Design
Define the filing-linked legal-entity complexity signal and cutoff discipline.

## Portfolio Decisions
For each buy:
- Company: <entity UUID="...">Name</entity>
- Ticker: TICKER
- Allocation: $...
- Filing date used
- Prior filing date used
- Complexity metrics: subsidiary count, jurisdiction count, hierarchy depth, complexity score, change vs prior
- Why it belongs under the fixed thesis
- Cala-backed evidence
- Risks

## Time Cutoff Audit
Explain why the reasoning avoided post-2025-04-15 information.

## Open Gaps
Missing data, point-in-time caveats, or reasons confidence is limited.
`.trim();

// Internal alias kept for the existing generateText call site below.
const systemPrompt = BASE_SYSTEM_PROMPT;

export async function runCalaAgent(
  prompt: string,
  options?: RunCalaAgentOptions,
): Promise<CalaAgentResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  if (!process.env.TEAM_ID) {
    throw new Error("TEAM_ID is required");
  }
  const tools = createCalaTools();

  console.info("[cala-agent][tools]", {
    toolCount: Object.keys(tools).length,
    toolNames: Object.keys(tools),
  });

  try {
    const effectiveSystemPrompt = options?.systemPromptOverride ?? systemPrompt;
    const result = await generateText({
      model: anthropic(DEFAULT_MODEL),
      system: effectiveSystemPrompt,
      prompt: [
        `TEAM_ID: ${process.env.TEAM_ID}`,
        `MODEL_AGENT_NAME: ${DEFAULT_AGENT_NAME}`,
        `MODEL_AGENT_VERSION: ${DEFAULT_AGENT_VERSION}`,
        "",
        "Return a challenge-ready structured portfolio response.",
        "The output must satisfy the schema exactly.",
        "The portfolio must be submission-ready for the leaderboard endpoint.",
        "",
        prompt,
      ].join("\n"),
      tools,
      stopWhen: stepCountIs(options?.stepBudget ?? 6),
      output: Output.object({
        schema: portfolioOutputSchema,
        name: "portfolio_report",
        description:
          "A submission-ready NASDAQ portfolio, a cutoff audit, and a markdown report with Cala entity citations.",
      }),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "mrkrabs.cala-agent.run",
        metadata: {
          agentName: DEFAULT_AGENT_NAME,
          agentVersion: DEFAULT_AGENT_VERSION,
        },
        integrations: {
          onStepStart: async (event) => {
            await options?.onTelemetryEvent?.({
              level: "info",
              type: "step-started",
              title: `Step ${event.stepNumber + 1} started`,
              data: {
                stepNumber: event.stepNumber,
                model: event.model,
              },
            });
          },
          onToolCallStart: async (event) => {
            await options?.onTelemetryEvent?.({
              level: "info",
              type: "tool-started",
              title: `Tool ${event.toolCall.toolName} started`,
              data: {
                stepNumber: event.stepNumber,
                toolCallId: event.toolCall.toolCallId,
                toolName: event.toolCall.toolName,
                input: event.toolCall.input,
              },
            });
          },
          onToolCallFinish: async (event) => {
            await options?.onTelemetryEvent?.({
              level: event.success ? "info" : "error",
              type: "tool-finished",
              title: `Tool ${event.toolCall.toolName} ${event.success ? "finished" : "failed"}`,
              data: event.success
                ? {
                    stepNumber: event.stepNumber,
                    toolCallId: event.toolCall.toolCallId,
                    toolName: event.toolCall.toolName,
                    durationMs: event.durationMs,
                    output: event.output,
                  }
                : {
                    stepNumber: event.stepNumber,
                    toolCallId: event.toolCall.toolCallId,
                    toolName: event.toolCall.toolName,
                    durationMs: event.durationMs,
                    error: event.error,
                  },
            });
          },
          onStepFinish: async (event) => {
            await options?.onTelemetryEvent?.({
              level: "info",
              type: "step-finished",
              title: `Step ${event.stepNumber + 1} finished`,
              data: {
                stepNumber: event.stepNumber,
                finishReason: event.finishReason,
                toolCallCount: event.toolCalls.length,
                text: event.text,
                usage: event.usage,
              },
            });
          },
        },
      },
    });

    console.info("[cala-agent][generateText][success]", {
      model: DEFAULT_MODEL,
      steps: result.steps.length,
      positions: result.output.positions.length,
      transactions: result.output.submissionPayload.transactions.length,
    });

    const response = {
      model: DEFAULT_MODEL,
      output: result.output,
      steps: result.steps.map((step) => ({
        text: step.text,
        finishReason: step.finishReason,
        toolCalls: step.toolCalls,
        toolResults: step.toolResults,
      })),
    };

    // Schema can no longer encode leaderboard constraints (Anthropic
    // rejects minItems > 1 and number minimum), so we enforce the same
    // rules post-generation and fail fast with a clear message.
    validatePortfolioOutput(response.output);

    await options?.onFinish?.({
      totalUsage: result.totalUsage,
      result: response,
    });

    return response;
  } catch (error) {
    console.error("[cala-agent][generateText][error]", {
      model: DEFAULT_MODEL,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    });
    throw error;
  }
}
