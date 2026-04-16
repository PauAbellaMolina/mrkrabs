import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PortfolioOutput, PortfolioPosition } from "./portfolio-schema";

// MRKRABS_BASELINE=1 mode: locks 45 tickers to a verified prior submission,
// asks the agent to only research + pick 5 more. Real leaderboard
// submission (all 50 tickers shipped), but iteration time drops ~90% since
// the agent skips the bulk of the research loop.
//
// Turn on by setting MRKRABS_BASELINE=1 when spawning an autoresearch
// session or a manual run.

const BASELINE_FILE = path.join(process.cwd(), "data", "portfolio-base.json");
const BASELINE_ENV_FLAG = "MRKRABS_BASELINE";
const REQUIRED_PORTFOLIO_BUDGET = 1_000_000;
const REQUIRED_POSITION_COUNT = 50;

interface BaselineFile {
  description: string;
  tickers: string[];
  amountPerTickerUsd: number;
}

export function isBaselineMode(): boolean {
  const v = process.env[BASELINE_ENV_FLAG];
  return v === "1" || v === "true";
}

let cachedBaseline: BaselineFile | null = null;

function loadBaseline(): BaselineFile {
  if (cachedBaseline) return cachedBaseline;
  const raw = readFileSync(BASELINE_FILE, "utf8");
  const parsed = JSON.parse(raw) as BaselineFile;
  const uniqueUpper = Array.from(
    new Set(parsed.tickers.map(t => t.trim().toUpperCase())),
  ).filter(Boolean);
  cachedBaseline = { ...parsed, tickers: uniqueUpper };
  return cachedBaseline;
}

export function baselineTickers(): string[] {
  return loadBaseline().tickers.slice();
}

export function baselineSize(): number {
  return loadBaseline().tickers.length;
}

export function baselineAmountPerTicker(): number {
  return loadBaseline().amountPerTickerUsd;
}

export function remainingPickCount(): number {
  return REQUIRED_POSITION_COUNT - baselineSize();
}

export function remainingAmountPerPick(): number {
  const remainingSlots = remainingPickCount();
  if (remainingSlots <= 0) {
    throw new Error(
      `Baseline has ${baselineSize()} tickers, leaving no slots for new picks.`,
    );
  }
  const remainingBudget =
    REQUIRED_PORTFOLIO_BUDGET - baselineSize() * baselineAmountPerTicker();
  return Math.floor(remainingBudget / remainingSlots);
}

// Injected into the system prompt so the agent knows (a) which tickers are
// locked, (b) how many new picks to make, (c) at what amount each.
export function buildBaselinePromptBlock(): string {
  const b = loadBaseline();
  const totalLocked = b.tickers.length * b.amountPerTickerUsd;
  const count = remainingPickCount();
  const perPick = remainingAmountPerPick();
  const rows: string[] = [];
  for (let i = 0; i < b.tickers.length; i += 10) {
    rows.push("  " + b.tickers.slice(i, i + 10).join(", "));
  }
  return [
    "",
    "=== BASELINE PORTFOLIO (FIXED — DO NOT MODIFY OR RESEARCH) ===",
    `${b.tickers.length} NASDAQ tickers are already locked in your portfolio at $${b.amountPerTickerUsd.toLocaleString()} each ($${totalLocked.toLocaleString()} total). They will be merged into your final submission automatically; do NOT include them in your submit_portfolio call, do NOT research them.`,
    "",
    "Locked tickers (FORBIDDEN as new picks):",
    ...rows,
    "",
    "=== YOUR TASK ===",
    `Research and pick EXACTLY ${count} ADDITIONAL NASDAQ tickers that are NOT in the locked list above. Each new pick must be allocated exactly $${perPick.toLocaleString()}.`,
    "Apply the Legal-Entity Focus thesis rigorously to these new picks only.",
    `Your submit_portfolio call must contain exactly ${count} positions — the locked ${b.tickers.length} will be merged in server-side.`,
    "",
    "Valid NASDAQ tickers that are NOT yet in the baseline (you can pick from these or any other verified NASDAQ-listed common stock):",
    "  SMCI, SNOW, SNPS, TXN, VRTX, WDAY, ZS",
    "(These are suggestions from a prior successful submission — you are free to research other NASDAQ-listed tickers if the filing-linked complexity thesis points elsewhere.)",
  ].join("\n");
}

function buildBaselinePositions(): PortfolioPosition[] {
  const b = loadBaseline();
  return b.tickers.map(ticker => ({
    nasdaqCode: ticker,
    companyName: ticker,
    companyEntityId: randomUUID(),
    amount: b.amountPerTickerUsd,
    thesis:
      "Pre-verified baseline holding carried forward from a prior leaderboard submission; full per-ticker research was intentionally skipped in BASELINE test mode.",
    currentAnnualFilingDate: "2025-01-01",
    priorAnnualFilingDate: null,
    subsidiaryCount: 0,
    jurisdictionCount: 0,
    hierarchyDepth: 0,
    complexityScore: 0,
    complexityChangeVsPrior: null,
    calaEvidence: [
      "Baseline pick from prior verified submission; Cala research skipped in BASELINE mode.",
    ],
    supportingEntityIds: [],
    riskNotes: [
      "Baseline — per-ticker research intentionally skipped in BASELINE mode.",
    ],
    cutoffComplianceNote:
      "Baseline picks carry forward from a previous submission; no post-cutoff reasoning was applied.",
  }));
}

function buildBaselineTransactions(): Array<{
  nasdaq_code: string;
  amount: number;
}> {
  const b = loadBaseline();
  return b.tickers.map(ticker => ({
    nasdaq_code: ticker,
    amount: b.amountPerTickerUsd,
  }));
}

// Extends an agent-produced portfolio (10 positions) with the locked 40 to
// produce a full 50-ticker payload. validatePortfolioOutput runs on the
// result, catching any duplicate tickers between the agent's picks and the
// baseline automatically.
export function mergeWithBaseline(agentOutput: PortfolioOutput): PortfolioOutput {
  return {
    ...agentOutput,
    positions: [...agentOutput.positions, ...buildBaselinePositions()],
    submissionPayload: {
      ...agentOutput.submissionPayload,
      transactions: [
        ...agentOutput.submissionPayload.transactions,
        ...buildBaselineTransactions(),
      ],
    },
  };
}
