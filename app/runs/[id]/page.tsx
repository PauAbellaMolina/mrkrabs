import { HybridRunDetail } from "@/components/hybrid-run-detail";
import {
  listRunSummaries,
  readRunRecord,
  type AgentRunRecord,
} from "@/lib/agent-runs";
import { PUBLIC_AUTORESEARCH_AGENT_NAME } from "@/lib/agent-version";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import {
  loadAutoresearchLedgerForRun,
  type AutoresearchLedgerView,
} from "@/lib/autoresearch-run-view";
import type { RunStage } from "@/lib/run-stage";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let serverRun: AgentRunRecord | null = null;
  let serverBaseline: AgentRunRecord | null = null;

  try {
    serverRun = await readRunRecord(id);
  } catch {
    serverRun = null;
  }

  if (serverRun?.result) {
    const summaries = await listRunSummaries();
    const candidate = summaries.find(
      summary => summary.id !== serverRun!.id && summary.status === "completed",
    );
    if (candidate) {
      try {
        serverBaseline = await readRunRecord(candidate.id);
      } catch {
        serverBaseline = null;
      }
    }
  }

  const isAutoresearch =
    serverRun?.agentName === PUBLIC_AUTORESEARCH_AGENT_NAME;
  const sessionId = serverRun?.sessionId ?? null;

  let ledger: AutoresearchLedgerView | null = null;
  let previousLedgerEntries: AutoresearchLedgerView[] = [];
  if (isAutoresearch && serverRun) {
    try {
      ledger = await loadAutoresearchLedgerForRun(id);
    } catch {
      ledger = null;
    }
    if (sessionId) {
      try {
        const rows = await getConvexClient().query(
          api.autoresearch.getLedgerBySession,
          { sessionId },
        );
        previousLedgerEntries = (rows as AutoresearchLedgerView[])
          .filter(r => r.runId !== id)
          .sort((a, b) => b.iteration - a.iteration);
      } catch {
        // best-effort
      }
    }
  }

  const backHref = isAutoresearch
    ? sessionId
      ? `/autoresearch/runs/${sessionId}`
      : "/autoresearch"
    : "/";
  const backLabel = isAutoresearch
    ? sessionId
      ? "← Back to session"
      : "← Back to autoresearch"
    : "← Back to runs";

  // The ledger is the source of truth for autoresearch iterations. If it
  // has a verdict (kept, discarded, skipped), override the stage derived
  // from run.status — because completeRunRecord can silently fail and
  // leave run.status="running" even though the iteration has settled.
  let stageOverride: RunStage | undefined;
  if (isAutoresearch && ledger) {
    if (ledger.skipReason) {
      stageOverride = "failed";
    } else {
      stageOverride = "submitted";
    }
  }

  return (
    <HybridRunDetail
      runId={id}
      serverRun={serverRun}
      serverBaseline={serverBaseline}
      backHref={backHref}
      backLabel={backLabel}
      stageOverride={stageOverride}
      isAutoresearch={isAutoresearch}
      contextPanel={
        isAutoresearch ? (
          <AutoresearchIterationPanel
            ledger={ledger}
            previousEntries={previousLedgerEntries}
          />
        ) : null
      }
    />
  );
}

