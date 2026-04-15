"use client";

import { STAGE_LABELS, type RunStage } from "@/lib/run-stage";

export type StageFilter = RunStage | "all";

type Props = {
  value: StageFilter;
  onChange: (next: StageFilter) => void;
  counts: Record<RunStage, number>;
  total: number;
};

// Shown order. Matches the general lifecycle — in-flight first, ship-ready
// next, then terminal outcomes.
const FILTER_ORDER: RunStage[] = [
  "running",
  "done",
  "submitted",
  "submit-failed",
  "failed",
];

const STAGE_COLOR_VAR: Record<RunStage, string> = {
  running: "var(--stage-running)",
  done: "var(--stage-done)",
  submitted: "var(--stage-submitted)",
  "submit-failed": "var(--stage-submit-failed)",
  failed: "var(--stage-failed)",
};

export function StageFilterPills({ value, onChange, counts, total }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill
        label="All"
        count={total}
        active={value === "all"}
        onClick={() => onChange("all")}
      />
      {FILTER_ORDER.map(stage => (
        <Pill
          key={stage}
          label={STAGE_LABELS[stage]}
          count={counts[stage] ?? 0}
          active={value === stage}
          color={STAGE_COLOR_VAR[stage]}
          onClick={() => onChange(stage)}
          disabled={(counts[stage] ?? 0) === 0}
        />
      ))}
    </div>
  );
}

function Pill({
  label,
  count,
  active,
  color,
  onClick,
  disabled = false,
}: {
  label: string;
  count: number;
  active: boolean;
  color?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const accent = color ?? "var(--foreground)";
  const style: React.CSSProperties = active
    ? {
        color: accent,
        borderColor: accent,
        backgroundColor: `color-mix(in oklab, ${accent} 22%, var(--background))`,
      }
    : color
      ? {
          color: `color-mix(in oklab, ${color} 75%, var(--muted-foreground))`,
          borderColor: `color-mix(in oklab, ${color} 45%, var(--border))`,
          backgroundColor: "transparent",
        }
      : {
          color: "var(--muted-foreground)",
          borderColor: "var(--border)",
          backgroundColor: "transparent",
        };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-2 border px-3 py-1.5 font-mono " +
        "text-[10px] uppercase tracking-[0.2em] transition " +
        "disabled:cursor-not-allowed disabled:opacity-40"
      }
      style={style}
    >
      <span>{label}</span>
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );
}
