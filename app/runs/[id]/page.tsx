import { HybridRunDetail } from "@/components/hybrid-run-detail";
import {
  listRunSummaries,
  readRunRecord,
  type AgentRunRecord,
} from "@/lib/agent-runs";
import { PUBLIC_AUTORESEARCH_AGENT_NAME } from "@/lib/agent-version";
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

  let ledger: AutoresearchLedgerView | null = null;
  if (isAutoresearch && serverRun) {
    try {
      ledger = await loadAutoresearchLedgerForRun(id);
    } catch {
      ledger = null;
    }
  }

  // sessionId is stamped on the run record for every autoresearch iteration
  // spawned from the UI. Legacy iterations predate the field, so we fall
  // back to the autoresearch index page if it's missing.
  const sessionId = serverRun?.sessionId ?? null;

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
        isAutoresearch && ledger ? (
          <AutoresearchIterationPanel ledger={ledger} />
        ) : null
      }
    />
  );
}

function AutoresearchIterationPanel({
  ledger,
}: {
  ledger: AutoresearchLedgerView;
}) {
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
      ? "—"
      : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`;
  const scoreStr =
    ledger.score != null ? `$${ledger.score.toLocaleString()}` : "—";

  return (
    <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <header className="border-b border-[color:var(--border)] px-6 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
          Autoresearch iteration
        </p>
        <h2 className="mt-1 font-sans text-base font-semibold tracking-tight text-[color:var(--foreground)]">
          #{ledger.iteration}
          {ledger.publicAgentVersion ? ` · ${ledger.publicAgentVersion}` : ""}
        </h2>
      </header>

      <div className="grid grid-cols-4">
        <Cell label="Status" value={status} pulse={status === "kept"} />
        <Cell label="Score" value={scoreStr} border="l" />
        <Cell label="Δ vs champion" value={deltaStr} border="l" />
        <Cell
          label="Rules in effect"
          value={`${ledger.rulesInEffect}`}
          border="l"
        />
      </div>

      {ledger.proposedRule ? (
        <div className="border-t border-[color:var(--border)] px-6 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Proposed rule {status === "kept" ? "(kept)" : "(discarded)"}
          </p>
          <p className="mt-2 font-mono text-xs leading-relaxed text-[color:var(--foreground)]">
            {ledger.proposedRule}
          </p>
        </div>
      ) : (
        <div className="border-t border-[color:var(--border)] px-6 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Baseline iteration (no rule proposed)
          </p>
        </div>
      )}

      {ledger.skipReason ? (
        <div className="border-t border-[color:var(--border)] px-6 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Skip reason
          </p>
          <p className="mt-2 font-mono text-xs text-[color:var(--foreground)]">
            {ledger.skipReason}
          </p>
        </div>
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
