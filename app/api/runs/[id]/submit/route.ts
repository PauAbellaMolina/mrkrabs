import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

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

const CODEX_CHECKPOINT_DIR = path.join(
  process.cwd(),
  ".data",
  "codex-checkpoints",
)

function extractBadTickers(details: unknown) {
  const message =
    details &&
    typeof details === "object" &&
    "error" in (details as Record<string, unknown>) &&
    typeof (details as { error?: unknown }).error === "string"
      ? (details as { error: string }).error
      : JSON.stringify(details)

  return Array.from(
    new Set(
      [
        ...Array.from(
          message.matchAll(
            /Failed to fetch historical price for ([A-Z.]{1,6})/g,
          ),
        ).map((match) => match[1]),
        ...Array.from(
          message.matchAll(
            /Failed to fetch purchase prices.*?: ([A-Z.]{1,6}):/g,
          ),
        ).map((match) => match[1]),
      ],
    ),
  )
}

async function readCheckpointForRun(runId: string) {
  try {
    const contents = await readFile(
      path.join(CODEX_CHECKPOINT_DIR, `${runId}.json`),
      "utf8",
    )
    return JSON.parse(contents) as {
      candidateCompanies?: Array<{
        ticker?: string
        nasdaqCode?: string
        sector?: string
        status?: string
      }>
      portfolioDraft?: Array<{
        ticker?: string
        nasdaq_code?: string
      }>
    }
  } catch {
    return null
  }
}

async function findReplacementTicker(
  runId: string,
  currentTransactions: Array<{ nasdaq_code: string; amount: number }>,
  badTicker: string,
) {
  const currentCheckpoint = await readCheckpointForRun(runId)
  const currentTickers = new Set(
    currentTransactions.map((transaction) => transaction.nasdaq_code.trim().toUpperCase()),
  )
  const sectorByTicker = new Map(
    (currentCheckpoint?.candidateCompanies ?? []).map((candidate) => [
      (candidate.ticker ?? candidate.nasdaqCode ?? "").trim().toUpperCase(),
      candidate.sector,
    ]),
  )
  const targetSector = sectorByTicker.get(badTicker)

  const files = await readdir(CODEX_CHECKPOINT_DIR).catch(() => [])
  const counts = new Map<string, number>()

  for (const file of files) {
    if (!file.endsWith(".json")) continue
    const checkpoint = await readCheckpointForRun(file.replace(/\.json$/, ""))
    for (const candidate of checkpoint?.candidateCompanies ?? []) {
      const ticker = (candidate.ticker ?? candidate.nasdaqCode ?? "")
        .trim()
        .toUpperCase()
      if (!ticker) continue
      if (ticker === badTicker) continue
      if (currentTickers.has(ticker)) continue
      if (candidate.status !== "selected") continue
      if (targetSector && candidate.sector && candidate.sector !== targetSector) {
        continue
      }
      counts.set(ticker, (counts.get(ticker) ?? 0) + 1)
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? null
}

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

    const preflightIssues: string[] = []
    const transactions = submissionPayload.transactions ?? []
    const uniqueTickers = new Set(
      transactions.map((t) => t.nasdaq_code?.trim().toUpperCase()).filter(Boolean),
    )
    const totalAmount = transactions.reduce((sum, t) => sum + (t.amount ?? 0), 0)

    if (uniqueTickers.size < 50) {
      preflightIssues.push(
        `transactions has ${uniqueTickers.size} unique tickers; server requires >= 50.`,
      )
    }
    if (uniqueTickers.size !== transactions.length) {
      preflightIssues.push(
        `transactions contains duplicate tickers (${transactions.length} rows, ${uniqueTickers.size} unique).`,
      )
    }
    if (totalAmount !== 1_000_000) {
      preflightIssues.push(
        `transactions sum is $${totalAmount.toLocaleString()}; server requires exactly $1,000,000.`,
      )
    }
    const underMin = transactions.filter((t) => (t.amount ?? 0) < 5000)
    if (underMin.length > 0) {
      preflightIssues.push(
        `${underMin.length} position(s) below the $5,000 floor: ${underMin
          .map((t) => t.nasdaq_code)
          .join(", ")}.`,
      )
    }

    if (preflightIssues.length > 0) {
      await appendRunEvent(id, {
        level: "error",
        type: "run-failed",
        title: "Submission blocked by preflight validation",
        data: { issues: preflightIssues },
      })
      return Response.json(
        {
          error: "Submission payload failed preflight validation.",
          issues: preflightIssues,
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
      const badTickers = result.upstreamStatus === 422 ? extractBadTickers(result.details) : []

      if (badTickers.length > 0) {
        const repairedTransactions = [...submissionPayload.transactions]
        const replacements: Array<{ from: string; to: string }> = []

        for (const badTicker of badTickers) {
          const replacementTicker = await findReplacementTicker(
            id,
            repairedTransactions,
            badTicker,
          )
          if (!replacementTicker) {
            continue
          }

          const index = repairedTransactions.findIndex(
            (transaction) =>
              transaction.nasdaq_code.trim().toUpperCase() === badTicker,
          )

          if (index >= 0) {
            repairedTransactions[index] = {
              ...repairedTransactions[index],
              nasdaq_code: replacementTicker,
            }
            replacements.push({ from: badTicker, to: replacementTicker })
          }
        }

        if (replacements.length > 0) {
          await appendRunEvent(id, {
            level: "info",
            type: "step-finished",
            title: "Retrying submission with fallback ticker replacements",
            data: {
              replacements,
              originalRequestId: result.requestId,
            },
          })

          const retryResult = await submitToLeaderboard({
            ...submissionPayload,
            transactions: repairedTransactions,
          })

          if (retryResult.ok) {
            await recordRunSubmission(id, {
              status: "submitted",
              submittedAt: new Date().toISOString(),
              requestId: retryResult.requestId,
              publicAgentName: retryResult.agentName,
              publicAgentVersion: retryResult.agentVersion,
              response: retryResult.response,
              details: {
                autoRepair: true,
                replacements,
                originalFailedRequestId: result.requestId,
              },
            })

            await appendRunEvent(id, {
              level: "info",
              type: "run-finished",
              title: "Leaderboard submission accepted after ticker repair",
              data: {
                requestId: retryResult.requestId,
                replacements,
                response: retryResult.response,
              },
            })

            return Response.json({
              requestId: retryResult.requestId,
              publicAgentName: retryResult.agentName,
              publicAgentVersion: retryResult.agentVersion,
              response: retryResult.response,
              autoRepair: {
                replacements,
                originalFailedRequestId: result.requestId,
              },
            })
          }
        }
      }

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
