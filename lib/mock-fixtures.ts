import type { AgentRunEvent, AgentRunRecord } from "./agent-runs";
import type { CalaAgentResult } from "./cala-agent";

const MOCK_AGENT_NAME = "mrkrabs-mock";
const MOCK_AGENT_VERSION = "v0.1";
const MOCK_MODEL = "claude-sonnet-4-5";

// Fixed anchor so "N minutes ago" math is deterministic across reloads.
const NOW = new Date("2026-04-15T17:30:00.000Z").getTime();

const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();
const secondsAgo = (n: number) => new Date(NOW - n * 1000).toISOString();

type MockPosition = {
  ticker: string;
  name: string;
  amount: number;
  thesis: string;
  entityId: string;
};

const HIGH_CONVICTION: ReadonlyArray<Omit<MockPosition, "amount">> = [
  {
    ticker: "NVDA",
    name: "NVIDIA CORP",
    thesis:
      "Cala graph flags NVDA as the ultimate parent of the dominant AI accelerator supply chain — PARTICIPATES_IN_CORPORATE_EVENT edges track every mega-cap GPU contract.",
    entityId: "5f7ca504-01d8-4aa9-b1ac-889202fd17c9",
  },
  {
    ticker: "META",
    name: "Meta Platforms, Inc.",
    thesis:
      "XBRL cash position doubled YoY; HAS_PRIVATE_FUND edges show reaccelerating infra spend flowing to NVDA and AMD.",
    entityId: "11111111-1111-4111-8111-111111111111",
  },
  {
    ticker: "GOOGL",
    name: "Alphabet Inc.",
    thesis:
      "IS_ULTIMATE_PARENT_OF graph depth is unrivalled — 300+ subsidiaries spanning cloud, search, and autonomous vehicles.",
    entityId: "22222222-2222-4222-8222-222222222222",
  },
  {
    ticker: "MSFT",
    name: "MICROSOFT CORP",
    thesis:
      "Cala employee_count and us-gaap Revenue trending up in lockstep; IS_AFFILIATE_OF edge to OpenAI is the cleanest AI proxy on NASDAQ.",
    entityId: "33333333-3333-4333-8333-333333333333",
  },
  {
    ticker: "AVGO",
    name: "Broadcom Inc.",
    thesis:
      "Custom-silicon tailwind: CorporateEvent entities show multiple hyperscaler ASIC design wins post-VMware acquisition.",
    entityId: "44444444-4444-4444-8444-444444444444",
  },
  {
    ticker: "AMD",
    name: "Advanced Micro Devices, Inc.",
    thesis:
      "us-gaap Data Center segment revenue compounding; Cala PARTICIPATES_IN_CORPORATE_EVENT flags MI300X launch cadence.",
    entityId: "55555555-5555-4555-8555-555555555555",
  },
  {
    ticker: "PLTR",
    name: "Palantir Technologies Inc.",
    thesis:
      "IS_AFFILIATE_OF edges to DoD and NHS programs; commercial AIP segment revenue growth visible in XBRL filings.",
    entityId: "66666666-6666-4666-8666-666666666666",
  },
  {
    ticker: "TSLA",
    name: "Tesla, Inc.",
    thesis:
      "Autonomy option value; Cala graph tracks subsidiary expansion in energy storage and humanoid robotics R&D.",
    entityId: "77777777-7777-4777-8777-777777777777",
  },
  {
    ticker: "NFLX",
    name: "Netflix, Inc.",
    thesis:
      "Cala XBRL free cash flow inflected positive; HAS_PRIVATE_FUND edges show growing content investment discipline.",
    entityId: "88888888-8888-4888-8888-888888888888",
  },
  {
    ticker: "COIN",
    name: "Coinbase Global, Inc.",
    thesis:
      "Regulatory clarity upcoming per PARTICIPATES_IN_CORPORATE_EVENT edges tracking ETF approvals and stablecoin legislation.",
    entityId: "99999999-9999-4999-8999-999999999999",
  },
];

