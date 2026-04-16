import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { streamText } from "ai";
import { codexExec } from "ai-sdk-provider-codex-cli";

import {
  portfolioOutputSchema,
  type PortfolioOutput,
  type PortfolioPosition,
} from "@/lib/portfolio-schema";
import { updateRunCheckpoint } from "@/lib/agent-runs";
import {
  ensureCodexCheckpointFile,
  readCodexCheckpointFile,
} from "@/lib/codex-checkpoint-file";
import {
  SHARED_SYSTEM_PROMPT,
  composePromptSections,
} from "@/lib/system-prompt";
import { buildCalaPreanalysisPromptSection } from "@/lib/cala-preanalysis";

const DEFAULT_MODEL = process.env.CODEX_MODEL?.trim() || "gpt-5.4-mini";
const DEFAULT_AGENT_NAME = "mrkrabs-codex-cli";
const DEFAULT_AGENT_VERSION = "v0.1";
const CALA_MCP_URL =
  process.env.CALA_MCP_URL?.trim() || "https://api.cala.ai/mcp/";
const CALA_MCP_PROXY_PATH = path.join(
  process.cwd(),
  "scripts",
  "cala-mcp-proxy.sh",
);
const MIN_POSITION_SIZE = 5_000;
const REQUIRED_PORTFOLIO_BUDGET = 1_000_000;
const MIN_POSITION_COUNT = 50;
const TARGET_FILING_CUTOFF = "2025-04-15";
const MAX_SUBMISSION_REPAIR_ATTEMPTS = 2;
const PLACEHOLDER_TICKER_PATTERN =
  /^(UNVERIFIABLE|UNAVAILABLE|DO-NOT-|INVALID-|PLACEHOLDER|REMOVE_|CALA_|BLOCKED|MISSING|NO_SUBMISSION|OMIT|THIS|PAYLOAD)/i;

const findBundledCodexPath = () => {
  const pnpmDir = path.join(process.cwd(), "node_modules", ".pnpm");

  try {
    const match = readdirSync(pnpmDir).find((entry) =>
      entry.startsWith("@openai+codex@"),
    );

    if (!match) {
      return undefined;
    }

    const candidate = path.join(
      pnpmDir,
      match,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );

    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
};

const BUNDLED_CODEX_PATH = findBundledCodexPath();

export interface CalaAgentStep {
  text: string;
  finishReason: string;
  toolCalls: unknown[];
  toolResults?: unknown[];
}

export interface CalaAgentResult {
  model: string;
  output: PortfolioOutput;
  steps: CalaAgentStep[];
  leaderboardResponse?: unknown;
  leaderboardSubmission?: {
    requestId: string;
    publicAgentName: string;
    publicAgentVersion: string;
    response: unknown;
  };
}

interface SubmissionPayload {
  team_id: string;
  model_agent_name: string;
  model_agent_version: string;
  transactions: Array<{
    nasdaq_code: string;
    amount: number;
  }>;
}

interface LeaderboardSubmitSuccess {
  ok: true;
  requestId: string;
  agentName: string;
  agentVersion: string;
  response: unknown;
}

interface LeaderboardSubmitFailure {
  ok: false;
  requestId: string;
  agentName: string;
  agentVersion: string;
  upstreamStatus: number;
  upstreamStatusText: string;
  details: unknown;
}

type LeaderboardSubmitResult =
  | LeaderboardSubmitSuccess
  | LeaderboardSubmitFailure;

class LeaderboardSubmissionError extends Error {
  submissionFailure: LeaderboardSubmitFailure;

  constructor(message: string, submissionFailure: LeaderboardSubmitFailure) {
    super(message);
    this.name = "LeaderboardSubmissionError";
    this.submissionFailure = submissionFailure;
  }
}

interface RunCalaAgentOptions {
  runId?: string;
  submitFn?: (payload: SubmissionPayload) => Promise<LeaderboardSubmitResult>;
  onTelemetryEvent?: (event: {
    level: "info" | "error";
    type: "step-started" | "tool-started" | "tool-finished" | "step-finished";
    title: string;
    data?: unknown;
  }) => Promise<void> | void;
  onFinish?: (event: {
    functionId?: string;
    metadata?: Record<string, unknown>;
    totalUsage: unknown;
    result: CalaAgentResult;
  }) => Promise<void> | void;
}

export const CALA_AGENT_MODEL = DEFAULT_MODEL;
export const CALA_AGENT_NAME = DEFAULT_AGENT_NAME;
export const CALA_AGENT_VERSION = DEFAULT_AGENT_VERSION;

class PortfolioValidationError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "PortfolioValidationError";
    this.issues = issues;
  }
}

