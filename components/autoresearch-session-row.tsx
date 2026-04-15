"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { AutoresearchSession } from "@/lib/autoresearch-session";

// Fixed locale + style so the server-rendered timestamp matches the client
// render and doesn't trigger a hydration mismatch.
const startedAtFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type Props = {
  session: AutoresearchSession;
  isLast: boolean;
};

export function AutoresearchSessionRow({ session, isLast }: Props) {
  const router = useRouter();
  const [stopError, setStopError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const pct =
    session.plannedIterations > 0
      ? Math.min(
          100,
          (session.completedIterations / session.plannedIterations) * 100,
        )
      : 0;

  const isRunning = session.status === "running";
  // Elapsed-time ticker is client-only — SSR would compute Date.now() on the
  // server and fight the browser's value on hydrate.
  const elapsed = useRunningElapsed(session.startedAt, isRunning);

  const handleStop = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setStopError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/autoresearch/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || data.ok === false) {
          throw new Error(data.error ?? "Stop failed");
        }
        router.refresh();
      } catch (error) {
        setStopError(
          error instanceof Error ? error.message : "Unknown stop error",
        );
      }
    });
  };

  return (
    <li
      className={isLast ? "" : "border-b border-[color:var(--border)]"}
    >
      <div className="relative">
        <Link
          href={`/autoresearch/runs/${session.sessionId}`}
          className="flex flex-col gap-3 px-5 py-4 transition hover:bg-[color:var(--surface-elevated)]"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <StatusDot status={session.status} />
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                {session.status}
              </span>
              <span className="font-mono text-base tabular-nums text-[color:var(--foreground)]">
                {session.completedIterations}/{session.plannedIterations}
              </span>
              <span className="font-mono text-[11px] text-[color:var(--muted-foreground)]">
                iterations
              </span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)] tabular-nums">
              {isRunning
                ? (elapsed ?? "…")
                : startedAtFormatter.format(new Date(session.startedAt))}
            </span>
          </div>

          <div className="relative h-1 w-full border border-[color:var(--border)]">
            <div
              className="absolute inset-y-0 left-0 bg-[color:var(--foreground)]"
              style={{ width: `${pct}%` }}
              aria-hidden
            />
          </div>

          <SessionStats session={session} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
              {session.model}
              {session.host ? ` · ${session.host}` : ""}
              {session.pid != null ? ` · pid ${session.pid}` : ""}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
              session {session.sessionId.slice(0, 8)}
            </p>
          </div>

          {session.errorMessage ? (
            <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
              error: {session.errorMessage}
            </p>
          ) : null}
        </Link>

        {isRunning ? (
          <div className="absolute right-5 top-5 flex items-center gap-2">
            {stopError ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                {stopError}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleStop}
              disabled={isPending}
              className="relative z-10 border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Stopping…" : "Stop"}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SessionStats({ session }: { session: AutoresearchSession }) {
  const kept = session.keptCount ?? 0;
  const discarded = session.discardedCount ?? 0;
  const skipped = session.skippedCount ?? 0;
  const total = kept + discarded + skipped;
  const best = session.bestScore ?? null;

  // No ledger entries yet (fresh session with zero settled iterations).
  if (total === 0 && best == null) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {kept > 0 ? (
        <StatChip label={`${kept} kept`} filled />
      ) : null}
      {discarded > 0 ? <StatChip label={`${discarded} discarded`} /> : null}
      {skipped > 0 ? <StatChip label={`${skipped} skipped`} /> : null}
      {best != null ? (
        <StatChip label={`best $${best.toLocaleString()}`} filled />
      ) : total > 0 ? (
        <StatChip label="no score" muted />
      ) : null}
    </div>
  );
}

function StatChip({
  label,
  filled = false,
  muted = false,
}: {
  label: string;
  filled?: boolean;
  muted?: boolean;
}) {
  const className = filled
    ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]"
    : muted
      ? "border-[color:var(--border)] text-[color:var(--muted-foreground)]"
      : "border-[color:var(--border)] text-[color:var(--foreground)]";
  return (
    <span
      className={
        "inline-flex items-center border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] " +
        className
      }
    >
      {label}
    </span>
  );
}

function StatusDot({
  status,
}: {
  status: AutoresearchSession["status"];
}) {
  const base = "inline-block h-2 w-2 ";
  if (status === "running") {
    return (
      <span
        aria-hidden
        className={base + "animate-pulse bg-[color:var(--foreground)]"}
      />
    );
  }
  if (status === "completed") {
    return (
      <span aria-hidden className={base + "bg-[color:var(--foreground)]"} />
    );
  }
  return (
    <span aria-hidden className={base + "bg-[color:var(--muted-foreground)]"} />
  );
}

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Returns null on the server + first client render so the SSR markup and
// the hydrated markup match; then ticks once per second on the client.
// State transitions only happen inside the timer callback (not the effect
// body) so the react-hooks/set-state-in-effect lint stays satisfied.
function useRunningElapsed(startedAt: string, isRunning: boolean): string | null {
  const [elapsed, setElapsed] = useState<string | null>(null);
  useEffect(() => {
    if (!isRunning) return;
    const tick = () => {
      setElapsed(formatElapsed(Date.now() - new Date(startedAt).getTime()));
    };
    const kickoff = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [startedAt, isRunning]);
  useEffect(() => {
    if (isRunning) return;
    // Reset via effect so the clear runs outside render and the lint is
    // happy; async-by-scheduling (setTimeout) for the same reason.
    const handle = window.setTimeout(() => setElapsed(null), 0);
    return () => window.clearTimeout(handle);
  }, [isRunning]);
  return elapsed;
}