const CORE: ReadonlyArray<Omit<MockPosition, "amount">> = [
  { ticker: "AAPL", name: "Apple Inc.", thesis: "Services margin expansion; Cala tracks 150+ subsidiary relationships.", entityId: "a1111111-1111-4111-8111-111111111111" },
  { ticker: "AMZN", name: "Amazon.com, Inc.", thesis: "AWS capex cycle; IS_DIRECT_OWNER_OF edges to Anthropic via the graph.", entityId: "a2222222-2222-4222-8222-222222222222" },
  { ticker: "COST", name: "Costco Wholesale Corp.", thesis: "us-gaap operating margin expansion, defensive hedge against tech concentration.", entityId: "a3333333-3333-4333-8333-333333333333" },
  { ticker: "ADBE", name: "Adobe Inc.", thesis: "Firefly generative AI monetisation; Cala CorporateEvent edges flag enterprise deal velocity.", entityId: "a4444444-4444-4444-8444-444444444444" },
  { ticker: "QCOM", name: "QUALCOMM Incorporated", thesis: "On-device AI inflection; Cala graph tracks automotive and XR design wins.", entityId: "a5555555-5555-4555-8555-555555555555" },
  { ticker: "CSCO", name: "Cisco Systems, Inc.", thesis: "Splunk integration accretion visible in Cala's us-gaap cash flow metrics.", entityId: "a6666666-6666-4666-8666-666666666666" },
  { ticker: "AMAT", name: "Applied Materials, Inc.", thesis: "Semiconductor capex super-cycle; customer graph via IS_AFFILIATE_OF includes every foundry.", entityId: "a7777777-7777-4777-8777-777777777777" },
  { ticker: "MU", name: "Micron Technology, Inc.", thesis: "HBM demand inflection; Cala tracks NVDA supply-chain dependency via SEC filings metadata.", entityId: "a8888888-8888-4888-8888-888888888888" },
  { ticker: "BKNG", name: "Booking Holdings Inc.", thesis: "Cala us-gaap Revenue stable growth; PARTICIPATES_IN_CORPORATE_EVENT tracks generative AI trip-planning rollout.", entityId: "a9999999-9999-4999-8999-999999999999" },
  { ticker: "MRVL", name: "Marvell Technology, Inc.", thesis: "Custom silicon for hyperscalers; us-gaap Data Center segment growth.", entityId: "b1111111-1111-4111-8111-111111111111" },
  { ticker: "INTU", name: "Intuit Inc.", thesis: "QuickBooks AI; Cala tracks SMB customer concentration via SEC filings.", entityId: "b2222222-2222-4222-8222-222222222222" },
  { ticker: "TXN", name: "Texas Instruments Inc.", thesis: "Industrial recovery play; Cala graph shows HAS_HEADQUARTERS_IN Dallas foundry expansion.", entityId: "b3333333-3333-4333-8333-333333333333" },
  { ticker: "ABNB", name: "Airbnb, Inc.", thesis: "Travel secular growth; us-gaap operating leverage improving with marketing discipline.", entityId: "b4444444-4444-4444-8444-444444444444" },
  { ticker: "PANW", name: "Palo Alto Networks, Inc.", thesis: "Platformisation narrative; CorporateEvent edges track Cortex XSIAM mega deals.", entityId: "b5555555-5555-4555-8555-555555555555" },
  { ticker: "CRWD", name: "CrowdStrike Holdings, Inc.", thesis: "Cloud-native endpoint with Falcon Complete; Cala XBRL shows best-in-class net retention.", entityId: "b6666666-6666-4666-8666-666666666666" },
  { ticker: "ZS", name: "Zscaler, Inc.", thesis: "SASE category leader; us-gaap billings growth reaccelerating per 10-Q metadata.", entityId: "b7777777-7777-4777-8777-777777777777" },
  { ticker: "DDOG", name: "Datadog, Inc.", thesis: "AI observability tailwind; Cala IS_AFFILIATE_OF edges map to every major cloud.", entityId: "b8888888-8888-4888-8888-888888888888" },
  { ticker: "SNPS", name: "Synopsys, Inc.", thesis: "EDA moat; Cala graph tracks every foundry and fabless design house as a customer.", entityId: "b9999999-9999-4999-8999-999999999999" },
  { ticker: "CDNS", name: "Cadence Design Systems, Inc.", thesis: "Duopoly with SNPS; Cala us-gaap R&D spend steady and margins expanding.", entityId: "c1111111-1111-4111-8111-111111111111" },
  { ticker: "KLAC", name: "KLA Corporation", thesis: "Process control leader; Cala IS_AFFILIATE_OF edges show TSMC, Samsung, Intel all as customers.", entityId: "c2222222-2222-4222-8222-222222222222" },
];

