import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";
import { estimateHaikuCostUsd } from "./autoresearch-cost";
import type { LedgerEntry, RuleEntry } from "./autoresearch-ledger";

// Append-only rule mutator. Given the current rule set and the recent
// experiment history, ask Haiku to propose ONE new strategy rule (1-2
// sentences) that might lift the leaderboard score.
//
// The mutator never touches the base system prompt. It only produces a
// rule string that gets appended to the rules list. This makes drift
// impossible — the base prompt's hard constraints are protected no matter
// what the mutator says.

const MUTATOR_MODEL = "claude-haiku-4-5";

const MUTATOR_SYSTEM_PROMPT = `
You are the curator of a self-improving financial research agent's strategy
playbook. Each iteration you propose ONE new strategy rule that might lift
the agent's leaderboard score on a NASDAQ portfolio-building task.

Output format — exactly one JSON object:

  { "rule": "<your one- or two-sentence strategy rule here>" }

Hard constraints the rule MUST respect (never violate, never contradict):
  - at least 50 distinct NASDAQ tickers
  - each position >= $5,000
  - total invested == exactly $1,000,000
  - no duplicate tickers
  - no use of market data, prices, or events after 2025-04-15
  - Cala entity UUIDs must be used for citations
  - structured output schema is preserved
  - the primary alpha thesis is fixed: favor low or improving filing-linked
    legal-entity complexity
  - executive changes, corporate events, regulatory context, supply-chain
    context, and financial metrics may only act as tie-breakers or risk notes

Each experiment in the history shows: score, % delta vs the champion at that
time, and whether it was kept or discarded. Use these signals:
  - If many recent iterations are close to the champion (e.g. -0.5% to -2%),
    the current ruleset is nearly optimal — propose FINE-GRAINED refinements
    (tie-breaker adjustments, edge-case handling, small threshold tweaks).
  - If recent iterations are far below the champion (e.g. -10% or worse),
    a recent rule may be actively hurting — propose REMOVING or REVERSING
    the most recently added rule, or try a fundamentally different angle.
  - If scores are volatile (some +2%, some -8%), the ranking is unstable —
    propose rules that STABILIZE selection (e.g. minimum filing recency,
    minimum subsidiary count threshold, exclude micro-caps).
  - Pay attention to which proposed rules were followed by score improvements
    vs drops — learn from the pattern.

Good rules:
  - Concrete ("ignore complexity changes smaller than 10% of prior subsidiary
    count so tiny Exhibit 21 diffs do not dominate the ranking")
  - Actionable during research (not post-hoc)
  - Narrow the existing thesis instead of replacing it
  - Improve scoring, exclusions, tie-breaks, or temporal discipline inside the
    filings/entity-complexity framework
  - Orthogonal to rules already in the playbook

Bad rules:
  - Restate a hard constraint
  - Generic advice ("be careful", "do good research")
  - Reference specific tickers, companies, or sectors by name
  - Invent a new primary signal family
  - Contradict an existing rule (unless the history shows that rule failed)

Output ONLY the JSON object. No preamble, no explanation, no markdown fences.
`.trim();

const ruleResponseSchema = z.object({
  rule: z.string().min(10).max(400),
});

export interface MutationResult {
  rule: string;
  costUsd: number;
}

function formatHistory(entries: LedgerEntry[]): string {
  if (entries.length === 0) return "(no prior experiments yet)";
  return entries
    .map(e => {
      const score = e.score != null ? `$${e.score.toLocaleString()}` : "skipped";
      const kept = e.kept ? "KEPT" : "discarded";
      const rule = e.proposedRule ? `\n       rule: ${e.proposedRule}` : "";
      let delta = "";
      if (e.score != null && e.championScoreAtStart > 0) {
        const pct = ((e.score - e.championScoreAtStart) / e.championScoreAtStart) * 100;
        delta = ` (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% vs champion $${e.championScoreAtStart.toLocaleString()})`;
      }
      const skip = e.skipReason ? `\n       reason: ${e.skipReason}` : "";
      return `  #${e.iteration} — ${score}${delta} [${kept}]${rule}${skip}`;
    })
    .join("\n");
}

function formatRules(rules: RuleEntry[]): string {
  if (rules.length === 0) return "(none yet — you're proposing the first rule)";
  return rules.map((r, i) => `  ${i + 1}. ${r.text}`).join("\n");
}

// Parse the model's output. The system prompt asks for a strict JSON object
// but Haiku is chatty — we extract the first {...} block and validate with
// zod, so we tolerate extra preamble or markdown fences.
function extractRule(raw: string): string | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = ruleResponseSchema.parse(JSON.parse(match[0]));
    return parsed.rule.trim();
  } catch {
    return null;
  }
}

export async function proposeRule(
  currentRules: RuleEntry[],
  championScore: number,
  history: LedgerEntry[],
): Promise<MutationResult | null> {
  const userMessage = [
    `## Current champion score`,
    championScore > 0 ? `$${championScore.toLocaleString()}` : "no scored submissions yet",
    "",
    "## Rules currently in the playbook",
    formatRules(currentRules),
    "",
    "## Recent experiments (most recent last)",
    formatHistory(history),
    "",
    "Propose ONE new rule. Output only the JSON object.",
  ].join("\n");

  const result = await generateText({
    model: anthropic(MUTATOR_MODEL),
    system: MUTATOR_SYSTEM_PROMPT,
    prompt: userMessage,
  });

  const rule = extractRule(result.text);
  if (!rule) {
    return null;
  }
  return {
    rule,
    costUsd: estimateHaikuCostUsd(result.usage),
  };
}