const normalizeTicker = (ticker: string) => ticker.trim().toUpperCase();

const dedupeStrings = (values: string[]) =>
  Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );

const normalizeText = (value: string, fallback: string) => {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
};

const normalizeDateOrNull = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const safeJsonPreview = (value: unknown, maxLength = 800) => {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized.length > maxLength
      ? `${serialized.slice(0, maxLength)}...`
      : serialized;
  } catch {
    return String(value);
  }
};

const extractJsonObject = (text: string) => {
  const fenced = text.match(/```json([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Model response did not contain a JSON object.");
  }

  const candidate = fenced.slice(start, end + 1);
  return JSON.parse(candidate);
};

const stringifySubmissionDetails = (details: unknown) => {
  if (
    details &&
    typeof details === "object" &&
    "error" in (details as Record<string, unknown>) &&
    typeof (details as { error?: unknown }).error === "string"
  ) {
    return (details as { error: string }).error;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
};

const extractBadTickersFromSubmissionError = (message: string) =>
  Array.from(
    new Set(
      [
        ...Array.from(
          message.matchAll(
            /Failed to fetch historical price for ([A-Z.]{1,6})/g,
          ),
        ).map((match) => match[1]),
        ...Array.from(
          message.matchAll(
            /Failed to fetch purchase prices.*?: ([A-Z.]{1,6}):/g,
          ),
        ).map((match) => match[1]),
        ...Array.from(
          message.matchAll(/No data found for ([A-Z.]{1,6})/g),
        ).map((match) => match[1]),
      ],
    ),
  );

const isRepairableSubmissionError = (message: string) =>
  /Failed to fetch historical price|Failed to fetch purchase prices|No data found|Duplicate companies found|at least 50 companies|Total investment must be exactly|Each company must receive at least/i.test(
    message,
  );

const buildSubmissionRepairIssues = (failure: LeaderboardSubmitFailure) => {
  const errorBody = stringifySubmissionDetails(failure.details);
  const badTickers = extractBadTickersFromSubmissionError(errorBody);

  return [
    `Leaderboard rejected the portfolio (HTTP ${failure.upstreamStatus} ${failure.upstreamStatusText}): ${errorBody}`,
    ...(badTickers.length > 0
      ? [
          `Bad ticker(s): ${badTickers.join(", ")}. Replace ${badTickers.length === 1 ? "it" : "them"} with valid NASDAQ-listed stocks that have an April 15, 2025 purchase price, then re-check the total still equals exactly $1,000,000.`,
        ]
      : []),
  ];
};

const mergePositions = (positions: PortfolioPosition[]) => {
  const merged = new Map<string, PortfolioPosition>();

  for (const position of positions) {
    const ticker = normalizeTicker(position.nasdaqCode);
    if (!ticker) {
      continue;
    }

    const incomingCurrentAnnualFilingDate = normalizeText(
      position.currentAnnualFilingDate,
      TARGET_FILING_CUTOFF,
    );
    const incomingPriorAnnualFilingDate = normalizeDateOrNull(
      position.priorAnnualFilingDate,
    );

    const existing = merged.get(ticker);
    if (!existing) {
      merged.set(ticker, {
        ...position,
        nasdaqCode: ticker,
        companyName: normalizeText(position.companyName, ticker),
        companyEntityId: position.companyEntityId.trim(),
        thesis: normalizeText(
          position.thesis,
          `Cala-backed thesis for ${ticker}.`,
        ),
        currentAnnualFilingDate: incomingCurrentAnnualFilingDate,
        priorAnnualFilingDate: incomingPriorAnnualFilingDate,
        subsidiaryCount: Math.max(position.subsidiaryCount, 0),
        jurisdictionCount: Math.max(position.jurisdictionCount, 0),
        hierarchyDepth: Math.max(position.hierarchyDepth, 0),
        complexityScore: position.complexityScore,
        complexityChangeVsPrior: position.complexityChangeVsPrior,
        cutoffComplianceNote: normalizeText(
          position.cutoffComplianceNote,
          "Reasoning was intended to avoid data after 2025-04-15.",
        ),
        calaEvidence: dedupeStrings(position.calaEvidence),
        supportingEntityIds: dedupeStrings(position.supportingEntityIds),
        riskNotes: dedupeStrings(position.riskNotes),
      });
      continue;
    }

    const useIncomingSignal =
      incomingCurrentAnnualFilingDate > existing.currentAnnualFilingDate;

    merged.set(ticker, {
      ...existing,
      amount: Math.max(existing.amount, position.amount),
      companyName:
        existing.companyName.length >= position.companyName.trim().length
          ? existing.companyName
          : normalizeText(position.companyName, existing.companyName),
      companyEntityId:
        existing.companyEntityId.length > 0
          ? existing.companyEntityId
          : position.companyEntityId.trim(),
      thesis:
        existing.thesis.length >= position.thesis.trim().length
          ? existing.thesis
          : normalizeText(position.thesis, existing.thesis),
      currentAnnualFilingDate: useIncomingSignal
        ? incomingCurrentAnnualFilingDate
        : existing.currentAnnualFilingDate,
      priorAnnualFilingDate: useIncomingSignal
        ? incomingPriorAnnualFilingDate
        : existing.priorAnnualFilingDate,
      subsidiaryCount: useIncomingSignal
        ? Math.max(position.subsidiaryCount, 0)
        : existing.subsidiaryCount,
      jurisdictionCount: useIncomingSignal
        ? Math.max(position.jurisdictionCount, 0)
        : existing.jurisdictionCount,
      hierarchyDepth: useIncomingSignal
        ? Math.max(position.hierarchyDepth, 0)
        : existing.hierarchyDepth,
      complexityScore: useIncomingSignal
        ? position.complexityScore
        : existing.complexityScore,
      complexityChangeVsPrior: useIncomingSignal
        ? position.complexityChangeVsPrior
        : existing.complexityChangeVsPrior,
      cutoffComplianceNote:
        existing.cutoffComplianceNote.length >=
        position.cutoffComplianceNote.trim().length
          ? existing.cutoffComplianceNote
          : normalizeText(
              position.cutoffComplianceNote,
              existing.cutoffComplianceNote,
            ),
      calaEvidence: dedupeStrings([
        ...existing.calaEvidence,
        ...position.calaEvidence,
      ]),
      supportingEntityIds: dedupeStrings([
        ...existing.supportingEntityIds,
        ...position.supportingEntityIds,
      ]),
      riskNotes: dedupeStrings([...existing.riskNotes, ...position.riskNotes]),
    });
  }

  return Array.from(merged.values());
};

const allocatePortfolioAmounts = (positions: PortfolioPosition[]) => {
  const minimumBudget = positions.length * MIN_POSITION_SIZE;

  if (minimumBudget > REQUIRED_PORTFOLIO_BUDGET) {
    throw new PortfolioValidationError([
      `Portfolio has ${positions.length} positions, which exceeds the maximum supported count for a $${REQUIRED_PORTFOLIO_BUDGET.toLocaleString()} budget with a $${MIN_POSITION_SIZE.toLocaleString()} minimum.`,
    ]);
  }

  const remainingBudget = REQUIRED_PORTFOLIO_BUDGET - minimumBudget;
  const weights = positions.map((position) =>
    Math.max(position.amount - MIN_POSITION_SIZE, 0),
  );
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const normalizedWeights = weightSum > 0 ? weights : positions.map(() => 1);
  const normalizedWeightSum = normalizedWeights.reduce(
    (sum, weight) => sum + weight,
    0,
  );

  const provisionalExtras = normalizedWeights.map(
    (weight) => (remainingBudget * weight) / normalizedWeightSum,
  );
  const flooredExtras = provisionalExtras.map((extra) => Math.floor(extra));
  let remainder =
    REQUIRED_PORTFOLIO_BUDGET -
    (minimumBudget + flooredExtras.reduce((sum, extra) => sum + extra, 0));

  const fractionalOrder = provisionalExtras
    .map((extra, index) => ({
      index,
      remainder: extra - flooredExtras[index],
    }))
    .sort((a, b) => b.remainder - a.remainder);

  const extras = [...flooredExtras];
  for (const entry of fractionalOrder) {
    if (remainder <= 0) {
      break;
    }
    extras[entry.index] += 1;
    remainder -= 1;
  }

  return positions.map((position, index) => ({
    ...position,
    amount: MIN_POSITION_SIZE + extras[index],
  }));
};

const renderReportMarkdown = (
  output: Omit<PortfolioOutput, "reportMarkdown">,
) => {
  const portfolioLines = output.positions.flatMap((position) => {
    const evidenceLines =
      position.calaEvidence.length > 0
        ? position.calaEvidence.map((item) => `- ${item}`)
        : ["- No additional evidence captured."];
    const riskLines =
      position.riskNotes.length > 0
        ? position.riskNotes.map((item) => `- ${item}`)
        : ["- No explicit risks captured."];

    return [
      `### ${position.companyName} (${position.nasdaqCode})`,
      `- Company: <entity UUID="${position.companyEntityId}">${position.companyName}</entity>`,
      `- Ticker: ${position.nasdaqCode}`,
      `- Allocation: $${position.amount.toLocaleString("en-US")}`,
      `- Thesis: ${position.thesis}`,
      `- Filing date used: ${position.currentAnnualFilingDate}`,
      `- Prior filing date used: ${position.priorAnnualFilingDate ?? "Not available"}`,
      `- Complexity metrics: subsidiaries=${position.subsidiaryCount}, jurisdictions=${position.jurisdictionCount}, depth=${position.hierarchyDepth}, score=${position.complexityScore.toFixed(2)}, change_vs_prior=${position.complexityChangeVsPrior == null ? "n/a" : position.complexityChangeVsPrior.toFixed(2)}`,
      `- Cutoff note: ${position.cutoffComplianceNote}`,
      "- Cala-backed evidence:",
      ...evidenceLines,
      "- Risks:",
      ...riskLines,
      "",
    ];
  });

  const openGapLines =
    output.openGaps.length > 0
      ? output.openGaps.map((gap) => `- ${gap}`)
      : ["- No additional open gaps recorded."];

  const cutoffLines =
    output.cutoffAudit.bannedDataChecks.length > 0
      ? output.cutoffAudit.bannedDataChecks.map((check) => `- ${check}`)
      : ["- No explicit banned-data checks recorded."];

  return [
    "# Lobster of Wall Street: NASDAQ Portfolio Challenge Submission",
    "",
    "## Thesis",
    output.portfolioThesis,
    "",
    "## Signal Design",
    "Favor NASDAQ companies with low or improving filing-linked legal-entity complexity using subsidiary count, jurisdiction count, and hierarchy depth from annual-filing-backed company structure on or before 2025-04-15.",
    "",
    "## Portfolio Decisions",
    ...portfolioLines,
    "## Time Cutoff Audit",
    `- Post-cutoff data used: ${output.cutoffAudit.postCutoffDataUsed ? "yes" : "no"}`,
    `- Summary: ${output.cutoffAudit.complianceSummary}`,
    ...cutoffLines,
    "",
    "## Open Gaps",
    ...openGapLines,
  ].join("\n");
};

