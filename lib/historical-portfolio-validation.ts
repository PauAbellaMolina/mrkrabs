import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const PRICE_CACHE_PATH = path.join(
  process.cwd(),
  ".data",
  "historical-price-cache.json",
);
const YAHOO_CHART_BASE_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart";
const WINDOW_PADDING_DAYS = 7;
const FETCH_CONCURRENCY = 8;
const REPAIR_UNDERPERFORMANCE_PCT = -10;
const REPAIR_DEEP_LOSER_PCT = -25;
const REPAIR_DEEP_LOSER_COUNT = 8;
const MIN_CAPITAL_COVERAGE_PCT = 95;

export const DEFAULT_PRIOR_WINDOW = {
  label: "Prior-window sanity replay",
  startDate: "2024-04-15",
  endDate: "2025-04-15",
} as const;

export interface HistoricalValidationPosition {
  nasdaqCode: string;
  companyName: string;
  amount: number;
}

interface ResolvedWindowPrice {
  startDate: string;
  startPrice: number;
  endDate: string;
  endPrice: number;
  fetchedAt: string;
}

interface PriceCacheFile {
  version: 1;
  entries: Record<string, ResolvedWindowPrice>;
}

interface ReplayPositionSummary {
  nasdaqCode: string;
  companyName: string;
  amount: number;
  startDate: string;
  startPrice: number;
  endDate: string;
  endPrice: number;
  returnPct: number;
  contributionUsd: number;
}

export interface HistoricalPortfolioValidationReport {
  dataSource: string;
  window: {
    label: string;
    startDate: string;
    endDate: string;
  };
  totalPositions: number;
  validatedPositions: number;
  validatedCapitalUsd: number;
  capitalCoveragePct: number;
  missingTickers: string[];
  portfolioReturnPct: number | null;
  benchmarkReturnPct: {
    SPY: number | null;
    QQQ: number | null;
  };
  excessReturnPct: {
    vsSPY: number | null;
    vsQQQ: number | null;
  };
  deepLoserCount: number;
  shouldRepair: boolean;
  concerns: string[];
  guidance: string[];
  topWinners: ReplayPositionSummary[];
  topLosers: ReplayPositionSummary[];
}

const normalizeTicker = (ticker: string) => ticker.trim().toUpperCase();

const dateToUnixSeconds = (date: string) =>
  Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);

const buildCacheKey = (ticker: string, startDate: string, endDate: string) =>
  `${normalizeTicker(ticker)}|${startDate}|${endDate}`;

const formatPct = (value: number) => `${value.toFixed(2)}%`;

const round2 = (value: number) => Math.round(value * 100) / 100;

const loadPriceCache = async (): Promise<PriceCacheFile> => {
  try {
    const raw = await readFile(PRICE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as PriceCacheFile;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
      return { version: 1, entries: {} };
    }
    return parsed;
  } catch {
    return { version: 1, entries: {} };
  }
};

const persistPriceCache = async (cache: PriceCacheFile) => {
  await mkdir(path.dirname(PRICE_CACHE_PATH), { recursive: true });
  await writeFile(PRICE_CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );

  return results;
};

