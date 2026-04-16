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
  const [open, setOpen] = useState(false);
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
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Stop failed");
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex h-8 w-8 items-center justify-center border border-[color:var(--border)] bg-[color:var(--surface)] font-mono text-sm text-[color:var(--muted-foreground)] transition hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)]"
        aria-label="Session options"
      >
        ···
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-[calc(100%+4px)] z-20 flex min-w-[240px] flex-col gap-3 border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.4)]">
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
                  className="w-16 border border-[color:var(--border)] bg-[color:var(--background)] px-2 py-1.5 font-mono text-sm tabular-nums text-[color:var(--foreground)] disabled:opacity-60"
                />
              </div>
              <button
                type="submit"
                disabled={shrinkBusy}
                className="border border-[color:var(--border)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] disabled:opacity-60"
              >
                {shrinkBusy ? "…" : "Set"}
              </button>
            </form>

            <button
              type="button"
              onClick={handleStop}
              disabled={stopPending}
              className="w-full border border-[color:var(--border)] py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] disabled:opacity-60"
            >
              {stopPending ? "Stopping…" : "Stop session"}
            </button>

            {error ? (
              <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
                {error}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
