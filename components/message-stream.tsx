"use client";

import { isToolUIPart } from "ai";
import type { TradingMessage } from "@/lib/agent-message";
import { ToolCallCard } from "./tool-call-card";

type Props = {
  messages: TradingMessage[];
};

export function MessageStream({ messages }: Props) {
  return (
    <div className="flex flex-col gap-6">
      {messages.map(message => (
        <MessageBlock key={message.id} message={message} />
      ))}
    </div>
  );
}

function MessageBlock({ message }: { message: TradingMessage }) {
  if (message.role === "user") {
    return (
      <div className="border-l-2 border-[color:var(--border)] pl-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
          You
        </div>
        <div className="mt-1 text-sm text-[color:var(--foreground)]">
          {message.parts.map((part, i) =>
            part.type === "text" ? <span key={i}>{part.text}</span> : null,
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        Agent
      </div>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <p
              key={i}
              className="whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--foreground)]"
            >
              {part.text}
            </p>
          );
        }
        if (part.type === "reasoning") {
          return (
            <p
              key={i}
              className="whitespace-pre-wrap border-l border-[color:var(--border)] pl-3 font-mono text-xs leading-relaxed text-[color:var(--muted-foreground)]"
            >
              {part.text}
            </p>
          );
        }
        if (isToolUIPart(part)) {
          return <ToolCallCard key={i} part={part} />;
        }
        return null;
      })}
    </div>
  );
}