const normalizeAndValidateOutput = (
  output: PortfolioOutput,
  teamId: string,
): PortfolioOutput => {
  const issues: string[] = [];

  const mergedPositions = mergePositions(output.positions).filter(
    (position) => position.companyEntityId.length > 0,
  );

  if (mergedPositions.length < MIN_POSITION_COUNT) {
    issues.push(
      `Portfolio has only ${mergedPositions.length} unique positions with Cala UUIDs after deduplication; at least ${MIN_POSITION_COUNT} are required.`,
    );
  }

  for (const position of mergedPositions) {
    if (!position.nasdaqCode) {
      issues.push("A position is missing a NASDAQ ticker.");
    }
    if (!position.companyEntityId) {
      issues.push(
        `Position ${position.nasdaqCode} is missing a Cala entity UUID.`,
      );
    }
    if (position.currentAnnualFilingDate > TARGET_FILING_CUTOFF) {
      issues.push(
        `${position.nasdaqCode} uses currentAnnualFilingDate=${position.currentAnnualFilingDate}, which is after the ${TARGET_FILING_CUTOFF} cutoff.`,
      );
    }
    if (
      position.priorAnnualFilingDate &&
      position.priorAnnualFilingDate > TARGET_FILING_CUTOFF
    ) {
      issues.push(
        `${position.nasdaqCode} uses priorAnnualFilingDate=${position.priorAnnualFilingDate}, which is after the ${TARGET_FILING_CUTOFF} cutoff.`,
      );
    }
    if (PLACEHOLDER_TICKER_PATTERN.test(position.nasdaqCode)) {
      issues.push(
        `Position ${position.nasdaqCode} looks like a placeholder ticker rather than a real NASDAQ symbol.`,
      );
    }
  }

  if (output.cutoffAudit.postCutoffDataUsed) {
    issues.push(
      "cutoffAudit.postCutoffDataUsed was true; the portfolio must explicitly avoid post-2025-04-15 data.",
    );
  }

  if (issues.length > 0) {
    throw new PortfolioValidationError(issues);
  }

  const normalizedPositions = allocatePortfolioAmounts(mergedPositions);
  const normalizedOutput: PortfolioOutput = {
    portfolioThesis: normalizeText(
      output.portfolioThesis,
      "Favor NASDAQ companies with low or improving filing-linked legal-entity complexity.",
    ),
    submissionPayload: {
      team_id: teamId,
      model_agent_name: DEFAULT_AGENT_NAME,
      model_agent_version: DEFAULT_AGENT_VERSION,
      transactions: normalizedPositions.map((position) => ({
        nasdaq_code: position.nasdaqCode,
        amount: position.amount,
      })),
    },
    positions: normalizedPositions,
    cutoffAudit: {
      postCutoffDataUsed: false,
      complianceSummary: normalizeText(
        output.cutoffAudit.complianceSummary,
        "Portfolio reasoning was normalized to a Cala-grounded, pre-2025-04-15 research workflow.",
      ),
      bannedDataChecks: dedupeStrings(output.cutoffAudit.bannedDataChecks),
    },
    openGaps: dedupeStrings(output.openGaps),
    reportMarkdown: "",
  };

  normalizedOutput.reportMarkdown = renderReportMarkdown({
    portfolioThesis: normalizedOutput.portfolioThesis,
    submissionPayload: normalizedOutput.submissionPayload,
    positions: normalizedOutput.positions,
    cutoffAudit: normalizedOutput.cutoffAudit,
    openGaps: normalizedOutput.openGaps,
  });

  return normalizedOutput;
};