const SATELLITE: ReadonlyArray<Omit<MockPosition, "amount">> = [
  { ticker: "LRCX", name: "Lam Research Corporation", thesis: "WFE cycle upturn; Cala tracks memory-capex dependency.", entityId: "c3333333-3333-4333-8333-333333333333" },
  { ticker: "ON", name: "ON Semiconductor Corp.", thesis: "Silicon-carbide for EVs; CorporateEvent edges track Tesla supply agreements.", entityId: "c4444444-4444-4444-8444-444444444444" },
  { ticker: "NXPI", name: "NXP Semiconductors N.V.", thesis: "Automotive semi exposure; Cala subsidiary graph rich in EU regulators.", entityId: "c5555555-5555-4555-8555-555555555555" },
  { ticker: "MELI", name: "MercadoLibre, Inc.", thesis: "LatAm fintech and e-commerce; us-gaap take-rate expanding.", entityId: "c6666666-6666-4666-8666-666666666666" },
  { ticker: "MDB", name: "MongoDB, Inc.", thesis: "Atlas consumption model; Cala graph tracks enterprise migration patterns.", entityId: "c7777777-7777-4777-8777-777777777777" },
  { ticker: "SNOW", name: "Snowflake Inc.", thesis: "AI workloads driving consumption; us-gaap RPO growth visible in filings.", entityId: "c8888888-8888-4888-8888-888888888888" },
  { ticker: "TTD", name: "The Trade Desk, Inc.", thesis: "CTV share-take; Cala CorporateEvent edges flag UID 2.0 adoption milestones.", entityId: "c9999999-9999-4999-8999-999999999999" },
  { ticker: "ODFL", name: "Old Dominion Freight Line, Inc.", thesis: "Best-in-class LTL margins; Cala us-gaap metrics show steady operating leverage.", entityId: "d1111111-1111-4111-8111-111111111111" },
  { ticker: "ADP", name: "Automatic Data Processing, Inc.", thesis: "Payroll float + defensive; Cala graph shows 1M+ SMB customer relationships.", entityId: "d2222222-2222-4222-8222-222222222222" },
  { ticker: "ASML", name: "ASML Holding N.V.", thesis: "EUV monopoly; Cala IS_AFFILIATE_OF graph confirms TSMC and Samsung as top customers.", entityId: "d3333333-3333-4333-8333-333333333333" },
  { ticker: "ARM", name: "Arm Holdings plc", thesis: "Royalty model leverage; Cala CorporateEvent tracks v9 adoption across mobile + datacenter.", entityId: "d4444444-4444-4444-8444-444444444444" },
  { ticker: "SMCI", name: "Super Micro Computer, Inc.", thesis: "AI server build-to-order flywheel; NVDA supply-chain edge visible in Cala graph.", entityId: "d5555555-5555-4555-8555-555555555555" },
  { ticker: "LULU", name: "Lululemon Athletica Inc.", thesis: "Brand premium; us-gaap international growth segment compounding.", entityId: "d6666666-6666-4666-8666-666666666666" },
  { ticker: "MNST", name: "Monster Beverage Corporation", thesis: "Energy drink cash cow; Cala graph shows stable distribution agreements.", entityId: "d7777777-7777-4777-8777-777777777777" },
  { ticker: "MAR", name: "Marriott International, Inc.", thesis: "Asset-light travel compounder; us-gaap RevPAR visible in 10-Qs.", entityId: "d8888888-8888-4888-8888-888888888888" },
  { ticker: "CTAS", name: "Cintas Corporation", thesis: "Boring compounder; Cala us-gaap operating margin expanding for a decade.", entityId: "d9999999-9999-4999-8999-999999999999" },
  { ticker: "PAYX", name: "Paychex, Inc.", thesis: "SMB payroll + defensive yield; Cala XBRL cash position steadily growing.", entityId: "e1111111-1111-4111-8111-111111111111" },
  { ticker: "ORLY", name: "O'Reilly Automotive, Inc.", thesis: "Share-take in auto parts; recession-resilient per Cala us-gaap trend.", entityId: "e2222222-2222-4222-8222-222222222222" },
  { ticker: "ROST", name: "Ross Stores, Inc.", thesis: "Off-price moat; Cala graph shows steady store-count expansion.", entityId: "e3333333-3333-4333-8333-333333333333" },
  { ticker: "FAST", name: "Fastenal Company", thesis: "Industrial distribution; defensive with dividend growth.", entityId: "e4444444-4444-4444-8444-444444444444" },
];

