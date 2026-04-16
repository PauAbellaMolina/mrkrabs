"use client";

import Image from "next/image";
import type { PortfolioPosition } from "@/lib/portfolio-schema";

const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

type Props = {
  positions: PortfolioPosition[];
};

export function CalaOntologyPanel({ positions }: Props) {
  const uniqueEntities = new Set(positions.map(p => p.companyEntityId));
  const filingDates = positions
    .map(p => p.currentAnnualFilingDate)
    .filter(Boolean);
  const earliestFiling = filingDates.length > 0
    ? filingDates.sort()[0]
    : null;
  const latestFiling = filingDates.length > 0
    ? filingDates.sort().reverse()[0]
    : null;
  const totalSubsidiaries = positions.reduce((s, p) => s + p.subsidiaryCount, 0);
  const avgComplexity =
    positions.reduce((s, p) => s + p.complexityScore, 0) / (positions.length || 1);
  const improving = positions.filter(
    p => p.complexityChangeVsPrior != null && p.complexityChangeVsPrior < 0,
  ).length;

  const allEvidence = positions.flatMap(p => p.calaEvidence);
  const calaToolMentions = allEvidence.filter(
    e =>
      e.includes("entity_search") ||
      e.includes("retrieve_entity") ||
      e.includes("entity_introspection") ||
      e.includes("Cala"),
  ).length;

  const ranked = [...positions].sort(
    (a, b) => a.complexityScore - b.complexityScore,
  );

  return (
    <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--border)] px-5 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
            Ontology
          </p>
          <h2 className="mt-1 font-sans text-base font-semibold tracking-tight text-[color:var(--foreground)]">
            Investment reasoning powered by Cala
          </h2>
        </div>
        <Image
          src="/cala-logo.png"
          alt="Cala"
          width={72}
          height={24}
          className="opacity-80"
          unoptimized
        />
      </header>

      <div className="flex flex-col gap-5 px-5 py-5">
        <p className="max-w-3xl font-sans text-sm leading-7 text-[color:var(--foreground)]">
          Every investment decision in this portfolio is grounded in{" "}
          <strong>Cala&apos;s verified entity graph</strong>. The agent queried
          Cala&apos;s knowledge base to resolve company identities, map
          parent/subsidiary ownership structures, extract filing-linked
          complexity metrics, and verify pre-cutoff evidence — then used those
          facts as the sole basis for position selection and allocation.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <OntologyStat label="Entities verified" value={String(uniqueEntities.size)} />
          <OntologyStat label="Cala evidence points" value={String(calaToolMentions)} />
          <OntologyStat label="Subsidiaries mapped" value={String(totalSubsidiaries)} />
          <OntologyStat label="Avg complexity" value={avgComplexity.toFixed(2)} />
          <OntologyStat
            label="Improving (Δ < 0)"
            value={`${improving} / ${positions.length}`}
          />
          <OntologyStat
            label="Filing window"
            value={
              earliestFiling && latestFiling
                ? earliestFiling === latestFiling
                  ? earliestFiling
                  : `${earliestFiling} — ${latestFiling}`
                : "—"
            }
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            {positions.length} companies analyzed via Cala — ranked by complexity
          </p>
          <div className="flex gap-3 overflow-x-auto overscroll-x-contain pb-2 [-ms-overflow-style:none] [scrollbar-width:thin]">
            {ranked.map((p, idx) => (
              <CompanyCard key={p.companyEntityId} position={p} rank={idx + 1} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            How Cala data drives each decision
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <ReasoningStep
              step="1"
              title="Entity resolution"
              description="Each company is resolved to a verified Cala entity with a stable UUID, ensuring the agent operates on the correct legal entity — not a similarly-named subsidiary or alias."
            />
            <ReasoningStep
              step="2"
              title="Structure analysis"
              description="Cala's filing-linked entity graph reveals each company's subsidiary count, jurisdiction spread, and control hierarchy depth — the raw inputs to the complexity scoring model."
            />
            <ReasoningStep
              step="3"
              title="Evidence-backed selection"
              description="Only companies with pre-cutoff Cala evidence qualify for inclusion. The agent's thesis, risk notes, and cutoff compliance are all traceable to specific Cala tool calls."
            />
          </div>
        </div>

        <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)] opacity-60">
          All entity data, relationships, and structure metrics sourced from
          Cala&apos;s verified knowledge graph · click any position in the
          portfolio table to see live Cala data for that company
        </p>
      </div>
    </section>
  );
}

function CompanyCard({ position, rank }: { position: PortfolioPosition; rank: number }) {
  const delta = position.complexityChangeVsPrior;
  return (
    <div className="flex w-[220px] shrink-0 flex-col gap-2 border border-[color:var(--border)] bg-[color:var(--background)] p-3 transition hover:border-[color:var(--foreground)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-[color:var(--foreground)]">
          {position.nasdaqCode}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-[color:var(--muted-foreground)]">
          #{String(rank).padStart(2, "0")}
        </span>
      </div>
      <p className="truncate font-sans text-[11px] text-[color:var(--muted-foreground)]">
        {position.companyName}
      </p>
      <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[color:var(--border)] pt-2">
        <CardStat label="Complexity" value={num.format(position.complexityScore)} />
        <CardStat
          label="Δ prior"
          value={
            delta != null
              ? `${delta < 0 ? "↓" : delta > 0 ? "↑" : ""}${num.format(Math.abs(delta))}`
              : "—"
          }
        />
        <CardStat label="Subs" value={String(position.subsidiaryCount)} />
        <CardStat label="Filing" value={position.currentAnnualFilingDate} />
      </div>
    </div>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p className="font-mono text-[10px] font-semibold tabular-nums text-[color:var(--foreground)]">
        {value}
      </p>
    </div>
  );
}

function OntologyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-[color:var(--foreground)]">
        {value}
      </p>
    </div>
  );
}

function ReasoningStep({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 border border-[color:var(--border)] bg-[color:var(--background)] p-4">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[color:var(--border)] font-mono text-xs font-semibold text-[color:var(--foreground)]">
        {step}
      </span>
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground)]">
          {title}
        </p>
        <p className="mt-1 font-sans text-xs leading-5 text-[color:var(--muted-foreground)]">
          {description}
        </p>
      </div>
    </div>
  );
}
