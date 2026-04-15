"use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import type { TradingMessage } from "@/lib/agent-message";
import { MessageStream } from "./message-stream";
import { PortfolioPanel } from "./portfolio-panel";
import { RunControls } from "./run-controls";

const INITIAL_TRIGGER =
  "Build the $1,000,000 NASDAQ portfolio now. Follow your system instructions. " +
  "Research candidates, reason over Cala's graph, then finalize via finalize_portfolio.";

export function AgentTheater() {
  const { messages, sendMessage, setMessages, stop, status, error, clearError } =
    useChat<TradingMessage>({
      transport: new DefaultChatTransport({ api: "/api/agent" }),
    });

  const handleRun = () => {
    clearError();
    void sendMessage({ text: INITIAL_TRIGGER });
  };

  const handleReset = () => {
    clearError();
    setMessages([]);
  };

  return (
    <div className="flex flex-col gap-8">
      <RunControls
        status={status}
        hasMessages={messages.length > 0}
        onRun={handleRun}
        onStop={stop}
        onReset={handleReset}
      />
      {error ? <ErrorBanner error={error} onDismiss={clearError} /> : null}
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <MessageStream messages={messages} />
      )}
      <PortfolioPanel messages={messages} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--surface)] p-10 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        Idle
      </p>
      <p className="mt-4 text-sm text-[color:var(--foreground)]">
        Click <span className="font-mono font-semibold">Run agent</span> to start the
        research loop.
      </p>
      <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
        entity_search → entity_introspection → retrieve_entity → finalize_portfolio
      </p>
    </div>
  );
}

function ErrorBanner({ error, onDismiss }: { error: Error; onDismiss: () => void }) {
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--surface-elevated)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-[color:var(--foreground)]">
            Error
          </div>
          <p className="mt-1 break-words font-mono text-sm text-[color:var(--foreground)]">
            {error.message}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 border border-[color:var(--border)] px-3 py-1 font-mono text-xs uppercase tracking-[0.15em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
