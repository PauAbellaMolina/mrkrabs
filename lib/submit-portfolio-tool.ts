import { tool } from "ai";
import { portfolioSchema, validatePortfolio } from "./portfolio";

// The agent's final local validation step. This does NOT hit the leaderboard.
// Its input schema holds the hard constraints; execute runs the remaining
// runtime checks (dedupe, exact total) and returns a structured error the
// agent can read and retry. The UI also reads the tool call at
// state 'input-available' to paint the portfolio table the moment the agent
// commits — we don't wait for the validator round-trip.

export const finalizePortfolioTool = tool({
  description:
    "Finalize and locally validate your final 50+ position NASDAQ portfolio for the " +
    "$1,000,000 allocation. This does not submit anything to the leaderboard. The " +
    "input schema enforces per-position minimums; validation enforces the exact " +
    "$1,000,000 total and dedupe. If accepted, you are done. If rejected, read the " +
    "errors carefully, fix the issues, and call finalize_portfolio again with the " +
    "revised portfolio.",
  inputSchema: portfolioSchema,
  execute: async input => {
    const result = validatePortfolio(input);
    if (result.ok) {
      return {
        accepted: true as const,
        position_count: input.positions.length,
        total_usd: input.positions.reduce((s, p) => s + p.notional_usd, 0),
      };
    }
    return {
      accepted: false as const,
      errors: result.errors,
    };
  },
});
