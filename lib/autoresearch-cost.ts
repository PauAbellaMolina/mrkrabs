// Rough Anthropic pricing (USD per million tokens). Authoritative source is
// the Anthropic dashboard — these are conservative and only used locally by
// the autoresearch loop to enforce the hard budget cap.
const ANTHROPIC_PRICING: Record<
  string,
  { input: number; output: number }
> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
};

const DEFAULT_PRICING = ANTHROPIC_PRICING["claude-haiku-4-5"];

export interface TokenUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export function estimateAnthropicCostUsd(
  usage: unknown,
  modelId: string,
): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as TokenUsageLike;
  const pricing = ANTHROPIC_PRICING[modelId] ?? DEFAULT_PRICING;
  const input = typeof u.inputTokens === "number" ? u.inputTokens : 0;
  const output = typeof u.outputTokens === "number" ? u.outputTokens : 0;
  return (input * pricing.input) / 1_000_000 +
    (output * pricing.output) / 1_000_000;
}

// Back-compat shim for callers that still assume Haiku pricing (the mutator
// loop estimates its own cost separately using Haiku even when the main
// agent runs on a pricier model).
export function estimateHaikuCostUsd(usage: unknown): number {
  return estimateAnthropicCostUsd(usage, "claude-haiku-4-5");
}

export function getBudgetCapUsd(): number {
  const raw = process.env.AUTORESEARCH_BUDGET_USD;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 50;
}
