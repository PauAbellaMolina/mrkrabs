"use client";

import { useMemo, useState } from "react";
import type { AgentRunSummary } from "@/lib/agent-runs";
import { useMockMode } from "@/lib/mock-mode";
import { listMockRunSummaries } from "@/lib/mock-store";
import { deriveSummaryStage, type RunStage } from "@/lib/run-stage";
import { AutoRefresh } from "./auto-refresh";
import { RefreshButton } from "./refresh-button";
import { RunListCard } from "./run-list-card";
import { StageFilterPills, type StageFilter } from "./stage-filter-pills";

type Props = {
  serverRuns: AgentRunSummary[];
  emptyState: React.ReactNode;
};

const EMPTY_COUNTS: Record<RunStage, number> = {
  running: 0,
  done: 0,
  submitted: 0,
  "submit-failed": 0,
  failed: 0,
};

export function HybridRunsList({ serverRuns, emptyState }: Props) {
  const { ready, enabled } = useMockMode();
  const mockRuns = enabled && ready ? listMockRunSummaries() : null;
  const runs = mockRuns ?? serverRuns;

  const [filter, setFilter] = useState<StageFilter>("all");

  const { counts, filteredRuns } = useMemo(() => {
    const counts: Record<RunStage, number> = { ...EMPTY_COUNTS };
    for (const run of runs) {
      counts[deriveSummaryStage(run)] += 1;
    }
    const filteredRuns =
      filter === "all"
        ? runs
        : runs.filter(run => deriveSummaryStage(run) === filter);
    return { counts, filteredRuns };
  }, [runs, filter]);

  const anyRunning = counts.running > 0;

  return (
    <>
      <AutoRefresh enabled={anyRunning} intervalMs={5000} />
      {runs.length === 0 ? (
        emptyState
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StageFilterPills
              value={filter}
              onChange={setFilter}
              counts={counts}
              total={runs.length}
            />
            <RefreshButton />
          </div>
          {filteredRuns.length === 0 ? (
            <div className="border border-dashed border-[color:var(--border)] px-6 py-10 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                No runs in this stage
              </p>
            </div>
          ) : (
            <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto overscroll-contain pr-1">
              {filteredRuns.map((run, i) => (
                <RunListCard key={run.id} run={run} index={i} />
              ))}
            </div>
          )}
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
