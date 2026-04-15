// Quick end-to-end sanity check for the Cala client.
// Run with: pnpm cala:sanity
//
// Walks the three-endpoint research loop on one well-known company:
//   entity_search("Apple", Company)  →  pick the top hit
//   entity_introspection(<uuid>)     →  see which fields are populated
//   retrieve_entity(<uuid>, {properties: ['name','cik','lei','headquarters_address']})
//
// If any step fails with a 401, double-check CALA_API_KEY in .env.local.

import { createCalaClient } from "../lib/cala";

const TARGET_NAME = process.argv[2] ?? "Apple";

async function main() {
  const cala = createCalaClient();

  console.log(`\n▸ entity_search(name="${TARGET_NAME}", entity_types=['Company'])`);
  const search = await cala.searchEntities({
    name: TARGET_NAME,
    entityTypes: ["Company"],
    limit: 5,
  });
  console.log(`  got ${search.entities.length} hit(s):`);
  for (const e of search.entities) {
    console.log(`    ${e.id}  ${e.entity_type.padEnd(14)} ${e.name}`);
  }
  const top = search.entities[0];
  if (!top) {
    console.error("No results. Bailing.");
    process.exit(1);
  }

  console.log(`\n▸ entity_introspection("${top.id}")`);
  const introspection = await cala.introspectEntity(top.id);
  console.log(`  properties (${introspection.properties.length}):`);
  console.log(`    ${introspection.properties.join(", ")}`);
  if (introspection.numerical_observations !== undefined) {
    console.log(`  numerical_observations:`);
    console.log(
      JSON.stringify(introspection.numerical_observations, null, 2)
        .split("\n")
        .slice(0, 20)
        .map(l => "    " + l)
        .join("\n"),
    );
  }
  if (introspection.relationships !== undefined) {
    console.log(`  relationships:`);
    console.log(
      JSON.stringify(introspection.relationships, null, 2)
        .split("\n")
        .slice(0, 12)
        .map(l => "    " + l)
        .join("\n"),
    );
  }

  console.log(`\n▸ retrieve_entity("${top.id}", { properties: [...] })`);
  const picked = ["name", "aliases", "cik", "lei", "headquarters_address", "employee_count"].filter(
    p => introspection.properties.includes(p),
  );
  const full = await cala.retrieveEntity(top.id, { properties: picked });
  console.log(`  full response:`);
  console.log(
    JSON.stringify(full, null, 2)
      .split("\n")
      .map(l => "    " + l)
      .join("\n"),
  );

  console.log(`\n✅  sanity check passed`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
