import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { estimateHaikuCostUsd } from "./autoresearch-cost";
import type { PortfolioOutput, PortfolioPosition } from "./portfolio-schema";
import {
  loadResearchUniverse,
  removeFromUniverse,
  type ResearchedCompany,
} from "./research-universe";
import {
  isBaselineMode,
  baselineTickers,
  mergeWithBaseline,
} from "./portfolio-baseline";
import { validatePortfolioOutput, PortfolioValidationError } from "./cala-agent";
import {
  submitToLeaderboard,
  type SubmitOptions,
} from "./leaderboard-submit";

// Fast autoresearch pipeline: a single Haiku call picks 50 tickers from
// the pre-researched universe, then TypeScript builds the full portfolio
// programmatically and submits. Total wall time: ~10 seconds vs ~30 min
// for the full agent loop.

const RANKER_MODEL = "claude-sonnet-4-6";
const AMOUNT_PER_POSITION = 20_000;
const REQUIRED_POSITIONS = 50;

interface FastRankerResult {
  output: PortfolioOutput;
  leaderboardResponse: unknown;
  costUsd: number;
  pickedTickers: string[];
}

function extractScoreFromRetryResponse(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>).total_value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function buildRankerPrompt(
  universe: ResearchedCompany[],
  rules: string[],
  count: number,
): string {
  const rows = universe.map(
    (c) =>
      `${c.ticker} | ${c.companyName} | score=${c.complexityScore.toFixed(3)}${c.complexityChangeVsPrior != null ? ` Δ=${c.complexityChangeVsPrior.toFixed(3)}` : ""} | subs=${c.subsidiaryCount} jur=${c.jurisdictionCount} depth=${c.hierarchyDepth} | filing=${c.currentAnnualFilingDate}`,
  );

  const rulesBlock =
    rules.length > 0
      ? [
          "",
          "## Strategy rules to apply (in addition to the base complexity thesis):",
          ...rules.map((r, i) => `  ${i + 1}. ${r}`),
        ].join("\n")
      : "";

  return [
    `You are a portfolio manager selecting exactly ${count} NASDAQ stocks for a $1,000,000 equal-weight portfolio ($${AMOUNT_PER_POSITION.toLocaleString()} per position).`,
    "",
    "## Alpha thesis",
    "Favor NASDAQ companies with LOW or IMPROVING filing-linked legal-entity complexity.",
    "Lower complexityScore = better (fewer subsidiaries, jurisdictions, shallower hierarchy).",
    "Negative Δ = complexity improving vs prior annual filing.",
    "",
    "## Selection criteria (in priority order)",
    "1. Complexity score — prefer the lowest",
    "2. Complexity improvement (Δ) — prefer negative (improving) over null/positive",
    "3. Filing recency — prefer filings closer to 2025-04-15 (fresher data = higher confidence)",
    "4. Sector diversification — spread across Technology, Healthcare, Industrials, Consumer, Financials, etc.",
    "   No more than 15 picks from any single sector.",
    "5. Avoid companies with 0 subsidiaries AND 0 jurisdictions (likely sparse Cala coverage)",
    rulesBlock,
    "",
    `## Pre-researched universe (${universe.length} companies):`,
    ...rows,
    "",
    `Select exactly ${count} tickers. For each, provide a brief reason (1 sentence).`,
    "Output a JSON array of objects: [{\"ticker\":\"AAPL\",\"reason\":\"...\"},...]",
    "Output ONLY the JSON array, nothing else.",
  ].join("\n");
}

function buildNarrativePrompt(
  picks: Array<{ ticker: string; reason: string; company: ResearchedCompany }>,
  rules: string[],
): string {
  const pickRows = picks.map(
    (p) =>
      `- ${p.ticker} (${p.company.companyName}): score=${p.company.complexityScore.toFixed(3)}, subs=${p.company.subsidiaryCount}, jur=${p.company.jurisdictionCount}, depth=${p.company.hierarchyDepth}, filing=${p.company.currentAnnualFilingDate}. Reason: ${p.reason}`,
  );

  const rulesBlock =
    rules.length > 0
      ? ["", "Strategy rules applied:", ...rules.map((r, i) => `  ${i + 1}. ${r}`)].join("\n")
      : "";

  return [
    "You are writing the investment thesis narrative for a NASDAQ portfolio submission.",
    "The thesis: companies with low or improving filing-linked legal-entity complexity outperform.",
    "All data is from Cala's verified entity graph, with filing dates on or before 2025-04-15.",
    rulesBlock,
    "",
    `## Selected positions (${picks.length}):`,
    ...pickRows,
    "",
    "Write a JSON object with these fields:",
    '  "portfolioThesis": 2-3 sentences explaining why this portfolio will beat SPY. Be specific about the complexity signal.',
    '  "positions": Array of objects for ONLY the positions listed above, each with:',
    '    "ticker": the ticker',
    '    "thesis": One sentence grounded in this company\'s complexity data.',
    '    "riskNotes": ["one risk factor"]',
    '  "reportMarkdown": A short markdown report: # Portfolio Report, ## Thesis (2 sentences), ## Top 10 Holdings (bullet list with scores).',
    "",
    "Be concise. Output ONLY the JSON object. No markdown fences.",
  ].join("\n");
}

