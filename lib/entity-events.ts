import type { AgentRunEvent } from "./agent-runs";

// Build a UUID → tool-call index from a run's events array. Used by the
// portfolio table + report renderer to surface Cala provenance next to
// every <EntityPill />: "this UUID came from a `retrieve_entity` call;
// click to see what came back."
//
// We match tool-finished events whose toolName is one of the Cala tools,
// then extract UUIDs from three places:
//   1. `data.input.entity_id`     — introspection + retrieval take a single UUID
//   2. `data.output.entities[].id` — entity_search returns a list
//   3. a regex scan of the stringified output as a fallback for any UUID
//      the tool cited that we didn't statically reach
// The fallback keeps us from silently dropping provenance when Cala's
// schema sprouts new shapes; duplicates are dedupe'd by toolCallId.

const CALA_TOOL_NAMES = new Set([
  "entity_search",
  "entity_introspection",
  "retrieve_entity",
]);

const UUID_REGEX =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export interface ToolEventMatch {
  toolName: string;
  toolCallId: string;
  stepNumber?: number;
  at: string;
  input: unknown;
  output: unknown;
  durationMs?: number;
}

export type EntityEventsIndex = Map<string, ToolEventMatch[]>;

export function indexEventsByUuid(events: AgentRunEvent[]): EntityEventsIndex {
  const index: EntityEventsIndex = new Map();

  for (const event of events) {
    if (event.type !== "tool-finished") continue;
    const data = event.data as
      | {
          toolName?: string;
          toolCallId?: string;
          stepNumber?: number;
          durationMs?: number;
          input?: unknown;
          output?: unknown;
        }
      | undefined;
    if (!data?.toolName || !CALA_TOOL_NAMES.has(data.toolName)) continue;

    const match: ToolEventMatch = {
      toolName: data.toolName,
      toolCallId: data.toolCallId ?? event.id,
      stepNumber: data.stepNumber,
      at: event.at,
      input: data.input,
      output: data.output,
      durationMs: data.durationMs,
    };

    const uuids = extractUuids(data.input, data.output);
    for (const uuid of uuids) {
      const normalized = uuid.toLowerCase();
      const existing = index.get(normalized);
      if (!existing) {
        index.set(normalized, [match]);
        continue;
      }
      if (existing.some(m => m.toolCallId === match.toolCallId)) continue;
      existing.push(match);
    }
  }

  return index;
}

function extractUuids(input: unknown, output: unknown): string[] {
  const uuids = new Set<string>();

  if (input && typeof input === "object") {
    const entityId = (input as Record<string, unknown>).entity_id;
    if (typeof entityId === "string") uuids.add(entityId);
  }

  if (output && typeof output === "object") {
    const entities = (output as Record<string, unknown>).entities;
    if (Array.isArray(entities)) {
      for (const entity of entities) {
        if (entity && typeof entity === "object") {
          const id = (entity as Record<string, unknown>).id;
          if (typeof id === "string") uuids.add(id);
        }
      }
    }
  }

  // Regex fallback — scan the serialized output so a newly-added Cala
  // payload shape doesn't silently hide UUIDs from the provenance view.
  if (output != null) {
    try {
      const serialized = JSON.stringify(output);
      const matches = serialized.match(UUID_REGEX);
      if (matches) {
        for (const match of matches) uuids.add(match);
      }
    } catch {
      // JSON.stringify can throw on cyclic structures; if it does we just
      // fall back to whatever we got from the structured extraction above.
    }
  }

  return Array.from(uuids);
}

export function lookupEntityEvents(
  index: EntityEventsIndex,
  uuid: string | null | undefined,
): ToolEventMatch[] {
  if (!uuid) return [];
  return index.get(uuid.toLowerCase()) ?? [];
}
