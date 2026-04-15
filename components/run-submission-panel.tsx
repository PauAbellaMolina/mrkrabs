"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AgentRunRecord } from "@/lib/agent-runs";
import {
  emitMockStoreChanged,
  updateMockRunRecord,
} from "@/lib/mock-store";
import {
  formatSubmissionMetric,
  parseSubmissionResponse,
  type ParsedSubmissionResponse,
} from "@/lib/submission-result";

// The submission block the run details page shows for "done" runs. Handles
// all three client-visible states:
//   1. idle       — big "Submit to leaderboard" call to action
//   2. submitting — pulsing skeleton with inflight messaging
//   3. settled    — headline metric + secondary metrics + raw response
//
// When the run is already submitted (persisted), we hydrate with the
// server-side `initialSubmission` so there's no flash of "idle".

type SubmissionState =
  | { kind: "idle" }
  | { kind: "submitting"; startedAt: number }
  | {
      kind: "settled";
      status: "submitted" | "failed";
      submittedAt: string;
      requestId: string;
      upstreamStatus?: number;
      upstreamStatusText?: string;
      response?: unknown;
      details?: unknown;
    };

type Props = {
  runId: string;
  initialSubmission: AgentRunRecord["leaderboardSubmission"];
  /**
   * When true, the submit button simulates a Convex round-trip instead of
   * actually hitting /api/runs/[id]/submit. Used by Mission Control so the
   * UI can iterate on the submitted/failed states without a real backend.
   */
  isMock?: boolean;
};

// Fake Convex response shaped exactly like the fixtures so the parser can
// pull a believable headline return out of it.
function buildMockSubmissionResponse(): unknown {
  const returnPct = Math.random() * 0.3 - 0.05;
  const excess = returnPct - 0.096;
  return {
    score: Math.round(1_000_000 * (1 + returnPct)),
    totalReturn: Number(returnPct.toFixed(4)),
    spxReturn: 0.096,
    excessReturn: Number(excess.toFixed(4)),
    sharpe: Number((1 + Math.random() * 2 - 0.5).toFixed(2)),
    maxDrawdown: Number((-0.05 - Math.random() * 0.15).toFixed(4)),
    positionsScored: 50,
    status: "accepted",
    message: `Mock submission · realised return ${
      (returnPct * 100).toFixed(2)
    }% vs SPX +9.60%.`,
  };
}

