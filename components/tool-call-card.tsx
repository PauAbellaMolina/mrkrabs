"use client";

import { useState } from "react";

// Loose shape — the AI SDK's ToolUIPart union has ~7 states (including human-
// in-the-loop approval states we don't use). Accept the lot and only branch on
// the four we actually render.
type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
};

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part: any;
};

export function ToolCallCard({ part: rawPart }: Props) {
  const part = rawPart as ToolPart;
  const [expanded, setExpanded] = useState(false);
  const toolName = part.type.replace(/^tool-/, "");
  const state = part.state ?? "input-streaming";

  // submit_portfolio is handled by <PortfolioPanel/>; render a terse row here.
  const isSubmit = toolName === "submit_portfolio";

  const glyph =
    state === "input-streaming"
      ? "◦"
      : state === "input-available"
        ? "…"
        : state === "output-available"
          ? "✓"
          : "×";

  const summary = summarize(toolName, part.input);

  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <button
        onClick={() => setExpanded(x => !x)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-[color:var(--surface-elevated)]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="w-3 shrink-0 text-center font-mono text-sm text-[color:var(--foreground)]"
          >
            {glyph}
          </span>
          <span className="font-mono text-xs font-semibold text-[color:var(--foreground)]">
            {toolName}
          </span>
          {summary ? (
            <span className="min-w-0 truncate font-mono text-xs text-[color:var(--muted-foreground)]">
              · {summary}
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          {stateLabel(state)}
          {" "}
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && !isSubmit ? (
        <div className="border-t border-[color:var(--border)] bg-[color:var(--background)] p-4">
          <Section label="Input">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
              {formatJson(part.input)}
            </pre>
          </Section>
          {state === "output-available" ? (
            <Section label="Output">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
                {formatJson(part.output)}
              </pre>
            </Section>
          ) : null}
          {state === "output-error" ? (
            <Section label="Error">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
                {part.errorText ?? "(no error text)"}
              </pre>
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function stateLabel(state: ToolPart["state"]) {
  switch (state) {
    case "input-streaming":
      return "writing";
    case "input-available":
      return "running";
    case "output-available":
      return "done";
    case "output-error":
      return "error";
    default:
      return "";
  }
}

function summarize(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  if (toolName === "entity_search" && typeof obj.name === "string") {
    return `"${obj.name}"`;
  }
  if (
    (toolName === "entity_introspection" || toolName === "retrieve_entity") &&
    typeof obj.entity_id === "string"
  ) {
    return obj.entity_id.slice(0, 8) + "…";
  }
  if (toolName === "submit_portfolio") {
    const positions = (obj.positions as unknown[]) ?? [];
    return `${positions.length} positions`;
  }
  return null;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
