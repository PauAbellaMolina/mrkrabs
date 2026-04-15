import { tool } from "ai";
import { z } from "zod";
import { CALA_ENTITY_TYPES, createCalaClient, type CalaClient } from "./cala";

// Cala's three-endpoint research loop as Vercel AI SDK tools. The agent
// composes them: search → introspect → retrieve. We keep the tool names
// aligned with Cala's MCP tool names so humans can switch between the
// Cursor/Claude-Desktop MCP flow and this agent without re-learning vocab.

export function createCalaTools(client: CalaClient = createCalaClient()) {
  return {
    entity_search: tool({
      description:
        "Fuzzy-search Cala's verified knowledge graph for entities by name. Returns a ranked list of matches with UUID, entity_type, and a short description. Use this to resolve a company name or ticker to an entity UUID before calling entity_introspection or retrieve_entity.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("Company or entity name to search for (e.g. 'Apple', 'NVIDIA')."),
        entity_types: z
          .array(z.enum(CALA_ENTITY_TYPES))
          .optional()
          .describe(
            "Restrict results to specific entity types. For portfolio research, usually ['Company'].",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of matches to return. Defaults to Cala's default of 20."),
      }),
      execute: async ({ name, entity_types, limit }) => {
        const response = await client.searchEntities({
          name,
          entityTypes: entity_types,
          limit,
        });
        return {
          query: response.query,
          entities: response.entities.map(({ id, name, entityType, score }) => ({
            id,
            name,
            entityType,
            score,
          })),
        };
      },
    }),

    entity_introspection: tool({
      description:
        "Given a Cala entity UUID, discover which properties, relationships, and numerical_observations are actually populated for that entity. Cala's graph is sparse — call this FIRST, before retrieve_entity, so you only ask for fields that exist. The numerical_observations field is particularly important for companies (may contain FinancialMetric observations).",
      inputSchema: z.object({
        entity_id: z
          .string()
          .uuid()
          .describe("The UUID of the entity, as returned by entity_search."),
      }),
      execute: async ({ entity_id }) => {
        const response = await client.introspectEntity(entity_id);
        return {
          id: response.id,
          entityType: response.entityType,
          properties: response.properties,
          relationships: response.relationships,
          numericalObservations: response.numericalObservations,
        };
      },
    }),

    retrieve_entity: tool({
      description:
        "Retrieve a Cala entity by UUID. Optionally pass a query to restrict which properties, relationships, and numerical_observations are returned — this is strongly recommended because the full graph blob is noisy. Use entity_introspection first to know which fields are worth asking for.",
      inputSchema: z.object({
        entity_id: z.string().uuid().describe("The UUID of the entity to retrieve."),
        properties: z
          .array(z.string())
          .optional()
          .describe(
            "Property names to return (e.g. ['name','cik','headquarters_address','employee_count']). Omit for Cala's default projection.",
          ),
        relationships: z
          .object({
            outgoing: z.record(z.string(), z.array(z.string())).optional(),
            incoming: z.record(z.string(), z.array(z.string())).optional(),
          })
          .optional()
          .describe("Relationships to include, grouped by direction and relationship name."),
        numerical_observations: z
          .record(z.string(), z.array(z.string().uuid()))
          .optional()
          .describe(
            "Numerical observations to include, keyed by entity type (e.g. { FinancialMetric: ['<uuid>', ...] }). UUIDs come from an earlier entity_introspection call.",
          ),
      }),
      execute: async ({ entity_id, properties, relationships, numerical_observations }) =>
        client.retrieveEntity(entity_id, {
          properties,
          relationships,
          numerical_observations,
        }),
    }),
  };
}

export type CalaTools = ReturnType<typeof createCalaTools>;
