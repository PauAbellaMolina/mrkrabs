import type { CalaAgentResult } from "./cala-agent";

// A portfolio diff that lets us highlight what changed between two runs.
// We treat the ticker as the identity key and compute (added, removed,
// unchanged, reweighted) buckets. Allocation deltas are absolute dollars.

export type RunDiffEntry = {
  ticker: string;
  companyName?: string;
  baselineAmount: number; // 0 if added
  currentAmount: number; // 0 if removed
  deltaAmount: number; // current - baseline
};

export type RunDiff = {
  added: RunDiffEntry[]; // in current, not in baseline
  removed: RunDiffEntry[]; // in baseline, not in current
  reweighted: RunDiffEntry[]; // in both, different amount
  unchanged: RunDiffEntry[]; // in both, same amount
  totals: {
    currentTotal: number;
    baselineTotal: number;
    deltaTotal: number;
  };
};

type PositionLike = {
  nasdaqCode: string;
  companyName: string;
  amount: number;
};

function positionsOf(result: CalaAgentResult | undefined): PositionLike[] {
  return result?.output.positions ?? [];
}

export function diffRuns(
  current: CalaAgentResult | undefined,
  baseline: CalaAgentResult | undefined,
): RunDiff {
  const currentMap = new Map<string, PositionLike>();
  for (const position of positionsOf(current)) {
    currentMap.set(position.nasdaqCode, position);
  }

  const baselineMap = new Map<string, PositionLike>();
  for (const position of positionsOf(baseline)) {
    baselineMap.set(position.nasdaqCode, position);
  }

  const added: RunDiffEntry[] = [];
  const removed: RunDiffEntry[] = [];
  const reweighted: RunDiffEntry[] = [];
  const unchanged: RunDiffEntry[] = [];

  for (const [ticker, position] of currentMap) {
    const baselinePosition = baselineMap.get(ticker);
    if (!baselinePosition) {
      added.push({
        ticker,
        companyName: position.companyName,
        baselineAmount: 0,
        currentAmount: position.amount,
        deltaAmount: position.amount,
      });
      continue;
    }
    const deltaAmount = position.amount - baselinePosition.amount;
    const entry: RunDiffEntry = {
      ticker,
      companyName: position.companyName,
      baselineAmount: baselinePosition.amount,
      currentAmount: position.amount,
      deltaAmount,
    };
    if (deltaAmount === 0) {
      unchanged.push(entry);
    } else {
      reweighted.push(entry);
    }
  }

  for (const [ticker, position] of baselineMap) {
    if (!currentMap.has(ticker)) {
      removed.push({
        ticker,
        companyName: position.companyName,
        baselineAmount: position.amount,
        currentAmount: 0,
        deltaAmount: -position.amount,
      });
    }
  }

  added.sort((a, b) => b.currentAmount - a.currentAmount);
  removed.sort((a, b) => b.baselineAmount - a.baselineAmount);
  reweighted.sort((a, b) => Math.abs(b.deltaAmount) - Math.abs(a.deltaAmount));

  const currentTotal = positionsOf(current).reduce((sum, p) => sum + p.amount, 0);
  const baselineTotal = positionsOf(baseline).reduce((sum, p) => sum + p.amount, 0);

  return {
    added,
    removed,
    reweighted,
    unchanged,
    totals: {
      currentTotal,
      baselineTotal,
      deltaTotal: currentTotal - baselineTotal,
    },
  };
}

// Per-ticker marker used by the positions table when a baseline exists.
// "new" = not in baseline, "removed" = in baseline only, "up"/"down" = reweight,
// "flat" = unchanged, null = no baseline to compare against.
export type DiffMarker = "new" | "removed" | "up" | "down" | "flat" | null;

export function buildDiffMarkerMap(
  current: CalaAgentResult | undefined,
  baseline: CalaAgentResult | undefined,
): Map<string, DiffMarker> {
  const markers = new Map<string, DiffMarker>();
  if (!current || !baseline) return markers;

  const diff = diffRuns(current, baseline);
  for (const entry of diff.added) markers.set(entry.ticker, "new");
  for (const entry of diff.removed) markers.set(entry.ticker, "removed");
  for (const entry of diff.reweighted) {
    markers.set(entry.ticker, entry.deltaAmount > 0 ? "up" : "down");
  }
  for (const entry of diff.unchanged) markers.set(entry.ticker, "flat");
  return markers;
}
