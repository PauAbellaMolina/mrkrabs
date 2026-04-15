import {
  CALA_AGENT_MODEL as CODEX_AGENT_MODEL,
  CALA_AGENT_NAME as CODEX_AGENT_NAME,
  CALA_AGENT_VERSION as CODEX_AGENT_VERSION,
  runCalaAgent as runCodexAgent,
} from "@/lib/codex-agent";
import {
  CALA_AGENT_MODEL as ANTHROPIC_AGENT_MODEL,
  CALA_AGENT_NAME as ANTHROPIC_AGENT_NAME,
  CALA_AGENT_VERSION as ANTHROPIC_AGENT_VERSION,
  runCalaAgent as runAnthropicAgent,
} from "@/lib/cala-agent";
import {
  appendRunEvent,
  completeRunRecord,
  createRunRecord,
  failRunRecord,
} from "@/lib/agent-runs";
import { composeSystemPrompt, loadRules } from "@/lib/autoresearch-ledger";

export const runtime = "nodejs";
export const maxDuration = 300;

export type AgentBackend = "anthropic" | "codex-cli";
export type SystemPromptMode = "base" | "champion";

const DEFAULT_BACKEND: AgentBackend = "codex-cli";
const DEFAULT_PROMPT_MODE: SystemPromptMode = "base";

interface AgentRequestBody {
  prompt?: string;
  backend?: AgentBackend;
  // Anthropic-only: pick a specific model ID (e.g. "claude-sonnet-4-6",
  // "claude-haiku-4-5", "claude-opus-4-6"). Ignored by Codex CLI.
  model?: string;
  // Anthropic-only: "base" uses the trunk prompt verbatim; "champion"
  // composes BASE + the accumulated autoresearch rules from Convex so the
  // manual run benefits from whatever the outer loop has learned so far.
  // Ignored by Codex CLI (its prompt pipeline is a separate compilation).
  systemPromptMode?: SystemPromptMode;
}

// Anthropic model IDs we accept from clients. Includes base IDs, the `[1m]`
// 1-million-context variants for Sonnet/Opus, and the pinned Haiku snapshot.
// Keep this list in sync with the UI option matrix in components/new-run-form
// and the allow-list in scripts/autoresearch.ts.
const ALLOWED_ANTHROPIC_MODELS = new Set([
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6[1m]",
  "claude-opus-4-6",
  "claude-opus-4-6[1m]",
]);

const AGENT_BACKENDS = {
  "codex-cli": {
    run: runCodexAgent,
    name: CODEX_AGENT_NAME,
    version: CODEX_AGENT_VERSION,
    model: CODEX_AGENT_MODEL,
  },
  anthropic: {
    run: runAnthropicAgent,
    name: ANTHROPIC_AGENT_NAME,
    version: ANTHROPIC_AGENT_VERSION,
    model: ANTHROPIC_AGENT_MODEL,
  },
} as const;

const serializeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return {
      message: "Unknown agent error",
      raw: error,
    };
  }

  const errorWithCause = error as Error & { cause?: unknown };
  const errorWithStreams = error as Error & {
    stdout?: string;
    stderr?: string;
  };

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    stdout: errorWithStreams.stdout,
    stderr: errorWithStreams.stderr,
    cause:
      errorWithCause.cause instanceof Error
        ? {
            name: errorWithCause.cause.name,
            message: errorWithCause.cause.message,
            stack: errorWithCause.cause.stack,
          }
        : errorWithCause.cause,
  };
};

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let runId: string | null = null;

  try {
    const body = (await request.json()) as AgentRequestBody;
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return Response.json(
        {
          error: "A non-empty prompt is required.",
          requestId,
        },
        { status: 400 },
      );
    }

    const backend: AgentBackend =
      body.backend && body.backend in AGENT_BACKENDS
        ? body.backend
        : DEFAULT_BACKEND;
    const agent = AGENT_BACKENDS[backend];

    const resolvedModel =
      backend === "anthropic" && body.model && ALLOWED_ANTHROPIC_MODELS.has(body.model)
        ? body.model
        : agent.model;

    const promptMode: SystemPromptMode =
      body.systemPromptMode === "champion" || body.systemPromptMode === "base"
        ? body.systemPromptMode
        : DEFAULT_PROMPT_MODE;

    // Only Anthropic honors the system-prompt override. The Codex CLI flow
    // compiles its own buildCodexPrompt() and doesn't accept a trunk swap.
    let systemPromptOverride: string | undefined;
    if (backend === "anthropic" && promptMode === "champion") {
      const rules = await loadRules();
      systemPromptOverride = composeSystemPrompt(rules);
    }

    console.info("[agent][start]", {
      requestId,
      backend,
      model: resolvedModel,
      promptMode,
      systemPromptSource:
        systemPromptOverride ? "champion (base + rules)" : "base",
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 240),
    });

    runId = crypto.randomUUID();

    await createRunRecord({
      id: runId,
      requestId,
      prompt,
      agentName: agent.name,
      agentVersion: agent.version,
      model: resolvedModel,
      // Only meaningful for Anthropic — the Codex CLI backend compiles its
      // own prompt and ignores this field.
      systemPromptMode: backend === "anthropic" ? promptMode : undefined,
    });

    const result = await agent.run(prompt, {
      ...(backend === "anthropic"
        ? { model: resolvedModel, runId }
        : {}),
      ...(systemPromptOverride ? { systemPromptOverride } : {}),
      onTelemetryEvent: (event) => appendRunEvent(runId!, event),
      onFinish: (event) =>
        completeRunRecord(runId!, {
          model: resolvedModel,
          result: event.result,
          telemetry: {
            functionId: event.functionId,
            metadata: event.metadata,
            totalUsage: event.totalUsage,
          },
        }),
    });

    console.info("[agent][success]", {
      requestId,
      runId,
      model: result.model,
      positions: result.output.positions.length,
      transactions: result.output.submissionPayload.transactions.length,
      usedPostCutoffData: result.output.cutoffAudit.postCutoffDataUsed,
    });

    return Response.json({
      runId,
      ...result,
    });
  } catch (error) {
    const details = serializeError(error);

    if (runId) {
      await failRunRecord(runId, {
        message: details.message,
        details,
      });
    }

    console.error("[agent][error]", {
      requestId,
      runId,
      ...details,
    });

    return Response.json(
      {
        error: details.message,
        requestId,
        details,
      },
      { status: 500 },
    );
  }
}
