import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { AutoresearchTrigger } from "@/components/autoresearch-trigger";
import {
  loadAutoresearchState,
  type AutoresearchState,
  type LedgerEntryView,
} from "@/lib/autoresearch-view";

export const dynamic = "force-dynamic";

export default async function AutoresearchPage() {
  const state = await loadAutoresearchState();

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-10 px-6 py-10">
      <AutoRefresh enabled intervalMs={3000} />

      <header className="border-b border-[color:var(--border)] pb-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Link
              href="/"
              className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
            >
              ← mrkrabs
            </Link>
            <h1 className="mt-3 font-sans text-4xl font-semibold tracking-tight text-[color:var(--foreground)] sm:text-5xl">
              Autoresearch
            </h1>
            <p className="mt-4 max-w-[64ch] text-sm leading-relaxed text-[color:var(--muted-foreground)]">
              An outer loop mutates the champion system prompt, runs the agent,
              submits to the leaderboard, and only keeps variants whose score
              beats the incumbent. Reads Convex live — reload-free via polling.
            </p>
          </div>
          <ChampionBadge state={state} />
        </div>
      </header>

      <AutoresearchTrigger />

      {!state.isLive ? (
        <EmptyState />
      ) : (
        <>
          <BudgetGauge
            spent={state.spentUsd}
            cap={state.budgetCapUsd}
          />

          <section>
            <SectionHeader
              eyebrow="Experiments"
              title="Iteration timeline"
              meta={`${state.ledger.length} rows`}
            />
            <IterationTimeline entries={state.ledger} />
          </section>

          <section>
            <SectionHeader
              eyebrow="Current prompt"
              title="Champion system prompt"
              meta={
                state.championPrompt
                  ? `${state.championPrompt.length.toLocaleString()} chars`
                  : "not written yet"
              }
            />
            <ChampionPromptPanel prompt={state.championPrompt} />
          </section>
        </>
      )}
    </main>
  );
}

function ChampionBadge({ state }: { state: AutoresearchState }) {
  const { championScore, ledger } = state;
  const hasScore = championScore.score > 0;
  const iterationCount = ledger.length;

  return (
    <div className="flex min-w-[240px] flex-col gap-1 border border-[color:var(--border)] px-4 py-3 text-right">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Champion
      </p>
      <p className="font-mono text-2xl tabular-nums text-[color:var(--foreground)]">
        {hasScore
          ? `$${championScore.score.toLocaleString()}`
          : "—"}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        {championScore.publicAgentVersion ?? "bootstrap"}
        {iterationCount > 0
          ? ` · ${iterationCount} iter${iterationCount === 1 ? "" : "s"}`
          : ""}
      </p>
    </div>
  );
}

function BudgetGauge({ spent, cap }: { spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const remaining = Math.max(0, cap - spent);

  return (
    <section className="flex flex-col gap-3 border border-[color:var(--border)] px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          Anthropic spend
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          ${remaining.toFixed(2)} remaining
        </p>
      </div>
      <div className="flex items-center gap-4">
        <p className="font-mono text-xl tabular-nums text-[color:var(--foreground)]">
          ${spent.toFixed(2)}
          <span className="ml-1 text-[color:var(--muted-foreground)]">
            / ${cap.toFixed(2)}
          </span>
        </p>
        <div className="flex-1">
          <div className="relative h-1.5 w-full border border-[color:var(--border)]">
            <div
              className="absolute inset-y-0 left-0 bg-[color:var(--foreground)]"
              style={{ width: `${pct}%` }}
              aria-hidden
            />
          </div>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          {pct.toFixed(0)}%
        </p>
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--muted-foreground)]">
          {eyebrow}
        </p>
        <h2 className="mt-2 font-sans text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
          {title}
        </h2>
      </div>
      {meta ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          {meta}
        </p>
      ) : null}
    </div>
  );
}

