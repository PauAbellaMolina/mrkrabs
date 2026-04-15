"use client"

import { useState, useTransition } from "react"

interface AgentStep {
  text: string
  finishReason: string
  toolCalls: unknown[]
  toolResults: unknown[]
}

interface AgentResponse {
  model: string
  output: {
    submissionPayload: {
      team_id: string
      model_agent_name: string
      model_agent_version: string
      transactions: Array<{
        nasdaq_code: string
        amount: number
      }>
    }
    positions: Array<{
      nasdaqCode: string
      companyName: string
      companyEntityId: string
      amount: number
      thesis: string
      calaEvidence: string[]
      supportingEntityIds: string[]
      riskNotes: string[]
      cutoffComplianceNote: string
    }>
    cutoffAudit: {
      postCutoffDataUsed: boolean
      complianceSummary: string
      bannedDataChecks: string[]
    }
    reportMarkdown: string
  }
  steps: AgentStep[]
}

interface SubmissionResponse {
  requestId: string
  response: unknown
}

const starterPrompt =
  "Build the first full challenge submission: choose at least 50 unique NASDAQ stocks, allocate exactly $1,000,000 total with at least $5,000 per name, and explain the picks with Cala-backed reasoning only. Avoid any data after 2025-04-15."

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)

const buildSubmissionChecks = (
  transactions: AgentResponse["output"]["submissionPayload"]["transactions"],
) => {
  const totalAllocated = transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  )
  const uniqueTickers = new Set(
    transactions.map((transaction) => transaction.nasdaq_code.toUpperCase()),
  )

  return {
    totalAllocated,
    positionCount: transactions.length,
    uniqueTickerCount: uniqueTickers.size,
    hasMinPositions: transactions.length >= 50,
    hasUniqueTickers: uniqueTickers.size === transactions.length,
    hasMinPositionSize: transactions.every(
      (transaction) => transaction.amount >= 5000,
    ),
    hasExactBudget: totalAllocated === 1_000_000,
  }
}