const CODEX_EXECUTION_APPENDIX = `
The grading server enforces every rule below. Any violation returns a 400 and the
entire submission is wasted. Read each rule and the exact server error it produces.

HARD CONSTRAINTS (server-enforced, non-negotiable):
1. transactions must contain AT LEAST 50 UNIQUE NASDAQ tickers.
   - Server error if short: "Must invest in at least 50 companies. You submitted N."
   - AIM FOR 52–60 positions, NEVER EXACTLY 50. Dedupe, ticker mis-verification, or
     an empty companyEntityId will silently drop candidates after you emit them, so
     you need headroom. 50 is a floor, not a target.
2. No duplicate nasdaq_code values. Case-insensitive (AAPL and aapl are the same).
   Different share classes are different tickers: GOOGL and GOOG are distinct; BRK.A
   and BRK.B are distinct.
   - Server error: "Duplicate companies found: AAPL."
3. Every amount must be >= 5000 USD. Integer dollars only.
   - Server error: "Each company must receive at least $5,000."
4. SUM of all amount values must equal EXACTLY 1,000,000 USD. Not 999,999. Not
   1,000,100. EXACTLY. Plan your weights before you emit the JSON.
   - Server error: "Total investment must be exactly $1,000,000."
5. Every nasdaq_code must be a real, currently-tradable NASDAQ symbol — not a
   company name, not a CUSIP, not a placeholder.
   - Server error: "Price fetch failed: No data found for XYZZ."
   - Examples of correct formatting: WDAY not WORKDAY, PYPL not PAYPAL, MDLZ not
     MONDELEZ, GOOGL not GOOGLE, META not FACEBOOK.
6. No data from after 2025-04-15. Research uses Cala's pre-cutoff graph only.

PRE-SUBMISSION SELF-CHECK (run this in your head before you emit the final JSON,
in this exact order — fix anything that fails before returning):
  (a) Count unique nasdaq_codes across transactions. If count < 52, go find more
      verified companies. Do NOT submit with exactly 50; one dedupe and you lose.
  (b) Sum all amount values. If sum !== 1,000,000, rebalance. Easiest fix:
      distribute the delta across your top-conviction names in $1,000 increments.
  (c) Scan every amount. If any is < 5000 or not an integer, fix it.
  (d) Scan every nasdaq_code for placeholder patterns (UNKNOWN, UNVERIFIABLE,
      MISSING, TBD, NONE, N/A, blank). Remove those positions, then re-check (a).
  (e) Scan every companyEntityId. If any is missing, empty, not a UUID, or was
      invented rather than retrieved from Cala, remove that position and re-check
      (a). Never pad with made-up UUIDs.
  (f) Scan every nasdaq_code. Is it a short market symbol (<= 5 uppercase letters,
      optionally with a dot class suffix)? If you wrote "NVIDIA" anywhere, fix it
      to "NVDA".
  (g) After all fixes, recount. If unique count dropped below 52, loop back to (a).

Required identifiers:
- TEAM_ID: ${process.env.TEAM_ID}
- MODEL_AGENT_NAME: ${DEFAULT_AGENT_NAME}
- MODEL_AGENT_VERSION: ${DEFAULT_AGENT_VERSION}

Additional execution rules for this Codex path:
- The available Cala tools here are the single-entity MCP tools: entity_search,
  entity_introspection, and retrieve_entity.
- Use the checkpoint file at CHECKPOINT_FILE_PATH as your scratchpad and source of truth
  for research progress during the run.
- After the first useful research batch, after any material ranking change, after any
  portfolio-draft change, and immediately before final output, overwrite that file with
  the full latest checkpoint JSON.
- The checkpoint file must stay valid JSON with this top-level shape:
  {
    "phase": "discovery" | "screening" | "ranking" | "drafting" | "finalized",
    "thesis": "...fixed thesis string...",
    "cutoffDate": "2025-04-15",
    "candidateCompanies": [...],
    "portfolioDraft": [...],
    "openGaps": [...],
    "notes": [...],
    "lastUpdatedAtStep": number
  }
- Use the checkpoint file to keep candidate metrics, exclusions, and draft positions
  outside the active context window.
- For every selected company you must independently verify:
  1. the Cala company UUID (retrieved from Cala, never invented), and
  2. the exact NASDAQ ticker symbol used in submissionPayload.transactions[].nasdaq_code.
- If you cannot verify either, exclude the company. Do not emit placeholders.
- supportingEntityIds must contain only UUID strings actually retrieved from Cala.
- Use <entity UUID="...">Company Name</entity> tags in reportMarkdown for every
  buy recommendation.
- Do not infer ticker symbols from company names; do not expand tickers into names.

Output:
- Return ONLY the final JSON object matching the provided schema.
- submissionPayload.transactions and positions[] must describe the same portfolio,
  same tickers, same amounts, same length.
`.trim();

