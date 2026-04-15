import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Convex mirror of lib/autoresearch-ledger.ts + lib/agent-version.ts
// counter. All three previously-racy operations (version allocation,
// spend increment, rule append) live here as mutations — serialized
// by Convex's transaction layer, so two machines can hit them at the
// same time without corruption.

const MAX_RULES = 8;
const DEFAULT_SPENT_USD = 0;
const DEFAULT_NEXT_VERSION = 1;

// Load the singleton state row, creating it on first read. Every mutation
// that touches the counter / champion / spend goes through this.
async function getOrCreateState(ctx: MutationCtx): Promise<Doc<"autoresearchState">> {
  const existing = await ctx.db
    .query("autoresearchState")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .first();
  if (existing) return existing;

  const id = await ctx.db.insert("autoresearchState", {
    key: "default" as const,
    spentUsd: DEFAULT_SPENT_USD,
    nextVersion: DEFAULT_NEXT_VERSION,
    championScore: 0,
    championIteration: 0,
    championUpdatedAt: new Date(0).toISOString(),
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("failed to bootstrap autoresearchState");
  return created as Doc<"autoresearchState">;
}

// ─── Rule playbook ──────────────────────────────────────────────────────

export const loadRules = query({
  args: {},
  handler: async ctx => {
    const all = await ctx.db
      .query("autoresearchRules")
      .withIndex("by_addedAtIteration")
      .collect();
    return all
      .slice()
      .sort((a, b) => a.addedAtIteration - b.addedAtIteration)
      .map(row => ({
        text: row.text,
        addedAtIteration: row.addedAtIteration,
        addedAt: row.addedAt,
      }));
  },
});

export const appendRule = mutation({
  args: {
    text: v.string(),
    addedAtIteration: v.number(),
  },
  handler: async (ctx, { text, addedAtIteration }) => {
    await ctx.db.insert("autoresearchRules", {
      text,
      addedAtIteration,
      addedAt: new Date().toISOString(),
    });
    // Enforce the cap: if we're over MAX_RULES, drop the oldest by
    // addedAtIteration. This mirrors the in-process append cap in the
    // old file-backed ledger, but runs server-side so two machines
    // can't race past the limit together.
    const all = await ctx.db
      .query("autoresearchRules")
      .withIndex("by_addedAtIteration")
      .collect();
    if (all.length <= MAX_RULES) return;
    const sorted = all
      .slice()
      .sort((a, b) => a.addedAtIteration - b.addedAtIteration);
    const overflow = sorted.length - MAX_RULES;
    for (let i = 0; i < overflow; i++) {
      await ctx.db.delete(sorted[i]._id);
    }
  },
});

// ─── Champion ───────────────────────────────────────────────────────────

export const getChampion = query({
  args: {},
  handler: async ctx => {
    const state = await ctx.db
      .query("autoresearchState")
      .withIndex("by_key", q => q.eq("key", "default"))
      .first();
    if (!state) {
      return {
        score: 0,
        iteration: 0,
        publicAgentVersion: null as string | null,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      score: state.championScore,
      iteration: state.championIteration,
      publicAgentVersion: state.championPublicAgentVersion ?? null,
      updatedAt: state.championUpdatedAt,
    };
  },
});

export const setChampion = mutation({
  args: {
    score: v.number(),
    iteration: v.number(),
    publicAgentVersion: v.optional(v.string()),
  },
  handler: async (ctx, { score, iteration, publicAgentVersion }) => {
    const state = await getOrCreateState(ctx);
    await ctx.db.patch(state._id, {
      championScore: score,
      championIteration: iteration,
      championPublicAgentVersion: publicAgentVersion,
      championUpdatedAt: new Date().toISOString(),
    });
  },
});

// ─── Ledger ─────────────────────────────────────────────────────────────

export const recentLedger = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = limit ?? 5;
    const all = await ctx.db
      .query("autoresearchLedger")
      .withIndex("by_iteration")
      .collect();
    return all
      .slice()
      .sort((a, b) => a.iteration - b.iteration)
      .slice(-cap)
      .map(row => ({
        iteration: row.iteration,
        ranAt: row.ranAt,
        runId: row.runId,
        publicAgentVersion: row.publicAgentVersion ?? null,
        score: row.score ?? null,
        championScoreAtStart: row.championScoreAtStart,
        kept: row.kept,
        skipReason: row.skipReason,
        estimatedCostUsd: row.estimatedCostUsd,
        proposedRule: row.proposedRule,
        rulesInEffect: row.rulesInEffect,
      }));
  },
});