function buildBasePortfolio(): MockPosition[] {
  return [
    ...HIGH_CONVICTION.map(p => ({ ...p, amount: 40_000 })),
    ...CORE.map(p => ({ ...p, amount: 20_000 })),
    ...SATELLITE.map(p => ({ ...p, amount: 10_000 })),
  ];
}

function buildAltPortfolio(): MockPosition[] {
  const base = buildBasePortfolio();
  const trimmed = base.slice(0, -3);
  const replacements: MockPosition[] = [
    {
      ticker: "INTC",
      name: "Intel Corporation",
      amount: 10_000,
      thesis: "Turnaround optionality; Cala tracks Gaudi roadmap via CorporateEvent edges.",
      entityId: "f1111111-1111-4111-8111-111111111111",
    },
    {
      ticker: "WDAY",
      name: "Workday, Inc.",
      amount: 10_000,
      thesis: "HCM + finance SaaS; us-gaap subscription growth rebounding.",
      entityId: "f2222222-2222-4222-8222-222222222222",
    },
    {
      ticker: "PYPL",
      name: "PayPal Holdings, Inc.",
      amount: 10_000,
      thesis: "Turnaround under new CEO; Cala graph shows Venmo monetisation ramp.",
      entityId: "f3333333-3333-4333-8333-333333333333",
    },
  ];
  const reweighted = [...trimmed, ...replacements].map(position => {
    if (position.ticker === "NVDA") return { ...position, amount: 55_000 };
    if (position.ticker === "MSFT") return { ...position, amount: 25_000 };
    return position;
  });
  return reweighted;
}

function buildResult(
  portfolio: MockPosition[],
  report: string,
  opts: { postCutoffDataUsed?: boolean } = {},
): CalaAgentResult {
  return {
    model: MOCK_MODEL,
    output: {
      portfolioThesis:
        "Favor NASDAQ companies with low or improving filing-linked legal-entity complexity.",
      submissionPayload: {
        team_id: "skunk",
        model_agent_name: MOCK_AGENT_NAME,
        model_agent_version: MOCK_AGENT_VERSION,
        transactions: portfolio.map(position => ({
          nasdaq_code: position.ticker,
          amount: position.amount,
        })),
      },
      positions: portfolio.map((position, index) => ({
        nasdaqCode: position.ticker,
        companyName: position.name,
        companyEntityId: position.entityId,
        amount: position.amount,
        thesis: position.thesis,
        currentAnnualFilingDate: "2025-02-14",
        priorAnnualFilingDate: "2024-02-15",
        subsidiaryCount: 12 + (index % 9),
        jurisdictionCount: 4 + (index % 5),
        hierarchyDepth: 2 + (index % 3),
        complexityScore: Number((1.8 + index * 0.03).toFixed(2)),
        complexityChangeVsPrior:
          index % 4 === 0 ? Number((-0.28 + index * 0.002).toFixed(2)) : -0.08,
        calaEvidence: [
          `Annual filing on 2025-02-14 linked to ${position.name}'s subsidiary graph in Cala`,
          `entity_search("${position.name}")`,
          `retrieve_entity(${position.entityId.slice(0, 8)}…) captured subsidiaries, jurisdictions, and control depth`,
        ],
        supportingEntityIds: [position.entityId],
        riskNotes: [
          "Sparse graph coverage for some lower-tier entities",
          "Some legal-entity simplification may reflect restructuring rather than healthy focus",
        ],
        cutoffComplianceNote:
          "All structural evidence was treated as annual-filing-linked and pre-cutoff; no post-2025-04-15 market data was used.",
      })),
      cutoffAudit: {
        postCutoffDataUsed: opts.postCutoffDataUsed ?? false,
        complianceSummary:
          opts.postCutoffDataUsed
            ? "Flagged: one or more retrievals carried a source date after 2025-04-15. Manual review required."
            : "Reasoning grounded in filing-linked Cala entity structure only. No prices, returns, or post-cutoff events consulted.",
        bannedDataChecks: [
          "No ticker price lookups",
          "No analyst rating queries",
          "No news sentiment queries",
          "No insider transaction queries",
        ],
      },
      openGaps: [
        "Peer normalization is not represented in the mock payload.",
        "Filing-linked complexity deltas are illustrative rather than computed from real Cala snapshots.",
      ],
      reportMarkdown: report,
    },
    steps: buildMockSteps(),
  };
}

