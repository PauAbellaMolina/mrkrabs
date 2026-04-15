import type { AgentRunEvent } from "@/lib/agent-runs";

// Live stream of telemetry events while the agent is running. Newest on
// top. Each event kind gets a different glyph so the eye can track the
// flow at a glance, still without color.

const EVENT_GLYPH: Record<AgentRunEvent["type"], string> = {
  "run-started": "▸",
  "step-started": "›",
  "tool-started": "·",
  "tool-finished": "✓",
  "step-finished": "✓",
  "run-finished": "●",
  "run-failed": "×",
};

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function RunActivityFeed({
  events,
  pulseLatest = false,
}: {
  events: AgentRunEvent[];
  pulseLatest?: boolean;
}) {
  const reversed = [...events].reverse();
  return (
    <div className="flex flex-col border border-[color:var(--border)]">
      {reversed.length === 0 ? (
        <div className="bg-[color:var(--background)] px-5 py-6 font-mono text-[11px] text-[color:var(--muted-foreground)]">
          No events yet.
        </div>
      ) : (
        reversed.map((event, index) => {
          const isLatest = index === 0;
          const glyph = EVENT_GLYPH[event.type] ?? "·";
          const toolName = extractToolName(event);
          return (
            <div
              key={event.id}
              className={
                "flex items-start gap-3 bg-[color:var(--background)] px-5 py-3 " +
                (index > 0 ? "border-t border-[color:var(--border)]" : "")
              }
            >
              <span
                aria-hidden
                className={
                  "w-3 shrink-0 text-center font-mono text-xs text-[color:var(--foreground)] " +
                  (pulseLatest && isLatest ? "animate-pulse" : "")
                }
              >
                {glyph}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="min-w-0 font-mono text-xs font-semibold text-[color:var(--foreground)]">
                    {event.title}
                  </p>
                  <p className="shrink-0 font-mono text-[10px] text-[color:var(--muted-foreground)] tabular-nums">
                    {timeFormatter.format(new Date(event.at))}
                  </p>
                </div>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  {event.type}
                  {toolName ? ` · ${toolName}` : ""}
                </p>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function extractToolName(event: AgentRunEvent): string | null {
  if (!event.data || typeof event.data !== "object") return null;
  const data = event.data as Record<string, unknown>;
  const toolName = data.toolName;
  if (typeof toolName === "string") return toolName;
  return null;
}
