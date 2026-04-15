"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