function AutoresearchIterationPanel({
  ledger,
  previousEntries,
}: {
  ledger: AutoresearchLedgerView | null;
  previousEntries: AutoresearchLedgerView[];
}) {
  // Previous iterations with proposed rules — most recent first.
  const prevRules = previousEntries.filter(e => e.proposedRule);

  if (!ledger) {
    return (
      <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="flex items-center gap-4 px-6 py-5">
          <span className="inline-block h-3 w-3 animate-pulse bg-[color:var(--foreground)]" />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
              Autoresearch iteration · running
            </p>
            <p className="mt-1 font-sans text-sm text-[color:var(--foreground)]">
              Waiting for this iteration to settle…
            </p>
          </div>
        </div>
        {prevRules.length > 0 ? (
          <PreviousIterationsContext entries={prevRules} defaultOpen />
        ) : null}
      </section>
    );
  }

  const status: "kept" | "discard" | "skip" = ledger.skipReason
    ? "skip"
    : ledger.kept
      ? "kept"
      : "discard";

  const delta =
    ledger.score != null && ledger.championScoreAtStart > 0
      ? ((ledger.score - ledger.championScoreAtStart) /
          ledger.championScoreAtStart) *
        100
      : null;
  const deltaStr =
    delta == null
      ? ""
      : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`;

  const verdictLabel =
    status === "kept"
      ? "New champion"
      : status === "skip"
        ? "Skipped"
        : "Discarded";

  return (
    <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
            Iteration #{ledger.iteration}
            {ledger.publicAgentVersion
              ? ` · ${ledger.publicAgentVersion}`
              : ""}
            {ledger.rulesInEffect > 0
              ? ` · ${ledger.rulesInEffect} rules`
              : ""}
          </p>
          {ledger.score != null ? (
            <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-[color:var(--foreground)]">
              ${ledger.score.toLocaleString()}
              {deltaStr ? (
                <span className="ml-3 text-base font-normal text-[color:var(--muted-foreground)]">
                  {deltaStr}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-2 font-mono text-xl text-[color:var(--muted-foreground)]">
              No score
            </p>
          )}
        </div>
        <span
          className={
            "border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] " +
            (status === "kept"
              ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]"
              : "border-[color:var(--border)] text-[color:var(--muted-foreground)]")
          }
        >
          {verdictLabel}
        </span>
      </div>

      {ledger.proposedRule ? (
        <div className="border-t border-[color:var(--border)] px-6 py-4">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Mutation tested
          </p>
          <p className="font-sans text-sm leading-6 text-[color:var(--foreground)]">
            {ledger.proposedRule}
          </p>
        </div>
      ) : (
        <div className="border-t border-[color:var(--border)] px-6 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Baseline — no mutation
          </p>
        </div>
      )}

      {ledger.skipReason ? (
        <div className="border-t border-[color:var(--border)] bg-[color:var(--background)] px-6 py-3">
          <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
            <span className="uppercase tracking-[0.18em]">Skip: </span>
            {ledger.skipReason}
          </p>
        </div>
      ) : null}

      {prevRules.length > 0 ? (
        <PreviousIterationsContext entries={prevRules} />
      ) : null}

      {ledger.systemPromptUsed ? (
        <ExpandableSection label="System prompt used">
          <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap border border-[color:var(--border)] bg-[color:var(--background)] p-4 font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
            {ledger.systemPromptUsed}
          </pre>
        </ExpandableSection>
      ) : null}
    </section>
  );
}

function PreviousIterationsContext({
  entries,
  defaultOpen = false,
}: {
  entries: AutoresearchLedgerView[];
  defaultOpen?: boolean;
}) {
  const shown = entries.slice(0, 5);
  return (
    <details
      className="group border-t border-[color:var(--border)]"
      open={defaultOpen || undefined}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)] transition select-none hover:text-[color:var(--foreground)]">
        <span className="transition group-open:rotate-90">▶</span>
        Prior mutations ({entries.length})
      </summary>
      <div className="flex flex-col gap-1.5 px-6 pb-4">
        {shown.map(entry => {
          const verdict = entry.skipReason
            ? "skip"
            : entry.kept
              ? "kept"
              : "discard";
          const scoreLabel =
            entry.score != null ? `$${entry.score.toLocaleString()}` : "—";
          return (
            <div
              key={entry.runId}
              className="flex items-baseline gap-3 font-mono text-[11px]"
            >
              <span className="shrink-0 text-[color:var(--muted-foreground)]">
                #{entry.iteration}
              </span>
              <span className="shrink-0 tabular-nums text-[color:var(--foreground)]">
                {scoreLabel}
              </span>
              <span className="shrink-0 text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                {verdict}
              </span>
              <span className="min-w-0 truncate text-[color:var(--foreground)]">
                {entry.proposedRule}
              </span>
            </div>
          );
        })}
        {entries.length > 5 ? (
          <p className="font-mono text-[9px] text-[color:var(--muted-foreground)]">
            + {entries.length - 5} more
          </p>
        ) : null}
      </div>
    </details>
  );
}

function Cell({
  label,
  value,
  pulse = false,
  border = "",
}: {
  label: string;
  value: string;
  pulse?: boolean;
  border?: "" | "l" | "t" | "tl";
}) {
  const borderClass =
    border === "l"
      ? "border-l border-[color:var(--border)]"
      : border === "t"
        ? "border-t border-[color:var(--border)]"
        : border === "tl"
          ? "border-l border-t border-[color:var(--border)]"
          : "";
  return (
    <div
      className={
        "flex flex-col gap-1 bg-[color:var(--background)] px-5 py-4 " +
        borderClass
      }
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p
        className={
          "font-mono text-sm font-semibold text-[color:var(--foreground)] tabular-nums " +
          (pulse ? "animate-pulse" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function ExpandableSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-t border-[color:var(--border)]">
      <summary className="flex cursor-pointer items-center gap-2 px-6 py-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)] transition select-none hover:text-[color:var(--foreground)]">
        <span className="transition group-open:rotate-90">▶</span>
        {label}
      </summary>
      <div className="px-6 pb-5">{children}</div>
    </details>
  );
}
