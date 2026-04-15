import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { hasToolCall, stepCountIs, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { finalizePortfolioTool } from "./submit-portfolio-tool";
import { createResearchCheckpointState } from "./research-checkpoint-state";
import {
  createLoadResearchCheckpointTool,
  createSaveResearchCheckpointTool,
} from "./research-checkpoint-tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { attachConsoleLoggingToTools } from "./tool-logging";

const execFileAsync = promisify(execFile);

// The trading agent. Composes Anthropic Sonnet 4.5 with Cala's three-endpoint
// research loop plus our finalize_portfolio validator tool. Two stop conditions:
// either the agent finalizes via finalize_portfolio, or we run out of steps.
//
// Step budget note: 50 stocks x 3 tool calls = 150 worst case. We start at 80
// because the system prompt encourages batched introspection and lighter
// research for obvious blue chips. Raise if we see the budget blow through in
// practice.
const CALA_MCP_URL = process.env.CALA_MCP_URL?.trim() || "https://api.cala.ai/mcp/";
const CODE_EXEC_MAX_STDOUT_CHARS = 12_000;
const CODE_EXEC_MAX_STDERR_CHARS = 12_000;
const CODE_EXEC_DEFAULT_TIMEOUT_MS = 15_000;

interface ExecCodeResult {
  ok: boolean;
  runtime: "node" | "python" | "bash";
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

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
        .min(500)
        .max(120_000)
        .optional()
        .describe("Optional execution timeout in milliseconds."),
    }),
    execute: async ({ runtime, code, timeoutMs }) => {
      const workspace = await mkdtemp(path.join(os.tmpdir(), "mrkrabs-sandbox-"));
      const fileExt = runtime === "python" ? ".py" : runtime === "bash" ? ".sh" : ".js";
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
          env: { ...process.env, NODE_ENV: "mrkrabs-agent-sandbox" },
          timeout: timeoutMs ?? CODE_EXEC_DEFAULT_TIMEOUT_MS,
          maxBuffer: 200_000,
        });

        return finish({
          ok: true,
          runtime,
          exitCode: 0,
          durationMs: Date.now() - start,
          stdout: truncateOutput(result.stdout ?? "", CODE_EXEC_MAX_STDOUT_CHARS),
          stderr: truncateOutput(result.stderr ?? "", CODE_EXEC_MAX_STDERR_CHARS),
        });
      } catch (error) {
        const wrapped = error as {
          stdout?: unknown;
          stderr?: unknown;
          code?: number;
          message?: string;
          signal?: string;
        };

        const stdout = truncateOutput(toText(wrapped.stdout), CODE_EXEC_MAX_STDOUT_CHARS);
        const stderr = truncateOutput(toText(wrapped.stderr), CODE_EXEC_MAX_STDERR_CHARS);
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

export async function createTradingAgent(options?: { runId?: string }) {
  const calaApiKey = process.env.CALA_API_KEY?.trim();
  const checkpointState = createResearchCheckpointState(options?.runId);

  const calaClient = await createMCPClient({
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

  const calaTools = await calaClient.tools();

  return new ToolLoopAgent({
    model: anthropic("claude-sonnet-4-5"),
    instructions: SYSTEM_PROMPT,
    tools: attachConsoleLoggingToTools("tool-loop-agent", {
      ...calaTools,
      run_code: createCodeExecutionTool(),
      save_research_checkpoint:
        createSaveResearchCheckpointTool(checkpointState),
      load_research_checkpoint:
        createLoadResearchCheckpointTool(checkpointState),
      finalize_portfolio: finalizePortfolioTool,
    }),
    stopWhen: [stepCountIs(80), hasToolCall("finalize_portfolio")],
  });
}

export type TradingAgent = Awaited<ReturnType<typeof createTradingAgent>>;
