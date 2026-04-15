import { api } from "../convex/_generated/api";
import { getConvexClient } from "./convex-client";
import type { AutoresearchSession } from "./autoresearch-session";
import { composeSystemPrompt } from "./autoresearch-ledger";
import type { RuleEntry } from "./autoresearch-ledger";

// Read-only view loader for the autoresearch index page. Data comes from
// Convex queries in a single parallel fetch.

export interface ChampionScoreView {
  score: number;
  iteration: number;
  publicAgentVersion: string | null;
  updatedAt: string;
}

export interface ChampionPromptView {
  // Composed system prompt the next iteration would run with — BASE prompt
  // plus every rule the outer loop has confirmed as an improvement.
  composed: string;
  rules: RuleEntry[];
}

export interface AutoresearchIndexState {
  championScore: ChampionScoreView;
  championPrompt: ChampionPromptView;
  sessions: AutoresearchSession[];
}

export async function loadAutoresearchIndexState(): Promise<AutoresearchIndexState> {
  const client = getConvexClient();
  const [champion, sessions, rules] = await Promise.all([
    client.query(api.autoresearch.getChampion, {}),
    client.query(api.autoresearch.listSessions, {}),
    client.query(api.autoresearch.loadRules, {}),
  ]);

  const sessionsView = sessions as unknown as AutoresearchSession[];

  const championView: ChampionScoreView = {
    score: (champion as ChampionScoreView)?.score ?? 0,
    iteration: (champion as ChampionScoreView)?.iteration ?? 0,
    publicAgentVersion:
      (champion as ChampionScoreView)?.publicAgentVersion ?? null,
    updatedAt:
      (champion as ChampionScoreView)?.updatedAt ?? new Date(0).toISOString(),
  };

  const rulesTyped = rules as unknown as RuleEntry[];

  return {
    championScore: championView,
    championPrompt: {
      composed: composeSystemPrompt(rulesTyped),
      rules: rulesTyped,
    },
    sessions: sessionsView,
  };
}