// Used by the autoresearch run detail page. The ledger is bounded by the
// total number of iterations we ever run (capped well under 10k for the
// hackathon), so a linear scan is fine and avoids adding a new index.
export const getLedgerByRunId = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const matches = await ctx.db
      .query("autoresearchLedger")
      .filter(q => q.eq(q.field("runId"), runId))
      .collect();
    const entry = matches[0];
    if (!entry) return null;
    return {
      iteration: entry.iteration,
      ranAt: entry.ranAt,
      runId: entry.runId,
      publicAgentVersion: entry.publicAgentVersion ?? null,
      score: entry.score ?? null,
      championScoreAtStart: entry.championScoreAtStart,
      kept: entry.kept,
      skipReason: entry.skipReason,
      estimatedCostUsd: entry.estimatedCostUsd,
      proposedRule: entry.proposedRule,
      rulesInEffect: entry.rulesInEffect,
    };
  },
});

export const appendLedger = mutation({
  args: {
    iteration: v.number(),
    ranAt: v.string(),
    runId: v.string(),
    publicAgentVersion: v.optional(v.string()),
    score: v.optional(v.number()),
    championScoreAtStart: v.number(),
    kept: v.boolean(),
    skipReason: v.optional(v.string()),
    estimatedCostUsd: v.number(),
    proposedRule: v.optional(v.string()),
    rulesInEffect: v.number(),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, entry) => {
    await ctx.db.insert("autoresearchLedger", entry);
  },
});

// ─── Sessions ───────────────────────────────────────────────────────────

export const createSession = mutation({
  args: {
    sessionId: v.string(),
    startedAt: v.string(),
    model: v.string(),
    plannedIterations: v.number(),
    host: v.optional(v.string()),
    logPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("autoresearchSessions", {
      sessionId: args.sessionId,
      status: "running" as const,
      startedAt: args.startedAt,
      model: args.model,
      plannedIterations: args.plannedIterations,
      completedIterations: 0,
      host: args.host,
      logPath: args.logPath,
    });
  },
});

export const attachSessionPid = mutation({
  args: { sessionId: v.string(), pid: v.number() },
  handler: async (ctx, { sessionId, pid }) => {
    const row = await ctx.db
      .query("autoresearchSessions")
      .withIndex("by_sessionId", q => q.eq("sessionId", sessionId))
      .first();
    if (!row) throw new Error(`session ${sessionId} not found`);
    await ctx.db.patch(row._id, { pid });
  },
});

export const incrementSessionProgress = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const row = await ctx.db
      .query("autoresearchSessions")
      .withIndex("by_sessionId", q => q.eq("sessionId", sessionId))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      completedIterations: row.completedIterations + 1,
    });
  },
});

export const finalizeSession = mutation({
  args: {
    sessionId: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("stopped"),
      v.literal("failed"),
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, status, errorMessage }) => {
    const row = await ctx.db
      .query("autoresearchSessions")
      .withIndex("by_sessionId", q => q.eq("sessionId", sessionId))
      .first();
    if (!row) return;
    // Don't overwrite a terminal status — once stopped/completed/failed, the
    // first caller wins. This matters when /api/autoresearch/stop and the
    // script's own SIGTERM handler both try to finalize the same session.
    if (row.status !== "running") return;
    await ctx.db.patch(row._id, {
      status,
      errorMessage,
      finishedAt: new Date().toISOString(),
    });
  },
});

