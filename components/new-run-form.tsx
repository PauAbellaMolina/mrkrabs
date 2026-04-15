"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { DEFAULT_RUN_PROMPT } from "@/lib/run-prompt";

export function NewRunForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!startedAt) {
      setElapsedMs(0);
      return;
    }
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const handleClick = () => {
    setError(null);
    setStartedAt(Date.now());

    startTransition(async () => {
      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: DEFAULT_RUN_PROMPT }),
        });

        const data = (await response.json()) as {
          error?: string;
          requestId?: string;
          runId?: string;
        };

        if (!response.ok || !data.runId) {
          throw new Error(
            data.error ??
              `Agent request failed${data.requestId ? ` (${data.requestId})` : ""}`,
          );
        }

        setStartedAt(null);
        router.push(`/runs/${data.runId}`);
        router.refresh();
      } catch (submitError) {
        setStartedAt(null);
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Unknown agent request error",
        );
      }
    });
  };

  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="flex flex-wrap items-center justify-center gap-4 px-6 py-10">
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          aria-live="polite"
          className="inline-flex min-w-[260px] items-center justify-center gap-3 border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--background)] transition hover:bg-transparent hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:hover:bg-[color:var(--foreground)] disabled:hover:text-[color:var(--background)]"
        >
          {isPending ? (
            <>
              <span
                aria-hidden
                className="inline-block h-2 w-2 animate-pulse bg-[color:var(--background)]"
              />
              Running · {formatElapsed(elapsedMs)}
            </>
          ) : (
            "Run agent"
          )}
        </button>

        <Link
          href="/autoresearch"
          className="inline-flex min-w-[260px] items-center justify-center gap-3 border border-[color:var(--border)] bg-transparent px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)]"
        >
          Autoresearch →
        </Link>
      </div>

      {error ? (
        <div className="border-t border-[color:var(--border)] px-6 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Error
          </p>
          <p className="mt-1 font-mono text-xs text-[color:var(--foreground)]">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function formatElapsed(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
