"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  ANTHROPIC_FAMILIES,
  DEFAULT_ANTHROPIC_FAMILY,
  DEFAULT_ANTHROPIC_VARIANT,
  findAnthropicFamily,
  resolveAnthropicModelId,
  type AnthropicFamilyId,
} from "@/lib/agent-options";

type Status =
  | { kind: "idle" }
  | {
      kind: "queued";
      iterations: number;
      modelId: string;
      sessionId: string;
      baseline: boolean;
      at: number;
    }
  | { kind: "error"; message: string };

const DEFAULT_ITERATIONS = 5;
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 50;

export function AutoresearchTrigger() {
  const router = useRouter();
  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS);
  const [familyId, setFamilyId] =
    useState<AnthropicFamilyId>(DEFAULT_ANTHROPIC_FAMILY);
  const [variantId, setVariantId] = useState<string>(DEFAULT_ANTHROPIC_VARIANT);
  const [baseline, setBaseline] = useState(false);
  const [fast, setFast] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  const family = useMemo(() => findAnthropicFamily(familyId), [familyId]);
  const modelId = resolveAnthropicModelId(familyId, variantId);

  const handleFamily = (next: AnthropicFamilyId) => {
    setFamilyId(next);
    const nextFamily = findAnthropicFamily(next);
    if (!nextFamily.variants.some(v => v.id === variantId)) {
      setVariantId(nextFamily.variants[0].id);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const clamped = Math.max(
      MIN_ITERATIONS,
      Math.min(MAX_ITERATIONS, Math.floor(iterations) || DEFAULT_ITERATIONS),
    );

    startTransition(async () => {
      try {
        const response = await fetch("/api/autoresearch/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            iterations: clamped,
            model: modelId,
            baseline,
            fast,
          }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          sessionId?: string;
        };
        if (!response.ok || data.ok === false || !data.sessionId) {
          throw new Error(data.error ?? "Failed to spawn autoresearch");
        }
        setStatus({
          kind: "queued",
          iterations: clamped,
          modelId,
          sessionId: data.sessionId,
          baseline,
          at: Date.now(),
        });
        setExpanded(false);
        // Refresh so the new session row appears in the list immediately.
        window.setTimeout(() => router.refresh(), 400);
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Unknown trigger error",
        });
      }
    });
  };

  if (!expanded) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-4 border border-[color:var(--border)] px-5 py-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex min-w-[220px] items-center justify-center gap-3 border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-6 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--background)] transition hover:bg-transparent hover:text-[color:var(--foreground)]"
          >
            New session
          </button>
          <StatusLine status={status} />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          local dev only
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 border border-[color:var(--border)] px-5 py-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Trigger
          </p>
          <h2 className="mt-1 font-sans text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
            Configure new session
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={isPending}
          className="border border-[color:var(--border)] bg-transparent px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-foreground)] transition hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Iterations
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_ITERATIONS}
              max={MAX_ITERATIONS}
              value={iterations}
              onChange={event => setIterations(Number(event.target.value))}
              disabled={isPending}
              className="w-20 border border-[color:var(--border)] bg-transparent px-3 py-2 text-center font-mono text-sm tabular-nums text-[color:var(--foreground)] focus:border-[color:var(--foreground)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>

        <SegmentedRow
          label="Family"
          options={ANTHROPIC_FAMILIES.map(f => ({
            value: f.id,
            label: f.label,
          }))}
          selected={familyId}
          onSelect={v => handleFamily(v as AnthropicFamilyId)}
          disabled={isPending}
        />

        <SegmentedRow
          label="Variant"
          options={family.variants.map(v => ({
            value: v.id,
            label: v.label,
          }))}
          selected={variantId}
          onSelect={setVariantId}
          disabled={isPending}
        />

        <label className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Baseline mode
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={baseline}
            onClick={() => setBaseline(v => !v)}
            disabled={isPending}
            className={
              "border px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] transition disabled:cursor-not-allowed " +
              (baseline
                ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]"
                : "border-[color:var(--border)] bg-transparent text-[color:var(--muted-foreground)] hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)]")
            }
          >
            {baseline ? "On — 45 locked, agent picks 5" : "Off — full 50-ticker research"}
          </button>
        </label>

        <label className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Fast mode
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={fast}
            onClick={() => setFast(v => !v)}
            disabled={isPending}
            className={
              "border px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] transition disabled:cursor-not-allowed " +
              (fast
                ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]"
                : "border-[color:var(--border)] bg-transparent text-[color:var(--muted-foreground)] hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)]")
            }
          >
            {fast ? "On — rank + submit (~10s/iter)" : "Off — full agent loop (~30min/iter)"}
          </button>
        </label>

        <div className="flex items-baseline justify-between border-t border-[color:var(--border)] pt-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Model ID
          </span>
          <code className="font-mono text-[11px] text-[color:var(--foreground)]">
            {modelId}
          </code>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex min-w-[220px] items-center justify-center gap-3 border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-6 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--background)] transition hover:bg-transparent hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:hover:bg-[color:var(--foreground)] disabled:hover:text-[color:var(--background)]"
          >
            {isPending ? (
              <>
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 animate-pulse bg-[color:var(--background)]"
                />
                Spawning…
              </>
            ) : (
              "Run iterations"
            )}
          </button>

          <StatusLine status={status} />
        </div>
      </form>

      <p className="font-mono text-[10px] leading-relaxed text-[color:var(--muted-foreground)]">
        Each click spawns one autoresearch session on this machine. Sessions
        show up in the list below and can be stopped individually.
      </p>
    </section>
  );
}

function SegmentedRow({
  label,
  options,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex divide-x divide-[color:var(--foreground)] border border-[color:var(--foreground)]"
      >
        {options.map(option => {
          const isSelected = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(option.value)}
              disabled={disabled}
              className={
                "px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] transition disabled:cursor-not-allowed " +
                (isSelected
                  ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                  : "bg-transparent text-[color:var(--foreground)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)]")
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;

  if (status.kind === "queued") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--foreground)]">
        queued {status.iterations} iteration
        {status.iterations === 1 ? "" : "s"} · {status.modelId}
        {status.baseline ? " · baseline" : ""} — session{" "}
        {status.sessionId.slice(0, 8)}
      </span>
    );
  }

  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
      error: {status.message}
    </span>
  );
}
