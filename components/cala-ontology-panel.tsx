"use client";

import Image from "next/image";
import { useState } from "react";
import type { PortfolioPosition } from "@/lib/portfolio-schema";
import { CalaEntityDetail } from "./cala-entity-detail";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type Props = {
  positions: PortfolioPosition[];
};

const INITIAL_VISIBLE = 6;

export function CalaOntologyPanel({ positions }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const ranked = [...positions].sort(
    (a, b) => a.complexityScore - b.complexityScore,
  );

  const visible = showAll ? ranked : ranked.slice(0, INITIAL_VISIBLE);
  const hiddenCount = ranked.length - INITIAL_VISIBLE;
  const cols = 3;

  // Build rows of `cols` items, inserting an expanded detail row after the
  // row that contains the expanded card.
  const rows: Array<{ cards: typeof visible; expandedPosition?: PortfolioPosition }> = [];
  for (let i = 0; i < visible.length; i += cols) {
    const chunk = visible.slice(i, i + cols);
    const expandedInRow = expandedId
      ? chunk.find(p => p.companyEntityId === expandedId)
      : undefined;
    rows.push({ cards: chunk, expandedPosition: expandedInRow });
  }

  return (
    <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--border)] px-6 py-5">
        <div className="w-full">
          <div className="flex items-center gap-3">
            <Image
              src="/cala-logo.png"
              alt="Cala"
              width={72}
              height={24}
              className="opacity-80"
              unoptimized
            />
            <h2 className="font-sans text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
              Why these {positions.length} companies?
            </h2>
          </div>
          <p className="mt-3 font-sans text-sm leading-6 text-[color:var(--muted-foreground)]">
            Each company was selected because Cala&apos;s entity graph shows it has a{" "}
            <strong className="text-[color:var(--foreground)]">simple corporate structure</strong>.
            Below are the top picks ranked by simplicity, with the evidence Cala provided.
          </p>
          <MetricsExplainer />
        </div>
      </div>

      <div className="flex flex-col">
        {rows.map((row, rowIdx) => (
          <div key={rowIdx}>
            <div className={
              "grid gap-px bg-[color:var(--border)] sm:grid-cols-2 lg:grid-cols-3" +
              (rowIdx > 0 ? " border-t border-[color:var(--border)]" : "")
            }>
              {row.cards.map((p, idx) => (
                <CompanyCard
                  key={p.companyEntityId}
                  position={p}
                  rank={rowIdx * cols + idx + 1}
                  isExpanded={expandedId === p.companyEntityId}
                  dimmed={expandedId != null && expandedId !== p.companyEntityId}
                  onToggle={() =>
                    setExpandedId(current =>
                      current === p.companyEntityId ? null : p.companyEntityId,
                    )
                  }
                />
              ))}
            </div>
            {row.expandedPosition ? (
              <div className="animate-[fadeSlideIn_0.3s_ease-out] border-t border-b border-[color:var(--border)] bg-[color:var(--background)]">
                <CompanyExpandedDetail
                  position={row.expandedPosition}
                  onClose={() => setExpandedId(null)}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {!showAll && hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)] transition hover:bg-[color:var(--surface-elevated)] hover:text-[color:var(--foreground)]"
        >
          Show all {ranked.length} companies (+{hiddenCount} more)
        </button>
      ) : showAll && hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="w-full border-t border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)] transition hover:bg-[color:var(--surface-elevated)] hover:text-[color:var(--foreground)]"
        >
          Show fewer
        </button>
      ) : null}
    </section>
  );
}

function MetricsExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--foreground)] transition hover:opacity-80"
      >
        <span className="flex h-4 w-4 items-center justify-center border border-[color:var(--border)] text-[9px]">
          ?
        </span>
        {open ? "Hide explanation" : "What do subsidiaries, jurisdictions, and depth mean?"}
      </button>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3 animate-[fadeSlideIn_0.3s_ease-out]">
          <MetricCard
            title="Subsidiaries"
            what="The number of child companies or legal entities a company owns."
            why="Fewer subsidiaries = simpler operations. Companies with sprawling subsidiary networks carry hidden risks in entities that are hard to audit."
            effect="Lower count → higher ranking in our portfolio."
          />
          <MetricCard
            title="Jurisdictions"
            what="The number of different countries or legal territories where the company has registered entities."
            why="Fewer jurisdictions = less regulatory complexity. Multi-jurisdiction companies face overlapping rules, tax regimes, and reporting requirements."
            effect="Lower count → higher ranking in our portfolio."
          />
          <MetricCard
            title="Hierarchy depth"
            what="How many layers deep the ownership chain goes — from the parent company to the furthest subsidiary."
            why="Shallower chains = more transparent control. Deep ownership hierarchies make it harder to trace who controls what, increasing governance risk."
            effect="Lower depth → higher ranking in our portfolio."
          />
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  title,
  what,
  why,
  effect,
}: {
  title: string;
  what: string;
  why: string;
  effect: string;
}) {
  return (
    <div className="flex flex-col gap-2 border border-[color:var(--border)] bg-[color:var(--background)] p-4">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground)]">
        {title}
      </p>
      <p className="font-sans text-xs leading-5 text-[color:var(--muted-foreground)]">
        {what}
      </p>
      <p className="font-sans text-xs leading-5 text-[color:var(--foreground)]">
        {why}
      </p>
      <p className="mt-auto border-t border-[color:var(--border)] pt-2 font-mono text-[10px] text-[color:var(--foreground)]">
        {effect}
      </p>
    </div>
  );
}

