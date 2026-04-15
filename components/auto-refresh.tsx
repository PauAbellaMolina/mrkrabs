"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Poll Next.js server components by calling router.refresh() on an interval.
// No new API route — the server component re-runs its data reads and the UI
// updates in place. Only mounts when `enabled` is true, so once the run is
// terminal the polling stops cleanly.
//
// Usage:
//   <AutoRefresh enabled={stage === "running"} intervalMs={1000} />

export function AutoRefresh({
  enabled,
  intervalMs,
}: {
  enabled: boolean;
  intervalMs: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, router]);

  return null;
}
