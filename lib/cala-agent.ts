import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  portfolioOutputSchema,
  portfolioOutputSchemaForAnthropic,
  type PortfolioOutput,
} from "./portfolio-schema";

const execFileAsync = promisify(execFile);

const DEFAULT_MODEL = "claude-sonnet-4-6";
const CALA_MCP_URL =
  process.env.CALA_MCP_URL?.trim() || "https://api.cala.ai/mcp/";
const CODE_EXEC_MAX_STDOUT_CHARS = 12_000;
const CODE_EXEC_MAX_STDERR_CHARS = 12_000;
const CODE_EXEC_DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STEP_BUDGET = 50;
const CONTEXT_CLEAR_TOOL_TRIGGER_TOKENS = 30_000;
const CONTEXT_CLEAR_TOOL_KEEP_COUNT = 8;
const CONTEXT_CLEAR_TOOL_MIN_TOKENS = 4_000;
const CONTEXT_COMPACT_TRIGGER_TOKENS = 50_000;

// Local display name for manual runs. The autoresearch outer loop overrides
// this when it creates its own run records, so "Mr. Krabs Autoresearch" only
// ever labels runs produced by scripts/autoresearch.ts — never manual Run-agent
// clicks from the dashboard.
const DEFAULT_AGENT_NAME = "Mr. Krabs";
const DEFAULT_AGENT_VERSION = "—";

// Leaderboard constraints the server enforces. We re-check them here so a bad
// generation fails fast with a clear error instead of wasting a submission.
const MIN_POSITION_COUNT = 50;
const MIN_POSITION_SIZE = 5_000;
const REQUIRED_PORTFOLIO_BUDGET = 1_000_000;

class PortfolioValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "PortfolioValidationError";
    this.issues = issues;
  }
}

const validatePortfolioOutput = (
  output: CalaAgentResult["output"],
): void => {
  const issues: string[] = [];
  const transactions = output.submissionPayload.transactions;
  const uniqueTickers = new Set(
    transactions
      .map((t) => t.nasdaq_code.trim().toUpperCase())
      .filter(Boolean),
  );

  if (uniqueTickers.size !== transactions.length) {
    issues.push(
      `Duplicate tickers in submissionPayload.transactions (${transactions.length} entries, ${uniqueTickers.size} unique).`,
    );
  }

  if (uniqueTickers.size < MIN_POSITION_COUNT) {
    issues.push(
      `Only ${uniqueTickers.size} unique tickers; leaderboard requires at least ${MIN_POSITION_COUNT}.`,
    );
  }

  for (const t of transactions) {
    if (t.amount < MIN_POSITION_SIZE) {
      issues.push(
        `Ticker ${t.nasdaq_code} allocated $${t.amount} — minimum is $${MIN_POSITION_SIZE}.`,
      );
    }
    if (!Number.isInteger(t.amount)) {
      issues.push(`Ticker ${t.nasdaq_code} amount ${t.amount} is not an integer dollar value.`);
    }
  }

  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  if (total !== REQUIRED_PORTFOLIO_BUDGET) {
    issues.push(
      `Portfolio total is $${total}; leaderboard requires exactly $${REQUIRED_PORTFOLIO_BUDGET}.`,
    );
  }

  if (output.cutoffAudit.postCutoffDataUsed) {
    issues.push(
      "cutoffAudit.postCutoffDataUsed is true; reasoning must stay before 2025-04-15.",
    );
  }

  if (output.positions.length !== transactions.length) {
    issues.push(
      `positions (${output.positions.length}) and transactions (${transactions.length}) must describe the same portfolio.`,
    );
  }

  if (issues.length > 0) throw new PortfolioValidationError(issues);
};

export const CALA_AGENT_NAME = DEFAULT_AGENT_NAME;
export const CALA_AGENT_VERSION = DEFAULT_AGENT_VERSION;
export const CALA_AGENT_MODEL = DEFAULT_MODEL;

