"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_RUN_PROMPT } from "@/lib/run-prompt";

type AgentBackend = "anthropic" | "codex-cli";

type AgentOption = {
  label: string;
  backend: AgentBackend;
  model?: string;
};

const AGENT_OPTIONS: AgentOption[] = [
  { label: "Codex CLI", backend: "codex-cli" },
  { label: "Sonnet 4.6", backend: "anthropic", model: "claude-sonnet-4-6" },
  { label: "Haiku 4.5", backend: "anthropic", model: "claude-haiku-4-5" },
  { label: "Opus 4.6", backend: "anthropic", model: "claude-opus-4-6" },
];

export function NewRunForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const runAgent = (option: AgentOption) => {
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
        backend: option.backend,
        ...(option.model ? { model: option.model } : {}),
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
      <div className="flex flex-wrap items-center justify-center gap-4 px-6 py-10">
        {expanded ? (
          <div
            role="group"
            aria-label="Pick agent backend and model"
            className="inline-flex divide-x divide-[color:var(--foreground)] border border-[color:var(--foreground)]"
          >
            {AGENT_OPTIONS.map(option => (
              <button
                key={`${option.backend}:${option.model ?? ""}`}
                type="button"
                onClick={() => runAgent(option)}
                className="flex-1 bg-transparent px-4 py-4 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground)] transition hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] whitespace-nowrap"
              >
                {option.label}
              </button>
            ))}
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
