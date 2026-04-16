"use client";

import { useMemo, useState } from "react";
import type { CalaAgentResult } from "@/lib/cala-agent";
import type { EntityEventsIndex } from "@/lib/entity-events";
import type { DiffMarker } from "@/lib/run-diff";
import type { PortfolioPosition } from "@/lib/portfolio-schema";
import { CalaEntityDetail } from "./cala-entity-detail";
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

type RankedPosition = PortfolioPosition & { _rank: number };

export function RunPortfolioTable({ result, markers, toolEvents }: Props) {
  const positions = result.output.positions;
  const showMarkers = !!markers && markers.size > 0;
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  const rankedPositions: RankedPosition[] = useMemo(
    () =>
      [...positions]
        .sort((a, b) => a.complexityScore - b.complexityScore)
        .map((p, i) => ({ ...p, _rank: i + 1 })),
    [positions],
  );

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
  const columnCount = showMarkers ? 8 : 7;

  return (
    <div className="max-h-[70vh] overflow-auto overscroll-contain">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[color:var(--border)] text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            <th className="px-4 py-3 text-left font-normal">Rank</th>
            {showMarkers ? (
              <th className="px-2 py-3 text-left font-normal" aria-label="Diff" />
            ) : null}
            <th className="px-3 py-3 text-left font-normal">Ticker</th>
            <th className="px-3 py-3 text-left font-normal">Company</th>
            <th className="px-3 py-3 text-right font-normal">Notional</th>
            <th className="px-3 py-3 text-right font-normal">Score</th>
            <th className="px-3 py-3 text-left font-normal">Thesis</th>
            <th className="px-3 py-3 text-right font-normal" aria-label="Expand" />
          </tr>
        </thead>
        <tbody>
          {rankedPositions.map((position) => {
            const marker = markers?.get(position.nasdaqCode) ?? null;
            const isExpanded = expandedTicker === position.nasdaqCode;
            return (
              <PositionRows
                key={`${position.companyEntityId}-${position.nasdaqCode}`}
                position={position}
                index={position._rank - 1}
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
          {(position as RankedPosition)._rank?.toString().padStart(2, "0") ??
            (index + 1).toString().padStart(2, "0")}
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
        <td className="max-w-[180px] px-3 py-3 font-sans text-[color:var(--muted-foreground)]">
          <span className="block truncate">{position.companyName}</span>
          <FilingBadge date={position.currentAnnualFilingDate} />
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-[color:var(--foreground)]">
          {money.format(position.amount)}
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-[color:var(--muted-foreground)]">
          {numberFormatter.format(position.complexityScore)}
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
  const delta = position.complexityChangeVsPrior;
  return (
    <div className="flex flex-col gap-4 border-t border-[color:var(--border)] px-5 py-5">
      <p className="font-sans text-sm leading-6 text-[color:var(--foreground)]">
        {position.thesis}
      </p>

      <div className="flex flex-wrap items-center gap-4 text-[color:var(--foreground)]">
        <Stat label="Complexity" value={numberFormatter.format(position.complexityScore)} />
        {delta != null ? (
          <Stat
            label="Δ prior"
            value={`${delta < 0 ? "↓" : delta > 0 ? "↑" : ""}${formatSignedNumber(delta)}`}
          />
        ) : null}
        <Stat label="Filing" value={position.currentAnnualFilingDate} />
        <Stat label="Subs" value={String(position.subsidiaryCount)} />
        <Stat label="Jurisdictions" value={String(position.jurisdictionCount)} />
        <Stat label="Depth" value={String(position.hierarchyDepth)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_0.8fr]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/cala-logo.png" alt="Cala" className="h-4 w-auto" />
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                Cala-verified evidence
              </p>
            </div>
            <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)] opacity-60">
              live from Cala Entity Graph
            </span>
          </div>
          <div className="border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-4">
            <CalaEntityDetail
              uuid={position.companyEntityId}
              companyName={position.companyName}
            />
          </div>
          <p className="font-mono text-[10px] leading-5 text-[color:var(--muted-foreground)]">
            The agent selected{" "}
            <span className="text-[color:var(--foreground)]">{position.nasdaqCode}</span>{" "}
            based on the above Cala entity data — complexity score{" "}
            <span className="font-semibold text-[color:var(--foreground)]">
              {numberFormatter.format(position.complexityScore)}
            </span>
            {position.complexityChangeVsPrior != null ? (
              <>
                {" "}(Δ{" "}
                <span className="font-semibold text-[color:var(--foreground)]">
                  {formatSignedNumber(position.complexityChangeVsPrior)}
                </span>
                {" "}vs prior filing)
              </>
            ) : null}
            , filing dated{" "}
            <span className="text-[color:var(--foreground)]">
              {position.currentAnnualFilingDate}
            </span>
            .
          </p>
          {position.calaEvidence.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                Agent evidence notes
              </p>
              <ul className="flex flex-col gap-1">
                {position.calaEvidence.map((line, idx) => (
                  <li
                    key={idx}
                    className="flex gap-2 font-mono text-[11px] leading-relaxed text-[color:var(--muted-foreground)]"
                  >
                    <span aria-hidden>·</span>
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
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Risks
          </p>
          <ul className="flex flex-col gap-1.5">
            {position.riskNotes.map((risk, idx) => (
              <li
                key={idx}
                className="flex gap-2 font-sans text-sm leading-6 text-[color:var(--foreground)]"
              >
                <span aria-hidden className="font-mono text-[color:var(--muted-foreground)]">·</span>
                <span className="flex-1">{risk}</span>
              </li>
            ))}
          </ul>
          {position.cutoffComplianceNote ? (
            <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
              cutoff: {position.cutoffComplianceNote}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono text-[11px]">
      <span className="text-[color:var(--muted-foreground)]">{label} </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
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

function formatSignedNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${numberFormatter.format(abs)}`;
}

const CUTOFF = new Date("2025-04-15");
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

function FilingBadge({ date }: { date: string | null | undefined }) {
  const color = (() => {
    if (!date) return "oklch(0.50 0 0)";
    const months = (CUTOFF.getTime() - new Date(date).getTime()) / MS_PER_MONTH;
    if (months <= 12) return "oklch(0.75 0.18 145)";
    if (months <= 18) return "oklch(0.80 0.18 85)";
    return "oklch(0.70 0.20 25)";
  })();

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
      <span
        className="inline-block h-1.5 w-1.5 shrink-0"
        style={{ background: color }}
        aria-hidden
      />
      {date ?? "no filing"}
    </span>
  );
}
