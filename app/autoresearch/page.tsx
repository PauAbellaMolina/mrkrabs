import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { RefreshButton } from "@/components/refresh-button";
import { AutoresearchTrigger } from "@/components/autoresearch-trigger";
import { AutoresearchSessionRow } from "@/components/autoresearch-session-row";
import { ChampionPromptSection } from "@/components/champion-prompt-section";
import {
  loadAutoresearchIndexState,
  type AutoresearchIndexState,
  type ChampionScoreView,
} from "@/lib/autoresearch-view";

export const dynamic = "force-dynamic";

export default async function AutoresearchPage() {
  const state = await loadAutoresearchIndexState();
  const hasRunning = state.sessions.some(s => s.status === "running");

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-10 px-6 py-10">
      <AutoRefresh enabled={hasRunning} intervalMs={5000} />
      <header className="border-b border-[color:var(--border)] pb-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
              >
                ← mrkrabs
              </Link>
              <RefreshButton />
            </div>
            <h1 className="mt-3 font-sans text-4xl font-semibold tracking-tight text-[color:var(--foreground)] sm:text-5xl">
              Autoresearch
            </h1>
            <p className="mt-4 max-w-[64ch] text-sm leading-relaxed text-[color:var(--muted-foreground)]">
              An outer loop mutates the champion system prompt, runs the agent,
              submits to the leaderboard, and only keeps variants whose score
              beats the incumbent. Each &ldquo;Run iterations&rdquo; click
              spawns one session; click any session to drill into its
              iterations.
            </p>
          </div>
          <ChampionBadge state={state} />
        </div>
      </header>

      <AutoresearchTrigger />

      <section>
        <SectionHeader
          eyebrow="Sessions"
          title="Autoresearch runs"
          meta={
            state.sessions.length === 0
              ? "none yet"
              : `${state.sessions.length} total · ${state.sessions.filter(s => s.status === "running").length} running`
          }
        />
        {state.sessions.length === 0 ? (
          <div className="border border-dashed border-[color:var(--border)] px-6 py-10 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              No autoresearch runs yet
            </p>
            <p className="mt-3 font-mono text-[11px] text-[color:var(--foreground)]">
              Click{" "}
              <span className="font-semibold">New session</span> above to
              spawn your first one.
            </p>
          </div>
        ) : (
          <ol className="flex max-h-[65vh] flex-col overflow-y-auto overscroll-contain border border-[color:var(--border)]">
            {state.sessions.map((session, idx) => (
              <AutoresearchSessionRow
                key={session.sessionId}
                session={session}
                isLast={idx === state.sessions.length - 1}
              />
            ))}
          </ol>
        )}
      </section>

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--muted-foreground)]">
              Current champion
            </p>
            <h2 className="mt-2 font-sans text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
              Refined system prompt
            </h2>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            {state.championPrompt.rules.length} rule
            {state.championPrompt.rules.length === 1 ? "" : "s"} ·{" "}
            {state.championPrompt.composed.length.toLocaleString()} chars
          </p>
        </div>
        <ChampionPromptSection champion={state.championPrompt} />
      </section>
    </main>
  );
}

function ChampionBadge({ state }: { state: AutoresearchIndexState }) {
  const { championScore, sessions } = state;
  const hasScore = championScore.score > 0;
  const sessionCount = sessions.length;

  return (
    <div className="flex min-w-[240px] flex-col gap-1 border border-[color:var(--border)] px-4 py-3 text-right">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Champion
      </p>
      <p className="font-mono text-2xl tabular-nums text-[color:var(--foreground)]">
        {hasScore ? `$${championScore.score.toLocaleString()}` : "—"}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        {(championScore as ChampionScoreView).publicAgentVersion ?? "bootstrap"}
        {sessionCount > 0
          ? ` · ${sessionCount} session${sessionCount === 1 ? "" : "s"}`
          : ""}
      </p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--muted-foreground)]">
          {eyebrow}
        </p>
        <h2 className="mt-2 font-sans text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
          {title}
        </h2>
      </div>
      {meta ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          {meta}
        </p>
      ) : null}
    </div>
  );
}
