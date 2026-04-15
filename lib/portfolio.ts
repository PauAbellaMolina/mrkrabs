import { z } from "zod";

// Hard constraints from the Cala "Lobster of Wall Street" challenge. Zod
// enforces the per-row constraints at the model boundary; validatePortfolio
// enforces the sum and dedupe at runtime (things Zod can't express).

export const TOTAL_BUDGET_USD = 1_000_000;
export const MIN_POSITION_USD = 5_000;
export const MIN_POSITION_COUNT = 50;

export const positionSchema = z.object({
  ticker: z
    .string()
    .regex(/^[A-Z][A-Z.]{0,5}$/, "Ticker must be uppercase NASDAQ symbol")
    .describe("NASDAQ ticker symbol, e.g. 'NVDA', 'AAPL', 'GOOGL'."),
  notional_usd: z
    .number()
    .int()
    .min(MIN_POSITION_USD)
    .describe(`Dollar amount allocated to this position. Minimum $${MIN_POSITION_USD}.`),
  thesis: z
    .string()
    .min(20)
    .max(280)
    .describe(
      "One-line investment thesis grounded in a Cala signal you actually retrieved. <=280 chars.",
    ),
  cala_entity_id: z
    .string()
    .uuid()
    .optional()
    .describe("The Cala entity UUID you researched for this pick. Strongly encouraged."),
});

export const portfolioSchema = z.object({
  positions: z.array(positionSchema).min(MIN_POSITION_COUNT),
});

export type Position = z.infer<typeof positionSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;

export type PortfolioValidation = { ok: true } | { ok: false; errors: string[] };

export function validatePortfolio(portfolio: Portfolio): PortfolioValidation {
  const errors: string[] = [];
  const { positions } = portfolio;

  if (positions.length < MIN_POSITION_COUNT) {
    errors.push(`Need at least ${MIN_POSITION_COUNT} positions; got ${positions.length}.`);
  }

  const tickers = new Set(positions.map(p => p.ticker));
  if (tickers.size !== positions.length) {
    const counts = new Map<string, number>();
    for (const p of positions) counts.set(p.ticker, (counts.get(p.ticker) ?? 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([t]) => t);
    errors.push(`Duplicate tickers: ${dupes.join(", ")}.`);
  }

  for (const p of positions) {
    if (p.notional_usd < MIN_POSITION_USD) {
      errors.push(`${p.ticker}: $${p.notional_usd} is below the $${MIN_POSITION_USD} floor.`);
    }
  }

  const total = positions.reduce((sum, p) => sum + p.notional_usd, 0);
  if (total !== TOTAL_BUDGET_USD) {
    const delta = TOTAL_BUDGET_USD - total;
    const direction = delta > 0 ? "add" : "remove";
    errors.push(
      `Total must equal $${TOTAL_BUDGET_USD.toLocaleString()}; got $${total.toLocaleString()}. ` +
        `${direction} $${Math.abs(delta).toLocaleString()}.`,
    );
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
