import {
  appendRunEvent,
  readRunRecord,
  recordRunSubmission,
} from "@/lib/agent-runs"
import {
  serializeSubmitError,
  submitToLeaderboard,
} from "@/lib/leaderboard-submit"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const run = await readRunRecord(id)
    const submissionPayload = run.result?.output.submissionPayload

    if (!submissionPayload) {
      return Response.json(
        {
          error: "This run does not have a submission payload.",
        },
        { status: 400 },
      )
    }

    await appendRunEvent(id, {
      level: "info",
      type: "run-started",
      title: "Leaderboard submission started",
      data: {
        teamId: submissionPayload.team_id,
        transactionCount: submissionPayload.transactions.length,
      },
    })

    const result = await submitToLeaderboard(submissionPayload)

    if (!result.ok) {
      await recordRunSubmission(id, {
        status: "failed",
        submittedAt: new Date().toISOString(),
        requestId: result.requestId,
        publicAgentName: result.agentName,
        publicAgentVersion: result.agentVersion,
        upstreamStatus: result.upstreamStatus,
        upstreamStatusText: result.upstreamStatusText,
        details: result.details,
      })

      await appendRunEvent(id, {
        level: "error",
        type: "run-failed",
        title: "Leaderboard submission failed",
        data: {
          requestId: result.requestId,
          publicAgentName: result.agentName,
          publicAgentVersion: result.agentVersion,
          upstreamStatus: result.upstreamStatus,
          upstreamStatusText: result.upstreamStatusText,
          details: result.details,
        },
      })

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

    await recordRunSubmission(id, {
      status: "submitted",
      submittedAt: new Date().toISOString(),
      requestId: result.requestId,
      publicAgentName: result.agentName,
      publicAgentVersion: result.agentVersion,
      response: result.response,
    })

    await appendRunEvent(id, {
      level: "info",
      type: "run-finished",
      title: "Leaderboard submission accepted",
      data: {
        requestId: result.requestId,
        publicAgentName: result.agentName,
        publicAgentVersion: result.agentVersion,
        response: result.response,
      },
    })

    return Response.json({
      requestId: result.requestId,
      publicAgentName: result.agentName,
      publicAgentVersion: result.agentVersion,
      response: result.response,
    })
  } catch (error) {
    const details = serializeSubmitError(error)

    await appendRunEvent(id, {
      level: "error",
      type: "run-failed",
      title: "Leaderboard submission errored",
      data: details,
    }).catch(() => undefined)

    return Response.json(
      {
        error: details.message,
        details,
      },
      { status: 500 },
    )
  }
}
