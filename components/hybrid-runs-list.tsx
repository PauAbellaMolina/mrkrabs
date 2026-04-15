"use client";

import type { AgentRunSummary } from "@/lib/agent-runs";
import { useMockMode } from "@/lib/mock-mode";
import { listMockRunSummaries } from "@/lib/mock-store";
import { deriveSummaryStage } from "@/lib/run-stage";
import { AutoRefresh } from "./auto-refresh";
import { RunListCard } from "./run-list-card";

// Client wrapper for the runs list. Takes the server-rendered summaries
// as a fallback and overrides them with the mock store contents when
// mock mode is enabled. While the provider is still hydrating (ready=false),
// we render the server data so there's no flash of empty state.

type Props = {
  serverRuns: AgentRunSummary[];
  emptyState: React.ReactNode;
};

export function HybridRunsList({ serverRuns, emptyState }: Props) {
  const { ready, enabled } = useMockMode();
  const mockRuns = enabled && ready ? listMockRunSummaries() : null;
  const runs = mockRuns ?? serverRuns;

  const anyRunning = runs.some(run => deriveSummaryStage(run) === "running");
  const refreshInterval = anyRunning ? 1000 : 4000;

  return (
    <>
      <AutoRefresh enabled intervalMs={refreshInterval} />
      {runs.length === 0 ? (
        emptyState
      ) : (
        <div className="flex flex-col gap-4">
          {runs.map((run, i) => (
            <RunListCard key={run.id} run={run} index={i} />
          ))}
        </div>
      )}
    </>
  );
}

export function HybridRunsHeaderStats({
  serverRuns,
}: {
  serverRuns: AgentRunSummary[];
}) {
  const { ready, enabled } = useMockMode();
  const runs = enabled && ready ? listMockRunSummaries() : serverRuns;
  const completedRuns = runs.filter(run => run.status === "completed");
  const submittedRuns = runs.filter(run => run.leaderboardStatus === "submitted");
  const latestRun = runs[0];

  const dateTime = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="grid min-w-[320px] grid-cols-2 border border-[color:var(--border)]">
      <MetricCell label="Runs" value={`${runs.length}`} border="" />
      <MetricCell
        label="Completed"
        value={`${completedRuns.length}`}
        border="l"
      />
      <MetricCell
        label="Submitted"
        value={`${submittedRuns.length}`}
        border="t"
      />
      <MetricCell
        label="Latest"
        value={latestRun ? dateTime.format(new Date(latestRun.startedAt)) : "—"}
        border="tl"
      />
    </div>
  );
}

function MetricCell({
  label,
  value,
  border,
}: {
  label: string;
  value: string;
  border: "" | "l" | "t" | "tl";
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
    <div className={"bg-[color:var(--surface)] px-4 py-3 " + borderClass}>
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-[color:var(--foreground)] tabular-nums">
        {value}
      </p>
    </div>
  );
}
