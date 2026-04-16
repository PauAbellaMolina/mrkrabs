"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export function RefreshButton() {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  const handleClick = useCallback(() => {
    setSpinning(true);
    router.refresh();
    window.setTimeout(() => setSpinning(false), 600);
  }, [router]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
    >
      <span className={spinning ? "animate-spin" : ""} aria-hidden>
        ↻
      </span>
      Refresh
    </button>
  );
}
