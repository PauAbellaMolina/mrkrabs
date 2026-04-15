export const runtime = "nodejs"
export const maxDuration = 30

const SUBMIT_URL = "https://different-cormorant-663.convex.site/api/submit"

interface SubmissionPayload {
  team_id: string
  model_agent_name: string
  model_agent_version: string
  transactions: Array<{
    nasdaq_code: string
    amount: number
  }>
}

interface SubmitRequestBody {
  submissionPayload?: SubmissionPayload
}

const serializeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return {
      message: "Unknown submit error",
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
    const body = (await request.json()) as SubmitRequestBody
    const submissionPayload = body.submissionPayload

    if (!submissionPayload) {
      return Response.json(
        {
          error: "submissionPayload is required.",
          requestId,
        },
        { status: 400 },
      )
    }

    console.info("[submit][start]", {
      requestId,
      teamId: submissionPayload.team_id,
      modelAgentName: submissionPayload.model_agent_name,
      modelAgentVersion: submissionPayload.model_agent_version,
      transactionCount: submissionPayload.transactions.length,
      totalAllocated: submissionPayload.transactions.reduce(
        (sum, transaction) => sum + transaction.amount,
        0,
      ),
    })

    const response = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(submissionPayload),
    })

    const rawText = await response.text()
    let parsedBody: unknown = null

    if (rawText) {
      try {
        parsedBody = JSON.parse(rawText)
      } catch {
        parsedBody = { rawText }
      }
    }

    if (!response.ok) {
      console.error("[submit][upstream-error]", {
        requestId,
        status: response.status,
        statusText: response.statusText,
        body: parsedBody,
      })

      return Response.json(
        {
          error: "Submission endpoint rejected the payload.",
          requestId,
          upstreamStatus: response.status,
          upstreamStatusText: response.statusText,
          details: parsedBody,
        },
        { status: response.status },
      )
    }

    console.info("[submit][success]", {
      requestId,
      response: parsedBody,
    })

    return Response.json({
      requestId,
      response: parsedBody,
    })
  } catch (error) {
    const details = serializeError(error)

    console.error("[submit][error]", {
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