function buildMockSteps() {
  return [
    {
      text: "Loading NASDAQ candidate universe from Cala's entity graph. Starting with legal-name resolution for well-covered NASDAQ filers.",
      finishReason: "tool-calls",
      toolCalls: [
        { toolName: "entity_search", input: { name: "NVIDIA CORP", entity_types: ["Company"] } },
        { toolName: "entity_search", input: { name: "MICROSOFT CORP", entity_types: ["Company"] } },
        { toolName: "entity_search", input: { name: "Alphabet Inc.", entity_types: ["Company"] } },
      ],
      toolResults: [
        { toolName: "entity_search", output: { entities: [{ id: "5f7ca504-01d8-4aa9-b1ac-889202fd17c9", name: "NVIDIA CORP" }] } },
      ],
    },
    {
      text: "Introspecting top candidates to find filing-linked ownership structure, jurisdictions, and dated evidence.",
      finishReason: "tool-calls",
      toolCalls: [
        { toolName: "entity_introspection", input: { entity_id: "5f7ca504-01d8-4aa9-b1ac-889202fd17c9" } },
      ],
      toolResults: [
        { toolName: "entity_introspection", output: { properties: ["bics", "cik", "lei", "employee_count"] } },
      ],
    },
    {
      text: "Building the final 50-position portfolio with equal weights after ranking on legal-entity complexity.",
      finishReason: "stop",
      toolCalls: [],
      toolResults: [],
    },
  ];
}

const BASE_REPORT = `## Thesis

Cala's entity graph is richest where filing-linked company structure is populated and dated. Our edge comes from **legal-entity complexity** — we favor NASDAQ names whose subsidiary graph is simpler than peers or getting simpler versus the prior annual filing.

## Portfolio Decisions

### Selected examples

- **NVDA** · <entity UUID="5f7ca504-01d8-4aa9-b1ac-889202fd17c9">NVIDIA CORP</entity> — Filing-linked entity graph stays focused relative to mega-cap peers despite global scale.
- **META** — Subsidiary count and jurisdiction spread remain manageable for a platform business of its size.
- **GOOGL** — Still complex, but this mock thesis treats it as stable rather than deteriorating versus the prior filing.
- **MSFT** — Large-cap structure remains broad but orderly; no evidence of worsening entity sprawl in the mock payload.

Diversified across semiconductor infrastructure (AMAT, KLAC, LRCX), software platforms (PANW, CRWD, DDOG), and defensive compounders (COST, ADP), all framed through filing-linked entity simplicity rather than price momentum.

Smaller positions in NASDAQ names whose mock filing-linked graphs appear simple enough to clear the coverage and complexity filters.

## Time Cutoff Audit

All retrievals were treated as filing-linked entity-structure reads. No price lookups, no analyst ratings, no insider transactions, no post-cutoff news. The Cala sources on every property were assumed to be tied to pre-2025-04-15 filings where available, though the mock payload still flags point-in-time caveats.

## Open Gaps

- Cala cannot guarantee native point-in-time snapshots, so the final selected names still need manual source-date review.
- Peer normalization is not represented in this mock report.
- Smaller names (ARM, SMCI) have thinner graph coverage than mega-caps.`;

let eventCounter = 0;
const eventId = () => `mock-evt-${(eventCounter++).toString().padStart(5, "0")}`;

