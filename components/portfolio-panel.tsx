"use client";

import type { TradingMessage } from "@/lib/agent-message";
import {
  MIN_POSITION_COUNT,
  MIN_POSITION_USD,
  TOTAL_BUDGET_USD,
  type Position,
} from "@/lib/portfolio";

type Props = {
  messages: TradingMessage[];
};

type PortfolioInput = { positions: Position[] };

// Find the latest submit_portfolio tool call from the assistant's messages.
// We read `input` as soon as it's available — i.e. at the moment the agent
// commits, BEFORE the validator runs. The validator result (accepted / errors)
// is displayed as a badge on top of the already-rendered table.
function findSubmitPart(messages: TradingMessage[]): {
  input: PortfolioInput;
  output: { accepted: boolean; errors?: string[] } | null;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    for (let j = message.parts.length - 1; j >= 0; j--) {
      const part = message.parts[j] as {
        type: string;
        state?: string;
        input?: unknown;
        output?: unknown;
      };
      if (part.type !== "tool-submit_portfolio") continue;
      if (part.state !== "input-available" && part.state !== "output-available") continue;
      const input = part.input as PortfolioInput | undefined;
      if (!input?.positions?.length) continue;
      return {
        input,
        output:
          part.state === "output-available"
            ? (part.output as { accepted: boolean; errors?: string[] })
            : null,
      };
    }
  }
  return null;
}

export function PortfolioPanel({ messages }: Props) {
  const found = findSubmitPart(messages);
  if (!found) return null;

  const { input, output } = found;
  const positions = input.positions;
  const total = positions.reduce((sum, p) => sum + p.notional_usd, 0);
  const tickers = new Set(positions.map(p => p.ticker));
  const uniqueCount = tickers.size;

  return (
    <section className="mt-4 border border-[color:var(--border)] bg-[color:var(--surface)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] px-5 py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
            Submitted portfolio
          </div>
          <h2 className="mt-1 font-sans text-lg font-semibold text-[color:var(--foreground)]">
            {positions.length} positions · ${total.toLocaleString()}
          </h2>
        </div>
        <ValidationBadge output={output} />
      </header>

      <ComplianceRow
        positionCount={positions.length}
        uniqueCount={uniqueCount}
        total={total}
        minPosition={positions.reduce(
          (min, p) => (p.notional_usd < min ? p.notional_usd : min),
          Number.POSITIVE_INFINITY,
        )}
      />

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="border-y border-[color:var(--border)] text-[10px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
              <th className="px-5 py-2 text-left font-normal">#</th>
              <th className="px-3 py-2 text-left font-normal">Ticker</th>
              <th className="px-3 py-2 text-right font-normal">Notional</th>
              <th className="px-3 py-2 text-right font-normal">Weight</th>
              <th className="px-3 py-2 text-left font-normal">Thesis</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position, idx) => {
              const weight = (position.notional_usd / TOTAL_BUDGET_USD) * 100;
              return (
                <tr
                  key={`${position.ticker}-${idx}`}
                  className="border-b border-[color:var(--border)] transition hover:bg-[color:var(--surface-elevated)]"
                >
                  <td className="px-5 py-2 text-[color:var(--muted-foreground)]">
                    {(idx + 1).toString().padStart(2, "0")}
                  </td>
                  <td className="px-3 py-2 font-semibold text-[color:var(--foreground)]">
                    {position.ticker}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--foreground)]">
                    ${position.notional_usd.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                    {weight.toFixed(2)}%
                  </td>
                  <td className="max-w-[420px] truncate px-3 py-2 font-sans text-[color:var(--foreground)]">
                    {position.thesis}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ValidationBadge({
  output,
}: {
  output: { accepted: boolean; errors?: string[] } | null;
}) {
  if (!output) {
    return (
      <span className="border border-[color:var(--border)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        Validating…
      </span>
    );
  }
  if (output.accepted) {
    return (
      <span className="border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--background)]">
        Accepted
      </span>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="border border-[color:var(--foreground)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--foreground)]">
        Rejected · revising
      </span>
      {output.errors?.slice(0, 2).map((err, i) => (
        <span
          key={i}
          className="font-mono text-[10px] text-[color:var(--muted-foreground)]"
        >
          {err}
        </span>
      ))}
    </div>
  );
}

function ComplianceRow({
  positionCount,
  uniqueCount,
  total,
  minPosition,
}: {
  positionCount: number;
  uniqueCount: number;
  total: number;
  minPosition: number;
}) {
  const cells = [
    {
      label: "Positions",
      value: `${positionCount}`,
      ok: positionCount >= MIN_POSITION_COUNT,
    },
    {
      label: "Unique tickers",
      value: `${uniqueCount}`,
      ok: uniqueCount === positionCount,
    },
    {
      label: "Total",
      value: `$${total.toLocaleString()}`,
      ok: total === TOTAL_BUDGET_USD,
    },
    {
      label: "Min position",
      value: Number.isFinite(minPosition) ? `$${minPosition.toLocaleString()}` : "—",
      ok: minPosition >= MIN_POSITION_USD,
    },
  ];
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-[color:var(--border)] border-b border-[color:var(--border)] sm:grid-cols-4 sm:divide-y-0">
      {cells.map(cell => (
        <div key={cell.label} className="px-5 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
            {cell.label}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-[color:var(--foreground)]">
              {cell.value}
            </span>
            <span
              aria-hidden
              className="font-mono text-xs text-[color:var(--foreground)]"
            >
              {cell.ok ? "✓" : "×"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
