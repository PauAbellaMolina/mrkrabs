<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project: mrkrabs

Cala "Lobster of Wall Street" hackathon. See [`README.md`](./README.md) for the one-paragraph overview and [`docs/`](./docs) for the living knowledge base:

- [`docs/VISION.md`](./docs/VISION.md) — what we're building and why
- [`docs/PRD.md`](./docs/PRD.md) — requirements / shipping scope
- [`docs/STRATEGY.md`](./docs/STRATEGY.md) — trading thesis + signals
- [`docs/LEADERBOARD.md`](./docs/LEADERBOARD.md) — hackathon submission API, scoring, and evaluation rules ([live guide](https://cala-leaderboard.apps.rebolt.ai/guide))
- [`docs/NOTES.md`](./docs/NOTES.md) — running decisions + scratchpad

Read `docs/NOTES.md` first — it's the fastest way to catch up on what we've already decided and ruled out. Read `docs/LEADERBOARD.md` before building submit flows or claiming score semantics.

# Implementations

For every major task, document it under `docs/`. When you need context, read it from there.

# After you have completed your task use the 'npm run lint' command to check for errors and warnings.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