function buildRunEvents(opts: {
  startMinutesAgo: number;
  runId: string;
  prompt: string;
  stepCount: number;
  toolCalls: number;
  stopAfter?: "step-started" | "tool-started" | "tool-finished" | "step-finished";
  finished?: "ok" | "error";
  errorMessage?: string;
}): AgentRunEvent[] {
  const events: AgentRunEvent[] = [];
  const start = opts.startMinutesAgo * 60;
  let elapsed = 0;

  events.push({
    id: eventId(),
    at: secondsAgo(start - elapsed),
    level: "info",
    type: "run-started",
    title: "Run started",
    data: {
      requestId: opts.runId + "-req",
      promptPreview: opts.prompt.slice(0, 240),
    },
  });

  for (let step = 0; step < opts.stepCount; step++) {
    elapsed += 6;
    events.push({
      id: eventId(),
      at: secondsAgo(start - elapsed),
      level: "info",
      type: "step-started",
      title: `Step ${step + 1} started`,
      data: { stepNumber: step, model: MOCK_MODEL },
    });

    const toolsThisStep = Math.max(1, Math.round(opts.toolCalls / opts.stepCount));
    for (let t = 0; t < toolsThisStep; t++) {
      elapsed += 3;
      const toolName =
        t % 3 === 0 ? "entity_search" : t % 3 === 1 ? "entity_introspection" : "retrieve_entity";
      events.push({
        id: eventId(),
        at: secondsAgo(start - elapsed),
        level: "info",
        type: "tool-started",
        title: `Tool ${toolName} started`,
        data: {
          stepNumber: step,
          toolCallId: `mock-tc-${step}-${t}`,
          toolName,
          input: { name: "NVIDIA CORP" },
        },
      });

      elapsed += 2;
      events.push({
        id: eventId(),
        at: secondsAgo(start - elapsed),
        level: "info",
        type: "tool-finished",
        title: `Tool ${toolName} finished`,
        data: {
          stepNumber: step,
          toolCallId: `mock-tc-${step}-${t}`,
          toolName,
          durationMs: 420,
          output: { ok: true },
        },
      });
    }

    elapsed += 2;
    events.push({
      id: eventId(),
      at: secondsAgo(start - elapsed),
      level: "info",
      type: "step-finished",
      title: `Step ${step + 1} finished`,
      data: {
        stepNumber: step,
        finishReason: "tool-calls",
        toolCallCount: toolsThisStep,
      },
    });
  }

  if (opts.finished === "ok") {
    elapsed += 3;
    events.push({
      id: eventId(),
      at: secondsAgo(start - elapsed),
      level: "info",
      type: "run-finished",
      title: "Run finished",
      data: { positions: 50, transactions: 50 },
    });
  } else if (opts.finished === "error") {
    elapsed += 3;
    events.push({
      id: eventId(),
      at: secondsAgo(start - elapsed),
      level: "error",
      type: "run-failed",
      title: "Run failed",
      data: { message: opts.errorMessage ?? "Unknown error" },
    });
  }

  return events;
}

export const MOCK_RUN_IDS = {
  running: "mock-run-001-running",
  doneAlt: "mock-run-002-done-alt",
  doneStrong: "mock-run-003-done-strong",
  submittedWinner: "mock-run-004-submitted-winner",
  submittedLoser: "mock-run-005-submitted-loser",
  submitFailed: "mock-run-006-submit-failed",
  failed: "mock-run-007-failed",
} as const;

const runningPrompt =
  "Build the first full challenge submission using one thesis only: favor NASDAQ companies with low or improving legal-entity complexity from filing-linked subsidiary/control graphs available on or before 2025-04-15. Use 50 equal $20,000 positions and explain the picks with Cala-backed evidence only.";

