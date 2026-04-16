import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createCalaClient,
  type CalaClient,
  type CalaEntitySearchHit,
  type CalaKnowledgeSearchEntity,
} from "./cala";
import { composePromptSections } from "./system-prompt";

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_DIR = path.join(process.cwd(), ".data", "cala-preanalysis");
const CACHE_PATH = path.join(CACHE_DIR, "coverage-scout.json");
const DEFAULT_TARGET_SECTORS = [
  "Technology",
  "Healthcare",
  "Consumer Discretionary",
  "Industrials",
  "Financials",
  "Energy",
  "Materials",
];
const THESIS_KEY_PATTERN =
  /(subsidi|parent|control|ownership|jurisdiction|country|state|legal|incorporat|entity|address)/i;

export interface CalaPreanalysisCache {
  createdAt: string;
  promptSection: string;
  metadata?: CalaPreanalysisMetadata;
}

export interface CalaPreanalysisMetadata {
  attemptedSectors: string[];
  seedCompanies: Array<{
    sector: string;
    requestedName: string;
    entityId: string;
  }>;
  probeCompanies: Array<{
    sector: string;
    requestedName: string;
    resolvedName: string;
    entityId: string;
  }>;
}

interface ProbeSummary {
  sourceSector: string;
  requestedName: string;
  resolvedName: string;
  entityId: string;
  propertyKeys: string[];
  relationshipKeys: string[];
  numericalObservationLabels: string[];
}

interface SectorNarrativeHints {
  sector: string;
  contentSummary: string | null;
  explainabilityHints: string[];
  contextHints: string[];
  followUpKeywords: string[];
}

interface SectorSeed {
  sector: string;
  entity: CalaKnowledgeSearchEntity;
}

interface SectorBootstrapResult {
  sector: string;
  seeds: SectorSeed[];
  narrativeHints: SectorNarrativeHints;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "annual",
  "available",
  "before",
  "between",
  "companies",
  "company",
  "common",
  "equity",
  "filing",
  "filings",
  "focus",
  "from",
  "funds",
  "have",
  "listed",
  "need",
  "only",
  "over",
  "research",
  "several",
  "should",
  "since",
  "source",
  "starting",
  "stocks",
  "their",
  "there",
  "these",
  "those",
  "through",
  "using",
  "which",
  "with",
]);

const normalizeText = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");

