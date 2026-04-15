export function RunSkeletonPortfolio({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col border border-[color:var(--border)]">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={
            "flex items-center gap-4 bg-[color:var(--background)] px-5 py-4 " +
            (i > 0 ? "border-t border-[color:var(--border)]" : "")
          }
        >
          <div className="h-3 w-10 animate-pulse bg-[color:var(--surface-elevated)]" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-3 w-3/5 animate-pulse bg-[color:var(--surface-elevated)]" />
            <div className="h-2 w-2/5 animate-pulse bg-[color:var(--surface)]" />
          </div>
          <div className="h-3 w-20 animate-pulse bg-[color:var(--surface-elevated)]" />
        </div>
      ))}
    </div>
  );
}

export function RunSkeletonReport() {
  const widths = ["w-4/5", "w-full", "w-3/4", "w-11/12", "w-2/3", "w-5/6"];
  return (
    <div className="flex flex-col gap-3 border border-[color:var(--border)] bg-[color:var(--background)] p-5">
      <div className="h-3 w-1/4 animate-pulse bg-[color:var(--surface-elevated)]" />
      <div className="mt-2 flex flex-col gap-2">
        {widths.map((w, i) => (
          <div
            key={i}
            className={`h-2 ${w} animate-pulse bg-[color:var(--surface)]`}
          />
        ))}
      </div>
    </div>
  );
}

export function RunSkeletonMetricRow({ cells = 4 }: { cells?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4">
      {Array.from({ length: cells }).map((_, i) => (
        <div
          key={i}
          className={
            "flex flex-col gap-2 bg-[color:var(--background)] px-5 py-4 " +
            (i > 0 ? "border-l border-[color:var(--border)]" : "")
          }
        >
          <div className="h-2 w-16 animate-pulse bg-[color:var(--surface)]" />
          <div className="h-4 w-20 animate-pulse bg-[color:var(--surface-elevated)]" />
        </div>
      ))}
    </div>
  );
}
