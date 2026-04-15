"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DEFAULT_RUN_PROMPT } from "@/lib/run-prompt";
import {
  ANTHROPIC_FAMILIES,
  DEFAULT_ANTHROPIC_FAMILY,
  DEFAULT_ANTHROPIC_VARIANT,
  findAnthropicFamily,
  resolveAnthropicModelId,
  type AgentBackend,
  type AnthropicFamilyId,
} from "@/lib/agent-options";

const CODEX_PREVIEW_ID = "codex-cli (bundled)";

type SystemPromptMode = "base" | "champion";

export function NewRunForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [backend, setBackend] = useState<AgentBackend>("anthropic");
  const [familyId, setFamilyId] = useState<AnthropicFamilyId>(
    DEFAULT_ANTHROPIC_FAMILY,
  );
  const [variantId, setVariantId] = useState<string>(DEFAULT_ANTHROPIC_VARIANT);
  const [promptMode, setPromptMode] = useState<SystemPromptMode>("base");

  const family = useMemo(() => findAnthropicFamily(familyId), [familyId]);
  const resolvedModelId =
    backend === "anthropic" ? resolveAnthropicModelId(familyId, variantId) : null;
  const previewId = backend === "codex-cli" ? CODEX_PREVIEW_ID : resolvedModelId;

  const handleBackend = (next: AgentBackend) => {
    setBackend(next);
  };

  const handleFamily = (next: AnthropicFamilyId) => {
    setFamilyId(next);
    const nextFamily = findAnthropicFamily(next);
    // Reset variant to the family's first option if the current variant
    // isn't available on the new family (standard/long-context/dated).
    if (!nextFamily.variants.some(v => v.id === variantId)) {
      setVariantId(nextFamily.variants[0].id);
    }
  };

  const runAgent = () => {
    setError(null);
    setExpanded(false);

    // Fire-and-forget. The API route writes the run record before the agent
    // starts, so a refresh at ~400ms surfaces the new row — after that the
    // auto-refresh in the runs list (1s while anything is running) keeps it
    // fresh without tying this button's state to the long-running fetch.
    window.setTimeout(() => router.refresh(), 400);

    fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: DEFAULT_RUN_PROMPT,
        backend,
        ...(backend === "anthropic" && resolvedModelId
          ? { model: resolvedModelId }
          : {}),
        ...(backend === "anthropic"
          ? { systemPromptMode: promptMode }
          : {}),
      }),
    })
      .then(async response => {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          requestId?: string;
        };
        if (!response.ok) {
          setError(
            data.error ??
              `Agent request failed${data.requestId ? ` (${data.requestId})` : ""}`,
          );
        }
        router.refresh();
      })
      .catch(submitError => {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Unknown agent request error",
        );
      });
  };

  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="flex flex-wrap items-start justify-center gap-4 px-6 py-10">
        {expanded ? (
          <div className="flex min-w-[360px] flex-col items-stretch gap-3">
            <SegmentedRow
              label="Backend"
              options={[
                { value: "anthropic", label: "Anthropic" },
                { value: "codex-cli", label: "Codex CLI" },
              ]}
              selected={backend}
              onSelect={v => handleBackend(v as AgentBackend)}
            />

            {backend === "anthropic" ? (
              <>
                <SegmentedRow
                  label="Family"
                  options={ANTHROPIC_FAMILIES.map(f => ({
                    value: f.id,
                    label: f.label,
                  }))}
                  selected={familyId}
                  onSelect={v => handleFamily(v as AnthropicFamilyId)}
                />
                <SegmentedRow
                  label="Variant"
                  options={family.variants.map(v => ({
                    value: v.id,
                    label: v.label,
                  }))}
                  selected={variantId}
                  onSelect={setVariantId}
                />
                <SegmentedRow
                  label="Prompt"
                  options={[
                    { value: "base", label: "Base" },
                    { value: "champion", label: "Autoresearch champion" },
                  ]}
                  selected={promptMode}
                  onSelect={v => setPromptMode(v as SystemPromptMode)}
                />
              </>
            ) : null}

            <div className="mt-1 flex items-baseline justify-between border-t border-[color:var(--border)] pt-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                Model ID
              </span>
              <code className="font-mono text-[11px] text-[color:var(--foreground)]">
                {previewId}
              </code>
            </div>
            {backend === "anthropic" && promptMode === "champion" ? (
              <p className="font-mono text-[10px] leading-relaxed text-[color:var(--muted-foreground)]">
                Composes{" "}
                <span className="text-[color:var(--foreground)]">BASE</span> +
                every rule autoresearch has accepted so far (loaded from
                Convex at request time).
              </p>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={runAgent}
                className="flex-1 border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-6 py-3 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--background)] transition hover:bg-transparent hover:text-[color:var(--foreground)]"
              >
                Run agent
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="border border-[color:var(--border)] bg-transparent px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-foreground)] transition hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex min-w-[260px] items-center justify-center gap-3 border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--background)] transition hover:bg-transparent hover:text-[color:var(--foreground)]"
          >
            Run agent
          </button>
        )}

        <Link
          href="/autoresearch"
          className="inline-flex min-w-[260px] items-center justify-center gap-3 border border-[color:var(--border)] bg-transparent px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground)] transition hover:border-[color:var(--foreground)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)]"
        >
          Autoresearch →
        </Link>
      </div>

      {error ? (
        <div className="border-t border-[color:var(--border)] px-6 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Error
          </p>
          <p className="mt-1 font-mono text-xs text-[color:var(--foreground)]">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SegmentedRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
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
              className={
                "px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] transition " +
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
