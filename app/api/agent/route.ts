import { runCalaAgent } from "@/lib/cala-agent"

export const runtime = "nodejs"
export const maxDuration = 30

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

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
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

    const result = await runCalaAgent(prompt)

    console.info("[agent][success]", {
      requestId,
      model: result.model,
      positions: result.output.positions.length,
      transactions: result.output.submissionPayload.transactions.length,
      usedPostCutoffData: result.output.cutoffAudit.postCutoffDataUsed,
    })

    return Response.json(result)
  } catch (error) {
    const details = serializeError(error)

    console.error("[agent][error]", {
      requestId,
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
