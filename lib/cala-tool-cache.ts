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
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const entries = JSON.parse(raw) as CacheEntry[];
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      memoryCache.set(`${entry.toolName}:${entry.argsHash}`, entry);
    }
    console.info(
      `[cala-cache] loaded ${entries.length} entries from ${CACHE_FILE}`,
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

// Wraps an MCP tool set in-place, patching .execute on cached tools to
// short-circuit on hits and memoize on misses. Non-cached tools pass
// through unchanged.
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
    if (!CACHED_TOOLS.has(name)) continue;
    const originalExecute = toolDef.execute;
    if (typeof originalExecute !== "function") continue;

    toolDef.execute = async (
      input: unknown,
      ...rest: unknown[]
    ): Promise<unknown> => {
      const key = keyFor(name, input);
      const hit = memoryCache.get(key);
      if (hit) {
        hits += 1;
        // Announce periodically so log isn't spammy on long runs.
        if ((hits + misses) % 10 === 1) report();
        return hit.result;
      }
      const result = await originalExecute(input, ...rest);
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
    };
  }

  return tools;
}
