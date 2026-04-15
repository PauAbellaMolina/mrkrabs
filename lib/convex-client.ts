import { ConvexHttpClient } from "convex/browser";

// Shared singleton ConvexHttpClient. Every server-side caller — Route
// Handlers, Server Components, Node scripts — reuses this instance to avoid
// re-parsing the deployment URL on every call.
//
// This is deliberately lazy: we throw at first-use if NEXT_PUBLIC_CONVEX_URL
// is missing, rather than at module load, so importing the module never
// crashes the dev server during first-time setup.

let singleton: ConvexHttpClient | null = null;

export function getConvexClient(): ConvexHttpClient {
  if (singleton) return singleton;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is not set. Run `pnpm convex:dev` once to provision the dev deployment — it writes this env var into .env.local automatically.",
    );
  }
  singleton = new ConvexHttpClient(url);
  return singleton;
}
