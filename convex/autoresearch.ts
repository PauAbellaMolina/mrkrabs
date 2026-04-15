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
  },
  handler: async (ctx, entry) => {
    await ctx.db.insert("autoresearchLedger", entry);
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
