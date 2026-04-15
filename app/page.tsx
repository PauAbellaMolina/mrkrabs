import Link from "next/link";
import { NewRunForm } from "@/components/new-run-form";
import {
  HybridRunsHeaderStats,
  HybridRunsList,
} from "@/components/hybrid-runs-list";
import { listRunSummaries } from "@/lib/agent-runs";
import { PUBLIC_AUTORESEARCH_AGENT_NAME } from "@/lib/agent-version";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Autoresearch iterations live on their own page — the home list only
  // surfaces manual "Run agent" executions so the two flows don't tangle.
  const allRuns = await listRunSummaries();
  const serverRuns = allRuns.filter(
    run => run.agentName !== PUBLIC_AUTORESEARCH_AGENT_NAME,
  );

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-10 px-6 py-10">
      <header className="border-b border-[color:var(--border)] pb-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--muted-foreground)]">
                Cala · Lobster of Wall Street
              </p>
              <span aria-hidden className="text-[10px] text-[color:var(--muted-foreground)]">
                ·
              </span>
              <Link
                href="/autoresearch"
                className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
              >
                Autoresearch →
              </Link>
            </div>
            <h1 className="mt-3 font-sans text-4xl font-semibold tracking-tight text-[color:var(--foreground)] sm:text-5xl">
              mrkrabs
            </h1>
            <p className="mt-4 max-w-[64ch] text-sm leading-relaxed text-[color:var(--muted-foreground)]">
              An AI agent that allocates $1,000,000 across ≥50 NASDAQ-listed
              companies on 2025-04-15, reasoning over Cala&rsquo;s verified
              knowledge graph. The agent now finalizes a validated portfolio
              draft locally; leaderboard submission remains a separate manual
              step. The list below shows exactly where each run stands.
            </p>
          </div>
          <HybridRunsHeaderStats serverRuns={serverRuns} />
        </div>
      </header>

      <NewRunForm />

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--muted-foreground)]">
              Agent runs
            </p>
            <h2 className="mt-2 font-sans text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
              Execution history
            </h2>
          </div>
        </div>

        <HybridRunsList serverRuns={serverRuns} emptyState={<EmptyState />} />
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-[color:var(--border)] px-6 py-16 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        No runs yet
      </p>
      <p className="mt-4 font-sans text-sm text-[color:var(--foreground)]">
        Click <span className="font-mono font-semibold">Run agent</span> above
        to start the research loop, or open{" "}
        <span className="font-mono font-semibold">Mission Control</span> in the
        top-right corner and seed mock fixtures for UI iteration.
      </p>
      <p className="mt-2 font-mono text-[10px] text-[color:var(--muted-foreground)]">
        entity_search → entity_introspection → retrieve_entity →
        finalize_portfolio
      </p>
    </div>
  );
}