export default function AgentPlayground() {
  const [prompt, setPrompt] = useState(starterPrompt)
  const [result, setResult] = useState<AgentResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorDetails, setErrorDetails] = useState<unknown>(null)
  const [submissionResult, setSubmissionResult] =
    useState<SubmissionResponse | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [submissionErrorDetails, setSubmissionErrorDetails] =
    useState<unknown>(null)
  const [isPending, startTransition] = useTransition()
  const submissionChecks = result
    ? buildSubmissionChecks(result.output.submissionPayload.transactions)
    : null
  const canSubmit =
    !!result &&
    !!submissionChecks &&
    submissionChecks.hasMinPositions &&
    submissionChecks.hasUniqueTickers &&
    submissionChecks.hasMinPositionSize &&
    submissionChecks.hasExactBudget

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setErrorDetails(null)
    setSubmissionResult(null)
    setSubmissionError(null)
    setSubmissionErrorDetails(null)

    startTransition(async () => {
      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt }),
        })

        const data = (await response.json()) as AgentResponse & {
          error?: string
          requestId?: string
          details?: unknown
        }

        if (!response.ok) {
          const errorPayload = {
            status: response.status,
            statusText: response.statusText,
            requestId: data.requestId,
            error: data.error ?? "Agent request failed",
            details: data.details,
          }

          console.error("[agent-ui][request-error]", errorPayload)
          setErrorDetails(errorPayload)
          throw new Error(
            `${errorPayload.error}${errorPayload.requestId ? ` (request ${errorPayload.requestId})` : ""}`,
          )
        }

        console.info("[agent-ui][success]", {
          model: data.model,
          positions: data.output.positions.length,
          transactions: data.output.submissionPayload.transactions.length,
        })
        setResult(data)
      } catch (submitError) {
        setResult(null)
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Unknown request error",
        )

        if (!(submitError instanceof Error)) {
          setErrorDetails({ raw: submitError })
        }
      }
    })
  }

  const handleSubmitPortfolio = async () => {
    if (!result || !canSubmit) {
      return
    }

    setSubmissionResult(null)
    setSubmissionError(null)
    setSubmissionErrorDetails(null)

    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submissionPayload: result.output.submissionPayload,
        }),
      })

      const data = (await response.json()) as {
        error?: string
        requestId?: string
        details?: unknown
        upstreamStatus?: number
        upstreamStatusText?: string
        response?: unknown
      }

      if (!response.ok) {
        const errorPayload = {
          status: response.status,
          statusText: response.statusText,
          requestId: data.requestId,
          upstreamStatus: data.upstreamStatus,
          upstreamStatusText: data.upstreamStatusText,
          error: data.error ?? "Submission failed",
          details: data.details,
        }

        console.error("[submit-ui][request-error]", errorPayload)
        setSubmissionErrorDetails(errorPayload)
        throw new Error(
          `${errorPayload.error}${errorPayload.requestId ? ` (request ${errorPayload.requestId})` : ""}`,
        )
      }

      const submissionPayload = {
        requestId: data.requestId ?? "unknown",
        response: data.response,
      }

      console.info("[submit-ui][success]", submissionPayload)
      setSubmissionResult(submissionPayload)
    } catch (submitError) {
      setSubmissionError(
        submitError instanceof Error
          ? submitError.message
          : "Unknown submission error",
      )

      if (!(submitError instanceof Error)) {
        setSubmissionErrorDetails({ raw: submitError })
      }
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.22),_transparent_32%),linear-gradient(180deg,_#fffdf7_0%,_#fff7e8_55%,_#fff1d1_100%)] px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="rounded-[2rem] border border-black/10 bg-white/80 p-8 shadow-[0_24px_90px_rgba(0,0,0,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
            MrKrabs Agent
          </p>
          <div className="mt-4 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Anthropic Haiku talking to Cala over MCP.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-zinc-700 sm:text-lg">
                This pass returns both a submission-ready JSON payload and a
                markdown report. The goal is to make the agent legible enough
                that we can spot any leakage past April 15, 2025 before we ever
                submit.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-black/10 bg-zinc-950 p-6 text-zinc-50">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300">
                Current Setup
              </p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
                <p>
                  Model: <span className="text-white">`claude-haiku-4-5`</span>
                </p>
                <p>
                  Transport: <span className="text-white">remote HTTP MCP</span>
                </p>
                <p>
                  Endpoint: <span className="text-white">`/api/agent`</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <form
            onSubmit={handleSubmit}
            className="rounded-[2rem] border border-black/10 bg-white/85 p-6 shadow-[0_20px_70px_rgba(0,0,0,0.06)]"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">Prompt</h2>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? "Running..." : "Run Agent"}
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="mt-4 min-h-64 w-full rounded-[1.5rem] border border-black/10 bg-amber-50/70 p-5 text-sm leading-7 outline-none ring-0 transition focus:border-amber-500"
            />
            <p className="mt-3 text-sm text-zinc-600">
              Keep prompts grounded in verified entity lookup. Company research
              questions work best for this first pass.
            </p>
          </form>

          <div className="rounded-[2rem] border border-black/10 bg-white/85 p-6 shadow-[0_20px_70px_rgba(0,0,0,0.06)]">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">Response</h2>
              {result ? (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
                  {result.model}
                </span>
              ) : null}
            </div>

            {error ? (
              <div className="mt-4 rounded-[1.25rem] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p>{error}</p>
                {errorDetails ? (
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-4 text-xs leading-6 text-zinc-800">
                    {JSON.stringify(errorDetails, null, 2)}
                  </pre>
                ) : null}
              </div>
            ) : null}

            {result ? (
              <div className="mt-4 space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-[1.25rem] border border-black/10 bg-zinc-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Positions
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-950">
                      {result.output.positions.length}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-black/10 bg-zinc-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Total Allocated
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-950">
                      {formatCurrency(
                        submissionChecks?.totalAllocated ?? 0,
                      )}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-black/10 bg-zinc-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Cutoff Audit
                    </p>
                    <p
                      className={`mt-2 text-sm font-semibold ${
                        result.output.cutoffAudit.postCutoffDataUsed
                          ? "text-red-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {result.output.cutoffAudit.postCutoffDataUsed
                        ? "Model claims post-cutoff data was used"
                        : "Model claims no post-cutoff data was used"}
                    </p>
                  </div>
                </div>

                {submissionChecks ? (
                  <div className="rounded-[1.5rem] border border-black/10 bg-zinc-50 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
                        Constraint Checks
                      </h3>
                      <button
                        type="button"
                        onClick={handleSubmitPortfolio}
                        disabled={!canSubmit}
                        className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
                      >
                        Submit Portfolio
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <p className="rounded-xl bg-white px-4 py-3 text-sm text-zinc-700">
                        Positions: {submissionChecks.positionCount}{" "}
                        {submissionChecks.hasMinPositions ? "PASS" : "FAIL"}
                      </p>
                      <p className="rounded-xl bg-white px-4 py-3 text-sm text-zinc-700">
                        Unique tickers: {submissionChecks.uniqueTickerCount}{" "}
                        {submissionChecks.hasUniqueTickers ? "PASS" : "FAIL"}
                      </p>
                      <p className="rounded-xl bg-white px-4 py-3 text-sm text-zinc-700">
                        Min position size:{" "}
                        {submissionChecks.hasMinPositionSize ? "PASS" : "FAIL"}
                      </p>
                      <p className="rounded-xl bg-white px-4 py-3 text-sm text-zinc-700">
                        Exact $1M budget:{" "}
                        {submissionChecks.hasExactBudget ? "PASS" : "FAIL"}
                      </p>
                    </div>

                    {submissionError ? (
                      <div className="mt-4 rounded-[1.25rem] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        <p>{submissionError}</p>
                        {submissionErrorDetails ? (
                          <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-4 text-xs leading-6 text-zinc-800">
                            {JSON.stringify(submissionErrorDetails, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}

                    {submissionResult ? (
                      <div className="mt-4 rounded-[1.25rem] border border-emerald-200 bg-emerald-50 p-4">
                        <p className="text-sm font-semibold text-emerald-800">
                          Submission sent successfully.
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-emerald-700">
                          Request ID: {submissionResult.requestId}
                        </p>
                        <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-4 text-xs leading-6 text-zinc-800">
                          {JSON.stringify(submissionResult.response, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-[1.5rem] border border-black/10 bg-zinc-950 p-5 text-sm leading-7 text-zinc-100 whitespace-pre-wrap">
                  {result.output.reportMarkdown}
                </div>

                <div className="rounded-[1.5rem] border border-black/10 bg-zinc-50 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
                      Submission Payload
                    </h3>
                  </div>
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-4 text-xs leading-6 text-zinc-800">
                    {JSON.stringify(result.output.submissionPayload, null, 2)}
                  </pre>
                </div>

                <div className="rounded-[1.5rem] border border-black/10 bg-zinc-50 p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
                    Position Records
                  </h3>
                  <div className="mt-4 space-y-4">
                    {result.output.positions.map((position) => (
                      <div
                        key={`${position.nasdaqCode}-${position.companyEntityId}`}
                        className="rounded-[1.25rem] border border-black/10 bg-white p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold text-zinc-950">
                              {position.companyName} · {position.nasdaqCode}
                            </p>
                            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Cala UUID: {position.companyEntityId}
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-zinc-800">
                            {formatCurrency(position.amount)}
                          </p>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-zinc-700">
                          {position.thesis}
                        </p>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                              Evidence
                            </p>
                            <ul className="mt-2 space-y-1 text-sm leading-6 text-zinc-700">
                              {position.calaEvidence.map((item, index) => (
                                <li key={index}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                              Risks
                            </p>
                            <ul className="mt-2 space-y-1 text-sm leading-6 text-zinc-700">
                              {position.riskNotes.map((item, index) => (
                                <li key={index}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                              Supporting Entity IDs
                            </p>
                            <ul className="mt-2 space-y-1 break-all text-sm leading-6 text-zinc-700">
                              {position.supportingEntityIds.map((item, index) => (
                                <li key={index}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-zinc-600">
                          {position.cutoffComplianceNote}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-black/10 bg-zinc-50 p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
                    Cutoff Audit Details
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-700">
                    {result.output.cutoffAudit.complianceSummary}
                  </p>
                  <ul className="mt-3 space-y-1 text-sm leading-6 text-zinc-700">
                    {result.output.cutoffAudit.bannedDataChecks.map(
                      (item, index) => (
                        <li key={index}>• {item}</li>
                      ),
                    )}
                  </ul>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
                    Tool Steps
                  </h3>
                  {result.steps.map((step, index) => (
                    <div
                      key={`${index}-${step.finishReason}`}
                      className="rounded-[1.25rem] border border-black/10 bg-zinc-50 p-4"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                        Step {index + 1} · {step.finishReason}
                      </p>
                      {step.text ? (
                        <p className="mt-2 text-sm leading-6 text-zinc-700">
                          {step.text}
                        </p>
                      ) : null}
                      <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-4 text-xs leading-6 text-zinc-800">
                        {JSON.stringify(
                          {
                            toolCalls: step.toolCalls,
                            toolResults: step.toolResults,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-7 text-zinc-600">
                No response yet. Submit a portfolio prompt to see the generated
                submission JSON, report markdown, and cutoff audit.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
