import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// In-process cache for idempotent Cala tool calls, persisted to a JSON
// file on disk so a fresh autoresearch process can hot-start from the
// cache left behind by the previous session. The cache is keyed by
// (toolName, stable-hash(args)); tool results for the same entity are
// stable, so there's no TTL.
//
// Covers entity_search / entity_introspection / retrieve_entity only —
// those are the read-only Cala queries. Excludes run_code, submit_portfolio,
// and anything else that might have side effects or return time-varying
// data.

const CACHED_TOOLS = new Set([
  "entity_search",
  "entity_introspection",
  "retrieve_entity",
]);

// Tools whose results we cap in size before feeding back to the model.
// knowledge_search / knowledge_query return 20-50 KB of unstructured prose
// per call — each one in context costs multi-second inference delays on
// every subsequent step. We truncate aggressively with a trailing marker
// so the model can see it was cut and learn to avoid the tool next time.
const TRUNCATED_TOOLS = new Set(["knowledge_search", "knowledge_query"]);
const TRUNCATE_BUDGET_CHARS = 2000;

// Entity-family tools return legitimately large structured JSON but are
// polluted with hourly price-tick arrays (high_1h/low_1h/volume_1h/...) on
// TRADED_ON relationships. A single TXN retrieve_entity came back at ~59 MB,
// 99% of it tick data, and blew up the Anthropic request with "Payload Too
// Large" once the model called retrieve_entity in parallel. Price ticks are
// irrelevant to the legal-entity complexity thesis, so we strip any array
// of timestamped points before returning the result to the model.
const ENTITY_SANITIZED_TOOLS = new Set([
  "entity_search",
  "entity_introspection",
  "retrieve_entity",
]);
// After time-series stripping, cap each text block to this many chars as a
// safety net (the cap only fires if stripping wasn't enough).
const ENTITY_MAX_CHARS = 12_000;

const CACHE_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(CACHE_DIR, "cala-tool-cache.json");

interface CacheEntry {
  toolName: string;
  argsHash: string;
  args: unknown;
  result: unknown;
  cachedAt: string;
}

const memoryCache: Map<string, CacheEntry> = new Map();
let dirty = false;
let loaded = false;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function hashArgs(args: unknown): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(args))
    .digest("hex")
    .slice(0, 16);
}

function keyFor(toolName: string, args: unknown): string {
  return `${toolName}:${hashArgs(args)}`;
}

function loadCacheFromDisk() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const stat = fs.statSync(CACHE_FILE);
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const entries = JSON.parse(raw) as CacheEntry[];
    if (!Array.isArray(entries)) return;
    let shrunk = 0;
    for (const entry of entries) {
      // Sanitize entity-family results at load time so the in-memory cache
      // doesn't hold hundreds of MB of time-series data from pre-fix runs.
      // The sanitizer is idempotent, so already-clean entries pass through.
      if (ENTITY_SANITIZED_TOOLS.has(entry.toolName)) {
        const sanitized = sanitizeEntityResult(entry.toolName, entry.result);
        if (sanitized !== entry.result) {
          entry.result = sanitized;
          shrunk += 1;
          dirty = true;
        }
      }
      memoryCache.set(`${entry.toolName}:${entry.argsHash}`, entry);
    }
    console.info(
      `[cala-cache] loaded ${entries.length} entries from ${CACHE_FILE} (${(stat.size / 1024 / 1024).toFixed(1)} MB on disk${shrunk > 0 ? `; sanitized ${shrunk} entries — persist will shrink the file` : ""})`,
    );
  } catch (error) {
    console.warn(
      "[cala-cache] failed to load from disk:",
      error instanceof Error ? error.message : error,
    );
  }
}

export function persistCacheToDisk(): void {
  if (!dirty) return;
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const entries = Array.from(memoryCache.values());
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entries, null, 2), "utf8");
    dirty = false;
    console.info(
      `[cala-cache] persisted ${entries.length} entries to ${CACHE_FILE}`,
    );
  } catch (error) {
    console.warn(
      "[cala-cache] failed to persist:",
      error instanceof Error ? error.message : error,
    );
  }
}

export function cacheStats() {
  return {
    entries: memoryCache.size,
    dirty,
    file: CACHE_FILE,
  };
}

type MinimalTool = {
  execute?: (...args: unknown[]) => Promise<unknown> | unknown;
};

// Recursively walk a parsed JSON value. Arrays of time-series points
// (objects with `time` + `value` keys) get replaced with a short marker.
// Returns both the stripped value and a count of how many series were
// removed, so callers can log the impact.
function stripTimeSeriesNode(
  node: unknown,
  counter: { removed: number; points: number },
): unknown {
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      typeof node[0] === "object" &&
      node[0] !== null &&
      "time" in (node[0] as Record<string, unknown>) &&
      "value" in (node[0] as Record<string, unknown>)
    ) {
      counter.removed += 1;
      counter.points += node.length;
      return `[${node.length} time-series points stripped]`;
    }
    return node.map((item) => stripTimeSeriesNode(item, counter));
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = stripTimeSeriesNode(v, counter);
    }
    return out;
  }
  return node;
}

