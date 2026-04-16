"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { AutoresearchSession } from "@/lib/autoresearch-session";
import { RunStageBadge } from "./run-stage-badge";

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
  const scores = session.scores ?? [];
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
          className={
            "flex items-center gap-5 px-5 py-4 transition hover:bg-[color:var(--surface-elevated)]" +
            (session.status === "running" ? " animate-pulse" : "")
          }
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-3">
              <SessionStatusBadge status={session.status} />
              <span className="font-mono text-sm tabular-nums text-[color:var(--foreground)]">
                {session.completedIterations}/{session.plannedIterations}
              </span>
              <span className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
                {session.model}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {session.bestScore != null ? (
                <span className="font-mono text-lg font-semibold tabular-nums text-[color:var(--foreground)]">
                  ${session.bestScore.toLocaleString()}
                </span>
              ) : null}
              <SessionStats session={session} />
            </div>
          </div>
          {scores.length >= 2 ? (
            <SessionSparkline scores={scores} />
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

const SESSION_STATUS_COLORS: Record<string, string> = {
  running: "var(--stage-running)",
  completed: "var(--stage-submitted)",
  stopped: "var(--stage-submit-failed)",
  failed: "var(--stage-failed)",
};

const SESSION_STATUS_LABELS: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
};

function SessionStatusBadge({ status }: { status: string }) {
  const color = SESSION_STATUS_COLORS[status] ?? "var(--muted-foreground)";
  const label = SESSION_STATUS_LABELS[status] ?? status;
  return (
    <span
      className="inline-flex items-center gap-2 border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em]"
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in oklab, ${color} 22%, var(--background))`,
      }}
    >
      {status === "running" ? (
        <span className="animate-pulse" aria-hidden>◦</span>
      ) : status === "completed" ? (
        <span aria-hidden>✓</span>
      ) : (
        <span aria-hidden>×</span>
      )}
      {label}
    </span>
  );
}

function SessionSparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) return null;
  const W = 120;
  const H = 36;
  const pad = 3;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const points = scores.map((s, i) => ({
    x: pad + (i / (scores.length - 1)) * (W - pad * 2),
    y: pad + (H - pad * 2) - ((s - min) / range) * (H - pad * 2),
  }));

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-9 w-[120px] shrink-0"
      aria-label="Score trend"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth="1.5"
        opacity="0.5"
      />
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r="2.5"
        fill="var(--foreground)"
      />
    </svg>
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

function ShrinkControl({ session }: { session: AutoresearchSession }) {
  const router = useRouter();
  const remaining = session.plannedIterations - session.completedIterations;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleShrink = (event: React.MouseEvent | React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const raw = inputRef.current?.value;
    if (!raw) return;
    const newPlanned = session.completedIterations + Number(raw);
    if (!Number.isFinite(newPlanned) || newPlanned < session.completedIterations) return;
    setBusy(true);
    fetch("/api/autoresearch/shrink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        plannedIterations: newPlanned,
      }),
    })
      .then(() => router.refresh())
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <form
      onSubmit={handleShrink}
      onClick={event => event.stopPropagation()}
      className="relative z-10 flex items-center gap-1"
    >
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={remaining}
        defaultValue={remaining}
        disabled={busy}
        className="w-12 border border-[color:var(--border)] bg-[color:var(--background)] px-1.5 py-1 text-center font-mono text-[10px] tabular-nums text-[color:var(--foreground)] disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={busy}
        className="border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "…" : "left"}
      </button>
    </form>
  );
}
