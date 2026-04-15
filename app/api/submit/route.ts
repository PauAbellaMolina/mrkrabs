export const runtime = "nodejs"
export const maxDuration = 30

interface SubmitRequestBody {
  submissionPayload?: import("@/lib/leaderboard-submit").SubmissionPayload
}

import {
  serializeSubmitError,
  submitToLeaderboard,
} from "@/lib/leaderboard-submit"

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

    const result = await submitToLeaderboard(submissionPayload)

    if (!result.ok) {
      return Response.json(
        {
          error: "Submission endpoint rejected the payload.",
          requestId: result.requestId,
          publicAgentName: result.agentName,
          publicAgentVersion: result.agentVersion,
          upstreamStatus: result.upstreamStatus,
          upstreamStatusText: result.upstreamStatusText,
          details: result.details,
        },
        { status: result.upstreamStatus },
      )
    }

    return Response.json({
      requestId: result.requestId,
      publicAgentName: result.agentName,
      publicAgentVersion: result.agentVersion,
      response: result.response,
    })
  } catch (error) {
    const details = serializeSubmitError(error)

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
