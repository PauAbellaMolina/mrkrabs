import { spawn } from "node:child_process";
import path from "node:path";

// Kicks off the autoresearch CLI as a detached child process so the caller
// (the dashboard "Run iterations" button) doesn't have to wait for the
// whole multi-minute loop to finish. The child runs the same entry point
// that `pnpm autoresearch` runs, inherits env from the parent, and writes
// results straight into Convex — where the autoresearch page already reads
// from, so progress shows up live via the existing poller.
//
// This is a local-dev facility. The child process model relies on the
// parent process staying alive, which only holds under `next dev`.

export const runtime = "nodejs";
export const maxDuration = 10;

interface RunRequestBody {
  iterations?: number;
}

export async function POST(request: Request) {
  let iterations = 5;
  try {
    const body = (await request.json()) as RunRequestBody;
    if (typeof body.iterations === "number" && Number.isFinite(body.iterations)) {
      iterations = Math.max(1, Math.min(50, Math.floor(body.iterations)));
    }
  } catch {
    // empty body is fine — we'll use the default
  }

  const scriptPath = path.join("scripts", "autoresearch.ts");

  try {
    const child = spawn(
      "node",
      [
        "--env-file=.env.local",
        "--import",
        "tsx",
        scriptPath,
        String(iterations),
      ],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );
    child.unref();

    console.info("[autoresearch][spawn]", {
      pid: child.pid,
      iterations,
    });

    return Response.json(
      {
        ok: true,
        iterations,
        pid: child.pid ?? null,
      },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown spawn error";
    console.error("[autoresearch][spawn-error]", {
      message,
      iterations,
    });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
