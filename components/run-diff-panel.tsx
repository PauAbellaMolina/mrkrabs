import Link from "next/link";
import type { RunDiff } from "@/lib/run-diff";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type Props = {
  diff: RunDiff;
  baselineRunId: string;
  baselineStartedAt: string;
};

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function RunDiffPanel({ diff, baselineRunId, baselineStartedAt }: Props) {
  const totalChanged =
    diff.added.length + diff.removed.length + diff.reweighted.length;

  return (
    <section className="border border-[color:var(--border)] bg-[color:var(--surface)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border)] px-5 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
            Diff vs baseline
          </p>
          <h2 className="mt-1 font-sans text-base font-semibold tracking-tight text-[color:var(--foreground)]">
            {totalChanged === 0
              ? "Identical portfolio"
              : `${totalChanged} position${totalChanged === 1 ? "" : "s"} changed`}
          </h2>
        </div>
        <Link
          href={`/runs/${baselineRunId}`}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)] underline-offset-4 hover:text-[color:var(--foreground)] hover:underline"
        >
          {dateTime.format(new Date(baselineStartedAt))} →
        </Link>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4">
        <DiffStat label="Added" glyph="+" count={diff.added.length} />
        <DiffStat label="Removed" glyph="−" count={diff.removed.length} />
        <DiffStat label="Reweighted" glyph="↕" count={diff.reweighted.length} />
        <DiffStat label="Unchanged" glyph="=" count={diff.unchanged.length} />
      </div>

      {diff.added.length + diff.removed.length + diff.reweighted.length > 0 ? (
        <div className="border-t border-[color:var(--border)]">
          {diff.added.length > 0 ? (
            <DiffSection title="Added to this run" glyph="+">
              {diff.added.slice(0, 6).map(entry => (
                <li
                  key={entry.ticker}
                  className="flex items-baseline justify-between gap-3 font-mono text-xs"
                >
                  <span className="truncate text-[color:var(--foreground)]">
                    <span className="font-semibold">{entry.ticker}</span>
                    {entry.companyName ? (
                      <span className="ml-2 font-normal text-[color:var(--muted-foreground)]">
                        {entry.companyName}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-[color:var(--foreground)]">
                    +{money.format(entry.currentAmount)}
                  </span>
                </li>
              ))}
              {diff.added.length > 6 ? (
                <li className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  +{diff.added.length - 6} more
                </li>
              ) : null}
            </DiffSection>
          ) : null}

          {diff.removed.length > 0 ? (
            <DiffSection title="Removed from this run" glyph="−">
              {diff.removed.slice(0, 6).map(entry => (
                <li
                  key={entry.ticker}
                  className="flex items-baseline justify-between gap-3 font-mono text-xs"
                >
                  <span className="truncate text-[color:var(--muted-foreground)]">
                    <span className="font-semibold text-[color:var(--foreground)]">
                      {entry.ticker}
                    </span>
                    {entry.companyName ? (
                      <span className="ml-2">{entry.companyName}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-[color:var(--muted-foreground)]">
                    −{money.format(entry.baselineAmount)}
                  </span>
                </li>
              ))}
              {diff.removed.length > 6 ? (
                <li className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  +{diff.removed.length - 6} more
                </li>
              ) : null}
            </DiffSection>
          ) : null}

          {diff.reweighted.length > 0 ? (
            <DiffSection title="Biggest reweights" glyph="↕">
              {diff.reweighted.slice(0, 6).map(entry => {
                const sign = entry.deltaAmount > 0 ? "+" : "−";
                return (
                  <li
                    key={entry.ticker}
                    className="flex items-baseline justify-between gap-3 font-mono text-xs"
                  >
                    <span className="truncate text-[color:var(--foreground)]">
                      <span className="font-semibold">{entry.ticker}</span>
                      {entry.companyName ? (
                        <span className="ml-2 font-normal text-[color:var(--muted-foreground)]">
                          {entry.companyName}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-[color:var(--foreground)]">
                      {money.format(entry.baselineAmount)} → {money.format(entry.currentAmount)}{" "}
                      <span className="text-[color:var(--muted-foreground)]">
                        ({sign}
                        {money.format(Math.abs(entry.deltaAmount))})
                      </span>
                    </span>
                  </li>
                );
              })}
              {diff.reweighted.length > 6 ? (
                <li className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  +{diff.reweighted.length - 6} more
                </li>
              ) : null}
            </DiffSection>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DiffStat({
  label,
  glyph,
  count,
}: {
  label: string;
  glyph: string;
  count: number;
}) {
  return (
    <div className="flex flex-col gap-1 bg-[color:var(--background)] px-5 py-4 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-[color:var(--border)]">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p className="font-mono text-lg font-semibold text-[color:var(--foreground)] tabular-nums">
        <span aria-hidden className="mr-2 text-[color:var(--muted-foreground)]">
          {glyph}
        </span>
        {count}
      </p>
    </div>
  );
}

function DiffSection({
  title,
  glyph,
  children,
}: {
  title: string;
  glyph: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[color:var(--border)] px-5 py-4 first:border-t-0">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        <span aria-hidden className="mr-2 text-[color:var(--foreground)]">
          {glyph}
        </span>
        {title}
      </p>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  );
}