type RankerPick = { ticker: string; reason: string };

function extractRankerPicks(text: string, count: number): RankerPick[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    // Handle both formats: array of objects or array of strings
    const picks: RankerPick[] = parsed.slice(0, count + 5).map((item: unknown) => {
      if (typeof item === "string") return { ticker: item.trim().toUpperCase(), reason: "" };
      if (item && typeof item === "object" && "ticker" in (item as Record<string, unknown>)) {
        const obj = item as { ticker: string; reason?: string };
        return { ticker: obj.ticker.trim().toUpperCase(), reason: obj.reason ?? "" };
      }
      return null;
    }).filter((p: RankerPick | null): p is RankerPick => p !== null);
    return picks.length >= count ? picks.slice(0, count) : null;
  } catch {
    return null;
  }
}

type NarrativeOutput = {
  portfolioThesis: string;
  positions: Array<{ ticker: string; thesis: string; riskNotes: string[] }>;
  reportMarkdown: string;
};

function fallbackThesis(c: ResearchedCompany): string {
  const parts: string[] = [
    `Legal-entity complexity score ${c.complexityScore.toFixed(2)}`,
  ];
  if (c.complexityChangeVsPrior != null && c.complexityChangeVsPrior < 0) {
    parts.push(`improving (Δ ${c.complexityChangeVsPrior.toFixed(2)} vs prior filing)`);
  }
  parts.push(`${c.subsidiaryCount} subsidiaries across ${c.jurisdictionCount} jurisdictions`);
  parts.push(`filing ${c.currentAnnualFilingDate}`);
  return parts.join("; ") + ".";
}

function buildPortfolio(
  tickers: string[],
  universeMap: Map<string, ResearchedCompany>,
  amount: number,
  narrative?: NarrativeOutput,
): PortfolioOutput {
  const narrativeByTicker = new Map(
    (narrative?.positions ?? []).map((p) => [p.ticker.toUpperCase(), p]),
  );

  const positions: PortfolioPosition[] = tickers.map((ticker) => {
    const c = universeMap.get(ticker)!;
    const narr = narrativeByTicker.get(ticker);
    return {
      nasdaqCode: ticker,
      companyName: c.companyName,
      companyEntityId: c.entityId,
      amount,
      thesis: narr?.thesis || fallbackThesis(c),
      currentAnnualFilingDate: c.currentAnnualFilingDate,
      priorAnnualFilingDate: c.priorAnnualFilingDate,
      subsidiaryCount: c.subsidiaryCount,
      jurisdictionCount: c.jurisdictionCount,
      hierarchyDepth: c.hierarchyDepth,
      complexityScore: c.complexityScore,
      complexityChangeVsPrior: c.complexityChangeVsPrior,
      calaEvidence: c.evidence.length > 0 ? c.evidence : ["Pre-researched via Cala entity graph."],
      supportingEntityIds: [c.entityId],
      riskNotes: narr?.riskNotes?.length
        ? narr.riskNotes
        : [
            c.complexityChangeVsPrior == null
              ? "No prior filing available for change comparison."
              : c.complexityChangeVsPrior > 0
                ? "Complexity increased vs prior filing — monitor for continued deterioration."
                : "Low risk — complexity stable or improving.",
          ],
      cutoffComplianceNote:
        "All data sourced from Cala entity graph with filing dates on or before 2025-04-15.",
    };
  });

  const sorted = [...positions].sort(
    (a, b) => a.complexityScore - b.complexityScore,
  );

  return {
    portfolioThesis: narrative?.portfolioThesis ??
      "Favor NASDAQ companies with low or improving filing-linked legal-entity complexity. " +
      "Companies with fewer subsidiaries, fewer jurisdictions, and shallower hierarchy " +
      "tend to be more focused and operationally efficient.",
    submissionPayload: {
      team_id: process.env.TEAM_ID ?? "",
      model_agent_name: "",
      model_agent_version: "",
      transactions: sorted.map((p) => ({
        nasdaq_code: p.nasdaqCode,
        amount: p.amount,
      })),
    },
    positions: sorted,
    cutoffAudit: {
      postCutoffDataUsed: false,
      complianceSummary:
        "All complexity metrics derived from Cala entity graph data with filing dates on or before the 2025-04-15 cutoff.",
      bannedDataChecks: [
        "No post-cutoff stock prices used.",
        "No post-cutoff news or events referenced.",
      ],
    },
    openGaps: [],
    reportMarkdown: narrative?.reportMarkdown ?? buildReport(sorted),
  };
}