function IterationTimeline({ entries }: { entries: LedgerEntryView[] }) {
  if (entries.length === 0) {
    return (
      <div className="border border-dashed border-[color:var(--border)] px-6 py-10 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          No iterations yet
        </p>
        <p className="mt-3 font-mono text-[11px] text-[color:var(--foreground)]">
          Run{" "}
          <span className="font-semibold">pnpm autoresearch</span> to start the
          outer loop.
        </p>
      </div>
    );
  }

  // Most recent first.
  const ordered = [...entries].reverse();

  return (
    <ol className="flex max-h-[60vh] flex-col overflow-y-auto overscroll-contain border border-[color:var(--border)]">
      {ordered.map((entry, idx) => (
        <IterationRow
          key={`${entry.iteration}-${entry.runId}`}
          entry={entry}
          isLast={idx === ordered.length - 1}
        />
      ))}
    </ol>
  );
}

function IterationRow({
  entry,
  isLast,
}: {
  entry: LedgerEntryView;
  isLast: boolean;
}) {
  const scoreStr =
    entry.score != null
      ? `$${entry.score.toLocaleString()}`
      : "—";

  const delta =
    entry.score != null && entry.championScoreAtStart > 0
      ? ((entry.score - entry.championScoreAtStart) /
          entry.championScoreAtStart) *
        100
      : null;
  const deltaStr =
    delta == null
      ? "—"
      : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`;

  const status: "kept" | "discard" | "skip" = entry.skipReason
    ? "skip"
    : entry.kept
      ? "kept"
      : "discard";

  return (
    <li
      className={
        "flex flex-col gap-2 px-5 py-4 " +
        (isLast ? "" : "border-b border-[color:var(--border)]")
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            #{entry.iteration}
          </span>
          <span className="font-mono text-base tabular-nums text-[color:var(--foreground)]">
            {scoreStr}
          </span>
          <span
            className={
              "font-mono text-[11px] tabular-nums " +
              (delta != null && delta >= 0
                ? "text-[color:var(--foreground)]"
                : "text-[color:var(--muted-foreground)]")
            }
          >
            Δ {deltaStr}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            ${entry.estimatedCostUsd.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
          {entry.publicAgentVersion ?? "—"} ·{" "}
          {new Date(entry.ranAt).toLocaleString()}
        </p>
        <Link
          href={`/runs/${entry.runId}`}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
        >
          view run →
        </Link>
      </div>

      {entry.mutationSummary ? (
        <p className="font-mono text-[11px] text-[color:var(--foreground)]">
          {entry.mutationSummary}
        </p>
      ) : null}

      {entry.skipReason ? (
        <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
          skip: {entry.skipReason}
        </p>
      ) : null}
    </li>
  );
}

function StatusBadge({
  status,
}: {
  status: "kept" | "discard" | "skip";
}) {
  const label =
    status === "kept" ? "kept" : status === "skip" ? "skip" : "discard";

  const inverted = status === "kept";

  return (
    <span
      className={
        "inline-flex items-center border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] " +
        (inverted
          ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]"
          : "border-[color:var(--border)] text-[color:var(--muted-foreground)]")
      }
    >
      {label}
    </span>
  );
}

function ChampionPromptPanel({ prompt }: { prompt: string | null }) {
  if (!prompt) {
    return (
      <div className="border border-dashed border-[color:var(--border)] px-6 py-10 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          No champion prompt written
        </p>
        <p className="mt-3 font-mono text-[11px] text-[color:var(--foreground)]">
          The first iteration bootstraps this file from the agent&rsquo;s base
          system prompt.
        </p>
      </div>
    );
  }

  return (
    <details className="group border border-[color:var(--border)]">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]">
        <span>Expand prompt</span>
        <span aria-hidden className="text-[color:var(--muted-foreground)] group-open:hidden">
          +
        </span>
        <span aria-hidden className="hidden text-[color:var(--muted-foreground)] group-open:inline">
          −
        </span>
      </summary>
      <pre className="max-h-[60vh] overflow-auto border-t border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-4 font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
        {prompt}
      </pre>
    </details>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-[color:var(--border)] px-6 py-16 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Autoresearch idle
      </p>
      <p className="mt-4 font-sans text-sm text-[color:var(--foreground)]">
        No iterations recorded yet.
      </p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        pnpm autoresearch
      </p>
    </div>
  );
}
