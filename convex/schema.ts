import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Convex schema for mrkrabs shared state. Types live here; the strongly-
// typed application shapes (AgentRunRecord, LedgerEntry, etc.) are enforced
// in lib/*.ts. Anything the application treats as an opaque blob
// (result, telemetry, leaderboardSubmission, error, event.data) is stored
// as v.any() — we'd rather migrate fast than double-encode shapes we already
// type-check at the TypeScript layer.

const runEventValidator = v.object({
  id: v.string(),
  at: v.string(),
  level: v.union(v.literal("info"), v.literal("error")),
  type: v.union(
    v.literal("run-started"),
    v.literal("step-started"),
    v.literal("tool-started"),
    v.literal("tool-finished"),
    v.literal("step-finished"),
    v.literal("run-finished"),
    v.literal("run-failed"),
  ),
  title: v.string(),
  data: v.optional(v.any()),
});

export default defineSchema({
  // One document per agent run. Events are embedded inline (not a separate
  // table) because run docs stay under ~100KB and Convex handles up to 1MB.
  // Embedding keeps appendEvent as a single atomic mutation.
  runs: defineTable({
    runId: v.string(),
    requestId: v.string(),
    prompt: v.string(),
    agentName: v.string(),
    agentVersion: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    startedAt: v.string(),
    finishedAt: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    model: v.optional(v.string()),
    eventCount: v.number(),
    stepCount: v.number(),
    toolCallCount: v.number(),
    events: v.array(runEventValidator),
    result: v.optional(v.any()),
    checkpoint: v.optional(v.any()),
    telemetry: v.optional(v.any()),
    leaderboardSubmission: v.optional(v.any()),
    error: v.optional(v.any()),
    // Set only for runs produced by scripts/autoresearch.ts. Links the run
    // back to its parent autoresearch session so the UI can group iterations
    // under the outer-loop invocation that spawned them.
    sessionId: v.optional(v.string()),
    // Which trunk/composition the manual run used. Autoresearch iterations
    // always use "champion" implicitly via systemPromptOverride; manual
    // runs stamp this explicitly so the detail page can show which one was
    // picked. Legacy runs predate the field and leave it unset.
    systemPromptMode: v.optional(
      v.union(v.literal("base"), v.literal("champion")),
    ),
  })
    .index("by_runId", ["runId"])
    .index("by_startedAt", ["startedAt"])
    .index("by_sessionId", ["sessionId"]),

  // Singleton row keyed by "default". Holds everything there's exactly one of:
  // version counter, cumulative spend, and the current champion. Single row
  // means version allocation + spend increment + champion read-modify-write
  // are all one transaction instead of three.
  autoresearchState: defineTable({
    key: v.literal("default"),
    spentUsd: v.number(),
    nextVersion: v.number(),
    championScore: v.number(),
    championIteration: v.number(),
    championPublicAgentVersion: v.optional(v.string()),
    championUpdatedAt: v.string(),
  }).index("by_key", ["key"]),

  // Append-only rule playbook, capped at 8 by appendRule mutation (oldest drops).
  autoresearchRules: defineTable({
    text: v.string(),
    addedAtIteration: v.number(),
    addedAt: v.string(),
  }).index("by_addedAtIteration", ["addedAtIteration"]),

  // Full autoresearch experiment history. Append-only; never truncated.
  autoresearchLedger: defineTable({
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
    // Set only when the iteration was produced inside an autoresearch
    // session (i.e. spawned via /api/autoresearch/run). Legacy rows from
    // before this field was introduced leave it null.
    sessionId: v.optional(v.string()),
  })
    .index("by_iteration", ["iteration"])
    .index("by_sessionId", ["sessionId"]),

  // One row per "Run iterations" click. Owns the detached child process
  // that's executing the outer loop and groups the iterations it produces.
  // Lets the UI list sessions, show per-session progress, and stop a single
  // session by pid without hammering every autoresearch process on the host.
  autoresearchSessions: defineTable({
    sessionId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("stopped"),
      v.literal("failed"),
    ),
    startedAt: v.string(),
    finishedAt: v.optional(v.string()),
    // OS process ID of the spawned child. Only meaningful on the host that
    // spawned the session — stored alongside `host` so the UI can disable
    // the Stop button when viewed from a different machine.
    pid: v.optional(v.number()),
    host: v.optional(v.string()),
    model: v.string(),
    plannedIterations: v.number(),
    completedIterations: v.number(),
    // Surfaces to the UI for "failed" sessions (e.g. env-var missing,
    // agent crash propagated out of the outer loop).
    errorMessage: v.optional(v.string()),
    // Absolute path to the tailable stdio log file for this session.
    // The detail page surfaces it so you can `tail -f` from a terminal.
    logPath: v.optional(v.string()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_startedAt", ["startedAt"]),
});
