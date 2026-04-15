import { api } from "../convex/_generated/api";
import { getConvexClient } from "./convex-client";

// Public identifiers sent to the Cala leaderboard.
//
// Manual one-off runs use "Mr. Krabs" — a Run-agent click from the dashboard
// gets this name. The "Mr. Krabs Autoresearch" brand is reserved for the
// outer-loop experimentation flow (scripts/autoresearch.ts), which passes
// PUBLIC_AUTORESEARCH_AGENT_NAME explicitly when it submits. This split
// keeps the public board readable: manual attempts and automated sweeps
// land in clearly separated groups.
export const PUBLIC_AGENT_NAME = "Mr. Krabs";
export const PUBLIC_AUTORESEARCH_AGENT_NAME = "Mr. MegaKrabs";

// Allocate a fresh monotonic `vN` string for a submission. Previously a
// file-backed counter with a per-process lock; now a Convex mutation that
// serializes across machines. Two developers submitting simultaneously
// will receive distinct versions even if their requests land on the server
// within the same millisecond.
export async function allocateNextVersion(): Promise<string> {
  return getConvexClient().mutation(api.autoresearch.allocateNextVersion, {});
}
