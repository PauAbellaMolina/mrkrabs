import { readFile } from "node:fs/promises";
import path from "node:path";

// Read-only view loaders for the autoresearch outer loop. Deliberately
// decoupled from `lib/autoresearch-ledger.ts` so the web UI can render
// state without pulling in the mutator / agent import chain (which
// currently depends on an export that doesn't exist yet).

const AUTORESEARCH_DIR = path.join(process.cwd(), ".data", "autoresearch");
const CHAMPION_PATH = path.join(AUTORESEARCH_DIR, "champion.md");
const CHAMPION_SCORE_PATH = path.join(AUTORESEARCH_DIR, "champion-score.json");
const LEDGER_PATH = path.join(AUTORESEARCH_DIR, "ledger.jsonl");
const SPENT_PATH = path.join(AUTORESEARCH_DIR, "spent.json");

const DEFAULT_BUDGET_USD = 50;

export interface LedgerEntryView {
  iteration: number;
  ranAt: string;
  runId: string;
  publicAgentVersion: string | null;
  score: number | null;
  championScoreAtStart: number;
  kept: boolean;
  skipReason?: string;
  estimatedCostUsd: number;
  mutationSummary?: string;
}

export interface ChampionScoreView {
  score: number;
  iteration: number;
  publicAgentVersion: string | null;
  updatedAt: string;
}

export interface AutoresearchState {
  championScore: ChampionScoreView;
  championPrompt: string | null;
  ledger: LedgerEntryView[];
  spentUsd: number;
  budgetCapUsd: number;
  isLive: boolean;
}

function getBudgetCapUsd(): number {
  const raw = process.env.AUTORESEARCH_BUDGET_USD;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_BUDGET_USD;
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function emptyChampionScore(): ChampionScoreView {
  return {
    score: 0,
    iteration: 0,
    publicAgentVersion: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function parseChampionScore(raw: string | null): ChampionScoreView {
  if (!raw) return emptyChampionScore();
  try {
    const parsed = JSON.parse(raw) as Partial<ChampionScoreView>;
    return {
      score: typeof parsed.score === "number" ? parsed.score : 0,
      iteration: typeof parsed.iteration === "number" ? parsed.iteration : 0,
      publicAgentVersion: parsed.publicAgentVersion ?? null,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return emptyChampionScore();
  }
}

function parseLedger(raw: string | null, limit: number): LedgerEntryView[] {
  if (!raw) return [];
  const lines = raw.trim().split("\n").filter(Boolean);
  const recent = lines.slice(-limit);
  const out: LedgerEntryView[] = [];
  for (const line of recent) {
    try {
      out.push(JSON.parse(line) as LedgerEntryView);
    } catch {
      // skip malformed row
    }
  }
  return out;
}

function parseSpent(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { spentUsd?: number };
    return typeof parsed.spentUsd === "number" ? parsed.spentUsd : 0;
  } catch {
    return 0;
  }
}

export async function loadAutoresearchState(
  ledgerLimit = 50,
): Promise<AutoresearchState> {
  const [championRaw, scoreRaw, ledgerRaw, spentRaw] = await Promise.all([
    readOptional(CHAMPION_PATH),
    readOptional(CHAMPION_SCORE_PATH),
    readOptional(LEDGER_PATH),
    readOptional(SPENT_PATH),
  ]);

  return {
    championScore: parseChampionScore(scoreRaw),
    championPrompt: championRaw,
    ledger: parseLedger(ledgerRaw, ledgerLimit),
    spentUsd: parseSpent(spentRaw),
    budgetCapUsd: getBudgetCapUsd(),
    isLive:
      championRaw !== null ||
      scoreRaw !== null ||
      ledgerRaw !== null ||
      spentRaw !== null,
  };
}