const fetchWindowPrice = async (
  ticker: string,
  startDate: string,
  endDate: string,
  cache: PriceCacheFile,
): Promise<ResolvedWindowPrice | null> => {
  const normalizedTicker = normalizeTicker(ticker);
  const cacheKey = buildCacheKey(normalizedTicker, startDate, endDate);
  const cached = cache.entries[cacheKey];
  if (cached) {
    return cached;
  }

  const period1 =
    dateToUnixSeconds(startDate) - WINDOW_PADDING_DAYS * 24 * 60 * 60;
  const period2 =
    dateToUnixSeconds(endDate) + WINDOW_PADDING_DAYS * 24 * 60 * 60;
  const url = new URL(`${YAHOO_CHART_BASE_URL}/${encodeURIComponent(normalizedTicker)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("includeAdjustedClose", "true");
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "mrkrabs/0.1 historical-validation",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          adjclose?: Array<{ adjclose?: Array<number | null> }>;
          quote?: Array<{ close?: Array<number | null> }>;
        };
      }>;
      error?: { description?: string };
    };
  };

  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const adjustedCloses =
    result?.indicators?.adjclose?.[0]?.adjclose ??
    result?.indicators?.quote?.[0]?.close ??
    [];

  const points = timestamps
    .map((timestamp, index) => {
      const close = adjustedCloses[index];
      if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
        return null;
      }

      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close,
      };
    })
    .filter((value): value is { date: string; close: number } => value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const startPoint = points.find((point) => point.date >= startDate);
  const endPoint = [...points].reverse().find((point) => point.date <= endDate);

  if (!startPoint || !endPoint) {
    return null;
  }

  const resolved: ResolvedWindowPrice = {
    startDate: startPoint.date,
    startPrice: round2(startPoint.close),
    endDate: endPoint.date,
    endPrice: round2(endPoint.close),
    fetchedAt: new Date().toISOString(),
  };

  cache.entries[cacheKey] = resolved;
  return resolved;
};

const buildReplaySummary = (
  position: HistoricalValidationPosition,
  price: ResolvedWindowPrice,
): ReplayPositionSummary => {
  const shares = position.amount / price.startPrice;
  const endValue = shares * price.endPrice;
  const contributionUsd = endValue - position.amount;
  const returnPct = ((price.endPrice - price.startPrice) / price.startPrice) * 100;

  return {
    nasdaqCode: normalizeTicker(position.nasdaqCode),
    companyName: position.companyName.trim(),
    amount: position.amount,
    startDate: price.startDate,
    startPrice: price.startPrice,
    endDate: price.endDate,
    endPrice: price.endPrice,
    returnPct: round2(returnPct),
    contributionUsd: round2(contributionUsd),
  };
};

export const validatePortfolioPriorWindow = async (
  positions: HistoricalValidationPosition[],
  window = DEFAULT_PRIOR_WINDOW,
): Promise<HistoricalPortfolioValidationReport> => {
  const uniquePositions = Array.from(
    new Map(
      positions.map((position) => [
        normalizeTicker(position.nasdaqCode),
        {
          nasdaqCode: normalizeTicker(position.nasdaqCode),
          companyName: position.companyName.trim() || normalizeTicker(position.nasdaqCode),
          amount: position.amount,
        },
      ]),
    ).values(),
  );

  const cache = await loadPriceCache();

  const resolved = await mapWithConcurrency(uniquePositions, FETCH_CONCURRENCY, async (position) => {
    const price = await fetchWindowPrice(
      position.nasdaqCode,
      window.startDate,
      window.endDate,
      cache,
    );
    return {
      position,
      price,
    };
  });

  const spyPrice = await fetchWindowPrice("SPY", window.startDate, window.endDate, cache);
  const qqqPrice = await fetchWindowPrice("QQQ", window.startDate, window.endDate, cache);

  await persistPriceCache(cache);

  const validSummaries = resolved
    .filter(
      (
        item,
      ): item is { position: HistoricalValidationPosition; price: ResolvedWindowPrice } =>
        item.price !== null,
    )
    .map((item) => buildReplaySummary(item.position, item.price));

  const missingTickers = resolved
    .filter((item) => item.price === null)
    .map((item) => normalizeTicker(item.position.nasdaqCode));

  const validatedCapitalUsd = round2(
    validSummaries.reduce((sum, position) => sum + position.amount, 0),
  );
  const capitalCoveragePct =
    positions.length === 0
      ? 0
      : round2((validatedCapitalUsd / 1_000_000) * 100);

  const totalEndValue = validSummaries.reduce((sum, position) => {
    const shares = position.amount / position.startPrice;
    return sum + shares * position.endPrice;
  }, 0);

  const portfolioReturnPct =
    validatedCapitalUsd > 0
      ? round2(((totalEndValue - validatedCapitalUsd) / validatedCapitalUsd) * 100)
      : null;

  const spyReturnPct =
    spyPrice
      ? round2(((spyPrice.endPrice - spyPrice.startPrice) / spyPrice.startPrice) * 100)
      : null;
  const qqqReturnPct =
    qqqPrice
      ? round2(((qqqPrice.endPrice - qqqPrice.startPrice) / qqqPrice.startPrice) * 100)
      : null;

  const excessReturnVsSpyPct =
    portfolioReturnPct != null && spyReturnPct != null
      ? round2(portfolioReturnPct - spyReturnPct)
      : null;
  const excessReturnVsQqqPct =
    portfolioReturnPct != null && qqqReturnPct != null
      ? round2(portfolioReturnPct - qqqReturnPct)
      : null;

  const deepLosers = validSummaries.filter(
    (position) => position.returnPct <= REPAIR_DEEP_LOSER_PCT,
  );
  const concerns: string[] = [];
  const guidance: string[] = [];

  if (missingTickers.length > 0) {
    concerns.push(
      `${missingTickers.length} ticker(s) lacked replay price data: ${missingTickers.join(", ")}.`,
    );
    guidance.push(
      "Replace or deprioritize tickers that do not have clean prior-window price coverage.",
    );
  }

  if (capitalCoveragePct < MIN_CAPITAL_COVERAGE_PCT) {
    concerns.push(
      `Prior-window replay only covered ${formatPct(capitalCoveragePct)} of the portfolio by capital.`,
    );
    guidance.push(
      "Keep replay coverage above 95% of capital before trusting the sanity check.",
    );
  }

  if (
    excessReturnVsSpyPct != null &&
    excessReturnVsSpyPct <= REPAIR_UNDERPERFORMANCE_PCT
  ) {
    concerns.push(
      `Prior-window replay underperformed SPY by ${formatPct(Math.abs(excessReturnVsSpyPct))}.`,
    );
    guidance.push(
      "Re-check whether the portfolio is overexposed to names with worsening complexity or distress-like simplification.",
    );
  }

  if (deepLosers.length >= REPAIR_DEEP_LOSER_COUNT) {
    concerns.push(
      `${deepLosers.length} holdings lost at least ${formatPct(
        Math.abs(REPAIR_DEEP_LOSER_PCT),
      )} in the prior window.`,
    );
    guidance.push(
      "Inspect the worst losers for distress, thin evidence, or noisy ticker/entity resolution.",
    );
  }

  if (guidance.length === 0) {
    guidance.push(
      "The replay did not trigger a repair signal. Treat it as a sanity check, not as permission to optimize on past performance.",
    );
  }

  const byReturnAsc = [...validSummaries].sort((a, b) => a.returnPct - b.returnPct);
  const byReturnDesc = [...validSummaries].sort((a, b) => b.returnPct - a.returnPct);

  return {
    dataSource: "Yahoo Finance chart API (adjusted close, local sanity check only)",
    window: {
      label: window.label,
      startDate: window.startDate,
      endDate: window.endDate,
    },
    totalPositions: uniquePositions.length,
    validatedPositions: validSummaries.length,
    validatedCapitalUsd,
    capitalCoveragePct,
    missingTickers,
    portfolioReturnPct,
    benchmarkReturnPct: {
      SPY: spyReturnPct,
      QQQ: qqqReturnPct,
    },
    excessReturnPct: {
      vsSPY: excessReturnVsSpyPct,
      vsQQQ: excessReturnVsQqqPct,
    },
    deepLoserCount: deepLosers.length,
    shouldRepair: concerns.length > 0,
    concerns,
    guidance,
    topWinners: byReturnDesc.slice(0, 5),
    topLosers: byReturnAsc.slice(0, 5),
  };
};
