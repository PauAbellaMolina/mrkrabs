import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attachAutoresearchSessionPid,
  createAutoresearchSession,
} from "@/lib/autoresearch-session";

// Creates an autoresearch session row in Convex, then spawns the outer-loop
// script as a detached child process. The child's PID is written back onto
// the session so /api/autoresearch/stop can SIGTERM exactly one session.
// Child stdio is piped to .mrkrabs-logs/autoresearch-<sessionId>.log so the
// console.info / console.warn / error stacks from cala-agent + autoresearch
// are recoverable (previously they were thrown away with stdio: "ignore").
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

const LOG_DIR = path.join(process.cwd(), ".mrkrabs-logs");

function openSessionLogFile(sessionId: string): {
  logPath: string;
  fd: number;
} {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `autoresearch-${sessionId}.log`);
  const fd = fs.openSync(logPath, "a");
  // Write a header so the log is self-describing when tailed cold.
  fs.writeSync(
    fd,
    `=== autoresearch session ${sessionId} started ${new Date().toISOString()} ===\n`,
  );
  return { logPath, fd };
}

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

  let logPath: string;
  let logFd: number;
  try {
    const opened = openSessionLogFile(sessionId);
    logPath = opened.logPath;
    logFd = opened.fd;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown log-open error";
    console.error("[autoresearch][log-open-error]", { sessionId, message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  try {
    await createAutoresearchSession({
      sessionId,
      startedAt,
      model,
      plannedIterations: iterations,
      host: os.hostname(),
      logPath,
    });
  } catch (error) {
    try {
      fs.closeSync(logFd);
    } catch {
      // empty
    }
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
        // stdin=ignore, stdout+stderr → session log file. The fd gets closed
        // automatically when the child exits; we dup it twice so stdout and
        // stderr share the same underlying file (append-mode writes are
        // thread-safe enough for this kind of logging).
        stdio: ["ignore", logFd, logFd],
        env: {
          ...process.env,
          AUTORESEARCH_SESSION_ID: sessionId,
          AUTORESEARCH_MODEL: model,
          AUTORESEARCH_LOG_PATH: logPath,
          // BASELINE test mode is env-driven so the dev server inherits it
          // from .env.local or a prefix like `MRKRABS_BASELINE=1 pnpm dev`.
          // No extra UI surface yet — flip via env, restart dev server, new
          // autoresearch sessions pick it up.
          ...(process.env.MRKRABS_BASELINE
            ? { MRKRABS_BASELINE: process.env.MRKRABS_BASELINE }
            : {}),
        },
      },
    );
    child.unref();

    // The parent can close its own handle to the fd now that the child
    // inherited it — otherwise the fd stays open even after the child exits.
    try {
      fs.closeSync(logFd);
    } catch {
      // swallow — worst case the fd gets closed at process exit
    }

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
      logPath,
    });

    return Response.json(
      {
        ok: true,
        sessionId,
        iterations,
        model,
        pid: child.pid ?? null,
        logPath,
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
