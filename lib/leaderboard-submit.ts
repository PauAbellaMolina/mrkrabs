import { allocateNextVersion, PUBLIC_AGENT_NAME } from "./agent-version"

const SUBMIT_URL = "https://different-cormorant-663.convex.site/api/submit"

export interface SubmissionPayload {
  team_id: string
  model_agent_name: string
  model_agent_version: string
  transactions: Array<{
    nasdaq_code: string
    amount: number
  }>
}

// Every submission that leaves this module has its version allocated here.
// The name defaults to PUBLIC_AGENT_NAME (manual-run brand) but callers can
// override — scripts/autoresearch.ts passes PUBLIC_AUTORESEARCH_AGENT_NAME
// so only outer-loop experiments are labeled as autoresearch on the public
// leaderboard.
export interface SubmitOptions {
  agentName?: string
}

export async function submitToLeaderboard(
  submissionPayload: SubmissionPayload,
  options: SubmitOptions = {},
) {
  const requestId = crypto.randomUUID()
  const agentName = options.agentName ?? PUBLIC_AGENT_NAME
  const agentVersion = await allocateNextVersion()

  const stampedPayload: SubmissionPayload = {
    ...submissionPayload,
    model_agent_name: agentName,
    model_agent_version: agentVersion,
  }

  console.info("[submit][start]", {
    requestId,
    teamId: stampedPayload.team_id,
    modelAgentName: agentName,
    modelAgentVersion: agentVersion,
    transactionCount: stampedPayload.transactions.length,
    totalAllocated: stampedPayload.transactions.reduce(
      (sum, transaction) => sum + transaction.amount,
      0,
    ),
  })

  const response = await fetch(SUBMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(stampedPayload),
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

    return {
      ok: false as const,
      requestId,
      agentName,
      agentVersion,
      upstreamStatus: response.status,
      upstreamStatusText: response.statusText,
      details: parsedBody,
    }
  }

  console.info("[submit][success]", {
    requestId,
    agentName,
    agentVersion,
    response: parsedBody,
  })

  return {
    ok: true as const,
    requestId,
    agentName,
    agentVersion,
    response: parsedBody,
  }
}

export const serializeSubmitError = (error: unknown) => {
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
