// Rough Claude Haiku 4.5 pricing (per-million tokens). Authoritative source
// is the Anthropic dashboard — these are conservative and only used locally
// by the autoresearch loop to enforce the hard budget cap.
const HAIKU_INPUT_USD_PER_MTOK = 1.0;
const HAIKU_OUTPUT_USD_PER_MTOK = 5.0;

export interface TokenUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export function estimateHaikuCostUsd(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as TokenUsageLike;
  const input = typeof u.inputTokens === "number" ? u.inputTokens : 0;
  const output = typeof u.outputTokens === "number" ? u.outputTokens : 0;
  return (input * HAIKU_INPUT_USD_PER_MTOK) / 1_000_000 +
    (output * HAIKU_OUTPUT_USD_PER_MTOK) / 1_000_000;
}

export function getBudgetCapUsd(): number {
  const raw = process.env.AUTORESEARCH_BUDGET_USD;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 50;
}
