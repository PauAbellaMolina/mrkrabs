import Link from "next/link";
import { ViewTransition } from "react";
import type { AgentRunSummary } from "@/lib/agent-runs";
import { deriveSummaryStage, type RunStage } from "@/lib/run-stage";
import { RunStageBadge } from "./run-stage-badge";

// List card for the Runboard. Layout is stage-aware: running cards show a
// pulse + "—" for metrics that aren't computed yet; done/submitted cards
// show the populated numbers.

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type Props = {
  run: AgentRunSummary;
  index: number;
};

export function RunListCard({ run, index }: Props) {
  const stage = deriveSummaryStage(run);
  const duration = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : null;

  return (
    <ViewTransition name={`run-card-${run.id}`}>
      <Link
        href={`/runs/${run.id}`}
        className="group block border border-[color:var(--border)] bg-[color:var(--surface)] transition hover:border-[color:var(--foreground)]"
        data-stage={stage}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                {String(index + 1).padStart(2, "0")} · {run.agentName} · {run.agentVersion}
              </p>
              <RunStageBadge stage={stage} size="sm" />
            </div>
            <h3 className="mt-3 max-w-2xl font-sans text-base font-semibold tracking-tight text-[color:var(--foreground)]">
              {truncate(run.prompt, 140)}
            </h3>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
              {dateTime.format(new Date(run.startedAt))}
            </p>
            <p className="mt-1 font-mono text-[10px] text-[color:var(--foreground)] tabular-nums">
              {duration ?? (stage === "running" ? "elapsed…" : "—")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5">
          <CardMetric
            label="Model"
            value={run.model ?? "—"}
            monospace
          />
          <CardMetric
            label="Steps"
            value={
              stage === "running" && run.stepCount === 0 ? "…" : String(run.stepCount)
            }
          />
          <CardMetric
            label="Tools"
            value={
              stage === "running" && run.toolCallCount === 0
                ? "…"
                : String(run.toolCallCount)
            }
          />
          <CardMetric
            label="Positions"
            value={
              stage === "running"
                ? "…"
                : run.positionCount > 0
                  ? String(run.positionCount)
                  : "—"
            }
          />
          <CardMetric
            label="Stage"
            value={stageShortText(stage)}
            pulse={stage === "running"}
          />
        </div>
      </Link>
    </ViewTransition>
  );
}

function CardMetric({
  label,
  value,
  monospace = true,
  pulse = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  pulse?: boolean;
}) {
  return (
    <div className="bg-[color:var(--background)] px-5 py-3 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-[color:var(--border)]">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p
        className={
          (monospace ? "font-mono" : "font-sans") +
          " mt-1 text-xs font-medium text-[color:var(--foreground)] tabular-nums truncate " +
          (pulse ? "animate-pulse" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function stageShortText(stage: RunStage): string {
  switch (stage) {
    case "running":
      return "in flight";
    case "done":
      return "ready";
    case "submitted":
      return "submitted";
    case "submit-failed":
      return "submit × ";
    case "failed":
      return "agent × ";
  }
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
