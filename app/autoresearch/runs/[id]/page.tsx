import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { AutoresearchSessionStopButton } from "@/components/autoresearch-session-stop-button";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex-client";
import { getAutoresearchSession } from "@/lib/autoresearch-session";

export const dynamic = "force-dynamic";

type IterationSummary = {
  runId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  model?: string;
  stepCount: number;
  toolCallCount: number;
  positionCount: number;
  leaderboardStatus?: "submitted" | "failed";
  errorMessage?: string;
  // Ledger enrichment (may be missing if the iteration hasn't settled yet).
  iteration?: number;
  publicAgentVersion?: string | null;
  score?: number | null;
  kept?: boolean;
  skipReason?: string;
  estimatedCostUsd?: number;
  proposedRule?: string;
};

export default async function AutoresearchSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = await params;

  const session = await getAutoresearchSession(sessionId);

  if (!session) {
    return (
      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-8 px-6 py-10">
        <Link
          href="/autoresearch"
          className="self-start border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)]"
        >
          ← Back to autoresearch
        </Link>
        <section className="border border-dashed border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-16 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Session not found
          </p>
          <p className="mt-4 font-sans text-sm text-[color:var(--foreground)]">
            Nothing in Convex for session <code>{sessionId}</code>.
          </p>
        </section>
      </main>
    );
  }

  const client = getConvexClient();
  const [ledgerRows, allSummaries] = await Promise.all([
    client.query(api.autoresearch.getLedgerBySession, { sessionId }),
    client.query(api.runs.listSummaries, {}),
  ]);

  type LedgerRow = {
    iteration: number;
    ranAt: string;
    runId: string;
    publicAgentVersion: string | null;
    score: number | null;
    kept: boolean;
    skipReason?: string;
    estimatedCostUsd: number;
    proposedRule?: string;
  };
  const ledgerByRunId = new Map<string, LedgerRow>();
  for (const row of ledgerRows as LedgerRow[]) {
    ledgerByRunId.set(row.runId, row);
  }

  type RunSummary = {
    id: string;
    status: "running" | "completed" | "failed";
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    model?: string;
    stepCount: number;
    toolCallCount: number;
    positionCount: number;
    leaderboardStatus?: "submitted" | "failed";
    errorMessage?: string;
    agentName: string;
    sessionId?: string;
  };
  // Strict sessionId match. Every iteration spawned by the UI trigger gets
  // its sessionId stamped on the run record, so we don't need the startedAt
  // heuristic any more.
  const sessionIterations: IterationSummary[] = (allSummaries as RunSummary[])
    .filter(r => r.sessionId === sessionId)
    .map(r => {
      const ledger = ledgerByRunId.get(r.id);
      return {
        runId: r.id,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMs: r.durationMs,
        model: r.model,
        stepCount: r.stepCount,
        toolCallCount: r.toolCallCount,
        positionCount: r.positionCount,
        leaderboardStatus: r.leaderboardStatus,
        errorMessage: r.errorMessage,
        iteration: ledger?.iteration,
        publicAgentVersion: ledger?.publicAgentVersion ?? null,
        score: ledger?.score ?? null,
        kept: ledger?.kept,
        skipReason: ledger?.skipReason,
        estimatedCostUsd: ledger?.estimatedCostUsd,
        proposedRule: ledger?.proposedRule,
      };
    })
    .sort((a, b) => {
      if (a.iteration != null && b.iteration != null) return a.iteration - b.iteration;
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    });

  const pct =
    session.plannedIterations > 0
      ? Math.min(
          100,
          (session.completedIterations / session.plannedIterations) * 100,
        )
      : 0;
  const bestScore = sessionIterations.reduce<number | null>((best, it) => {
    if (it.score == null) return best;
    if (best == null || it.score > best) return it.score;
    return best;
  }, null);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-6 py-10">
      <AutoRefresh enabled={session.status === "running"} intervalMs={2000} />

      <nav className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/autoresearch"
          className="inline-flex items-center border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)]"
        >
          ← Back to autoresearch
        </Link>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          session {sessionId}
        </p>
      </nav>

      <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--border)] px-6 py-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted-foreground)]">
              Autoresearch session · {session.status}
            </p>
            <h1 className="mt-3 font-sans text-2xl font-semibold tracking-tight text-[color:var(--foreground)] sm:text-3xl">
              {session.completedIterations} / {session.plannedIterations}{" "}
              iterations
            </h1>
            <p className="mt-2 font-mono text-[11px] text-[color:var(--muted-foreground)]">
              {session.model}
              {session.host ? ` · ${session.host}` : ""}
              {session.pid != null ? ` · pid ${session.pid}` : ""}
            </p>
          </div>
          {session.status === "running" ? (
            <AutoresearchSessionStopButton sessionId={sessionId} />
          ) : null}
        </header>

        <div className="relative h-1 w-full border-b border-[color:var(--border)]">
          <div
            className="absolute inset-y-0 left-0 bg-[color:var(--foreground)]"
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>

        <div className="grid grid-cols-3">
          <Cell
            label="Started"
            value={new Date(session.startedAt).toLocaleString()}
          />
          <Cell
            label="Finished"
            value={
              session.finishedAt
                ? new Date(session.finishedAt).toLocaleString()
                : "—"
            }
            border="l"
          />
          <Cell
            label="Best score"
            value={bestScore != null ? `$${bestScore.toLocaleString()}` : "—"}
            border="l"
          />
        </div>

        {session.errorMessage ? (
          <div className="border-t border-[color:var(--border)] px-6 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Session error
            </p>
            <p className="mt-1 font-mono text-xs text-[color:var(--foreground)]">
              {session.errorMessage}
            </p>
          </div>
        ) : null}

        {session.logPath ? (
          <div className="border-t border-[color:var(--border)] px-6 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Live logs
            </p>
            <p className="mt-2 font-mono text-[10px] text-[color:var(--muted-foreground)]">
              Tail the child process&rsquo;s stdout/stderr from a terminal:
            </p>
            <pre className="mt-2 select-all overflow-x-auto border border-[color:var(--border)] bg-[color:var(--background)] px-4 py-2 font-mono text-[11px] text-[color:var(--foreground)]">
              tail -f {session.logPath}
            </pre>
          </div>
        ) : null}
      </section>

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--muted-foreground)]">
              Iterations
            </p>
            <h2 className="mt-2 font-sans text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
              Inner loop
            </h2>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            {sessionIterations.length} visible
          </p>
        </div>
        {sessionIterations.length === 0 ? (
          <div className="border border-dashed border-[color:var(--border)] px-6 py-10 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              No iterations yet
            </p>
            <p className="mt-3 font-mono text-[11px] text-[color:var(--foreground)]">
              The first iteration writes to Convex as soon as the agent
              finishes its first run. This page refreshes every 2 seconds
              while the session is running.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col border border-[color:var(--border)]">
            {sessionIterations.map((it, idx) => (
              <IterationRow
                key={it.runId}
                iteration={it}
                isLast={idx === sessionIterations.length - 1}
              />
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function IterationRow({
  iteration,
  isLast,
}: {
  iteration: IterationSummary;
  isLast: boolean;
}) {
  const status: "running" | "kept" | "discard" | "skip" | "failed" =
    iteration.status === "running"
      ? "running"
      : iteration.status === "failed"
        ? "failed"
        : iteration.skipReason
          ? "skip"
          : iteration.kept
            ? "kept"
            : "discard";
  const scoreStr =
    iteration.score != null ? `$${iteration.score.toLocaleString()}` : "—";

  return (
    <li className={isLast ? "" : "border-b border-[color:var(--border)]"}>
      <Link
        href={`/runs/${iteration.runId}`}
        className="flex flex-col gap-2 px-5 py-4 transition hover:bg-[color:var(--surface-elevated)]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              {iteration.iteration != null
                ? `#${iteration.iteration}`
                : "pending"}
            </span>
            <span className="font-mono text-base tabular-nums text-[color:var(--foreground)]">
              {scoreStr}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <IterationStatusBadge status={status} />
          </div>
        </div>

        <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
          {iteration.publicAgentVersion ?? "—"} ·{" "}
          {new Date(iteration.startedAt).toLocaleString()}
          {iteration.durationMs != null
            ? ` · ${(iteration.durationMs / 1000).toFixed(1)}s`
            : ""}
          {iteration.model ? ` · ${iteration.model}` : ""}
        </p>

        {iteration.proposedRule ? (
          <p className="font-mono text-[11px] text-[color:var(--foreground)]">
            {iteration.proposedRule}
          </p>
        ) : null}

        {iteration.skipReason ? (
          <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
            skip: {iteration.skipReason}
          </p>
        ) : null}

        {iteration.errorMessage ? (
          <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
            error: {iteration.errorMessage}
          </p>
        ) : null}
      </Link>
    </li>
  );
}

function IterationStatusBadge({
  status,
}: {
  status: "running" | "kept" | "discard" | "skip" | "failed";
}) {
  const inverted = status === "kept" || status === "running";
  return (
    <span
      className={
        "inline-flex items-center border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] " +
        (inverted
          ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]"
          : "border-[color:var(--border)] text-[color:var(--muted-foreground)]")
      }
    >
      {status}
    </span>
  );
}

function Cell({
  label,
  value,
  border = "",
}: {
  label: string;
  value: string;
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
      <p className="font-mono text-sm font-semibold text-[color:var(--foreground)] tabular-nums">
        {value}
      </p>
    </div>
  );
}