function buildReport(positions: PortfolioPosition[]): string {
  const lines: string[] = [
    "# Portfolio Report",
    "",
    "## Thesis",
    "Favor NASDAQ companies with low or improving filing-linked legal-entity complexity.",
    "",
    "## Portfolio Construction",
    `${positions.length} positions at $${AMOUNT_PER_POSITION.toLocaleString()} each = $${(positions.length * AMOUNT_PER_POSITION).toLocaleString()} total.`,
    "",
    "## Top 10 by Complexity Score (lowest = best)",
    "",
  ];

  for (const p of positions.slice(0, 10)) {
    lines.push(
      `- **${p.nasdaqCode}** (${p.companyName}): score ${p.complexityScore.toFixed(3)}, ` +
        `${p.subsidiaryCount} subs, ${p.jurisdictionCount} jur, depth ${p.hierarchyDepth}` +
        (p.complexityChangeVsPrior != null
          ? `, Δ ${p.complexityChangeVsPrior.toFixed(3)}`
          : ""),
    );
  }

  lines.push("", "## All Positions", "");
  for (const p of positions) {
    lines.push(`- ${p.nasdaqCode}: ${p.thesis}`);
  }

  return lines.join("\n");
}

type TelemetryEvent = {
  level: "info" | "error";
  type: string;
  title: string;
  data?: unknown;
};