export function RunSubmissionPanel({ runId, initialSubmission, isMock = false }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<SubmissionState>(() =>
    initialSubmission
      ? {
          kind: "settled",
          status: initialSubmission.status,
          submittedAt: initialSubmission.submittedAt,
          requestId: initialSubmission.requestId,
          upstreamStatus: initialSubmission.upstreamStatus,
          upstreamStatusText: initialSubmission.upstreamStatusText,
          response: initialSubmission.response,
          details: initialSubmission.details,
        }
      : { kind: "idle" },
  );
  const [fetchError, setFetchError] = useState<string | null>(null);

  const submit = () => {
    setFetchError(null);
    setState({ kind: "submitting", startedAt: Date.now() });

    if (isMock) {
      // Simulate the Convex round-trip so Pau can see the pulse skeleton
      // and the headline return without a real backend. 1.5s feels like a
      // real submission without being boring.
      window.setTimeout(() => {
        const submittedAt = new Date().toISOString();
        const response = buildMockSubmissionResponse();
        const submission = {
          status: "submitted" as const,
          submittedAt,
          requestId: `mock-req-${Math.random().toString(36).slice(2, 10)}`,
          response,
        };
        setState({
          kind: "settled",
          status: "submitted",
          submittedAt,
          requestId: submission.requestId,
          response,
        });
        updateMockRunRecord(runId, record => ({
          ...record,
          leaderboardSubmission: submission,
        }));
        emitMockStoreChanged();
        router.refresh();
      }, 1500);
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/submit`, {
          method: "POST",
        });
        const data = (await response.json()) as {
          error?: string;
          requestId?: string;
          upstreamStatus?: number;
          upstreamStatusText?: string;
          response?: unknown;
          details?: unknown;
        };
        const submittedAt = new Date().toISOString();
        if (!response.ok) {
          setState({
            kind: "settled",
            status: "failed",
            submittedAt,
            requestId: data.requestId ?? "unknown",
            upstreamStatus: data.upstreamStatus,
            upstreamStatusText: data.upstreamStatusText,
            details: data.details,
          });
          throw new Error(data.error ?? "Submission failed");
        }
        setState({
          kind: "settled",
          status: "submitted",
          submittedAt,
          requestId: data.requestId ?? "unknown",
          response: data.response,
        });
        router.refresh();
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Unknown submit error");
      }
    });
  };

  return (
    <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <header className="border-b border-[color:var(--border)] px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
          Leaderboard
        </p>
        <h2 className="mt-1 font-sans text-base font-semibold tracking-tight text-[color:var(--foreground)]">
          Submission
        </h2>
      </header>

      <div className="px-5 py-6">
        {state.kind === "idle" ? (
          <IdleView onSubmit={submit} disabled={isPending} error={fetchError} />
        ) : state.kind === "submitting" ? (
          <SubmittingView startedAt={state.startedAt} />
        ) : (
          <SettledView state={state} onResubmit={submit} disabled={isPending} />
        )}
      </div>
    </section>
  );
}

function IdleView({
  onSubmit,
  disabled,
  error,
}: {
  onSubmit: () => void;
  disabled: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-start gap-5">
      <p className="max-w-2xl text-sm leading-6 text-[color:var(--muted-foreground)]">
        Push this portfolio to the Cala leaderboard. Convex will score it and
        return your realised return over the 2025-04-15 → 2026-04-15 window.
      </p>
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        className="border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-6 py-3 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--background)] transition hover:bg-transparent hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[color:var(--foreground)] disabled:hover:text-[color:var(--background)]"
      >
        Submit to leaderboard
      </button>
      {error ? <ErrorBlock message={error} /> : null}
    </div>
  );
}

function SubmittingView({ startedAt }: { startedAt: number }) {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-2 w-2 animate-pulse bg-[color:var(--foreground)]"
        />
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[color:var(--foreground)]">
          Submitting to leaderboard · {elapsedSeconds}s
        </p>
      </div>
      <div className="flex flex-col gap-2 border border-[color:var(--border)] bg-[color:var(--background)] p-5">
        <div className="h-3 w-2/3 animate-pulse bg-[color:var(--surface-elevated)]" />
        <div className="h-3 w-1/2 animate-pulse bg-[color:var(--surface)]" />
        <div className="h-3 w-3/5 animate-pulse bg-[color:var(--surface-elevated)]" />
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        Waiting on upstream score…
      </p>
    </div>
  );
}

function SettledView({
  state,
  onResubmit,
  disabled,
}: {
  state: Extract<SubmissionState, { kind: "settled" }>;
  onResubmit: () => void;
  disabled: boolean;
}) {
  const parsed = parseSubmissionResponse(
    state.status === "submitted" ? state.response : null,
  );

  if (state.status === "failed") {
    return (
      <div className="flex flex-col gap-5">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[color:var(--foreground)]">
          Submission rejected
        </p>
        <ErrorBlock
          message={
            state.upstreamStatus
              ? `Upstream responded ${state.upstreamStatus} ${state.upstreamStatusText ?? ""}`.trim()
              : "Upstream rejected the payload."
          }
          details={state.details}
        />
        <button
          type="button"
          onClick={onResubmit}
          disabled={disabled}
          className="self-start border border-[color:var(--foreground)] bg-transparent px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Retry submission
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HeadlineMetric parsed={parsed} />
      {parsed.metrics.length > 0 ? (
        <MetricsGrid metrics={parsed.metrics} headlineKey={parsed.headline?.key} />
      ) : null}
      {parsed.messages.length > 0 ? (
        <MessagesBlock messages={parsed.messages} />
      ) : null}
      <RawResponseBlock raw={parsed.raw} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
          Request {state.requestId}
        </p>
        <button
          type="button"
          onClick={onResubmit}
          disabled={disabled}
          className="border border-[color:var(--border)] bg-transparent px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-foreground)] transition hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Resubmit
        </button>
      </div>
    </div>
  );
}

function HeadlineMetric({ parsed }: { parsed: ParsedSubmissionResponse }) {
  if (!parsed.headline) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          Leaderboard response
        </p>
        <p className="font-sans text-sm text-[color:var(--foreground)]">
          Accepted. No numeric return reported upstream yet — see the raw
          response below.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        {parsed.headline.label}
      </p>
      <p className="font-mono text-5xl font-semibold tracking-tight text-[color:var(--foreground)] tabular-nums">
        {formatSubmissionMetric(parsed.headline)}
      </p>
    </div>
  );
}

function MetricsGrid({
  metrics,
  headlineKey,
}: {
  metrics: ParsedSubmissionResponse["metrics"];
  headlineKey: string | undefined;
}) {
  const secondary = metrics.filter(m => m.key !== headlineKey);
  if (secondary.length === 0) return null;
  return (
    <div className="grid grid-cols-2 border border-[color:var(--border)] sm:grid-cols-3">
      {secondary.map((metric, i) => (
        <div
          key={metric.key}
          className={
            "flex flex-col gap-1 bg-[color:var(--background)] px-4 py-3 " +
            (i > 0 ? "border-l border-[color:var(--border)]" : "")
          }
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
            {metric.label}
          </p>
          <p className="font-mono text-sm font-semibold text-[color:var(--foreground)] tabular-nums">
            {formatSubmissionMetric(metric)}
          </p>
        </div>
      ))}
    </div>
  );
}

function MessagesBlock({
  messages,
}: {
  messages: ParsedSubmissionResponse["messages"];
}) {
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--background)]">
      {messages.slice(0, 5).map((message, i) => (
        <div
          key={message.key + i}
          className={
            "flex flex-col gap-1 px-4 py-3 " +
            (i > 0 ? "border-t border-[color:var(--border)]" : "")
          }
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
            {message.key}
          </p>
          <p className="font-mono text-xs text-[color:var(--foreground)]">
            {message.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function RawResponseBlock({ raw }: { raw: unknown }) {
  return (
    <details className="border border-[color:var(--border)] bg-[color:var(--background)]">
      <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]">
        Raw upstream response ▸
      </summary>
      <pre className="max-h-80 overflow-auto border-t border-[color:var(--border)] p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[color:var(--foreground)]">
        {JSON.stringify(raw ?? null, null, 2)}
      </pre>
    </details>
  );
}

function ErrorBlock({
  message,
  details,
}: {
  message: string;
  details?: unknown;
}) {
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--background)]">
      <div className="border-b border-[color:var(--border)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          Error
        </p>
        <p className="mt-1 font-mono text-xs text-[color:var(--foreground)]">
          {message}
        </p>
      </div>
      {details ? (
        <pre className="max-h-60 overflow-auto p-4 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words text-[color:var(--muted-foreground)]">
          {JSON.stringify(details, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