const buildCodexPrompt = async (
  prompt: string,
  checkpointFilePath: string,
  repairIssues: string[] = [],
  preanalysisPromptSection?: string,
) => {
  const resolvedPreanalysisPromptSection =
    preanalysisPromptSection ?? (await buildCalaPreanalysisPromptSection());
  const repairAddendum =
    repairIssues.length > 0
      ? [
          "Submission repair attempt:",
          "Your previous portfolio was rejected by the leaderboard.",
          ...repairIssues.map((issue) => `- ${issue}`),
          "Load the checkpoint file, fix the portfolio, overwrite the checkpoint with the repaired full JSON, and return a corrected final JSON object only.",
        ].join("\n")
      : null;

  const effectivePrompt = composePromptSections(
    SHARED_SYSTEM_PROMPT,
    resolvedPreanalysisPromptSection,
    CODEX_EXECUTION_APPENDIX.replace(
      "CHECKPOINT_FILE_PATH",
      checkpointFilePath,
    ),
    `User request:\n${prompt}`,
    repairAddendum,
  );

  return {
    effectivePrompt,
    preanalysisPromptSection: resolvedPreanalysisPromptSection,
  };
};

const createModel = () =>
  codexExec(DEFAULT_MODEL, {
    codexPath: BUNDLED_CODEX_PATH,
    allowNpx: true,
    approvalMode: "never",
    sandboxMode: "workspace-write",
    skipGitRepoCheck: true,
    cwd: process.cwd(),
    verbose: true,
    reasoningEffort: "high",
    // Keep Codex focused on Cala MCP research instead of opportunistic web detours.
    configOverrides: {
      "tools.web_search": false,
    },
    logger: {
      debug: (message) => console.debug("[codex-provider][debug]", message),
      info: (message) => console.info("[codex-provider][info]", message),
      warn: (message) => console.warn("[codex-provider][warn]", message),
      error: (message) => console.error("[codex-provider][error]", message),
    },
    mcpServers: {
      Cala: {
        transport: "stdio",
        command: "sh",
        args: [CALA_MCP_PROXY_PATH],
        env: {
          CALA_API_KEY: process.env.CALA_API_KEY ?? "",
        },
        enabledTools: [
          "entity_search",
          "entity_introspection",
          "retrieve_entity",
        ],
      },
    },
  });

