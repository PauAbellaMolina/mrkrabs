import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BASE_SYSTEM_PROMPT } from "./cala-agent";

// Autoresearch state lives in .data/autoresearch/:
//   rules.json          — accumulated strategy rules (append-only playbook,
//                         capped at MAX_RULES; oldest drop when full)
//   champion-score.json — the best total_value we've seen so far
//   ledger.jsonl        — per-experiment outcome log (append-only)
//   spent.json          — cumulative Anthropic spend for budget enforcement
//
// The base system prompt in `lib/cala-agent.ts` never changes — the mutator
// can only APPEND rules to the end. This makes drift impossible: the hard
// constraints (≥50 tickers, $5k floor, exactly $1M, no post-cutoff data,
// structured output schema) are protected regardless of what the mutator
// says.

const AUTORESEARCH_DIR = path.join(process.cwd(), ".data", "autoresearch");
const RULES_PATH = path.join(AUTORESEARCH_DIR, "rules.json");
const CHAMPION_SCORE_PATH = path.join(AUTORESEARCH_DIR, "champion-score.json");
const LEDGER_PATH = path.join(AUTORESEARCH_DIR, "ledger.jsonl");
const SPENT_PATH = path.join(AUTORESEARCH_DIR, "spent.json");

// Cap on accumulated rules. Kept intentionally small so the system prompt
// stays focused and tokens stay cheap. Oldest drops when the cap is reached.
export const MAX_RULES = 8;

export interface RuleEntry {
  text: string;
  addedAtIteration: number;
  addedAt: string;
}

export interface LedgerEntry {
  iteration: number;
  ranAt: string;
  runId: string;
  publicAgentVersion: string | null;
  score: number | null;              // total_value from the Cala submit response
  championScoreAtStart: number;
  kept: boolean;                     // true if this variant became the new champion
  skipReason?: string;
  estimatedCostUsd: number;
  proposedRule?: string;             // the rule the mutator proposed this iteration
  rulesInEffect: number;             // how many rules were in play for this run
}

export interface ChampionScore {
  score: number;
  iteration: number;
  publicAgentVersion: string | null;
  updatedAt: string;
}

async function ensureDir() {
  await mkdir(AUTORESEARCH_DIR, { recursive: true });
}

export async function loadRules(): Promise<RuleEntry[]> {
  try {
    const raw = await readFile(RULES_PATH, "utf8");
    const parsed = JSON.parse(raw) as { rules?: RuleEntry[] };
    if (Array.isArray(parsed.rules)) return parsed.rules;
  } catch {
    // no rules yet
  }
  return [];
}

export async function writeRules(rules: RuleEntry[]): Promise<void> {
  await ensureDir();
  await writeFile(RULES_PATH, JSON.stringify({ rules }, null, 2), "utf8");
}

// Compose the full system prompt: base verbatim, plus accumulated rules if
// there are any. When `rules` is empty we return the base alone.
export function composeSystemPrompt(rules: RuleEntry[]): string {
  if (rules.length === 0) return BASE_SYSTEM_PROMPT;
  const rulesBlock = rules
    .map((rule, i) => `  ${i + 1}. ${rule.text}`)
    .join("\n");
  return (
    BASE_SYSTEM_PROMPT +
    `\n\n## Accumulated strategy rules (from autoresearch)\n${rulesBlock}`
  );
}

export async function appendRule(
  rule: Omit<RuleEntry, "addedAt">,
): Promise<RuleEntry[]> {
  const current = await loadRules();
  const next: RuleEntry = { ...rule, addedAt: new Date().toISOString() };
  const updated = [...current, next];
  // Cap: drop oldest when full.
  const trimmed =
    updated.length > MAX_RULES ? updated.slice(updated.length - MAX_RULES) : updated;
  await writeRules(trimmed);
  return trimmed;
}

export async function loadChampionScore(): Promise<ChampionScore> {
  try {
    const raw = await readFile(CHAMPION_SCORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChampionScore>;
    if (typeof parsed.score === "number") {
      return {
        score: parsed.score,
        iteration: parsed.iteration ?? 0,
        publicAgentVersion: parsed.publicAgentVersion ?? null,
        updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      };
    }
  } catch {
    // no champion yet
  }
  return {
    score: 0,
    iteration: 0,
    publicAgentVersion: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function writeChampionScore(score: ChampionScore): Promise<void> {
  await ensureDir();
  await writeFile(CHAMPION_SCORE_PATH, JSON.stringify(score, null, 2), "utf8");
}

export async function appendLedgerEntry(entry: LedgerEntry): Promise<void> {
  await ensureDir();
  await appendFile(LEDGER_PATH, JSON.stringify(entry) + "\n", "utf8");
}

export async function loadRecentLedgerEntries(limit = 5): Promise<LedgerEntry[]> {
  try {
    const raw = await readFile(LEDGER_PATH, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-limit);
    return recent.map(line => JSON.parse(line) as LedgerEntry);
  } catch {
    return [];
  }
}

export async function loadSpentUsd(): Promise<number> {
  try {
    const raw = await readFile(SPENT_PATH, "utf8");
    const parsed = JSON.parse(raw) as { spentUsd?: number };
    return typeof parsed.spentUsd === "number" ? parsed.spentUsd : 0;
  } catch {
    return 0;
  }
}

export async function addSpentUsd(delta: number): Promise<number> {
  const current = await loadSpentUsd();
  const next = current + delta;
  await ensureDir();
  await writeFile(SPENT_PATH, JSON.stringify({ spentUsd: next }, null, 2), "utf8");
  return next;
}
