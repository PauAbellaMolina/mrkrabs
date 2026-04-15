// The single user prompt every run dispatches. Edit this, not the UI — we
// iterate on the agent, not on how the user phrases the question.
export const DEFAULT_RUN_PROMPT =
  "Build the first full challenge submission: choose at least 50 unique NASDAQ stocks, allocate exactly $1,000,000 total with at least $5,000 per name, and explain the picks with Cala-backed reasoning only. Avoid any data after 2025-04-15.";
