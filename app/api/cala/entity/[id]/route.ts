import { CalaClient } from "@/lib/cala";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || id.length < 8) {
    return Response.json({ error: "invalid entity id" }, { status: 400 });
  }

  try {
    const client = new CalaClient({ timeoutMs: 8000 });

    // Run introspection + full retrieval in parallel with a short timeout.
    // Introspection gives structure (properties/relationships/observations).
    // Retrieval gives the full entity record with deeper field data.
    const [introspection, retrieved] = await Promise.all([
      client.introspectEntity(id),
      client.retrieveEntity(id).catch(() => null),
    ]);

    // Merge retrieved.raw fields into properties so the component gets
    // the richest possible set of company details.
    const mergedProperties = {
      ...(introspection.properties ?? {}),
      ...(retrieved?.raw ?? {}),
    };
    // Remove internal/duplicate keys
    delete mergedProperties.id;
    delete mergedProperties._id;

    const entityName =
      typeof mergedProperties.name === "string"
        ? mergedProperties.name
        : typeof mergedProperties.legal_name === "string"
          ? mergedProperties.legal_name
          : null;

    // Knowledge search is best-effort — gives narrative content +
    // explainability records that prove Cala backed the decision.
    let knowledge: {
      content?: string;
      explainability?: Array<Record<string, unknown>>;
      context?: Array<Record<string, unknown>>;
    } | null = null;

    if (entityName) {
      try {
        const ks = await client.knowledgeSearch(entityName);
        knowledge = {
          content: ks.content,
          explainability: ks.explainability,
          context: ks.context,
        };
      } catch {
        // best-effort
      }
    }

    return Response.json(
      {
        ...introspection,
        properties: mergedProperties,
        knowledge,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cala request failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