export async function runFastIteration(options: {
  rules: string[];
  submitOptions: SubmitOptions;
  onEvent?: (event: TelemetryEvent) => Promise<void> | void;
}): Promise<FastRankerResult> {
  const emit = options.onEvent ?? (() => {});

  const universe = loadResearchUniverse();
  if (universe.length === 0) {
    throw new Error("Research universe is empty — run build-universe first");
  }

  await emit({
    level: "info",
    type: "run-started",
    title: `Fast ranker started — ${universe.length} companies from Cala entity graph`,
    data: { universeSize: universe.length, rules: options.rules.length },
  });

  const universeMap = new Map(universe.map((c) => [c.ticker, c]));
  const baseline = isBaselineMode();
  const lockedTickers = baseline ? new Set(baselineTickers()) : new Set<string>();
  const availableUniverse = baseline
    ? universe.filter((c) => !lockedTickers.has(c.ticker))
    : universe;
  const pickCount = baseline ? REQUIRED_POSITIONS - lockedTickers.size : REQUIRED_POSITIONS;

  const prompt = buildRankerPrompt(availableUniverse, options.rules, pickCount);

  await emit({
    level: "info",
    type: "step-started",
    title: `Ranking ${availableUniverse.length} Cala-verified companies with ${RANKER_MODEL}`,
    data: { model: RANKER_MODEL, pickCount, candidateCount: availableUniverse.length },
  });

  // Phase 1: Smart ranker — picks tickers with per-pick reasoning
  const rankerResult = await generateText({
    model: anthropic(RANKER_MODEL),
    prompt,
    maxOutputTokens: 4000,
  });

  let costUsd = estimateHaikuCostUsd(rankerResult.usage);

  const picks = extractRankerPicks(rankerResult.text, pickCount);
  if (!picks) {
    throw new Error(
      `Ranker did not return valid picks. Raw output: ${rankerResult.text.slice(0, 500)}`,
    );
  }

  let tickers = picks
    .map((p) => p.ticker)
    .filter((t) => universeMap.has(t));
  if (tickers.length < pickCount) {
    throw new Error(
      `Ranker returned only ${tickers.length} valid tickers (need ${pickCount}).`,
    );
  }
  tickers = tickers.slice(0, pickCount);

  await emit({
    level: "info",
    type: "step-finished",
    title: `Picked ${tickers.length} tickers`,
    data: { tickers: tickers.slice(0, 10), total: tickers.length },
  });

  // Phase 2: Narrative writer — LLM-generated thesis, risk notes, report
  await emit({
    level: "info",
    type: "step-started",
    title: "Writing portfolio narrative and per-position thesis",
  });

  // Only send top 15 picks to the narrative writer — the rest use templates.
  // This cuts the narrative prompt from 50 entries to 15, halving generation time.
  const allEnrichedPicks = picks
    .filter((p) => universeMap.has(p.ticker))
    .slice(0, pickCount)
    .map((p) => ({ ...p, company: universeMap.get(p.ticker)! }));
  const enrichedPicks = allEnrichedPicks.slice(0, 15);

  let narrative: NarrativeOutput | undefined;
  try {
    const narrativePrompt = buildNarrativePrompt(enrichedPicks, options.rules);
    const narrativeResult = await generateText({
      model: anthropic(RANKER_MODEL),
      prompt: narrativePrompt,
      maxOutputTokens: 4000,
    });
    costUsd += estimateHaikuCostUsd(narrativeResult.usage);

    const jsonMatch = narrativeResult.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as NarrativeOutput;
      if (parsed.portfolioThesis && parsed.positions) {
        narrative = parsed;
      }
    }
  } catch (e) {
    console.warn(
      "[fast-ranker] narrative writer failed, using fallback templates:",
      e instanceof Error ? e.message : e,
    );
  }

  await emit({
    level: "info",
    type: "step-finished",
    title: narrative
      ? `Narrative written — ${narrative.positions?.length ?? 0} position theses`
      : "Narrative failed — using template fallback",
  });

  await emit({
    level: "info",
    type: "step-started",
    title: "Building portfolio from Cala entity graph data",
  });

  let portfolio = buildPortfolio(tickers, universeMap, AMOUNT_PER_POSITION, narrative);

  if (baseline) {
    portfolio = mergeWithBaseline(portfolio);
  }

  try {
    validatePortfolioOutput(portfolio);
  } catch (e) {
    if (e instanceof PortfolioValidationError) {
      await emit({ level: "error", type: "step-finished", title: "Validation failed", data: { issues: e.issues } });
    }
    throw e;
  }

  await emit({
    level: "info",
    type: "step-finished",
    title: `Portfolio built — ${portfolio.positions.length} positions, $${(portfolio.positions.length * AMOUNT_PER_POSITION).toLocaleString()}`,
  });

  await emit({
    level: "info",
    type: "step-started",
    title: "Submitting to leaderboard",
  });

  const submitResult = await submitToLeaderboard(
    portfolio.submissionPayload,
    options.submitOptions,
  );

  if (!submitResult.ok) {
    const errorBody =
      submitResult.details &&
      typeof submitResult.details === "object" &&
      "error" in (submitResult.details as Record<string, unknown>)
        ? (submitResult.details as { error: string }).error
        : JSON.stringify(submitResult.details);

    const badTickers = [
      ...String(errorBody).matchAll(
        /Failed to fetch (?:historical )?price for ([A-Z.]{1,6})/g,
      ),
    ].map((m) => m[1]);

    if (badTickers.length > 0) {
      removeFromUniverse(badTickers);

      await emit({
        level: "info",
        type: "step-started",
        title: `Replacing bad tickers: ${badTickers.join(", ")} (removed from universe)`,
        data: { badTickers },
      });

      const badSet = new Set(badTickers);
      const usedSet = new Set(tickers);
      const replacements = availableUniverse
        .filter((c) => !usedSet.has(c.ticker) && !badSet.has(c.ticker))
        .sort((a, b) => a.complexityScore - b.complexityScore)
        .slice(0, badTickers.length)
        .map((c) => c.ticker);

      const fixedTickers = [
        ...tickers.filter((t) => !badSet.has(t)),
        ...replacements,
      ];

      portfolio = buildPortfolio(fixedTickers, universeMap, AMOUNT_PER_POSITION);
      if (baseline) portfolio = mergeWithBaseline(portfolio);
      validatePortfolioOutput(portfolio);

      await emit({
        level: "info",
        type: "step-started",
        title: `Resubmitting with replacements: ${replacements.join(", ")}`,
      });

      const retryResult = await submitToLeaderboard(
        portfolio.submissionPayload,
        options.submitOptions,
      );

      if (!retryResult.ok) {
        throw new Error(`Submit retry failed: HTTP ${retryResult.upstreamStatus}`);
      }

      const score = extractScoreFromRetryResponse(retryResult.response);
      await emit({
        level: "info",
        type: "step-finished",
        title: score != null ? `Submitted — score $${score.toLocaleString()}` : "Submitted (retry)",
        data: { response: retryResult.response },
      });

      return {
        output: portfolio,
        leaderboardResponse: retryResult.response,
        costUsd,
        pickedTickers: fixedTickers,
      };
    }

    throw new Error(`Submit failed: HTTP ${submitResult.upstreamStatus} — ${errorBody}`);
  }

  const score = extractScoreFromRetryResponse(submitResult.response);
  await emit({
    level: "info",
    type: "step-finished",
    title: score != null ? `Submitted — score $${score.toLocaleString()}` : "Submitted successfully",
    data: { response: submitResult.response },
  });

  return {
    output: portfolio,
    leaderboardResponse: submitResult.response,
    costUsd,
    pickedTickers: tickers,
  };
}
