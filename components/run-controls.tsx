"use client";

import type { ChatStatus } from "ai";

type Props = {
  status: ChatStatus;
  hasMessages: boolean;
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
};

export function RunControls({ status, hasMessages, onRun, onStop, onReset }: Props) {
  const isBusy = status === "submitted" || status === "streaming";
  const label =
    status === "submitted"
      ? "Submitting"
      : status === "streaming"
        ? "Streaming"
        : status === "error"
          ? "Error"
          : hasMessages
            ? "Done"
            : "Idle";

  return (
    <div className="flex items-center justify-between gap-4 border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={
            "inline-block h-2 w-2 " +
            (isBusy
              ? "animate-pulse bg-[color:var(--foreground)]"
              : status === "error"
                ? "bg-[color:var(--foreground)]"
                : hasMessages
                  ? "bg-[color:var(--muted-foreground)]"
                  : "bg-[color:var(--border)]")
          }
        />
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
          {label}
        </span>
      </div>
      <div className="flex gap-2">
        {isBusy ? (
          <Button onClick={onStop}>Stop</Button>
        ) : (
          <Button onClick={onRun} primary>
            {hasMessages ? "Run again" : "Run agent"}
          </Button>
        )}
        {hasMessages && !isBusy ? <Button onClick={onReset}>Reset</Button> : null}
      </div>
    </div>
  );
}

function Button({
  children,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "border px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.15em] transition " +
        (primary
          ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)] hover:bg-transparent hover:text-[color:var(--foreground)]"
          : "border-[color:var(--border)] bg-transparent text-[color:var(--foreground)] hover:border-[color:var(--foreground)]")
      }
    >
      {children}
    </button>
  );
}