export async function runCalaAgent(
  prompt: string,
  options?: RunCalaAgentOptions,
): Promise<CalaAgentResult> {
  if (!process.env.TEAM_ID) {
    throw new Error("TEAM_ID is required");
  }

  if (!process.env.CALA_API_KEY) {
    throw new Error("CALA_API_KEY is required");
  }

  const checkpointFilePath = options?.runId
    ? await ensureCodexCheckpointFile(options.runId)
    : path.join(process.cwd(), ".data", "codex-checkpoints", "adhoc.json");

  const cachedPreanalysisPromptSection =
    await buildCalaPreanalysisPromptSection();

  console.info("[codex-agent][start]", {
    model: DEFAULT_MODEL,
    promptLength: prompt.length,
    calaMcpUrl: CALA_MCP_URL,
    calaMcpProxyPath: CALA_MCP_PROXY_PATH,
    checkpointFilePath,
    codexPath: BUNDLED_CODEX_PATH ?? "npx:@openai/codex",
    enabledTools: [
      "entity_search",
      "entity_introspection",
      "retrieve_entity",
    ],
  });

  let repairIssues: string[] = [];
  let aggregatedUsage: Record<string, unknown> | null = null;
  let aggregatedProviderMetadata: Record<string, unknown> | undefined;
  const aggregatedSteps: CalaAgentStep[] = [];
  let finalOutput: PortfolioOutput | null = null;
  let successfulSubmission: LeaderboardSubmitSuccess | null = null;

  const mergeUsage = (next: unknown) => {
    if (!next || typeof next !== "object") {
      return;
    }

    const nextRecord = next as Record<string, unknown>;
    if (!aggregatedUsage) {
      aggregatedUsage = { ...nextRecord };
      return;
    }

    for (const [key, value] of Object.entries(nextRecord)) {
      if (typeof value === "number") {
        const existing = aggregatedUsage[key];
        aggregatedUsage[key] =
          (typeof existing === "number" ? existing : 0) + value;
      } else if (!(key in aggregatedUsage)) {
        aggregatedUsage[key] = value;
      }
    }
  };

  for (
    let attempt = 0;
    attempt <= MAX_SUBMISSION_REPAIR_ATTEMPTS;
    attempt += 1
  ) {
    const {
      effectivePrompt,
      preanalysisPromptSection: resolvedPreanalysisPromptSection,
    } = await buildCodexPrompt(
      prompt,
      checkpointFilePath,
      repairIssues,
      cachedPreanalysisPromptSection,
    );

    console.info("[codex-agent][prompt]", {
      model: DEFAULT_MODEL,
      attempt,
      rawPromptLength: prompt.length,
      effectivePromptLength: effectivePrompt.length,
      preanalysisIncluded: Boolean(resolvedPreanalysisPromptSection),
      preanalysisLength: resolvedPreanalysisPromptSection?.length ?? 0,
      preanalysisPreview: resolvedPreanalysisPromptSection
        ? resolvedPreanalysisPromptSection.slice(0, 240)
        : null,
      repairIssueCount: repairIssues.length,
    });

    const result = streamText({
      model: createModel(),
      prompt: effectivePrompt,
    });

    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        if (part.toolName === "exec") {
          let input: unknown;
          try {
            input =
              typeof part.input === "string" ? JSON.parse(part.input) : part.input;
          } catch {
            input = part.input;
          }

          console.info("[codex-agent][tool][exec][start]", {
            toolCallId: part.toolCallId,
            command:
              input && typeof input === "object" && "command" in input
                ? (input as { command?: unknown }).command
                : undefined,
            cwd:
              input && typeof input === "object" && "cwd" in input
                ? (input as { cwd?: unknown }).cwd
                : undefined,
            status:
              input && typeof input === "object" && "status" in input
                ? (input as { status?: unknown }).status
                : undefined,
          });
        } else {
          console.info("[codex-agent][tool][start]", {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: safeJsonPreview(part.input, 1200),
          });
        }
      }

      if (part.type === "tool-result") {
        if (part.toolName === "exec") {
          const resultPayload =
            part.result && typeof part.result === "object"
              ? (part.result as {
                  command?: unknown;
                  aggregatedOutput?: unknown;
                  exitCode?: unknown;
                  status?: unknown;
                })
              : undefined;

          console.info("[codex-agent][tool][exec][finish]", {
            toolCallId: part.toolCallId,
            command: resultPayload?.command,
            status: resultPayload?.status,
            exitCode: resultPayload?.exitCode,
            outputPreview: safeJsonPreview(
              resultPayload?.aggregatedOutput,
              1200,
            ),
          });
        } else {
          console.info("[codex-agent][tool][finish]", {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: safeJsonPreview(part.result, 1200),
          });
        }
      }
    }

    const text = await result.text;
    const usage = await result.totalUsage;
    const providerMetadata = await result.providerMetadata;
    const steps = await result.steps;
    const parsedObject = portfolioOutputSchema.parse(extractJsonObject(text));

    mergeUsage(usage);
    if (
      providerMetadata &&
      typeof providerMetadata === "object" &&
      !aggregatedProviderMetadata
    ) {
      aggregatedProviderMetadata = providerMetadata as Record<string, unknown>;
    }
    aggregatedSteps.push(
      ...steps.map((step) => ({
        text: step.text,
        finishReason: step.finishReason,
        toolCalls: step.toolCalls,
      })),
    );

    console.info("[codex-agent][raw-output]", {
      model: DEFAULT_MODEL,
      attempt,
      usage: safeJsonPreview(usage, 600),
      providerMetadata: safeJsonPreview(providerMetadata, 1200),
      preview: safeJsonPreview(
        {
          firstPositions: parsedObject.positions.slice(0, 3),
          firstTransactions: parsedObject.submissionPayload.transactions.slice(
            0,
            3,
          ),
          cutoffAudit: parsedObject.cutoffAudit,
        },
        2000,
      ),
    });

    let normalizedOutput: PortfolioOutput;
    try {
      normalizedOutput = normalizeAndValidateOutput(
        parsedObject,
        process.env.TEAM_ID,
      );
    } catch (error) {
      if (error instanceof PortfolioValidationError) {
        console.error("[codex-agent][validation][failed]", {
          attempt,
          issues: error.issues,
          preview: safeJsonPreview(
            {
              firstPositions: parsedObject.positions.slice(0, 5),
              firstTransactions:
                parsedObject.submissionPayload.transactions.slice(0, 5),
            },
            2000,
          ),
        });
      }
      throw error;
    }

    console.info("[codex-agent][success]", {
      model: DEFAULT_MODEL,
      attempt,
      positions: normalizedOutput.positions.length,
      transactions: normalizedOutput.submissionPayload.transactions.length,
      preview: safeJsonPreview(
        {
          portfolioThesis: normalizedOutput.portfolioThesis,
          firstTransactions:
            normalizedOutput.submissionPayload.transactions.slice(0, 5),
        },
        900,
      ),
    });

    finalOutput = normalizedOutput;

    if (!options?.submitFn) {
      break;
    }

    const submitResult = await options.submitFn(normalizedOutput.submissionPayload);
    if (submitResult.ok) {
      successfulSubmission = submitResult;
      console.info("[codex-agent][submit][accepted]", {
        attempt,
        requestId: submitResult.requestId,
        publicAgentName: submitResult.agentName,
        publicAgentVersion: submitResult.agentVersion,
      });
      break;
    }

    const nextRepairIssues = buildSubmissionRepairIssues(submitResult);
    const errorBody = nextRepairIssues.join(" ");

    console.warn("[codex-agent][submit][rejected]", {
      attempt,
      requestId: submitResult.requestId,
      upstreamStatus: submitResult.upstreamStatus,
      upstreamStatusText: submitResult.upstreamStatusText,
      details: safeJsonPreview(submitResult.details, 2000),
      repairIssues: nextRepairIssues,
    });

    if (
      attempt >= MAX_SUBMISSION_REPAIR_ATTEMPTS ||
      !isRepairableSubmissionError(errorBody)
    ) {
      throw new LeaderboardSubmissionError(
        `Leaderboard rejected the generated portfolio: ${errorBody}`,
        submitResult,
      );
    }

    repairIssues = nextRepairIssues;
  }

  if (!finalOutput) {
    throw new Error("Codex did not produce a final portfolio output.");
  }

  const finalResult = {
    model: DEFAULT_MODEL,
    output: finalOutput,
    steps: aggregatedSteps,
    ...(successfulSubmission
      ? {
          leaderboardResponse: successfulSubmission.response,
          leaderboardSubmission: {
            requestId: successfulSubmission.requestId,
            publicAgentName: successfulSubmission.agentName,
            publicAgentVersion: successfulSubmission.agentVersion,
            response: successfulSubmission.response,
          },
        }
      : {}),
  } satisfies CalaAgentResult;

  if (options?.runId) {
    const checkpoint = await readCodexCheckpointFile(options.runId);
    if (checkpoint) {
      await updateRunCheckpoint(options.runId, checkpoint);
    } else {
      console.warn("[codex-agent][checkpoint][missing-or-invalid]", {
        runId: options.runId,
        checkpointFilePath,
      });
    }
  }

  await options?.onFinish?.({
    totalUsage: aggregatedUsage,
    metadata: aggregatedProviderMetadata,
    result: finalResult,
  });

  return finalResult;
}
