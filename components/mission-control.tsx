"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMockMode } from "@/lib/mock-mode";
import {
  addFreshRunningRun,
  clearMockRunRecords,
  emitMockStoreChanged,
  seedMockRunRecords,
} from "@/lib/mock-store";

// Peek-to-open dev panel flush to the top-right corner.
//
// Idle: a tiny 28×20px trigger in the corner — just a status dot inside
// a hairline box. No label, no text, not noisy.
//
// Hover (or click): expands into a full label strip + control panel
// directly below. The trigger and panel live in the same wrapping div
// so moving the cursor between them doesn't trip onMouseLeave — only
// leaving the combined area closes it, with a small grace delay to
// absorb cursor wobble.

const LEAVE_DELAY_MS = 180;

export function MissionControl() {
  const router = useRouter();
  const { ready, enabled, records, setEnabled } = useMockMode();
  const [open, setOpen] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const leaveTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    };
  }, []);

  const handleEnter = () => {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setOpen(true);
  };

  const handleLeave = () => {
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setOpen(false), LEAVE_DELAY_MS);
  };

  const notifyAndRefresh = (action: string) => {
    setLastAction(action);
    emitMockStoreChanged();
    router.refresh();
  };

  const handleToggle = () => {
    setEnabled(!enabled);
    notifyAndRefresh(enabled ? "mock mode off" : "mock mode on");
  };

  const handleSeed = () => {
    seedMockRunRecords();
    if (!enabled) setEnabled(true);
    notifyAndRefresh("seeded fixtures");
  };

  const handleAddRunning = () => {
    addFreshRunningRun();
    if (!enabled) setEnabled(true);
    notifyAndRefresh("added running run");
  };

  const handleClear = () => {
    clearMockRunRecords();
    notifyAndRefresh("cleared mock store");
  };

  if (!ready) return null;

  const mockCount = records.length;

  return (
    <div
      className="pointer-events-none fixed right-0 top-0 z-50 flex justify-end font-mono"
      aria-hidden={!open}
    >
      <div
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className="pointer-events-auto flex flex-col items-end"
      >
        {/* Idle trigger. Minimal footprint — just a dot inside a hairline
           box, flush to the corner. Clicking also toggles for keyboard /
           touch, because not everyone hovers. */}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          onFocus={handleEnter}
          onBlur={handleLeave}
          aria-label="Mission control"
          aria-expanded={open}
          aria-controls="mission-control-panel"
          className={
            "flex h-7 w-10 items-center justify-center border-b border-l border-[color:var(--border)] bg-[color:var(--surface)] transition " +
            (open ? "bg-[color:var(--surface-elevated)]" : "hover:bg-[color:var(--surface-elevated)]")
          }
        >
          <span
            aria-hidden
            className={
              "inline-block h-1.5 w-1.5 " +
              (enabled
                ? "animate-pulse bg-[color:var(--foreground)]"
                : "bg-[color:var(--muted-foreground)]")
            }
          />
        </button>

        {/* Expanded: only rendered when open so the DOM stays clean when
           idle and there's zero visual noise. The wrapping div still
           encloses this once it mounts, so moving the cursor from the
           trigger into the panel doesn't fire onMouseLeave. */}
        {open ? (
          <div
            id="mission-control-panel"
            className="w-[360px] border-b border-l border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_12px_50px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-center gap-3 border-b border-[color:var(--border)] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--foreground)]">
              <span
                aria-hidden
                className={
                  "inline-block h-1.5 w-1.5 " +
                  (enabled
                    ? "animate-pulse bg-[color:var(--foreground)]"
                    : "bg-[color:var(--muted-foreground)]")
                }
              />
              <span className="font-semibold">Mission control</span>
              <span className="text-[color:var(--muted-foreground)]">
                {enabled ? "mock" : "live"}
              </span>
              {enabled && mockCount > 0 ? (
                <span className="text-[color:var(--muted-foreground)] tabular-nums">
                  · {mockCount}
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-4 px-4 py-4 text-[11px] text-[color:var(--foreground)]">
              <section className="flex flex-col gap-2">
                <p className="text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                  Mode
                </p>
                <button
                  type="button"
                  onClick={handleToggle}
                  className={
                    "flex items-center justify-between gap-3 border px-3 py-2 transition " +
                    (enabled
                      ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)] hover:bg-transparent hover:text-[color:var(--foreground)]"
                      : "border-[color:var(--border)] bg-transparent text-[color:var(--foreground)] hover:border-[color:var(--foreground)]")
                  }
                >
                  <span className="uppercase tracking-[0.18em]">
                    {enabled ? "Disable mock mode" : "Enable mock mode"}
                  </span>
                  <span aria-hidden>{enabled ? "●" : "◦"}</span>
                </button>
                <p className="text-[9px] leading-relaxed text-[color:var(--muted-foreground)]">
                  When on, the runs list and detail pages render from
                  localStorage instead of hitting the backend. Real runs
                  still get written to disk — mock mode only hides them
                  from view.
                </p>
              </section>

              <div className="h-px bg-[color:var(--border)]" />

              <section className="flex flex-col gap-2">
                <p className="text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                  Fixtures
                </p>
                <ActionButton
                  onClick={handleSeed}
                  label="Seed 7 fixture runs"
                  hint="all stages"
                />
                <ActionButton
                  onClick={handleAddRunning}
                  label="Add fresh running run"
                  hint="tests auto-refresh"
                />
                <ActionButton
                  onClick={handleClear}
                  label="Clear mock store"
                  hint="resets to empty"
                  variant="danger"
                />
              </section>

              <div className="h-px bg-[color:var(--border)]" />

              <section className="flex flex-col gap-1 text-[10px] leading-relaxed text-[color:var(--muted-foreground)]">
                <MetaRow label="mock records" value={`${mockCount}`} />
                <MetaRow label="last action" value={lastAction ?? "—"} />
                <MetaRow label="storage" value="localStorage" />
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  hint,
  variant = "default",
}: {
  onClick: () => void;
  label: string;
  hint?: string;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-center justify-between gap-3 border border-[color:var(--border)] px-3 py-2 transition hover:border-[color:var(--foreground)] " +
        (variant === "danger"
          ? "border-dashed text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
          : "text-[color:var(--foreground)]")
      }
    >
      <span className="uppercase tracking-[0.18em]">{label}</span>
      {hint ? (
        <span className="text-[9px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
          {hint}
        </span>
      ) : null}
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="uppercase tracking-[0.18em]">{label}</span>
      <span className="text-[color:var(--foreground)]">{value}</span>
    </div>
  );
}
