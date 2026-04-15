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
import { createResearchCheckpointState } from "./research-checkpoint-state";
import {
  createLoadResearchCheckpointTool,
  createSaveResearchCheckpointTool,
} from "./research-checkpoint-tools";
import { BASE_SYSTEM_PROMPT_FOR_RESEARCH } from "./system-prompt";
import { attachConsoleLoggingToTools, previewForConsole } from "./tool-logging";

const execFileAsync = promisify(execFile);

const DEFAULT_MODEL = "claude-sonnet-4-6";
const CALA_MCP_URL =
  process.env.CALA_MCP_URL?.trim() || "https://api.cala.ai/mcp/";
const CODE_EXEC_MAX_STDOUT_CHARS = 12_000;
const CODE_EXEC_MAX_STDERR_CHARS = 12_000;
const CODE_EXEC_DEFAULT_TIMEOUT_MS = 15_000;
// Step budget. Raised from 50 → 80 because Sonnet was hitting the ceiling
// researching 50 candidates without leaving room for the final emit, and
// the submit_portfolio tool now lets us stop early when the agent commits
// (via `hasToolCall("submit_portfolio")`), so a larger headroom is cheap.
const DEFAULT_STEP_BUDGET = 80;
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

// Max number of in-agent repair attempts when post-generation validation
// fails. On failure we re-run generateText with the validation issues
// appended to the prompt so the model can self-correct; this costs extra
// tokens but is cheaper than losing the whole autoresearch iteration.
const MAX_VALIDATION_RETRIES = 2;

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
  runId?: string;
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
  const checkpointState = createResearchCheckpointState(options?.runId);

  const calaTools = attachConsoleLoggingToTools("cala-agent", {
    ...tools,
    run_code: createCodeExecutionTool(),
    save_research_checkpoint:
      createSaveResearchCheckpointTool(checkpointState),
    load_research_checkpoint:
      createLoadResearchCheckpointTool(checkpointState),
  });

  const stepBudget = options?.stepBudget ?? DEFAULT_STEP_BUDGET;

  const effectiveModel = options?.model?.trim() || DEFAULT_MODEL;
  const effectiveSystemPrompt =
    options?.systemPromptOverride?.trim() || BASE_SYSTEM_PROMPT_FOR_RESEARCH;

  // Anthropic's context-management features (clear_tool_uses_20250919,
  // compact_20260112) are only supported on Sonnet/Opus at the moment;
  // Haiku returns a 400 if they're included in providerOptions. Feature-
  // detect by model family and skip the block for Haiku.
  const modelSupportsContextManagement = !effectiveModel.startsWith("claude-haiku-");

  const aggregatedSteps: CalaAgentStep[] = [];
  type UsageLike = Record<string, unknown>;
  let aggregatedUsage: UsageLike | undefined;

  // Merge the AI SDK's usage bag across retry attempts so the caller's
  // cost estimator sees the total work done, not just the final attempt.
  const mergeUsage = (next: unknown) => {
    if (!next || typeof next !== "object") return;
    const nextRecord = next as UsageLike;
    if (!aggregatedUsage) {
      aggregatedUsage = { ...nextRecord };
      return;
    }
    for (const [key, value] of Object.entries(nextRecord)) {
      if (typeof value === "number") {
        const existing = aggregatedUsage[key];
        aggregatedUsage[key] = (typeof existing === "number" ? existing : 0) + value;
      } else if (!(key in aggregatedUsage)) {
        aggregatedUsage[key] = value;
      }
    }
  };

  let previousIssues: string[] = [];
  // Populated when the model invokes submit_portfolio with an input that
  // passes validatePortfolioOutput. Preferred over extractJsonObject when
  // both paths produce output on the same attempt.
  let capturedOutput: PortfolioOutput | null = null;

  const submitPortfolioTool = tool({
    description:
      "Submit your final challenge-ready portfolio. The input schema matches " +
      "the leaderboard JSON exactly. This is your FINAL action — after you " +
      "call this with an accepted portfolio, stop immediately. If the " +
      "response comes back with errors, fix them and call submit_portfolio " +
      "again. Do not return a text answer alongside this call.",
    inputSchema: portfolioOutputSchemaForAnthropic,
    execute: async (input) => {
      try {
        const validated = portfolioOutputSchema.parse(input);
        validatePortfolioOutput(validated);
        capturedOutput = validated;
        const txs = validated.submissionPayload.transactions;
        const total = txs.reduce((sum, t) => sum + t.amount, 0);
        return {
          accepted: true as const,
          positions: validated.positions.length,
          transactions: txs.length,
          total_usd: total,
          unique_tickers: new Set(
            txs.map((t) => t.nasdaq_code.trim().toUpperCase()),
          ).size,
        };
      } catch (error) {
        const issues =
          error instanceof PortfolioValidationError
            ? error.issues
            : error &&
                typeof error === "object" &&
                "issues" in error &&
                Array.isArray((error as { issues: unknown }).issues)
              ? (error as { issues: Array<{ path?: unknown[]; message: string }> })
                  .issues.map((i) =>
                    Array.isArray(i.path) && i.path.length > 0
                      ? `${i.path.join(".")}: ${i.message}`
                      : i.message,
                  )
              : [error instanceof Error ? error.message : String(error)];
        return {
          accepted: false as const,
          errors: issues,
        };
      }
    },
  });

  try {
    for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
      const isRetry = attempt > 0;

      if (isRetry) {
        await options?.onTelemetryEvent?.({
          level: "info",
          type: "step-finished",
          title: `Retry ${attempt}/${MAX_VALIDATION_RETRIES}`,
          data: {
            attempt,
            issues: previousIssues,
          },
        });
      }

      // Reset the capture for this attempt — every retry gets a fresh shot
      // at the tool.
      capturedOutput = null;

      const retryAddendum = isRetry
        ? [
            "",
            "=== REPAIR ATTEMPT ===",
            "Your previous attempt failed with these issues:",
            ...previousIssues.map((issue) => `- ${issue}`),
            "Call submit_portfolio again with a corrected portfolio. Adjust",
            "allocations, add missing tickers, or rebalance so the total equals",
            "exactly $1,000,000 USD, every amount is a positive integer >= $5,000,",
            "and there are at least 50 unique NASDAQ tickers.",
          ].join("\n")
        : "";

      const userPrompt = [
        `TEAM_ID: ${process.env.TEAM_ID}`,
        `MODEL_AGENT_NAME: ${DEFAULT_AGENT_NAME}`,
        `MODEL_AGENT_VERSION: ${DEFAULT_AGENT_VERSION}`,
        "",
        "Research Cala's entity graph, then submit the final portfolio by",
        "calling the submit_portfolio tool exactly once. The tool's input",
        "schema matches the leaderboard exactly. Do NOT return a JSON blob",
        "in text — the submit_portfolio tool call IS the output.",
        "",
        "When you have 3 or fewer steps remaining, stop researching and",
        "call submit_portfolio with whatever you've verified so far —",
        "failing to commit at all is worse than committing an imperfect list.",
        "",
        prompt,
        retryAddendum,
      ]
        .filter((line) => line.length > 0 || line === "")
        .join("\n");

      const result = await generateText({
        model: anthropic(effectiveModel),
        system: effectiveSystemPrompt,
        prompt: userPrompt,
        // Stop on the step budget OR when the tool's execute set
        // capturedOutput (i.e. submit_portfolio ran AND the portfolio
        // passed validation). Using the captured flag instead of
        // hasToolCall lets the agent retry submit_portfolio in-loop when
        // its first attempt fails validation — the tool result tells it
        // what to fix, and the next step can try again.
        stopWhen: [
          stepCountIs(stepBudget),
          () => capturedOutput !== null,
        ],
        tools: { ...calaTools, submit_portfolio: submitPortfolioTool },
        toolChoice: "auto",
        ...(modelSupportsContextManagement
          ? {
              providerOptions: {
                anthropic: {
                  contextManagement: anthropicContextManagement,
                } satisfies AnthropicLanguageModelOptions,
              },
            }
          : {}),
        maxOutputTokens: 8000,
        maxRetries: 2,
        experimental_onStepStart: async (event: {
          stepNumber: number;
          toolCalls: unknown[];
        }) => {
          await options?.onTelemetryEvent?.({
            level: "info",
            type: "step-started",
            title: `Step ${event.stepNumber + 1} started${isRetry ? ` (retry ${attempt})` : ""}`,
            data: {
              stepNumber: event.stepNumber,
              toolCount: event.toolCalls.length,
              attempt,
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
            title: `Step ${event.stepNumber + 1} finished${isRetry ? ` (retry ${attempt})` : ""}`,
            data: {
              stepNumber: event.stepNumber,
              finishReason: event.finishReason,
              toolCallCount: event.toolCalls.length,
              text: event.text,
              usage: event.usage,
              attempt,
            },
          });
        },
      });

      mergeUsage(result.totalUsage);
      console.info("[cala-agent][result][text]", {
        model: effectiveModel,
        attempt,
        finishReason: result.finishReason,
        text: previewForConsole(result.text),
      });
      aggregatedSteps.push(
        ...result.steps.map((step) => ({
          text: step.text,
          finishReason: step.finishReason,
          toolCalls: step.toolCalls,
          toolResults: step.toolResults,
        })),
      );

      // Two-phase commit. The research pass above includes submit_portfolio
      // in its toolbox so the model *can* commit naturally — but we keep
      // hitting the failure mode where it burns the step budget on research
      // and never calls it. When that happens, capturedOutput is still null
      // and result.text has no JSON either. Run a short, forced commit pass
      // with ONLY submit_portfolio available and toolChoice="required" so
      // the SDK won't let the step end until the tool is called. The model
      // receives the entire research transcript as context, so no Cala
      // research is wasted.
      let outputPhase: "research" | "commit" = "research";
      if (!capturedOutput) {
        outputPhase = "commit";
        await options?.onTelemetryEvent?.({
          level: "info",
          type: "step-started",
          title: "Commit pass starting",
          data: {
            attempt,
            researchSteps: result.steps.length,
            reason:
              "research-pass-ended-without-submit_portfolio",
          },
        });

        const commitResult = await generateText({
          model: anthropic(effectiveModel),
          system: effectiveSystemPrompt,
          messages: [
            { role: "user", content: userPrompt },
            ...result.response.messages,
            {
              role: "user",
              content:
                "Your research budget is exhausted. Call submit_portfolio NOW " +
                "with the best portfolio you can assemble from the research above. " +
                "Requirements: at least 50 unique NASDAQ tickers, every amount a " +
                "positive integer >= $5,000, total equals exactly $1,000,000. " +
                "Do not call any other tool. Do not return any text — the " +
                "submit_portfolio tool call IS the final answer.",
            },
          ],
          // Same capturedOutput-based stop as the research pass, so the
          // model can retry submit_portfolio up to 4 times within this
          // pass if the first attempt fails validation.
          stopWhen: [stepCountIs(4), () => capturedOutput !== null],
          tools: { submit_portfolio: submitPortfolioTool },
          toolChoice: "required",
          ...(modelSupportsContextManagement
            ? {
                providerOptions: {
                  anthropic: {
                    contextManagement: anthropicContextManagement,
                  } satisfies AnthropicLanguageModelOptions,
                },
              }
            : {}),
          // Commit pass outputs a full 50-position JSON blob via the tool
          // call — give it headroom beyond the research pass's 8000.
          maxOutputTokens: 16000,
          maxRetries: 2,
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
              title: `Commit step ${event.stepNumber + 1} finished${isRetry ? ` (retry ${attempt})` : ""}`,
              data: {
                stepNumber: event.stepNumber,
                finishReason: event.finishReason,
                toolCallCount: event.toolCalls.length,
                text: event.text,
                usage: event.usage,
                attempt,
                phase: "commit",
              },
            });
          },
        });

        mergeUsage(commitResult.totalUsage);
        aggregatedSteps.push(
          ...commitResult.steps.map((step) => ({
            text: step.text,
            finishReason: step.finishReason,
            toolCalls: step.toolCalls,
            toolResults: step.toolResults,
          })),
        );
      }

      try {
        // Preferred path: submit_portfolio tool was invoked (either
        // naturally in the research pass or forcibly in the commit pass)
        // and its execute() validated the payload. Falls back to text
        // extraction only when BOTH passes failed to commit — which is
        // extremely rare with toolChoice="required" on the commit pass.
        let validatedOutput: PortfolioOutput;
        let outputSource:
          | "research-pass"
          | "commit-pass"
          | "text-extraction";
        if (capturedOutput) {
          validatedOutput = capturedOutput;
          outputSource = outputPhase === "commit" ? "commit-pass" : "research-pass";
        } else {
          const parsedOutput = portfolioOutputSchemaForAnthropic.parse(
            extractJsonObject(result.text),
          );
          validatedOutput = portfolioOutputSchema.parse(parsedOutput);
          validatePortfolioOutput(validatedOutput);
          outputSource = "text-extraction";
        }

        const response = {
          model: effectiveModel,
          output: validatedOutput,
          steps: aggregatedSteps,
        };

        console.info("[cala-agent][generateText][success]", {
          model: effectiveModel,
          attempt,
          steps: aggregatedSteps.length,
          positions: validatedOutput.positions.length,
          transactions: validatedOutput.submissionPayload.transactions.length,
          outputSource,
        });

        await options?.onFinish?.({
          totalUsage: aggregatedUsage ?? result.totalUsage,
          result: response,
          functionId: "cala-agent",
          metadata: { attempt },
        });

        return response;
      } catch (error) {
        if (attempt >= MAX_VALIDATION_RETRIES) throw error;

        // Three recoverable error shapes, all fed back into the prompt:
        //   1. PortfolioValidationError — our own post-generation checks
        //      (wrong total, <50 tickers, duplicates, etc).
        //   2. extractJsonObject() — model ended without a JSON block
        //      (ran out of steps, replied with prose only).
        //   3. zod parse failure — JSON was present but didn't match the
        //      lax Anthropic schema (missing field, wrong type).
        // Everything else (API errors, MCP client failures) propagates.
        if (error instanceof PortfolioValidationError) {
          previousIssues = error.issues;
          console.warn("[cala-agent][validation][retrying]", {
            attempt: attempt + 1,
            max: MAX_VALIDATION_RETRIES,
            issues: error.issues,
          });
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        const isExtractFailure = message.includes(
          "did not contain a JSON object",
        );
        // z.ZodError has .issues on it; check duck-typed so we don't have
        // to import zod's error class.
        const zodIssues =
          error &&
          typeof error === "object" &&
          "issues" in error &&
          Array.isArray((error as { issues: unknown }).issues)
            ? ((error as { issues: Array<{ path?: unknown[]; message: string }> }).issues
                .map(i =>
                  Array.isArray(i.path) && i.path.length > 0
                    ? `${i.path.join(".")}: ${i.message}`
                    : i.message,
                )
                .slice(0, 10))
            : null;

        if (isExtractFailure) {
          previousIssues = [
            "Previous attempt ended without emitting a JSON object. You MUST finish your response with a single fenced ```json ... ``` block containing the full portfolio matching the schema — do not end with narration or a tool call.",
          ];
        } else if (zodIssues && zodIssues.length > 0) {
          previousIssues = [
            "Previous attempt's JSON did not parse against the schema. Specific issues:",
            ...zodIssues.map(issue => `- ${issue}`),
            "Emit a corrected JSON object that matches every field's type exactly.",
          ];
        } else {
          previousIssues = [
            `Previous attempt failed: ${message}`,
            "Re-emit the full portfolio JSON from scratch.",
          ];
        }

        console.warn("[cala-agent][parse][retrying]", {
          attempt: attempt + 1,
          max: MAX_VALIDATION_RETRIES,
          reason: isExtractFailure
            ? "no-json"
            : zodIssues
              ? "schema-mismatch"
              : "unknown",
          message,
        });
        continue;
      }
    }

    // Unreachable — the loop either returns on success or throws on
    // final-attempt failure. TypeScript doesn't know that, hence the
    // explicit throw below.
    throw new Error("cala-agent retry loop exited without returning");
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