// Strip time-series arrays from entity_* tool responses and cap each text
// block to ENTITY_MAX_CHARS as a safety net. Idempotent — re-running on
// already-sanitized data is a no-op, which matters because we also apply
// this lazily when reading from the on-disk cache.
function sanitizeEntityResult(
  toolName: string,
  result: unknown,
): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  if (!Array.isArray(record.content)) return result;

  const counter = { removed: 0, points: 0 };
  const cleaned = record.content.map((block) => {
    if (block?.type !== "text" || typeof block.text !== "string") return block;
    let text = block.text;
    try {
      const parsed = JSON.parse(text);
      const stripped = stripTimeSeriesNode(parsed, counter);
      text = JSON.stringify(stripped);
    } catch {
      // Not JSON — leave it alone, the char cap below still applies.
    }
    if (text.length > ENTITY_MAX_CHARS) {
      text =
        text.slice(0, ENTITY_MAX_CHARS) +
        `\n…[truncated at ${ENTITY_MAX_CHARS} chars; result was ${text.length} chars]`;
    }
    return { ...block, text };
  });

  if (counter.removed > 0) {
    console.info(
      `[cala-cache][sanitized] ${toolName}: stripped ${counter.removed} time-series (${counter.points} points)`,
    );
  }

  return {
    ...record,
    content: cleaned,
    structuredContent: undefined,
  };
}

function truncateResultForContext(result: unknown): unknown {
  // Stringify → slice → replace the top-level text shape with the capped
  // version. MCP tool responses are wrapped as `{content: [{type: "text",
  // text: "..."}], ...}`, so we walk that shape and cap each text block.
  if (!result || typeof result !== "object") return result;
  const record = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  if (!Array.isArray(record.content)) return result;

  let totalText = 0;
  const capped = record.content.map((block) => {
    if (block?.type !== "text" || typeof block.text !== "string") return block;
    const remaining = TRUNCATE_BUDGET_CHARS - totalText;
    if (remaining <= 0) {
      return {
        ...block,
        text: "[truncated — knowledge_search/knowledge_query results are capped at " +
          TRUNCATE_BUDGET_CHARS +
          " chars. Use entity_search / entity_introspection / retrieve_entity instead.]",
      };
    }
    if (block.text.length <= remaining) {
      totalText += block.text.length;
      return block;
    }
    const head = block.text.slice(0, remaining);
    totalText += remaining;
    return {
      ...block,
      text: head +
        "\n…[truncated, result was " + block.text.length + " chars; knowledge_* tools are banned — switch to entity_* tools.]",
    };
  });

  return {
    ...record,
    content: capped,
    // Drop structuredContent entirely — it duplicates the text content.
    structuredContent: undefined,
  };
}

// Wraps an MCP tool set in-place:
//   - Cached tools short-circuit on hits and memoize on misses.
//   - Truncated tools (knowledge_search / knowledge_query) have their
//     results clipped to TRUNCATE_BUDGET_CHARS with a visible banner
//     telling the model to stop calling them.
// Non-matching tools pass through unchanged.
export function wrapToolsWithCache<T extends Record<string, MinimalTool>>(
  tools: T,
): T {
  loadCacheFromDisk();

  let hits = 0;
  let misses = 0;
  const report = () => {
    console.info(`[cala-cache] session hits=${hits} misses=${misses}`);
  };

  for (const [name, toolDef] of Object.entries(tools)) {
    const shouldCache = CACHED_TOOLS.has(name);
    const shouldTruncate = TRUNCATED_TOOLS.has(name);
    const shouldSanitize = ENTITY_SANITIZED_TOOLS.has(name);
    if (!shouldCache && !shouldTruncate) continue;
    const originalExecute = toolDef.execute;
    if (typeof originalExecute !== "function") continue;

    toolDef.execute = async (
      input: unknown,
      ...rest: unknown[]
    ): Promise<unknown> => {
      if (shouldCache) {
        const key = keyFor(name, input);
        const hit = memoryCache.get(key);
        if (hit) {
          hits += 1;
          if ((hits + misses) % 10 === 1) report();
          // Lazy migration: legacy on-disk cache entries predate
          // sanitization and can be 50+ MB. Run the sanitizer on every
          // hit so the model never sees the unstripped payload; it's
          // idempotent on already-clean entries. Also overwrite the
          // in-memory cache so subsequent hits skip the work, and mark
          // dirty so the shrunk result gets persisted on next flush.
          if (shouldSanitize) {
            const sanitized = sanitizeEntityResult(name, hit.result);
            if (sanitized !== hit.result) {
              memoryCache.set(key, { ...hit, result: sanitized });
              dirty = true;
            }
            return sanitized;
          }
          return hit.result;
        }
        const raw = await originalExecute(input, ...rest);
        const result = shouldSanitize ? sanitizeEntityResult(name, raw) : raw;
        memoryCache.set(key, {
          toolName: name,
          argsHash: key.split(":")[1],
          args: input,
          result,
          cachedAt: new Date().toISOString(),
        });
        dirty = true;
        misses += 1;
        if ((hits + misses) % 10 === 1) report();
        return result;
      }

      // Truncate-only path (knowledge_*). Not cached because we're
      // actively discouraging their use — no point growing the cache.
      const result = await originalExecute(input, ...rest);
      const clipped = truncateResultForContext(result);
      console.info(
        `[cala-cache][truncated] ${name} (banned tool; result capped to ${TRUNCATE_BUDGET_CHARS} chars)`,
      );
      return clipped;
    };
  }

  return tools;
}