const readEnvNumber = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const getTargetSectors = () => {
  const raw = process.env.CALA_PREANALYSIS_SECTORS?.trim();
  if (!raw) {
    return DEFAULT_TARGET_SECTORS;
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : DEFAULT_TARGET_SECTORS;
};

const getPreanalysisTimeoutMs = () =>
  readEnvNumber("CALA_PREANALYSIS_TIMEOUT_MS", 0);

const getBootstrapConcurrency = () =>
  Math.max(1, readEnvNumber("CALA_PREANALYSIS_BOOTSTRAP_CONCURRENCY", 2));

const getProbeConcurrency = () =>
  Math.max(1, readEnvNumber("CALA_PREANALYSIS_PROBE_CONCURRENCY", 3));

const getMaxBootstrapSectors = () =>
  Math.max(1, readEnvNumber("CALA_PREANALYSIS_MAX_BOOTSTRAP_SECTORS", 4));

const getTargetSeedCount = () =>
  Math.max(1, readEnvNumber("CALA_PREANALYSIS_TARGET_SEED_COUNT", 8));

const scoreHit = (requestedName: string, hit: CalaEntitySearchHit) => {
  const requested = normalizeText(requestedName);
  const resolved = normalizeText(hit.name);

  let score = 0;
  if ((hit.entityType ?? "").toLowerCase() === "company") {
    score += 100;
  }
  if (resolved === requested) {
    score += 50;
  } else if (resolved.startsWith(requested) || requested.startsWith(resolved)) {
    score += 25;
  } else if (resolved.includes(requested)) {
    score += 10;
  }
  if (typeof hit.score === "number") {
    score += hit.score;
  }

  return score;
};

const chooseBestHit = (
  requestedName: string,
  hits: CalaEntitySearchHit[],
) => {
  return [...hits]
    .sort((left, right) => {
      const scoreDelta =
        scoreHit(requestedName, right) - scoreHit(requestedName, left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.name.localeCompare(right.name);
    })
    .find((hit) => hit.id.trim().length > 0);
};

const bumpKeyCounts = (
  counts: Map<string, number>,
  keys: string[],
) => {
  for (const key of new Set(keys)) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
};

const rankKeys = (
  counts: Map<string, number>,
  maxCount: number,
  prioritizeThesisKeys = false,
) => {
  return [...counts.entries()]
    .sort((left, right) => {
      if (prioritizeThesisKeys) {
        const leftPriority = THESIS_KEY_PATTERN.test(left[0]) ? 1 : 0;
        const rightPriority = THESIS_KEY_PATTERN.test(right[0]) ? 1 : 0;
        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }
      }

      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .slice(0, maxCount)
    .map(([key, count]) => `${key} (${count})`);
};

const extractObservationLabels = (values: Record<string, unknown>[]) => {
  const labels = new Set<string>();

  for (const value of values) {
    const candidates = [
      value.name,
      value.entity_type,
      value.entityType,
      value.label,
      value.type,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        labels.add(candidate.trim());
        break;
      }
    }
  }

  return [...labels];
};

const renderProbeSummary = (probe: ProbeSummary) => {
  const interestingRelationships = probe.relationshipKeys
    .filter((key) => THESIS_KEY_PATTERN.test(key))
    .slice(0, 4);
  const relationshipPreview =
    interestingRelationships.length > 0
      ? interestingRelationships.join(", ")
      : probe.relationshipKeys.slice(0, 3).join(", ") || "none";

  return `- ${probe.sourceSector}: ${probe.requestedName} -> ${probe.resolvedName} | properties=${probe.propertyKeys.length} | relationships=${probe.relationshipKeys.length} | notable relationship keys: ${relationshipPreview}`;
};

const truncateSentence = (value: string | undefined, maxLength = 180) => {
  if (!value) {
    return null;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length <= maxLength
    ? trimmed
    : `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
};

const collectStrings = (rows: Record<string, unknown>[]) => {
  const values: string[] = [];

  for (const row of rows) {
    for (const key of ["content", "title", "name", "summary"]) {
      const candidate = row[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        values.push(candidate.trim());
        break;
      }
    }
  }

  return values;
};

const extractFollowUpKeywords = (values: string[]) => {
  const counts = new Map<string, number>();

  for (const value of values) {
    const words = normalizeText(value)
      .split(" ")
      .map((word) => word.trim())
      .filter(
        (word) =>
          word.length >= 4 &&
          !STOP_WORDS.has(word) &&
          !/^\d+$/.test(word),
      );

    for (const word of words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .slice(0, 6)
    .map(([word]) => word);
};

const buildPromptSection = (
  createdAt: string,
  targetSectors: string[],
  probes: ProbeSummary[],
  sectorNarratives: SectorNarrativeHints[],
) => {
  const propertyCounts = new Map<string, number>();
  const relationshipCounts = new Map<string, number>();
  const observationCounts = new Map<string, number>();

  for (const probe of probes) {
    bumpKeyCounts(propertyCounts, probe.propertyKeys);
    bumpKeyCounts(relationshipCounts, probe.relationshipKeys);
    bumpKeyCounts(observationCounts, probe.numericalObservationLabels);
  }

  const commonProperties = rankKeys(propertyCounts, 12);
  const commonRelationships = rankKeys(relationshipCounts, 12, true);
  const commonObservations = rankKeys(observationCounts, 8);

  return composePromptSections(
    "Runtime Cala coverage scout (generated from live Cala API probes, cached locally):",
    [
      `- Generated at ${createdAt}.`,
      `- Purpose: discover the actual Cala graph surface before research starts so you stop guessing which fields exist.`,
      `- This is NOT a candidate or recommendation list. Do not prefer or include a company because it appeared in this scout.`,
      `- Successful probes: ${probes.length}.`,
      `- Sector bootstrap source: knowledge_search over ${targetSectors.join(", ")}.`,
      commonProperties.length > 0
        ? `- Common properties seen across probes: ${commonProperties.join(", ")}.`
        : "- Common properties seen across probes: none.",
      commonRelationships.length > 0
        ? `- Common relationship keys seen across probes: ${commonRelationships.join(", ")}.`
        : "- Common relationship keys seen across probes: none.",
      commonObservations.length > 0
        ? `- Numerical observation labels seen: ${commonObservations.join(", ")}.`
        : "- Numerical observation labels seen: none.",
      `- Retrieval discipline: use entity_search -> entity_introspection -> retrieve_entity, and only request fields that introspection proved exist for that company.`,
      `- Coverage discipline: if a company has no clear subsidiary/control-style relationship keys after introspection, deprioritize or drop it quickly instead of spending more tool calls.`,
      `- Search discipline: use knowledge_search narrative, explainability, and context as soft research hints only. Do not use them as ranking evidence without structural verification.`,
      `- Narrative hints by sector:`,
      ...sectorNarratives.map((narrative) => {
        const segments = [
          `${narrative.sector}:`,
          narrative.contentSummary
            ? `summary=${narrative.contentSummary}`
            : "summary=none",
          narrative.explainabilityHints.length > 0
            ? `explainability=${narrative.explainabilityHints.join(" | ")}`
            : "explainability=none",
          narrative.contextHints.length > 0
            ? `context=${narrative.contextHints.join(" | ")}`
            : "context=none",
          narrative.followUpKeywords.length > 0
            ? `follow-up keywords=${narrative.followUpKeywords.join(", ")}`
            : "follow-up keywords=none",
        ];

        return `- ${segments.join(" ")}`;
      }),
      `- Live probe examples:`,
      ...probes.map(renderProbeSummary),
    ].join("\n"),
  );
};

const buildPreanalysisMetadata = (
  attemptedSectors: string[],
  seeds: SectorSeed[],
  probes: ProbeSummary[],
): CalaPreanalysisMetadata => ({
  attemptedSectors,
  seedCompanies: seeds.map((seed) => ({
    sector: seed.sector,
    requestedName: seed.entity.name,
    entityId: seed.entity.id,
  })),
  probeCompanies: probes.map((probe) => ({
    sector: probe.sourceSector,
    requestedName: probe.requestedName,
    resolvedName: probe.resolvedName,
    entityId: probe.entityId,
  })),
});

const logPreanalysisSummary = (
  source: "cache" | "stale-cache" | "live",
  createdAt: string,
  metadata: CalaPreanalysisMetadata,
) => {
  console.info("[cala-preanalysis][ready]", {
    source,
    createdAt,
    attemptedSectors: metadata.attemptedSectors,
    seedCompanies: metadata.seedCompanies.map((company) => ({
      sector: company.sector,
      name: company.requestedName,
      entityId: company.entityId,
    })),
    probeCompanies: metadata.probeCompanies.map((company) => ({
      sector: company.sector,
      requestedName: company.requestedName,
      resolvedName: company.resolvedName,
      entityId: company.entityId,
    })),
    cachePath: CACHE_PATH,
  });
};

export const readCalaPreanalysisCache = async (
  options: { allowStale?: boolean } = {},
) => {
  try {
    const raw = await readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as CalaPreanalysisCache;
    if (
      !parsed ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.promptSection !== "string"
    ) {
      return null;
    }

    const createdAtMs = Date.parse(parsed.createdAt);
    const ttlMs = readEnvNumber(
      "CALA_PREANALYSIS_TTL_MS",
      DEFAULT_CACHE_TTL_MS,
    );
    if (!Number.isFinite(createdAtMs)) {
      return null;
    }

    if (!options.allowStale && Date.now() - createdAtMs > ttlMs) {
      return null;
    }

    return {
      createdAt: parsed.createdAt,
      promptSection: parsed.promptSection,
      metadata: parsed.metadata,
    };
  } catch {
    return null;
  }
};

const writeCachedPromptSection = async (
  promptSection: string,
  metadata: CalaPreanalysisMetadata,
) => {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      CACHE_PATH,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          promptSection,
          metadata,
        } satisfies CalaPreanalysisCache,
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    console.warn("[cala-preanalysis][cache-write-failed]", error);
  }
};

const buildSectorBootstrapPrompt = (sector: string) =>
  [
    `Name several NASDAQ-listed ${sector} companies with annual filings available on or before 2025-04-15.`,
    "Focus on common stocks and established issuers, not ETFs, ADRs, funds, shells, or preferreds.",
    "I only need company entities that are good starting points for filing-linked legal-entity graph research.",
  ].join(" ");

const chooseKnowledgeSearchEntities = (
  sector: string,
  entities: CalaKnowledgeSearchEntity[],
) => {
  const filtered = entities.filter(
    (entity) => (entity.entityType ?? "").toLowerCase() === "company",
  );

  const seen = new Set<string>();
  return filtered
    .filter((entity) => {
      if (seen.has(entity.id)) {
        return false;
      }
      seen.add(entity.id);
      return true;
    })
    .slice(0, readEnvNumber("CALA_PREANALYSIS_MAX_ENTITIES_PER_SECTOR", 3))
    .map((entity) => ({ sector, entity }));
};

const buildSectorNarrativeHints = (
  sector: string,
  content: string | undefined,
  explainability: Record<string, unknown>[],
  context: Record<string, unknown>[],
): SectorNarrativeHints => {
  const explainabilityHints = collectStrings(explainability)
    .map((value) => truncateSentence(value, 140))
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
  const contextHints = collectStrings(context)
    .map((value) => truncateSentence(value, 140))
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
  const keywordSource = [
    content ?? "",
    ...explainabilityHints,
    ...contextHints,
  ].filter((value) => value.length > 0);

  return {
    sector,
    contentSummary: truncateSentence(content, 180),
    explainabilityHints,
    contextHints,
    followUpKeywords: extractFollowUpKeywords(keywordSource),
  };
};

const bootstrapSectorSeeds = async (
  client: CalaClient,
  sector: string,
): Promise<SectorBootstrapResult> => {
  const response = await client.knowledgeSearch(
    buildSectorBootstrapPrompt(sector),
  );
  return {
    sector,
    seeds: chooseKnowledgeSearchEntities(sector, response.entities),
    narrativeHints: buildSectorNarrativeHints(
      sector,
      response.content,
      response.explainability,
      response.context,
    ),
  };
};

const dedupeSeeds = (seeds: SectorSeed[]) =>
  seeds.filter((seed, index) => {
    return (
      seeds.findIndex((candidate) => candidate.entity.id === seed.entity.id) ===
      index
    );
  });

const bootstrapSeeds = async (
  client: CalaClient,
  targetSectors: string[],
) => {
  const maxBootstrapSectors = Math.min(
    targetSectors.length,
    getMaxBootstrapSectors(),
  );
  const bootstrapConcurrency = getBootstrapConcurrency();
  const targetSeedCount = getTargetSeedCount();
  const sectorsToAttempt = targetSectors.slice(0, maxBootstrapSectors);
  const seeds: SectorSeed[] = [];
  const sectorNarratives: SectorNarrativeHints[] = [];
  const failures: Array<{ sector: string; error: string }> = [];

  for (
    let startIndex = 0;
    startIndex < sectorsToAttempt.length && dedupeSeeds(seeds).length < targetSeedCount;
    startIndex += bootstrapConcurrency
  ) {
    const batch = sectorsToAttempt.slice(
      startIndex,
      startIndex + bootstrapConcurrency,
    );
    const results = await Promise.allSettled(
      batch.map((sector) => bootstrapSectorSeeds(client, sector)),
    );

    for (const [index, result] of results.entries()) {
      const sector = batch[index];
      if (result.status === "fulfilled") {
        seeds.push(...result.value.seeds);
        sectorNarratives.push(result.value.narrativeHints);
        continue;
      }

      failures.push({
        sector,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }

  return {
    seeds: dedupeSeeds(seeds),
    sectorNarratives,
    failures,
    attemptedSectors: sectorsToAttempt,
  };
};

const probeCompanyCoverage = async (
  client: CalaClient,
  seed: SectorSeed,
): Promise<ProbeSummary | null> => {
  const requestedName = seed.entity.name;
  const search = await client.searchEntities({
    name: requestedName,
    entityTypes: ["Company"],
    limit: 5,
  });
  const bestHit = chooseBestHit(requestedName, search.entities);
  if (!bestHit) {
    return null;
  }

  const introspection = await client.introspectEntity(bestHit.id);
  const propertyKeys = Object.keys(introspection.properties ?? {});
  const relationshipKeys = Object.keys(introspection.relationships ?? {});
  const numericalObservationLabels = extractObservationLabels(
    introspection.numericalObservations ?? [],
  );

  return {
    sourceSector: seed.sector,
    requestedName,
    resolvedName: bestHit.name,
    entityId: bestHit.id,
    propertyKeys,
    relationshipKeys,
    numericalObservationLabels,
  };
};

const collectProbeSummaries = async (
  client: CalaClient,
  seeds: SectorSeed[],
) => {
  const probeConcurrency = getProbeConcurrency();
  const probes: ProbeSummary[] = [];

  for (let startIndex = 0; startIndex < seeds.length; startIndex += probeConcurrency) {
    const batch = seeds.slice(startIndex, startIndex + probeConcurrency);
    const results = await Promise.allSettled(
      batch.map((seed) => probeCompanyCoverage(client, seed)),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        if (result.value) {
          probes.push(result.value);
        }
        continue;
      }

      console.warn("[cala-preanalysis][probe-failed]", {
        probeName: batch[index]?.entity.name,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }

  return probes;
};

export async function buildCalaPreanalysisPromptSection(
  client: CalaClient = createCalaClient({
    timeoutMs: getPreanalysisTimeoutMs(),
  }),
) {
  if (process.env.CALA_PREANALYSIS_DISABLED === "1") {
    return undefined;
  }

  if (process.env.CALA_PREANALYSIS_FORCE_REFRESH !== "1") {
    const cached = await readCalaPreanalysisCache();
    if (cached) {
      if (cached.metadata) {
        logPreanalysisSummary("cache", cached.createdAt, cached.metadata);
      } else {
        console.info("[cala-preanalysis][ready]", {
          source: "cache",
          createdAt: cached.createdAt,
          cachePath: CACHE_PATH,
        });
      }
      return cached.promptSection;
    }
  }

  const staleCache = await readCalaPreanalysisCache({ allowStale: true });
  const targetSectors = getTargetSectors();
  const { seeds, sectorNarratives, failures, attemptedSectors } =
    await bootstrapSeeds(client, targetSectors);

  for (const failure of failures) {
    console.warn("[cala-preanalysis][bootstrap-failed]", failure);
  }

  const probes = await collectProbeSummaries(client, seeds);

  if (probes.length === 0) {
    if (staleCache) {
      console.warn("[cala-preanalysis][using-stale-cache]", {
        cachedAt: staleCache.createdAt,
        attemptedSectors,
        bootstrapFailures: failures.length,
      });
      if (staleCache.metadata) {
        logPreanalysisSummary(
          "stale-cache",
          staleCache.createdAt,
          staleCache.metadata,
        );
      }
      return staleCache.promptSection;
    }

    return undefined;
  }

  const createdAt = new Date().toISOString();
  const promptSection = buildPromptSection(
    createdAt,
    attemptedSectors,
    probes,
    sectorNarratives,
  );
  const metadata = buildPreanalysisMetadata(attemptedSectors, seeds, probes);
  logPreanalysisSummary("live", createdAt, metadata);
  await writeCachedPromptSection(promptSection, metadata);
  return promptSection;
}
