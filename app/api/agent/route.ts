import {
  CALA_AGENT_MODEL,
  CALA_AGENT_NAME,
  CALA_AGENT_VERSION,
  runCalaAgent,
} from "@/lib/codex-agent"
import {
  appendRunEvent,
  completeRunRecord,
  createRunRecord,
  failRunRecord,
} from "@/lib/agent-runs"

export const runtime = "nodejs"
export const maxDuration = 300

interface AgentRequestBody {
  prompt?: string
}

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

    console.info("[agent][start]", {
      requestId,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 240),
    })

    runId = crypto.randomUUID()

    await createRunRecord({
      id: runId,
      requestId,
      prompt,
      agentName: CALA_AGENT_NAME,
      agentVersion: CALA_AGENT_VERSION,
      model: CALA_AGENT_MODEL,
    })

    const result = await runCalaAgent(prompt, {
      onTelemetryEvent: (event) => appendRunEvent(runId, event),
      onFinish: (event) =>
        completeRunRecord(runId, {
          model: CALA_AGENT_MODEL,
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