function CompanyCard({
  position,
  rank,
  isExpanded,
  dimmed,
  onToggle,
}: {
  position: PortfolioPosition;
  rank: number;
  isExpanded: boolean;
  dimmed: boolean;
  onToggle: () => void;
}) {
  const delta = position.complexityChangeVsPrior;
  const isImproving = delta != null && delta < 0;

  const structureSummary = [
    `${position.subsidiaryCount} ${position.subsidiaryCount === 1 ? "subsidiary" : "subsidiaries"}`,
    `${position.jurisdictionCount} ${position.jurisdictionCount === 1 ? "jurisdiction" : "jurisdictions"}`,
    `depth ${position.hierarchyDepth}`,
  ].join(", ");

  return (
    <div
      className={
        "flex flex-col bg-[color:var(--surface)] transition-colors duration-300 " +
        (dimmed ? "[&_*]:!text-[color:var(--border)] pointer-events-none" : "")
      }
    >
      <button
        type="button"
        onClick={onToggle}
        className={
          "flex flex-col gap-3 p-5 text-left transition hover:bg-[color:var(--surface-elevated)] " +
          (isExpanded ? "bg-[color:var(--surface-elevated)]" : "")
        }
      >
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-semibold text-[color:var(--foreground)]">
                {position.nasdaqCode}
              </span>
              <span className="font-mono text-[9px] tabular-nums text-[color:var(--muted-foreground)]">
                #{String(rank).padStart(2, "0")}
              </span>
              <span className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
                {isExpanded ? "▾" : "▸"}
              </span>
            </div>
            <p className="mt-0.5 font-sans text-xs text-[color:var(--muted-foreground)]">
              {position.companyName}
            </p>
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-[color:var(--foreground)]">
            {money.format(position.amount)}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            Investment decision
          </p>
          <p className="font-sans text-xs leading-5 text-[color:var(--foreground)]">
            {position.thesis}
          </p>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-[color:var(--border)] pt-3">
          <div className="flex items-center gap-1.5">
            <Image
              src="/cala-logo.png"
              alt="Cala"
              width={40}
              height={14}
              className="opacity-60"
              unoptimized
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
              found
            </span>
          </div>
          <p className="font-sans text-xs text-[color:var(--foreground)]">
            {structureSummary}
            {isImproving
              ? " — structure is simplifying vs prior filing"
              : ""}
          </p>
          <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
            Filing: {position.currentAnnualFilingDate}
            {position.priorAnnualFilingDate
              ? ` · Prior: ${position.priorAnnualFilingDate}`
              : ""}
          </p>
        </div>
      </button>
    </div>
  );
}

function CompanyExpandedDetail({
  position,
  onClose,
}: {
  position: PortfolioPosition;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-base font-semibold text-[color:var(--foreground)]">
            {position.nasdaqCode}
          </span>
          <span className="font-sans text-sm text-[color:var(--muted-foreground)]">
            {position.companyName}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
        >
          Close
        </button>
      </div>
      <div className="border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-4">
        <CalaEntityDetail
          uuid={position.companyEntityId}
          companyName={position.companyName}
        />
      </div>

      {position.riskNotes.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Risks
          </p>
          <ul className="flex flex-col gap-1">
            {position.riskNotes.map((risk, idx) => (
              <li key={idx} className="flex gap-2 font-sans text-xs leading-5 text-[color:var(--muted-foreground)]">
                <span aria-hidden className="font-mono">·</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {position.calaEvidence.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Agent evidence notes
          </p>
          <ul className="flex flex-col gap-1">
            {position.calaEvidence.map((line, idx) => (
              <li key={idx} className="flex gap-2 font-mono text-[10px] leading-5 text-[color:var(--muted-foreground)]">
                <span aria-hidden>·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