interface ExecCodeResult {
  ok: boolean;
  runtime: "node" | "python" | "bash";
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

const resolveSandboxNodeEnv = () => {
  const nodeEnv = process.env.NODE_ENV;

  return nodeEnv === "development" || nodeEnv === "production" || nodeEnv === "test"
    ? nodeEnv
    : "production";
};

const truncateOutput = (value: string, limit: number) => {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}...`;
};

const toText = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Buffer) {
    return value.toString("utf8");
  }

  return "";
};

const extractJsonObject = (text: string) => {
  const fenced = text.match(/```json([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Model response did not contain a JSON object.");
  }

  const candidate = fenced.slice(start, end + 1);
  return JSON.parse(candidate);
};

const anthropicContextManagement = {
  edits: [
    {
      type: "clear_tool_uses_20250919",
      trigger: {
        type: "input_tokens",
        value: CONTEXT_CLEAR_TOOL_TRIGGER_TOKENS,
      },
      keep: {
        type: "tool_uses",
        value: CONTEXT_CLEAR_TOOL_KEEP_COUNT,
      },
      clearAtLeast: {
        type: "input_tokens",
        value: CONTEXT_CLEAR_TOOL_MIN_TOKENS,
      },
      clearToolInputs: true,
    },
    {
      type: "compact_20260112",
      trigger: {
        type: "input_tokens",
        value: CONTEXT_COMPACT_TRIGGER_TOKENS,
      },
      instructions:
        "Summarize the conversation concisely while preserving hard constraints, Cala-backed evidence, portfolio decisions, unresolved gaps, and any validation repairs already attempted.",
      pauseAfterCompaction: false,
    },
  ],
} satisfies AnthropicLanguageModelOptions["contextManagement"];

const createCodeExecutionTool = () =>
  tool({
    description:
      "Execute code in a short-lived sandbox directory. Use for numerical checks, transformation sanity checks, and quick calculations.",
    inputSchema: z.object({
      runtime: z
        .enum(["node", "python", "bash"])
        .default("node")
        .describe("Runtime to execute the provided code in."),
      code: z.string().min(1).describe("Code to run in the sandbox."),
      timeoutMs: z
        .number()
        .int()
        .optional()
        .describe("Optional execution timeout in milliseconds."),
    }),
    execute: async ({ runtime, code, timeoutMs }) => {
      if (!code.trim()) {
        return {
          ok: false,
          runtime,
          exitCode: 1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          errorMessage: "Code is required.",
        };
      }

      const workspace = await mkdtemp(path.join(os.tmpdir(), "mrkrabs-sandbox-"));
      const fileExt =
        runtime === "python" ? ".py" : runtime === "bash" ? ".sh" : ".js";
      const executable = runtime;
      const sourcePath = path.join(workspace, `main${fileExt}`);
      const start = Date.now();

      const finish = async (outcome: ExecCodeResult) => {
        await rm(workspace, { force: true, recursive: true });
        return outcome;
      };

      await writeFile(sourcePath, `${code}\n`, "utf8");

      try {
        const command = runtime === "bash" ? "/bin/bash" : executable;
        const args = runtime === "bash" ? [sourcePath] : [sourcePath];
        const result = await execFileAsync(command, args, {
          cwd: workspace,
          env: { ...process.env, NODE_ENV: resolveSandboxNodeEnv() },
          timeout: Math.max(500, timeoutMs ?? CODE_EXEC_DEFAULT_TIMEOUT_MS),
          maxBuffer: 200_000,
        });

        return finish({
          ok: true,
          runtime,
          exitCode: 0,
          durationMs: Date.now() - start,
          stdout: truncateOutput(
            result.stdout?.toString("utf8") ?? "",
            CODE_EXEC_MAX_STDOUT_CHARS,
          ),
          stderr: truncateOutput(
            result.stderr?.toString("utf8") ?? "",
            CODE_EXEC_MAX_STDERR_CHARS,
          ),
        });
      } catch (error) {
        const wrapped = error as {
          stdout?: unknown;
          stderr?: unknown;
          code?: number;
          message?: string;
          signal?: string;
        };

        const stdout = truncateOutput(
          toText(wrapped.stdout),
          CODE_EXEC_MAX_STDOUT_CHARS,
        );
        const stderr = truncateOutput(
          toText(wrapped.stderr),
          CODE_EXEC_MAX_STDERR_CHARS,
        );
        const detail =
          wrapped.message ??
          wrapped.signal ??
          "Execution failed before producing structured output.";

        return finish({
          ok: false,
          runtime,
          exitCode: wrapped.code ?? 1,
          durationMs: Date.now() - start,
          stdout,
          stderr,
          errorMessage: detail,
        });
      }
    },
  });

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
  // Override the default Anthropic model ID (e.g. "claude-haiku-4-5",
  // "claude-opus-4-6"). Manual runs from the UI pass the user's picked
  // model here; autoresearch/scripts leave it unset.
  model?: string;
  onTelemetryEvent?: (event: {
    level: "info" | "error";
    type: string;
    title: string;
    data?: unknown;
  }) => Promise<void> | void;
  onFinish?: (event: {
    totalUsage: unknown;
    result: CalaAgentResult;
    functionId?: string;
    metadata?: object;
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

export const runCalaAgent = async (
  prompt: string,
  options?: RunCalaAgentOptions,
): Promise<CalaAgentResult> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  if (!process.env.TEAM_ID) {
    throw new Error("TEAM_ID is required");
  }

  const calaApiKey = process.env.CALA_API_KEY?.trim();

  const client = await createMCPClient({
    transport: {
      type: "http",
      url: CALA_MCP_URL,
      ...(calaApiKey
        ? {
            headers: {
              "X-API-KEY": calaApiKey,
            },
          }
        : {}),
    },
  });
  const tools = await client.tools();

  const calaTools = {
    ...tools,
    run_code: createCodeExecutionTool(),
  };

  const stepBudget = options?.stepBudget ?? DEFAULT_STEP_BUDGET;

  const effectiveModel = options?.model?.trim() || DEFAULT_MODEL;
  const effectiveSystemPrompt = options?.systemPromptOverride?.trim() || systemPrompt;

  try {
    const result = await generateText({
      model: anthropic(effectiveModel),
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
      stopWhen: stepCountIs(stepBudget),
      tools: calaTools,
      toolChoice: "auto",
      providerOptions: {
        anthropic: {
          contextManagement: anthropicContextManagement,
        } satisfies AnthropicLanguageModelOptions,
      },
      maxOutputTokens: 8000,
      maxRetries: 2,
      experimental_onStepStart: async (event: {
        stepNumber: number;
        toolCalls: unknown[];
      }) => {
        await options?.onTelemetryEvent?.({
          level: "info",
          type: "step-started",
          title: `Step ${event.stepNumber + 1} started`,
          data: {
            stepNumber: event.stepNumber,
            toolCount: event.toolCalls.length,
          },
        });
      },
      onStepFinish: async (event: {
        stepNumber: number;
        finishReason: string;
        toolCalls: unknown[];
        text: string;
        usage: unknown;
      }) => {
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
    });

    const parsedOutput = portfolioOutputSchemaForAnthropic.parse(
      extractJsonObject(result.text),
    );
    const validatedOutput = portfolioOutputSchema.parse(parsedOutput);

    console.info("[cala-agent][generateText][success]", {
      model: effectiveModel,
      steps: result.steps.length,
      positions: parsedOutput.positions.length,
      transactions: parsedOutput.submissionPayload.transactions.length,
    });

    const response = {
      model: effectiveModel,
      output: validatedOutput,
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
      functionId: "cala-agent",
      metadata: {},
    });

    return response;
  } catch (error) {
    console.error("[cala-agent][generateText][error]", {
      model: effectiveModel,
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
  } finally {
    await client.close().catch((closeError) => {
      console.warn("[cala-agent][mcp][close-failed]", closeError);
    });
  }
};
