import {
  CALA_AGENT_MODEL as CODEX_AGENT_MODEL,
  CALA_AGENT_NAME as CODEX_AGENT_NAME,
  CALA_AGENT_VERSION as CODEX_AGENT_VERSION,
  runCalaAgent as runCodexAgent,
} from "@/lib/codex-agent"
import {
  CALA_AGENT_MODEL as ANTHROPIC_AGENT_MODEL,
  CALA_AGENT_NAME as ANTHROPIC_AGENT_NAME,
  CALA_AGENT_VERSION as ANTHROPIC_AGENT_VERSION,
  runCalaAgent as runAnthropicAgent,
} from "@/lib/cala-agent"
import {
  appendRunEvent,
  completeRunRecord,
  createRunRecord,
  failRunRecord,
} from "@/lib/agent-runs"

export const runtime = "nodejs"
export const maxDuration = 300

export type AgentBackend = "anthropic" | "codex-cli"

const DEFAULT_BACKEND: AgentBackend = "codex-cli"

interface AgentRequestBody {
  prompt?: string
  backend?: AgentBackend
}

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
} as const

const serializeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return {
      message: "Unknown agent error",
      raw: error,
    }
  }

  const errorWithCause = error as Error & { cause?: unknown }
  const errorWithStreams = error as Error & {
    stdout?: string
    stderr?: string
  }

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
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID()
  let runId: string | null = null

  try {
    const body = (await request.json()) as AgentRequestBody
    const prompt = body.prompt?.trim()

    if (!prompt) {
      return Response.json(
        {
          error: "A non-empty prompt is required.",
          requestId,
        },
        { status: 400 },
      )
    }

    const backend: AgentBackend =
      body.backend && body.backend in AGENT_BACKENDS
        ? body.backend
        : DEFAULT_BACKEND
    const agent = AGENT_BACKENDS[backend]

    console.info("[agent][start]", {
      requestId,
      backend,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 240),
    })

    runId = crypto.randomUUID()

    await createRunRecord({
      id: runId,
      requestId,
      prompt,
      agentName: agent.name,
      agentVersion: agent.version,
      model: agent.model,
    })

    const result = await agent.run(prompt, {
      onTelemetryEvent: (event) => appendRunEvent(runId, event),
      onFinish: (event) =>
        completeRunRecord(runId, {
          model: agent.model,
          result: event.result,
          telemetry: {
            functionId: event.functionId,
            metadata: event.metadata,
            totalUsage: event.totalUsage,
          },
        }),
    })

    console.info("[agent][success]", {
      requestId,
      runId,
      model: result.model,
      positions: result.output.positions.length,
      transactions: result.output.submissionPayload.transactions.length,
      usedPostCutoffData: result.output.cutoffAudit.postCutoffDataUsed,
    })

    return Response.json({
      runId,
      ...result,
    })
  } catch (error) {
    const details = serializeError(error)

    if (runId) {
      await failRunRecord(runId, {
        message: details.message,
        details,
      })
    }

    console.error("[agent][error]", {
      requestId,
      runId,
      ...details,
    })

    return Response.json(
      {
        error: details.message,
        requestId,
        details,
      },
      { status: 500 },
    )
  }
}
