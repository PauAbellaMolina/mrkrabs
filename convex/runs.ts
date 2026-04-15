import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Convex mirror of lib/agent-runs.ts. Every mutation/query here is called
// from the server-side library via ConvexHttpClient; shape is preserved so
// the library shim can stay a thin wrapper.

async function getByRunIdOrThrow(
  ctx: { db: { query: (table: "runs") => any } },
  runId: string,
): Promise<Doc<"runs">> {
  const record = await ctx.db
    .query("runs")
    .withIndex("by_runId", (q: any) => q.eq("runId", runId))
    .first();
  if (!record) {
    throw new Error(`run ${runId} not found`);
  }
  return record as Doc<"runs">;
}

// ─── Queries ────────────────────────────────────────────────────────────

export const listSummaries = query({
  args: {},
  handler: async ctx => {
    const all = await ctx.db.query("runs").collect();
    return all
      .slice()
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .map(run => ({
        id: run.runId,
        prompt: run.prompt,
        agentName: run.agentName,
        agentVersion: run.agentVersion,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        model: run.model,
        eventCount: run.eventCount,
        stepCount: run.stepCount,
        toolCallCount: run.toolCallCount,
        positionCount:
          (run.result as any)?.output?.positions?.length ?? 0,
        requestId: run.requestId,
        leaderboardStatus: (run.leaderboardSubmission as any)?.status as
          | "submitted"
          | "failed"
          | undefined,
      }));
  },
});

export const getByRunId = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const record = await ctx.db
      .query("runs")
      .withIndex("by_runId", q => q.eq("runId", runId))
      .first();
    if (!record) return null;
    // Strip Convex system fields before returning — the library layer
    // consumes AgentRunRecord which doesn't know about _id / _creationTime.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, _creationTime, ...rest } = record;
    return { id: rest.runId, ...rest };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    runId: v.string(),
    requestId: v.string(),
    prompt: v.string(),
    agentName: v.string(),
    agentVersion: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const seedEventId = crypto.randomUUID();
    await ctx.db.insert("runs", {
      runId: args.runId,
      requestId: args.requestId,
      prompt: args.prompt,
      agentName: args.agentName,
      agentVersion: args.agentVersion,
      model: args.model,
      status: "running" as const,
      startedAt: now,
      eventCount: 1,
      stepCount: 0,
      toolCallCount: 0,
      events: [
        {
          id: seedEventId,
          at: now,
          level: "info" as const,
          type: "run-started" as const,
          title: "Run started",
          data: {
            requestId: args.requestId,
            promptPreview: args.prompt.slice(0, 240),
          },
        },
      ],
    });
  },
});

export const appendEvent = mutation({
  args: {
    runId: v.string(),
    event: v.object({
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
      at: v.optional(v.string()),
      data: v.optional(v.any()),
    }),
  },
  handler: async (ctx, { runId, event }) => {
    const record = await getByRunIdOrThrow(ctx, runId);
    const newEvent = {
      id: crypto.randomUUID(),
      at: event.at ?? new Date().toISOString(),
      level: event.level,
      type: event.type,
      title: event.title,
      data: event.data,
    };
    await ctx.db.patch(record._id, {
      events: [...record.events, newEvent],
      eventCount: record.eventCount + 1,
      stepCount:
        record.stepCount + (event.type === "step-finished" ? 1 : 0),
      toolCallCount:
        record.toolCallCount + (event.type === "tool-started" ? 1 : 0),
    });
  },
});

export const complete = mutation({
  args: {
    runId: v.string(),
    model: v.string(),
    result: v.any(),
    telemetry: v.optional(v.any()),
  },
  handler: async (ctx, { runId, model, result, telemetry }) => {
    const record = await getByRunIdOrThrow(ctx, runId);
    const finishedAt = new Date().toISOString();
    const steps = (result as any)?.steps ?? [];
    const toolCallCount = steps.reduce(
      (total: number, step: any) => total + (step?.toolCalls?.length ?? 0),
      0,
    );
    const finishEvent = {
      id: crypto.randomUUID(),
      at: finishedAt,
      level: "info" as const,
      type: "run-finished" as const,
      title: "Run finished",
      data: {
        positions: (result as any)?.output?.positions?.length ?? 0,
        transactions:
          (result as any)?.output?.submissionPayload?.transactions?.length ??
          0,
      },
    };
    await ctx.db.patch(record._id, {
      status: "completed" as const,
      model,
      finishedAt,
      durationMs:
        new Date(finishedAt).getTime() - new Date(record.startedAt).getTime(),
      result,
      telemetry,
      stepCount: steps.length,
      toolCallCount,
      events: [...record.events, finishEvent],
      eventCount: record.eventCount + 1,
    });
  },
});

export const fail = mutation({
  args: {
    runId: v.string(),
    message: v.string(),
    details: v.optional(v.any()),
  },
  handler: async (ctx, { runId, message, details }) => {
    const record = await getByRunIdOrThrow(ctx, runId);
    const finishedAt = new Date().toISOString();
    const failEvent = {
      id: crypto.randomUUID(),
      at: finishedAt,
      level: "error" as const,
      type: "run-failed" as const,
      title: "Run failed",
      data: details,
    };
    await ctx.db.patch(record._id, {
      status: "failed" as const,
      finishedAt,
      durationMs:
        new Date(finishedAt).getTime() - new Date(record.startedAt).getTime(),
      error: { message, details },
      events: [...record.events, failEvent],
      eventCount: record.eventCount + 1,
    });
  },
});

export const recordSubmission = mutation({
  args: {
    runId: v.string(),
    submission: v.any(),
  },
  handler: async (ctx, { runId, submission }) => {
    const record = await getByRunIdOrThrow(ctx, runId);
    await ctx.db.patch(record._id, { leaderboardSubmission: submission });
  },
});
