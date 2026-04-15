"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  sessionId: string;
};

export function AutoresearchSessionStopButton({ sessionId }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/autoresearch/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || data.ok === false) {
          throw new Error(data.error ?? "Stop failed");
        }
        router.refresh();
      } catch (stopError) {
        setError(
          stopError instanceof Error ? stopError.message : "Unknown stop error",
        );
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      {error ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center border border-[color:var(--border)] bg-transparent px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Stopping…" : "Stop session"}
      </button>
    </div>
  );
}
