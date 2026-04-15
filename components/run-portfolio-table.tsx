import type { CalaAgentResult } from "@/lib/cala-agent";
import type { DiffMarker } from "@/lib/run-diff";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const DIFF_GLYPH: Record<Exclude<DiffMarker, null>, string> = {
  new: "+",
  removed: "−",
  up: "↑",
  down: "↓",
  flat: "=",
};

export function RunPortfolioTable({
  result,
  markers,
}: {
  result: CalaAgentResult;
  markers?: Map<string, DiffMarker>;
}) {
  const positions = result.output.positions;
  const showMarkers = !!markers && markers.size > 0;

  return (
    <div className="max-h-[70vh] overflow-auto overscroll-contain">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[color:var(--border)] text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            <th className="px-4 py-3 text-left font-normal">#</th>
            {showMarkers ? (
              <th className="px-2 py-3 text-left font-normal" aria-label="Diff" />
            ) : null}
            <th className="px-3 py-3 text-left font-normal">Ticker</th>
            <th className="px-3 py-3 text-left font-normal">Company</th>
            <th className="px-3 py-3 text-right font-normal">Notional</th>
            <th className="px-3 py-3 text-left font-normal">Thesis</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position, idx) => {
            const marker = markers?.get(position.nasdaqCode) ?? null;
            return (
              <tr
                key={`${position.companyEntityId}-${position.nasdaqCode}`}
                className="border-b border-[color:var(--border)] transition hover:bg-[color:var(--surface-elevated)]"
              >
                <td className="px-4 py-3 text-[color:var(--muted-foreground)] tabular-nums">
                  {(idx + 1).toString().padStart(2, "0")}
                </td>
                {showMarkers ? (
                  <td className="px-2 py-3 text-center text-[color:var(--foreground)]">
                    {marker ? (
                      <span
                        className={
                          "inline-flex h-4 w-4 items-center justify-center border border-[color:var(--border)] " +
                          (marker === "new" || marker === "up"
                            ? "font-semibold"
                            : "")
                        }
                      >
                        {DIFF_GLYPH[marker]}
                      </span>
                    ) : null}
                  </td>
                ) : null}
                <td className="px-3 py-3 font-semibold text-[color:var(--foreground)]">
                  {position.nasdaqCode}
                </td>
                <td className="max-w-[180px] truncate px-3 py-3 font-sans text-[color:var(--muted-foreground)]">
                  {position.companyName}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-[color:var(--foreground)]">
                  {money.format(position.amount)}
                </td>
                <td className="max-w-[420px] truncate px-3 py-3 font-sans text-[color:var(--foreground)]">
                  {position.thesis}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
