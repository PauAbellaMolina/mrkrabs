"use client";

import { useState } from "react";
import type { EntityEventsIndex, ToolEventMatch } from "@/lib/entity-events";
import { lookupEntityEvents } from "@/lib/entity-events";

// Inline badge for an entity UUID that the agent cited. When the
// backing run's events include a Cala tool call against this UUID,
// clicking the pill drops a popover showing the tool name + input +
// output — that's the "powered by Cala" provenance moment the judges
// are scoring on. If no matching call exists (e.g. rendered on a
// stale run or for an unrecognized UUID), the pill renders inert.

type Props = {
  uuid: string;
  label?: string;
  toolEvents?: EntityEventsIndex;
  size?: "sm" | "xs";
};

const OUTPUT_TRUNCATE_CHARS = 1200;

export function EntityPill({ uuid, label, toolEvents, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const matches = lookupEntityEvents(toolEvents ?? new Map(), uuid);
  const clickable = matches.length > 0;
  const displayLabel = label && label.trim().length > 0 ? label : shortUuid(uuid);

  const padding = size === "xs" ? "px-1.5 py-[1px]" : "px-1.5 py-0.5";
  const fontSize = size === "xs" ? "text-[9px]" : "text-[10px]";

  const pillClass =
    "inline-flex items-center gap-1 border border-[color:var(--border)] " +
    `${padding} ${fontSize} font-mono uppercase tracking-[0.15em] ` +
    "text-[color:var(--foreground)] " +
    (clickable
      ? "cursor-pointer hover:border-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
      : "cursor-default opacity-80");

  return (
    <span className="relative inline-block align-baseline">
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && setOpen(value => !value)}
        className={pillClass}
        aria-expanded={clickable ? open : undefined}
      >
        <span className="truncate">{displayLabel}</span>
        {clickable ? (
          <span aria-hidden className="text-[color:var(--muted-foreground)]">
            ◉
          </span>
        ) : null}
      </button>
      {clickable && open ? (
        <EntityProvenancePopover
          matches={matches}
          uuid={uuid}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}

function EntityProvenancePopover({
  matches,
  uuid,
  onClose,
}: {
  matches: ToolEventMatch[];
  uuid: string;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute left-0 top-[calc(100%+4px)] z-20 flex min-w-[320px] max-w-[560px] flex-col gap-3 border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
      role="dialog"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          cala provenance · {uuid}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
        >
          close
        </button>
      </div>
      {matches.map((match, idx) => (
        <ProvenanceEntry key={match.toolCallId} match={match} index={idx} />
      ))}
    </div>
  );
}

function ProvenanceEntry({
  match,
  index,
}: {
  match: ToolEventMatch;
  index: number;
}) {
  return (
    <div
      className={
        "flex flex-col gap-2 " +
        (index > 0 ? "border-t border-[color:var(--border)] pt-3" : "")
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs font-semibold text-[color:var(--foreground)]">
          {match.toolName}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          step {match.stepNumber != null ? match.stepNumber + 1 : "—"}
          {match.durationMs != null ? ` · ${match.durationMs}ms` : ""}
        </span>
      </div>
      <ProvenanceBlock label="Input" value={match.input} />
      <ProvenanceBlock
        label="Output"
        value={match.output}
        truncate={OUTPUT_TRUNCATE_CHARS}
      />
    </div>
  );
}

function ProvenanceBlock({
  label,
  value,
  truncate,
}: {
  label: string;
  value: unknown;
  truncate?: number;
}) {
  const serialized = formatJson(value);
  const rendered =
    truncate != null && serialized.length > truncate
      ? serialized.slice(0, truncate) + "\n… (truncated)"
      : serialized;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        {label}
      </span>
      <pre className="max-h-[220px] overflow-auto border border-[color:var(--border)] bg-[color:var(--background)] p-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words text-[color:var(--foreground)]">
        {rendered}
      </pre>
    </div>
  );
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shortUuid(uuid: string): string {
  if (uuid.length <= 10) return uuid;
  return uuid.slice(0, 8) + "…";
}
