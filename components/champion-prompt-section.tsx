import type { ChampionPromptView } from "@/lib/autoresearch-view";

type Props = {
  champion: ChampionPromptView;
};

// The composed system prompt the autoresearch outer loop has converged on:
// BASE + every rule a winning iteration added. Shown in two panels:
// (1) the rules list — the actual delta autoresearch produces; (2) the
// full composed prompt, collapsed by default since it's long.
export function ChampionPromptSection({ champion }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {champion.rules.length === 0 ? (
        <div className="border border-dashed border-[color:var(--border)] px-6 py-8 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            No winning rules yet
          </p>
          <p className="mt-3 font-mono text-[11px] text-[color:var(--foreground)]">
            The first session runs the BASE prompt verbatim to establish a
            baseline. Iterations 2+ propose rules; only rules that beat the
            champion score are kept.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col border border-[color:var(--border)] bg-[color:var(--surface)]">
          {champion.rules.map((rule, idx) => (
            <li
              key={`${rule.addedAtIteration}-${idx}`}
              className={
                "flex flex-col gap-1 px-5 py-4 " +
                (idx === champion.rules.length - 1
                  ? ""
                  : "border-b border-[color:var(--border)]")
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                  Rule {idx + 1}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  added at iteration {rule.addedAtIteration}
                </span>
              </div>
              <p className="font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
                {rule.text}
              </p>
            </li>
          ))}
        </ol>
      )}

      <details className="group border border-[color:var(--border)]">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]">
          <span>Expand composed prompt (BASE + rules)</span>
          <span
            aria-hidden
            className="text-[color:var(--muted-foreground)] group-open:hidden"
          >
            +
          </span>
          <span
            aria-hidden
            className="hidden text-[color:var(--muted-foreground)] group-open:inline"
          >
            −
          </span>
        </summary>
        <pre className="max-h-[60vh] overflow-auto border-t border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[color:var(--foreground)]">
          {champion.composed}
        </pre>
      </details>
    </div>
  );
}
