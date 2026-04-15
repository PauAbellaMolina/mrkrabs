"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "queued"; iterations: number; at: number }
  | { kind: "error"; message: string };

const DEFAULT_ITERATIONS = 5;
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 50;

export function AutoresearchTrigger() {
  const router = useRouter();
  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const clamped = Math.max(
      MIN_ITERATIONS,
      Math.min(MAX_ITERATIONS, Math.floor(iterations) || DEFAULT_ITERATIONS),
    );

    startTransition(async () => {
      try {
        const response = await fetch("/api/autoresearch/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ iterations: clamped }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || data.ok === false) {
          throw new Error(data.error ?? "Failed to spawn autoresearch");
        }
        setStatus({ kind: "queued", iterations: clamped, at: Date.now() });
        // Give the child process a moment to write its first ledger row,
        // then refresh the page so the timeline picks it up.
        window.setTimeout(() => router.refresh(), 1200);
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Unknown trigger error",
        });
      }
    });
  };

  return (
    <section className="flex flex-col gap-4 border border-[color:var(--border)] px-5 py-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Trigger
          </p>
          <h2 className="mt-1 font-sans text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
            Run research iterations
          </h2>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          local dev only
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-center gap-3"
      >
        <label className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Iterations
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_ITERATIONS}
            max={MAX_ITERATIONS}
            value={iterations}
            onChange={event => setIterations(Number(event.target.value))}
            disabled={isPending}
            className="w-20 border border-[color:var(--border)] bg-transparent px-3 py-2 text-center font-mono text-sm tabular-nums text-[color:var(--foreground)] focus:border-[color:var(--foreground)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-w-[220px] items-center justify-center gap-3 border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-6 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--background)] transition hover:bg-transparent hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:hover:bg-[color:var(--foreground)] disabled:hover:text-[color:var(--background)]"
        >
          {isPending ? (
            <>
              <span
                aria-hidden
                className="inline-block h-2 w-2 animate-pulse bg-[color:var(--background)]"
              />
              Spawning…
            </>
          ) : (
            "Run iterations"
          )}
        </button>

        <StatusLine status={status} />
      </form>

      <p className="font-mono text-[10px] leading-relaxed text-[color:var(--muted-foreground)]">
        Spawns <span className="text-[color:var(--foreground)]">pnpm autoresearch N</span> as a
        detached child process. Iterations land in Convex as they finish and
        appear in the timeline below without reload.
      </p>
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;

  if (status.kind === "queued") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--foreground)]">
        queued {status.iterations} iteration{status.iterations === 1 ? "" : "s"}
        {" — "}watch the timeline
      </span>
    );
  }

  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
      error: {status.message}
    </span>
  );
}