export const listSessions = query({
  args: {},
  handler: async ctx => {
    // Load sessions + ledger in parallel and fold ledger stats by sessionId
    // so every row in the list can show kept/discarded/skipped/best-score
    // at a glance — the raw N/M progress bar alone doesn't say whether any
    // iteration actually produced a leaderboard score.
    const [sessionsRaw, ledgerRaw] = await Promise.all([
      ctx.db
        .query("autoresearchSessions")
        .withIndex("by_startedAt")
        .collect(),
      ctx.db.query("autoresearchLedger").collect(),
    ]);

    type Stats = {
      kept: number;
      discarded: number;
      skipped: number;
      bestScore: number | null;
    };
    const statsBySession = new Map<string, Stats>();

    for (const entry of ledgerRaw) {
      if (!entry.sessionId) continue;
      const current: Stats = statsBySession.get(entry.sessionId) ?? {
        kept: 0,
        discarded: 0,
        skipped: 0,
        bestScore: null,
      };
      if (entry.skipReason) {
        current.skipped += 1;
      } else if (entry.kept) {
        current.kept += 1;
      } else {
        current.discarded += 1;
      }
      if (
        typeof entry.score === "number" &&
        (current.bestScore == null || entry.score > current.bestScore)
      ) {
        current.bestScore = entry.score;
      }
      statsBySession.set(entry.sessionId, current);
    }

    return sessionsRaw
      .slice()
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .map(s => {
        const stats = statsBySession.get(s.sessionId);
        return {
          sessionId: s.sessionId,
          status: s.status,
          startedAt: s.startedAt,
          finishedAt: s.finishedAt,
          pid: s.pid ?? null,
          host: s.host ?? null,
          model: s.model,
          plannedIterations: s.plannedIterations,
          completedIterations: s.completedIterations,
          errorMessage: s.errorMessage,
          logPath: s.logPath ?? null,
          keptCount: stats?.kept ?? 0,
          discardedCount: stats?.discarded ?? 0,
          skippedCount: stats?.skipped ?? 0,
          bestScore: stats?.bestScore ?? null,
        };
      });
  },
});

export const getSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const row = await ctx.db
      .query("autoresearchSessions")
      .withIndex("by_sessionId", q => q.eq("sessionId", sessionId))
      .first();
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      pid: row.pid ?? null,
      host: row.host ?? null,
      model: row.model,
      plannedIterations: row.plannedIterations,
      completedIterations: row.completedIterations,
      errorMessage: row.errorMessage,
      logPath: row.logPath ?? null,
    };
  },
});

export const getLedgerBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const rows = await ctx.db
      .query("autoresearchLedger")
      .withIndex("by_sessionId", q => q.eq("sessionId", sessionId))
      .collect();
    return rows
      .slice()
      .sort((a, b) => a.iteration - b.iteration)
      .map(row => ({
        iteration: row.iteration,
        ranAt: row.ranAt,
        runId: row.runId,
        publicAgentVersion: row.publicAgentVersion ?? null,
        score: row.score ?? null,
        championScoreAtStart: row.championScoreAtStart,
        kept: row.kept,
        skipReason: row.skipReason,
        estimatedCostUsd: row.estimatedCostUsd,
        proposedRule: row.proposedRule,
        rulesInEffect: row.rulesInEffect,
      }));
  },
});

// ─── Spend tracking ─────────────────────────────────────────────────────

export const getSpent = query({
  args: {},
  handler: async ctx => {
    const state = await ctx.db
      .query("autoresearchState")
      .withIndex("by_key", q => q.eq("key", "default"))
      .first();
    return state?.spentUsd ?? 0;
  },
});

// Atomic increment with optional server-side budget cap. If the new total
// would exceed `budgetCapUsd`, the mutation throws without mutating — the
// caller must handle the error. This is how the autoresearch loop enforces
// its budget cap across multiple concurrent runners.
export const addSpent = mutation({
  args: {
    delta: v.number(),
    budgetCapUsd: v.optional(v.number()),
  },
  handler: async (ctx, { delta, budgetCapUsd }) => {
    const state = await getOrCreateState(ctx);
    const next = state.spentUsd + delta;
    if (budgetCapUsd != null && next > budgetCapUsd) {
      throw new Error(
        `budget cap exceeded: $${next.toFixed(4)} > $${budgetCapUsd.toFixed(2)}`,
      );
    }
    await ctx.db.patch(state._id, { spentUsd: next });
    return next;
  },
});

// ─── Version allocation ─────────────────────────────────────────────────

// Atomic vN allocator. Previously a read-modify-write against a local JSON
// file; now a single serialized Convex mutation that two machines can safely
// hit at the same time.
export const allocateNextVersion = mutation({
  args: {},
  handler: async ctx => {
    const state = await getOrCreateState(ctx);
    const version = `v${state.nextVersion}`;
    await ctx.db.patch(state._id, { nextVersion: state.nextVersion + 1 });
    return version;
  },
});
