"use client";

import Link from "next/link";
import { ViewTransition } from "react";
import type { AgentRunRecord } from "@/lib/agent-runs";
import { useMockMode } from "@/lib/mock-mode";
import { readMockRunRecords } from "@/lib/mock-store";
import { buildDiffMarkerMap, diffRuns, type DiffMarker } from "@/lib/run-diff";
import { deriveRunStage, type RunStage } from "@/lib/run-stage";
import { AutoRefresh } from "./auto-refresh";
import { RunActivityFeed } from "./run-activity-feed";
import { RunDiffPanel } from "./run-diff-panel";
import { RunPortfolioTable } from "./run-portfolio-table";
import {
  RunSkeletonMetricRow,
  RunSkeletonPortfolio,
  RunSkeletonReport,
} from "./run-skeleton-blocks";
import { RunStageBadge } from "./run-stage-badge";
import { RunSubmissionPanel } from "./run-submission-panel";

// Client wrapper for the run detail page. Renders the server-rendered run
// when mock mode is off. When mock mode is on, re-reads the run from
// localStorage and computes a mock baseline on the client so the diff
// panel still lights up.

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type Props = {
  runId: string;
  serverRun: AgentRunRecord | null;
  serverBaseline: AgentRunRecord | null;
};

export function HybridRunDetail({ runId, serverRun, serverBaseline }: Props) {
  const { ready, enabled } = useMockMode();

  let run: AgentRunRecord | null = serverRun;
  let baseline: AgentRunRecord | null = serverBaseline;

  if (ready && enabled) {
    const mockRecords = readMockRunRecords();
    const mockRun = mockRecords.find(record => record.id === runId);
    run = mockRun ?? null;
    if (mockRun && mockRun.result) {
      const candidate = mockRecords
        .filter(record => record.id !== runId && record.status === "completed")
        .sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        )[0];
      baseline = candidate ?? null;
    } else {
      baseline = null;
    }
  }

  if (!ready) {
    // First render before provider hydrates: show the server data as-is.
    if (!serverRun) return <NotFoundBody runId={runId} />;
    return (
      <DetailBody
        run={serverRun}
        baseline={serverBaseline}
        isMock={false}
      />
    );
  }

  if (!run) return <NotFoundBody runId={runId} />;

  return <DetailBody run={run} baseline={baseline} isMock={enabled} />;
}

function NotFoundBody({ runId }: { runId: string }) {
  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-8 px-6 py-10">
      <Link
        href="/"
        className="self-start border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)]"
      >
        ← Back to runs
      </Link>
      <section className="border border-dashed border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-16 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          Run not found
        </p>
        <p className="mt-4 font-sans text-sm text-[color:var(--foreground)]">
          Nothing in the mock store or backend for <code>{runId}</code>.
        </p>
      </section>
    </main>
  );
}

function DetailBody({
  run,
  baseline,
  isMock,
}: {
  run: AgentRunRecord;
  baseline: AgentRunRecord | null;
  isMock: boolean;
}) {
  const stage = deriveRunStage(run);
  const isRunning = stage === "running";

  const diff =
    run.result && baseline?.result ? diffRuns(run.result, baseline.result) : null;
  const markers =
    run.result && baseline?.result
      ? buildDiffMarkerMap(run.result, baseline.result)
      : undefined;

  const submissionPayload = run.result?.output.submissionPayload;
  const totalAllocated =
    submissionPayload?.transactions.reduce(
      (sum, transaction) => sum + transaction.amount,
      0,
    ) ?? 0;

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-6 py-10">
      <AutoRefresh enabled={isRunning && !isMock} intervalMs={1000} />

      <nav className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)]"
        >
          ← Back to runs
        </Link>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          Request {run.requestId}
        </p>
      </nav>

      <ViewTransition name={`run-card-${run.id}`}>
        <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--border)] px-6 py-5">
            <div className="max-w-3xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted-foreground)]">
                {run.agentName} · {run.agentVersion}
              </p>
              <h1 className="mt-3 font-sans text-2xl font-semibold tracking-tight text-[color:var(--foreground)] sm:text-3xl">
                {truncate(run.prompt, 160)}
              </h1>
              <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-[color:var(--muted-foreground)]">
                {run.prompt}
              </p>
            </div>
            <RunStageBadge stage={stage} />
          </header>

          <HeaderStats run={run} stage={stage} totalAllocated={totalAllocated} />
        </section>
      </ViewTransition>

      {isRunning ? (
        <RunningBody run={run} />
      ) : stage === "failed" ? (
        <FailedBody run={run} />
      ) : (
        <SettledBody
          run={run}
          stage={stage}
          diff={diff}
          baseline={baseline}
          markers={markers}
          totalAllocated={totalAllocated}
          isMock={isMock}
        />
      )}
    </main>
  );
}

