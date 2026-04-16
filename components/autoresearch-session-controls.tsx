"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type Props = {
  sessionId: string;
  completedIterations: number;
  plannedIterations: number;
};

export function AutoresearchSessionControls({
  sessionId,
  completedIterations,
  plannedIterations,
}: Props) {
  const router = useRouter();
  const remaining = plannedIterations - completedIterations;
  const inputRef = useRef<HTMLInputElement>(null);
  const [shrinkBusy, setShrinkBusy] = useState(false);
  const [stopPending, startStopTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleShrink = (event: React.FormEvent) => {
    event.preventDefault();
    const raw = inputRef.current?.value;
    if (!raw) return;
    const newRemaining = Number(raw);
    if (!Number.isFinite(newRemaining) || newRemaining < 0) return;
    const newPlanned = completedIterations + newRemaining;
    setShrinkBusy(true);
    setError(null);
    fetch("/api/autoresearch/shrink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, plannedIterations: newPlanned }),
    })
      .then(async res => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Shrink failed");
        }
        router.refresh();
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : "Shrink failed");
      })
      .finally(() => setShrinkBusy(false));
  };

  const handleStop = () => {
    setError(null);
    startStopTransition(async () => {
      try {
        const res = await fetch("/api/autoresearch/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Stop failed");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Stop failed");
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <form onSubmit={handleShrink} className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="remaining-input"
              className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]"
            >
              Remaining iterations
            </label>
            <input
              id="remaining-input"
              ref={inputRef}
              type="number"
              min={0}
              max={remaining}
              defaultValue={remaining}
              disabled={shrinkBusy}
              className="w-20 border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2 font-mono text-sm tabular-nums text-[color:var(--foreground)] disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={shrinkBusy}
            className="border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {shrinkBusy ? "Updating…" : "Set"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleStop}
          disabled={stopPending}
          className="border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {stopPending ? "Stopping…" : "Stop session"}
        </button>
      </div>

      {error ? (
        <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
