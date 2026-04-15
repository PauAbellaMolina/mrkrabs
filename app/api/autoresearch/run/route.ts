import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  attachAutoresearchSessionPid,
  createAutoresearchSession,
} from "@/lib/autoresearch-session";

// Creates an autoresearch session row in Convex, then spawns the outer-loop
// script as a detached child process. The child's PID is written back onto
// the session so /api/autoresearch/stop can SIGTERM exactly one session.
//
// This is local-dev-only: the child lives in the same host as the Next dev
// server, and the PID is only meaningful on that machine.

export const runtime = "nodejs";
export const maxDuration = 10;

interface RunRequestBody {
  iterations?: number;
  model?: string;
}

const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6[1m]",
  "claude-opus-4-6",
  "claude-opus-4-6[1m]",
]);

const DEFAULT_MODEL = "claude-sonnet-4-6";

export async function POST(request: Request) {
  let iterations = 5;
  let model = DEFAULT_MODEL;
  try {
    const body = (await request.json()) as RunRequestBody;
    if (typeof body.iterations === "number" && Number.isFinite(body.iterations)) {
      iterations = Math.max(1, Math.min(50, Math.floor(body.iterations)));
    }
    if (typeof body.model === "string" && ALLOWED_MODELS.has(body.model)) {
      model = body.model;
    }
  } catch {
    // empty body is fine — defaults apply
  }

  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    await createAutoresearchSession({
      sessionId,
      startedAt,
      model,
      plannedIterations: iterations,
      host: os.hostname(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown session-create error";
    console.error("[autoresearch][session-create-error]", { message });
    return Response.json({ ok: false, error: message }, { status: 500 });
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
        env: {
          ...process.env,
          AUTORESEARCH_SESSION_ID: sessionId,
          AUTORESEARCH_MODEL: model,
        },
      },
    );
    child.unref();

    if (typeof child.pid === "number") {
      // Best effort: if this mutation fails we still return success because
      // the child is already running — the Stop button will just be disabled
      // until the session reloads enough to learn the pid some other way.
      attachAutoresearchSessionPid(sessionId, child.pid).catch(error => {
        console.warn("[autoresearch][attach-pid-failed]", {
          sessionId,
          pid: child.pid,
          error: error instanceof Error ? error.message : error,
        });
      });
    }

    console.info("[autoresearch][spawn]", {
      sessionId,
      pid: child.pid ?? null,
      iterations,
      model,
    });

    return Response.json(
      {
        ok: true,
        sessionId,
        iterations,
        model,
        pid: child.pid ?? null,
      },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown spawn error";
    console.error("[autoresearch][spawn-error]", {
      sessionId,
      message,
      iterations,
    });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
