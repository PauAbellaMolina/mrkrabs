"use client";

import { useState } from "react";
import type { CalaAgentResult } from "@/lib/cala-agent";
import type { EntityEventsIndex } from "@/lib/entity-events";
import type { DiffMarker } from "@/lib/run-diff";
import type { PortfolioPosition } from "@/lib/portfolio-schema";
import { EntityPill } from "./entity-pill";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const DIFF_GLYPH: Record<Exclude<DiffMarker, null>, string> = {
  new: "+",
  removed: "−",
  up: "↑",
  down: "↓",
  flat: "=",
};

type Props = {
  result: CalaAgentResult;
  markers?: Map<string, DiffMarker>;
  toolEvents?: EntityEventsIndex;
};

export function RunPortfolioTable({ result, markers, toolEvents }: Props) {
  const positions = result.output.positions;
  const showMarkers = !!markers && markers.size > 0;
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  // uuid → companyName lookup so entity pills can resolve a human label
  // for the primary (companyEntityId) and any supportingEntityIds that
  // point at other companies in the same portfolio.
  const companyByUuid = new Map<string, string>();
  for (const position of positions) {
    if (position.companyEntityId) {
      companyByUuid.set(position.companyEntityId.toLowerCase(), position.companyName);
    }
  }

  // Collapsed-row columns: #, (diff), ticker, company, notional, thesis,
  // expand-chevron. Total = 6 (+1 if diffs are shown). The expanded
  // detail panel spans all of them.
  const columnCount = showMarkers ? 7 : 6;

  return (
    <div className="max-h-[70vh] overflow-auto overscroll-contain">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[color:var(--border)] text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            <th className="px-4 py-3 text-left font-normal">#</th>
            {showMarkers ? (
              <th className="px-2 py-3 text-left font-normal" aria-label="Diff" />
            ) : null}
            <th className="px-3 py-3 text-left font-normal">Ticker</th>
            <th className="px-3 py-3 text-left font-normal">Company</th>
            <th className="px-3 py-3 text-right font-normal">Notional</th>
            <th className="px-3 py-3 text-left font-normal">Thesis</th>
            <th className="px-3 py-3 text-right font-normal" aria-label="Expand" />
          </tr>
        </thead>
        <tbody>
          {positions.map((position, idx) => {
            const marker = markers?.get(position.nasdaqCode) ?? null;
            const isExpanded = expandedTicker === position.nasdaqCode;
            return (
              <PositionRows
                key={`${position.companyEntityId}-${position.nasdaqCode}`}
                position={position}
                index={idx}
                marker={marker}
                showMarkers={showMarkers}
                isExpanded={isExpanded}
                onToggle={() =>
                  setExpandedTicker(current =>
                    current === position.nasdaqCode ? null : position.nasdaqCode,
                  )
                }
                columnCount={columnCount}
                toolEvents={toolEvents}
                companyByUuid={companyByUuid}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PositionRows({
  position,
  index,
  marker,
  showMarkers,
  isExpanded,
  onToggle,
  columnCount,
  toolEvents,
  companyByUuid,
}: {
  position: PortfolioPosition;
  index: number;
  marker: DiffMarker | null;
  showMarkers: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  columnCount: number;
  toolEvents?: EntityEventsIndex;
  companyByUuid: Map<string, string>;
}) {
  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggle}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className={
          "cursor-pointer border-b border-[color:var(--border)] transition hover:bg-[color:var(--surface-elevated)] " +
          (isExpanded ? "bg-[color:var(--surface-elevated)]" : "")
        }
      >
        <td className="px-4 py-3 text-[color:var(--muted-foreground)] tabular-nums">
          {(index + 1).toString().padStart(2, "0")}
        </td>
        {showMarkers ? (
          <td className="px-2 py-3 text-center text-[color:var(--foreground)]">
            {marker ? (
              <span
                className={
                  "inline-flex h-4 w-4 items-center justify-center border border-[color:var(--border)] " +
                  (marker === "new" || marker === "up" ? "font-semibold" : "")
                }
              >
                {DIFF_GLYPH[marker]}
              </span>
            ) : null}
          </td>
        ) : null}
        <td className="px-3 py-3 font-semibold text-[color:var(--foreground)]">
          {position.nasdaqCode}
        </td>
        <td className="max-w-[180px] truncate px-3 py-3 font-sans text-[color:var(--muted-foreground)]">
          {position.companyName}
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-[color:var(--foreground)]">
          {money.format(position.amount)}
        </td>
        <td className="max-w-[420px] truncate px-3 py-3 font-sans text-[color:var(--foreground)]">
          {position.thesis}
        </td>
        <td
          aria-hidden
          className="px-3 py-3 text-right font-mono text-[10px] text-[color:var(--muted-foreground)]"
        >
          {isExpanded ? "▾" : "▸"}
        </td>
      </tr>
      {isExpanded ? (
        <tr className="border-b border-[color:var(--border)] bg-[color:var(--background)]">
          <td colSpan={columnCount} className="p-0">
            <PositionDetail
              position={position}
              toolEvents={toolEvents}
              companyByUuid={companyByUuid}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PositionDetail({
  position,
  toolEvents,
  companyByUuid,
}: {
  position: PortfolioPosition;
  toolEvents?: EntityEventsIndex;
  companyByUuid: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-5 border-t border-[color:var(--border)] px-5 py-5">
      <div>
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          Thesis
        </p>
        <p className="mt-1 font-sans text-sm leading-6 text-[color:var(--foreground)]">
          {position.thesis}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr_1fr]">
        <ComplexityColumn position={position} />
        <EvidenceColumn
          position={position}
          toolEvents={toolEvents}
          companyByUuid={companyByUuid}
        />
        <RisksColumn position={position} />
      </div>
    </div>
  );
}

function ComplexityColumn({ position }: { position: PortfolioPosition }) {
  const metrics: Array<{ label: string; value: string; signal?: "up" | "down" | null }> = [
    { label: "Subsidiaries", value: String(position.subsidiaryCount) },
    { label: "Jurisdictions", value: String(position.jurisdictionCount) },
    { label: "Hierarchy depth", value: String(position.hierarchyDepth) },
    {
      label: "Complexity score",
      value: numberFormatter.format(position.complexityScore),
    },
    {
      label: "Δ vs prior",
      value:
        position.complexityChangeVsPrior == null
          ? "—"
          : formatSignedNumber(position.complexityChangeVsPrior),
      signal:
        position.complexityChangeVsPrior == null
          ? null
          : position.complexityChangeVsPrior < 0
            ? "down"
            : position.complexityChangeVsPrior > 0
              ? "up"
              : null,
    },
    { label: "Filing date", value: position.currentAnnualFilingDate },
    {
      label: "Prior filing",
      value: position.priorAnnualFilingDate ?? "—",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Complexity
      </p>
      <div className="grid grid-cols-2 border border-[color:var(--border)]">
        {metrics.map((metric, idx) => (
          <div
            key={metric.label}
            className={
              "bg-[color:var(--surface)] px-3 py-2 " +
              ((idx % 2 === 1) ? "border-l border-[color:var(--border)] " : "") +
              (idx >= 2 ? "border-t border-[color:var(--border)]" : "")
            }
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
              {metric.label}
            </p>
            <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-[color:var(--foreground)]">
              {metric.signal === "down" ? "↓ " : metric.signal === "up" ? "↑ " : ""}
              {metric.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceColumn({
  position,
  toolEvents,
  companyByUuid,
}: {
  position: PortfolioPosition;
  toolEvents?: EntityEventsIndex;
  companyByUuid: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Cala evidence
      </p>
      <ul className="flex flex-col gap-2">
        {position.calaEvidence.map((line, idx) => (
          <li
            key={idx}
            className="flex gap-2 font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]"
          >
            <span aria-hidden className="text-[color:var(--muted-foreground)]">
              ·
            </span>
            <span className="flex-1 break-words">
              <EvidenceLine
                text={line}
                toolEvents={toolEvents}
                companyByUuid={companyByUuid}
              />
            </span>
          </li>
        ))}
      </ul>
      {position.supportingEntityIds.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Supporting entities
          </p>
          <div className="flex flex-wrap gap-1.5">
            {position.supportingEntityIds.map(uuid => (
              <EntityPill
                key={uuid}
                uuid={uuid}
                label={companyByUuid.get(uuid.toLowerCase())}
                toolEvents={toolEvents}
              />
            ))}
          </div>
        </div>
      ) : null}
      {position.cutoffComplianceNote ? (
        <p className="border-t border-[color:var(--border)] pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          <span className="text-[color:var(--foreground)]">cutoff · </span>
          <span className="normal-case tracking-normal">
            {position.cutoffComplianceNote}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function EvidenceLine({
  text,
  toolEvents,
  companyByUuid,
}: {
  text: string;
  toolEvents?: EntityEventsIndex;
  companyByUuid: Map<string, string>;
}) {
  // Replace every UUID in the evidence string with an inline EntityPill.
  // Non-UUID text passes through verbatim so the agent's narrative
  // (e.g. "retrieve_entity(...) · subsidiary_count=12") stays readable.
  const matches = Array.from(text.matchAll(UUID_PATTERN));
  if (matches.length === 0) return <>{text}</>;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(
        <span key={`t-${lastIndex}`}>{text.slice(lastIndex, start)}</span>,
      );
    }
    const uuid = match[0];
    nodes.push(
      <EntityPill
        key={`p-${start}`}
        uuid={uuid}
        label={companyByUuid.get(uuid.toLowerCase())}
        toolEvents={toolEvents}
        size="xs"
      />,
    );
    lastIndex = start + uuid.length;
  }
  if (lastIndex < text.length) {
    nodes.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return <>{nodes}</>;
}

function RisksColumn({ position }: { position: PortfolioPosition }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Risks
      </p>
      <ul className="flex flex-col gap-2">
        {position.riskNotes.map((risk, idx) => (
          <li
            key={idx}
            className="flex gap-2 font-sans text-sm leading-6 text-[color:var(--foreground)]"
          >
            <span aria-hidden className="font-mono text-[color:var(--muted-foreground)]">
              ·
            </span>
            <span className="flex-1">{risk}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatSignedNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${numberFormatter.format(abs)}`;
}