export function buildMockRunRecords(): AgentRunRecord[] {
  eventCounter = 0;

  const runningEvents = buildRunEvents({
    startMinutesAgo: 0.5,
    runId: MOCK_RUN_IDS.running,
    prompt: runningPrompt,
    stepCount: 1,
    toolCalls: 4,
  });
  const running: AgentRunRecord = {
    id: MOCK_RUN_IDS.running,
    runId: MOCK_RUN_IDS.running,
    requestId: MOCK_RUN_IDS.running + "-req",
    prompt: runningPrompt,
    agentName: MOCK_AGENT_NAME,
    agentVersion: MOCK_AGENT_VERSION,
    status: "running",
    startedAt: secondsAgo(30),
    eventCount: runningEvents.length,
    stepCount: 1,
    toolCallCount: 4,
    model: MOCK_MODEL,
    events: runningEvents,
  };

  const altReport = BASE_REPORT.replace(
    "## Thesis",
    "## Thesis\n\n_Prior iteration: uses INTC / WDAY / PYPL as satellite positions and weights NVDA heavier at $55k._",
  );
  const altEvents = buildRunEvents({
    startMinutesAgo: 40,
    runId: MOCK_RUN_IDS.doneAlt,
    prompt: runningPrompt,
    stepCount: 5,
    toolCalls: 18,
    finished: "ok",
  });
  const doneAlt: AgentRunRecord = {
    id: MOCK_RUN_IDS.doneAlt,
    runId: MOCK_RUN_IDS.doneAlt,
    requestId: MOCK_RUN_IDS.doneAlt + "-req",
    prompt: runningPrompt,
    agentName: MOCK_AGENT_NAME,
    agentVersion: MOCK_AGENT_VERSION,
    status: "completed",
    startedAt: minutesAgo(40),
    finishedAt: minutesAgo(38),
    durationMs: 2 * 60_000,
    model: MOCK_MODEL,
    eventCount: altEvents.length,
    stepCount: 5,
    toolCallCount: 18,
    result: buildResult(buildAltPortfolio(), altReport),
    events: altEvents,
  };

  const doneEvents = buildRunEvents({
    startMinutesAgo: 15,
    runId: MOCK_RUN_IDS.doneStrong,
    prompt: runningPrompt,
    stepCount: 6,
    toolCalls: 22,
    finished: "ok",
  });
  const doneStrong: AgentRunRecord = {
    id: MOCK_RUN_IDS.doneStrong,
    runId: MOCK_RUN_IDS.doneStrong,
    requestId: MOCK_RUN_IDS.doneStrong + "-req",
    prompt: runningPrompt,
    agentName: MOCK_AGENT_NAME,
    agentVersion: MOCK_AGENT_VERSION,
    status: "completed",
    startedAt: minutesAgo(15),
    finishedAt: minutesAgo(13),
    durationMs: 2 * 60_000,
    model: MOCK_MODEL,
    eventCount: doneEvents.length,
    stepCount: 6,
    toolCallCount: 22,
    result: buildResult(buildBasePortfolio(), BASE_REPORT),
    events: doneEvents,
  };

  const winnerEvents = [
    ...buildRunEvents({
      startMinutesAgo: 25,
      runId: MOCK_RUN_IDS.submittedWinner,
      prompt: runningPrompt,
      stepCount: 6,
      toolCalls: 24,
      finished: "ok",
    }),
    {
      id: eventId(),
      at: minutesAgo(4),
      level: "info" as const,
      type: "run-started" as const,
      title: "Leaderboard submission started",
      data: { teamId: "skunk", transactionCount: 50 },
    },
    {
      id: eventId(),
      at: minutesAgo(3.9),
      level: "info" as const,
      type: "run-finished" as const,
      title: "Leaderboard submission accepted",
      data: { totalReturn: 0.2174 },
    },
  ];
  const submittedWinner: AgentRunRecord = {
    id: MOCK_RUN_IDS.submittedWinner,
    runId: MOCK_RUN_IDS.submittedWinner,
    requestId: MOCK_RUN_IDS.submittedWinner + "-req",
    prompt: runningPrompt,
    agentName: MOCK_AGENT_NAME,
    agentVersion: MOCK_AGENT_VERSION,
    status: "completed",
    startedAt: minutesAgo(25),
    finishedAt: minutesAgo(23),
    durationMs: 2 * 60_000,
    model: MOCK_MODEL,
    eventCount: winnerEvents.length,
    stepCount: 6,
    toolCallCount: 24,
    result: buildResult(buildBasePortfolio(), BASE_REPORT),
    leaderboardSubmission: {
      status: "submitted",
      submittedAt: minutesAgo(4),
      requestId: "mock-sub-winner",
      response: {
        score: 1_217_432,
        totalReturn: 0.2174,
        spxReturn: 0.096,
        excessReturn: 0.1214,
        sharpe: 1.82,
        maxDrawdown: -0.084,
        positionsScored: 50,
        message:
          "Portfolio accepted. Realised return +21.74% vs SPX +9.6%. Beat the index by 12.14 percentage points.",
        status: "accepted",
      },
    },
    events: winnerEvents,
  };

  const loserEvents = [
    ...buildRunEvents({
      startMinutesAgo: 55,
      runId: MOCK_RUN_IDS.submittedLoser,
      prompt: runningPrompt,
      stepCount: 4,
      toolCalls: 14,
      finished: "ok",
    }),
    {
      id: eventId(),
      at: minutesAgo(50),
      level: "info" as const,
      type: "run-finished" as const,
      title: "Leaderboard submission accepted",
      data: { totalReturn: -0.0612 },
    },
  ];
  const submittedLoser: AgentRunRecord = {
    id: MOCK_RUN_IDS.submittedLoser,
    runId: MOCK_RUN_IDS.submittedLoser,
    requestId: MOCK_RUN_IDS.submittedLoser + "-req",
    prompt: runningPrompt,
    agentName: MOCK_AGENT_NAME,
    agentVersion: MOCK_AGENT_VERSION,
    status: "completed",
    startedAt: minutesAgo(55),
    finishedAt: minutesAgo(53),
    durationMs: 2 * 60_000,
    model: MOCK_MODEL,
    eventCount: loserEvents.length,
    stepCount: 4,
    toolCallCount: 14,
    result: buildResult(buildAltPortfolio(), altReport),
    leaderboardSubmission: {
      status: "submitted",
      submittedAt: minutesAgo(50),
      requestId: "mock-sub-loser",
      response: {
        score: 938_800,
        totalReturn: -0.0612,
        spxReturn: 0.096,
        excessReturn: -0.1572,
        sharpe: -0.41,
        maxDrawdown: -0.174,
        positionsScored: 50,
        message:
          "Portfolio accepted. Realised return −6.12% vs SPX +9.6%. Underperformed the index by 15.72 percentage points.",
        status: "accepted",
      },
    },
    events: loserEvents,
  };

  const submitFailedEvents = buildRunEvents({
    startMinutesAgo: 90,
    runId: MOCK_RUN_IDS.submitFailed,
    prompt: runningPrompt,
    stepCount: 5,
    toolCalls: 17,
    finished: "ok",
  });
  submitFailedEvents.push({
    id: eventId(),
    at: minutesAgo(85),
    level: "error",
    type: "run-failed",
    title: "Leaderboard submission failed",
    data: {
      upstreamStatus: 422,
      upstreamStatusText: "Unprocessable Entity",
      details: { error: "Ticker XYZQ not in approved NASDAQ universe." },
    },
  });
  const submitFailed: AgentRunRecord = {
    id: MOCK_RUN_IDS.submitFailed,
    runId: MOCK_RUN_IDS.submitFailed,
    requestId: MOCK_RUN_IDS.submitFailed + "-req",
    prompt: runningPrompt,
    agentName: MOCK_AGENT_NAME,
    agentVersion: MOCK_AGENT_VERSION,
    status: "completed",
    startedAt: minutesAgo(90),
    finishedAt: minutesAgo(88),
    durationMs: 2 * 60_000,
    model: MOCK_MODEL,
    eventCount: submitFailedEvents.length,
    stepCount: 5,
    toolCallCount: 17,
    result: buildResult(buildBasePortfolio(), BASE_REPORT),
    leaderboardSubmission: {
      status: "failed",
      submittedAt: minutesAgo(85),
      requestId: "mock-sub-failed",
      upstreamStatus: 422,
      upstreamStatusText: "Unprocessable Entity",
      details: {
        error: "Ticker XYZQ not in approved NASDAQ universe.",
        offendingTicker: "XYZQ",
        accepted_tickers: 49,
        rejected_tickers: 1,
      },
    },
    events: submitFailedEvents,
  };

  const failedEvents = buildRunEvents({
    startMinutesAgo: 120,
    runId: MOCK_RUN_IDS.failed,
    prompt: runningPrompt,
    stepCount: 1,
    toolCalls: 2,
    finished: "error",
    errorMessage: "ANTHROPIC_API_KEY is not set.",
  });
  const failed: AgentRunRecord = {
    id: MOCK_RUN_IDS.failed,
    runId: MOCK_RUN_IDS.failed,
    requestId: MOCK_RUN_IDS.failed + "-req",
    prompt: runningPrompt,
    agentName: MOCK_AGENT_NAME,
    agentVersion: MOCK_AGENT_VERSION,
    status: "failed",
    startedAt: minutesAgo(120),
    finishedAt: minutesAgo(119),
    durationMs: 45_000,
    model: MOCK_MODEL,
    eventCount: failedEvents.length,
    stepCount: 1,
    toolCallCount: 2,
    error: {
      message: "ANTHROPIC_API_KEY is not set.",
      details: { hint: "Add it to .env.local and restart the dev server." },
    },
    events: failedEvents,
  };

  return [running, doneStrong, submittedWinner, doneAlt, submittedLoser, submitFailed, failed];
}

export function buildFreshRunningFixture(): AgentRunRecord {
  eventCounter = 900;
  const id = `mock-run-fresh-${Date.now().toString(36)}`;
  const events = buildRunEvents({
    startMinutesAgo: 0.1,
    runId: id,
    prompt: runningPrompt,
    stepCount: 0,
    toolCalls: 0,
  });
  return {
    id,
    runId: id,
    requestId: id + "-req",
    prompt: runningPrompt,
    agentName: MOCK_AGENT_NAME,
    agentVersion: MOCK_AGENT_VERSION,
    status: "running",
    startedAt: new Date().toISOString(),
    eventCount: events.length,
    stepCount: 0,
    toolCallCount: 0,
    model: MOCK_MODEL,
    events,
  };
}
