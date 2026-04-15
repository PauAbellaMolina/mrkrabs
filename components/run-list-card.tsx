import Link from "next/link";
import { ViewTransition } from "react";
import type { AgentRunSummary } from "@/lib/agent-runs";
import { deriveSummaryStage, type RunStage } from "@/lib/run-stage";
import {
  formatSubmissionMetric,
  parseSubmissionResponse,
  type SubmissionMetric,
} from "@/lib/submission-result";
import { RunStageBadge } from "./run-stage-badge";

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

        <CoreMetrics run={run} stage={stage} />
        <StageDetail run={run} stage={stage} />
      </Link>
    </ViewTransition>
  );
}

function CoreMetrics({ run, stage }: { run: AgentRunSummary; stage: RunStage }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5">
      <CardMetric label="Model" value={run.model ?? "—"} />
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
  );
}

function StageDetail({ run, stage }: { run: AgentRunSummary; stage: RunStage }) {
  if (stage === "submitted") return <SubmittedDetail run={run} />;
  if (stage === "submit-failed") return <SubmitFailedDetail run={run} />;
  if (stage === "failed") return <FailedDetail run={run} />;
  return null;
}

function SubmittedDetail({ run }: { run: AgentRunSummary }) {
  const parsed = parseSubmissionResponse(run.leaderboardResponse);
  const headline = parsed.headline;
  // Up to three distinct secondary metrics, skipping the headline.
  const secondary: SubmissionMetric[] = [];
  for (const metric of parsed.metrics) {
    if (secondary.length >= 3) break;
    if (headline && metric.key === headline.key) continue;
    if (secondary.some(existing => existing.label === metric.label)) continue;
    secondary.push(metric);
  }

  if (!headline && secondary.length === 0) {
    return (
      <div className="border-t border-[color:var(--border)] bg-[color:var(--background)] px-5 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          Cala response · no metrics
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 border-t border-[color:var(--border)] sm:grid-cols-4">
      {headline ? (
        <CardMetric
          label={headline.label}
          value={formatSubmissionMetric(headline)}
          emphasis
        />
      ) : null}
      {secondary.map(metric => (
        <CardMetric
          key={metric.key}
          label={metric.label}
          value={formatSubmissionMetric(metric)}
        />
      ))}
    </div>
  );
}

function SubmitFailedDetail({ run }: { run: AgentRunSummary }) {
  const message = extractSubmitFailureMessage(run.leaderboardDetails);
  const upstream =
    run.leaderboardUpstreamStatus != null
      ? `HTTP ${run.leaderboardUpstreamStatus}`
      : "—";
  return (
    <div className="grid grid-cols-1 border-t border-[color:var(--border)] sm:grid-cols-[auto_1fr]">
      <CardMetric label="Upstream" value={upstream} />
      <div className="bg-[color:var(--background)] px-5 py-3 sm:border-l sm:border-[color:var(--border)]">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          Submit error
        </p>
        <p className="mt-1 font-sans text-xs leading-5 text-[color:var(--foreground)]">
          {truncate(message ?? "Cala rejected the submission.", 220)}
        </p>
      </div>
    </div>
  );
}

function FailedDetail({ run }: { run: AgentRunSummary }) {
  return (
    <div className="border-t border-[color:var(--border)] bg-[color:var(--background)] px-5 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        Agent error
      </p>
      <p className="mt-1 font-sans text-xs leading-5 text-[color:var(--foreground)]">
        {truncate(run.errorMessage ?? "Unknown error", 220)}
      </p>
    </div>
  );
}

function CardMetric({
  label,
  value,
  monospace = true,
  pulse = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  pulse?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-[color:var(--background)] px-5 py-3 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-[color:var(--border)]">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p
        className={
          (monospace ? "font-mono" : "font-sans") +
          " mt-1 tabular-nums truncate text-[color:var(--foreground)] " +
          (emphasis ? "text-sm font-semibold " : "text-xs font-medium ") +
          (pulse ? "animate-pulse" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function extractSubmitFailureMessage(details: unknown): string | null {
  if (!details) return null;
  if (typeof details === "string") return details;
  if (typeof details !== "object") return String(details);
  const obj = details as Record<string, unknown>;
  for (const key of ["message", "error", "detail", "reason"]) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return null;
  }
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
