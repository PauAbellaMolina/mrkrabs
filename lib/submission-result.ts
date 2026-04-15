// Convex's /api/submit response shape isn't documented — the persisted record
// stores it as `unknown`. Rather than guessing a schema, we walk it
// defensively: pull any number-valued field whose key hints at a return /
// P&L / score, normalize to a display form, and always keep the raw JSON
// available for the details panel.
//
// Priority order matters because we surface the first match as the headline
// number. Put the strongest semantic matches first.

const HEADLINE_KEY_PRIORITY = [
  // percent / return style
  "returnPercent",
  "return_percent",
  "pnlPercent",
  "pnl_percent",
  "percentage",
  "percent",
  "totalReturn",
  "total_return",
  "return",
  "pnl",
  "delta",
  // score / rank style
  "score",
  "rank",
  // raw value style
  "finalValue",
  "final_value",
  "currentValue",
  "current_value",
  "portfolioValue",
  "portfolio_value",
];

// Any number-valued key that loosely matches one of these substrings becomes
// a secondary metric. We lowercase keys before matching.
const METRIC_KEY_HINTS = [
  "return",
  "pnl",
  "delta",
  "score",
  "rank",
  "value",
  "percent",
  "ratio",
  "sharpe",
];

export type SubmissionMetric = {
  key: string;
  label: string;
  value: number;
  // "percent" if the key hints at a ratio; "currency" if value looks like a
  // dollar amount; "number" otherwise. The display layer uses this to format.
  kind: "percent" | "currency" | "number";
};

export type ParsedSubmissionResponse = {
  headline: SubmissionMetric | null;
  metrics: SubmissionMetric[];
  // Best-effort human-readable message fields (response.message, status, etc.)
  messages: Array<{ key: string; value: string }>;
  raw: unknown;
};

function classifyKind(key: string, value: number): "percent" | "currency" | "number" {
  const lower = key.toLowerCase();
  if (
    lower.includes("percent") ||
    lower.endsWith("_percent") ||
    lower.endsWith("percent") ||
    lower.includes("ratio") ||
    lower.includes("pnl") ||
    lower.includes("return")
  ) {
    return "percent";
  }
  if (
    lower.includes("value") ||
    lower.includes("cash") ||
    lower.includes("allocated") ||
    lower.includes("balance")
  ) {
    return "currency";
  }
  // Fall back: if the number is very small (|x| <= 5) assume percent,
  // otherwise number. Return deltas from Convex could plausibly come in
  // either decimal (0.12 = 12%) or percent (12 = 12%).
  if (Math.abs(value) <= 5) return "percent";
  if (Math.abs(value) >= 1000) return "currency";
  return "number";
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());
}

function collectNumericFields(
  value: unknown,
  path: string[] = [],
  out: Array<{ key: string; path: string[]; value: number }> = [],
): Array<{ key: string; path: string[]; value: number }> {
  if (value == null) return out;
  if (typeof value === "number" && Number.isFinite(value)) {
    const key = path[path.length - 1] ?? "value";
    out.push({ key, path, value });
    return out;
  }
  if (typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectNumericFields(item, [...path, String(i)], out));
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    collectNumericFields(v, [...path, k], out);
  }
  return out;
}

function collectStringMessages(
  value: unknown,
  path: string[] = [],
  out: Array<{ key: string; value: string }> = [],
): Array<{ key: string; value: string }> {
  if (value == null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectStringMessages(item, [...path, String(i)], out));
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const currentPath = [...path, k];
    const lowerKey = k.toLowerCase();
    if (
      typeof v === "string" &&
      v.length > 0 &&
      (lowerKey === "message" ||
        lowerKey === "status" ||
        lowerKey === "state" ||
        lowerKey === "note" ||
        lowerKey === "detail" ||
        lowerKey === "error")
    ) {
      out.push({ key: currentPath.join("."), value: v });
    } else if (typeof v === "object") {
      collectStringMessages(v, currentPath, out);
    }
  }
  return out;
}

export function parseSubmissionResponse(raw: unknown): ParsedSubmissionResponse {
  const numericFields = collectNumericFields(raw);

  const metrics: SubmissionMetric[] = numericFields
    .filter(({ key }) => {
      const lower = key.toLowerCase();
      return METRIC_KEY_HINTS.some(hint => lower.includes(hint));
    })
    .map(({ key, path, value }) => ({
      key: path.join("."),
      label: humanizeKey(key),
      value,
      kind: classifyKind(key, value),
    }));

  let headline: SubmissionMetric | null = null;
  for (const candidate of HEADLINE_KEY_PRIORITY) {
    const match = metrics.find(metric => {
      const lastSegment = metric.key.split(".").pop() ?? "";
      return lastSegment === candidate;
    });
    if (match) {
      headline = match;
      break;
    }
  }
  // Fallback: if nothing matched priority keys but we have some metrics,
  // show the first one as headline so the user sees something meaningful.
  if (!headline && metrics.length > 0) {
    headline = metrics[0];
  }

  return {
    headline,
    metrics,
    messages: collectStringMessages(raw),
    raw,
  };
}

// Display formatters. Kept in this file so the UI never has to decide.
// All monochrome, no hue; up/down is communicated by leading "+" / "−".
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function formatSubmissionMetric(metric: SubmissionMetric): string {
  if (metric.kind === "percent") {
    // If the value is between -5 and 5, treat as decimal ratio (0.12 → 12%).
    const percent = Math.abs(metric.value) <= 5 ? metric.value * 100 : metric.value;
    const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
    return `${sign}${numberFormatter.format(Math.abs(percent))}%`;
  }
  if (metric.kind === "currency") {
    return currencyFormatter.format(metric.value);
  }
  return numberFormatter.format(metric.value);
}