function HeaderStats({
  run,
  stage,
  totalAllocated,
}: {
  run: AgentRunRecord;
  stage: RunStage;
  totalAllocated: number;
}) {
  const positions = run.result?.output.positions.length ?? 0;
  const isRunning = stage === "running";

  const cells = [
    {
      label: "Started",
      value: dateTime.format(new Date(run.startedAt)),
    },
    {
      label: "Duration",
      value: run.durationMs
        ? `${(run.durationMs / 1000).toFixed(1)}s`
        : isRunning
          ? "elapsed…"
          : "—",
      pulse: isRunning,
    },
    {
      label: "Steps",
      value: isRunning && run.stepCount === 0 ? "…" : `${run.stepCount}`,
    },
    {
      label: "Tools",
      value:
        isRunning && run.toolCallCount === 0 ? "…" : `${run.toolCallCount}`,
    },
    {
      label: "Positions",
      value: isRunning ? "…" : positions > 0 ? `${positions}` : "—",
    },
    {
      label: "Allocated",
      value: isRunning
        ? "…"
        : totalAllocated > 0
          ? money.format(totalAllocated)
          : "—",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={
            "flex flex-col gap-1 bg-[color:var(--background)] px-5 py-4 " +
            (i > 0 ? "border-l border-[color:var(--border)]" : "") +
            " [&:nth-child(n+4)]:border-t [&:nth-child(n+4)]:border-[color:var(--border)] md:[&:nth-child(n+4)]:border-t-0"
          }
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
            {cell.label}
          </p>
          <p
            className={
              "font-mono text-sm font-semibold text-[color:var(--foreground)] tabular-nums " +
              (cell.pulse ? "animate-pulse" : "")
            }
          >
            {cell.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function RunningBody({ run }: { run: AgentRunRecord }) {
  return (
    <section className="grid gap-8 xl:grid-cols-[0.95fr_1.35fr]">
      <div className="flex flex-col gap-6">
        <Panel eyebrow="Live" title="Activity">
          <RunActivityFeed events={run.events} pulseLatest />
        </Panel>
      </div>
      <div className="flex flex-col gap-6">
        <Panel eyebrow="Pending" title="Result summary">
          <RunSkeletonMetricRow cells={4} />
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            Waiting for the agent to finish. This page refreshes every second.
          </p>
        </Panel>
        <Panel eyebrow="Pending" title="Report">
          <RunSkeletonReport />
        </Panel>
        <Panel eyebrow="Pending" title="Portfolio">
          <RunSkeletonPortfolio rows={6} />
        </Panel>
      </div>
    </section>
  );
}

function FailedBody({ run }: { run: AgentRunRecord }) {
  return (
    <section className="grid gap-8 xl:grid-cols-[0.95fr_1.35fr]">
      <div className="flex flex-col gap-6">
        <Panel eyebrow="Error" title="Agent failed">
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[color:var(--foreground)]">
              {run.error?.message ?? "Unknown error"}
            </p>
            {run.error?.details ? <CodeBlock value={run.error.details} /> : null}
          </div>
        </Panel>
        <Panel eyebrow="Telemetry" title="Timeline">
          <RunActivityFeed events={run.events} />
        </Panel>
      </div>
      <div className="flex flex-col gap-6">
        <Panel eyebrow="Context" title="Prompt">
          <pre className="whitespace-pre-wrap border border-[color:var(--border)] bg-[color:var(--background)] p-4 font-mono text-xs leading-6 text-[color:var(--foreground)]">
            {run.prompt}
          </pre>
        </Panel>
      </div>
    </section>
  );
}

function SettledBody({
  run,
  stage,
  diff,
  baseline,
  markers,
  totalAllocated,
  isMock,
}: {
  run: AgentRunRecord;
  stage: RunStage;
  diff: ReturnType<typeof diffRuns> | null;
  baseline: AgentRunRecord | null;
  markers: Map<string, DiffMarker> | undefined;
  totalAllocated: number;
  isMock: boolean;
}) {
  const result = run.result!;
  const isSubmittable = stage === "done" || stage === "submit-failed";

  return (
    <>
      {stage === "submitted" || stage === "submit-failed" ? (
        <RunSubmissionPanel
          runId={run.id}
          initialSubmission={run.leaderboardSubmission}
          isMock={isMock}
        />
      ) : null}

      <section className="grid gap-8 xl:grid-cols-[0.95fr_1.35fr]">
        <div className="flex flex-col gap-6">
          <Panel eyebrow="Output" title="Result summary">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2">
                <MiniMetric label="Model" value={result.model} />
                <MiniMetric
                  label="Allocated"
                  value={money.format(totalAllocated)}
                  border="l"
                />
                <MiniMetric
                  label="Post-cutoff"
                  value={
                    result.output.cutoffAudit.postCutoffDataUsed
                      ? "flagged"
                      : "clean"
                  }
                  border="t"
                />
                <MiniMetric
                  label="Transactions"
                  value={`${result.output.submissionPayload.transactions.length}`}
                  border="tl"
                />
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                {result.output.cutoffAudit.complianceSummary}
              </p>
            </div>
          </Panel>

          {isSubmittable ? (
            <RunSubmissionPanel
              runId={run.id}
              initialSubmission={run.leaderboardSubmission}
              isMock={isMock}
            />
          ) : null}

          <Panel eyebrow="Narrative" title="Report">
            <pre className="max-h-[720px] overflow-auto border border-[color:var(--border)] bg-[color:var(--background)] p-5 font-mono text-[11px] leading-6 whitespace-pre-wrap break-words text-[color:var(--foreground)]">
              {result.output.reportMarkdown || "No report available."}
            </pre>
          </Panel>

          <Panel eyebrow="Telemetry" title="Timeline">
            <RunActivityFeed events={run.events} />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {diff && baseline ? (
            <RunDiffPanel
              diff={diff}
              baselineRunId={baseline.id}
              baselineStartedAt={baseline.startedAt}
            />
          ) : (
            <section className="border border-dashed border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                No baseline
              </p>
              <p className="mt-2 font-sans text-sm text-[color:var(--foreground)]">
                This is the first completed run — no baseline to compare
                against yet. Future runs will show a diff against this one.
              </p>
            </section>
          )}

          <Panel
            eyebrow="Portfolio"
            title={`${result.output.positions.length} positions`}
          >
            <RunPortfolioTable result={result} markers={markers} />
          </Panel>

          <Panel eyebrow="JSON" title="Submission payload">
            <CodeBlock value={result.output.submissionPayload} />
          </Panel>
        </div>
      </section>
    </>
  );
}

function Panel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <header className="border-b border-[color:var(--border)] px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
          {eyebrow}
        </p>
        <h2 className="mt-1 font-sans text-base font-semibold tracking-tight text-[color:var(--foreground)]">
          {title}
        </h2>
      </header>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function MiniMetric({
  label,
  value,
  border = "",
}: {
  label: string;
  value: string;
  border?: "" | "l" | "t" | "tl";
}) {
  const classes = [
    "flex flex-col gap-1 border border-[color:var(--border)] bg-[color:var(--background)] px-4 py-3",
  ];
  if (border === "l") classes.push("border-l-0 border-r-0 border-t-0");
  if (border === "t") classes.push("border-l-0 border-t-[1px] border-r-0 border-b-0");
  if (border === "tl")
    classes.push("border-l-[1px] border-t-[1px] border-r-0 border-b-0");
  if (!border) classes.push("border-r-0 border-b-0");
  return (
    <div className={classes.join(" ")}>
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold text-[color:var(--foreground)] tabular-nums">
        {value}
      </p>
    </div>
  );
}

function CodeBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[560px] overflow-auto border border-[color:var(--border)] bg-[color:var(--background)] p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[color:var(--foreground)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
