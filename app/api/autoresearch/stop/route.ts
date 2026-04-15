import os from "node:os";
import {
  finalizeAutoresearchSession,
  getAutoresearchSession,
} from "@/lib/autoresearch-session";

// Stops one autoresearch session by SIGTERMing the PID we recorded when it
// was spawned. Only works when the request is handled on the same host that
// spawned the session — the PID is a local number, meaningless elsewhere.

export const runtime = "nodejs";

interface StopRequestBody {
  sessionId?: string;
}

export async function POST(request: Request) {
  let sessionId: string | undefined;
  try {
    const body = (await request.json()) as StopRequestBody;
    if (typeof body.sessionId === "string" && body.sessionId.length > 0) {
      sessionId = body.sessionId;
    }
  } catch {
    // fall through; sessionId check below handles missing id
  }

  if (!sessionId) {
    return Response.json(
      { ok: false, error: "sessionId is required" },
      { status: 400 },
    );
  }

  const session = await getAutoresearchSession(sessionId);
  if (!session) {
    return Response.json(
      { ok: false, error: `session ${sessionId} not found` },
      { status: 404 },
    );
  }

  if (session.status !== "running") {
    return Response.json(
      {
        ok: true,
        alreadyTerminal: true,
        status: session.status,
      },
      { status: 200 },
    );
  }

  const currentHost = os.hostname();
  if (session.host && session.host !== currentHost) {
    return Response.json(
      {
        ok: false,
        error: `session was spawned on ${session.host}; stop it from that host`,
        sessionHost: session.host,
        currentHost,
      },
      { status: 409 },
    );
  }

  if (typeof session.pid !== "number") {
    // The spawn route stores the PID best-effort, so a session that
    // crashed between createSession and attachSessionPid ends up here.
    // Nothing to kill — just mark it stopped.
    await finalizeAutoresearchSession(
      sessionId,
      "stopped",
      "pid never attached; marked stopped without signal.",
    );
    return Response.json(
      { ok: true, signaled: false, reason: "no pid" },
      { status: 200 },
    );
  }

  try {
    // SIGTERM — polite. The script catches it, writes status=stopped, and
    // exits. If the child has already exited, process.kill throws ESRCH;
    // we treat that as success (nothing to stop).
    process.kill(session.pid, "SIGTERM");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ESRCH") {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[autoresearch][kill-error]", {
        sessionId,
        pid: session.pid,
        message,
      });
      return Response.json(
        { ok: false, error: message },
        { status: 500 },
      );
    }
  }

  // Belt-and-suspenders: finalize here as well so the session row reflects
  // the stop even if the child's signal handler didn't run (e.g. child
  // already dead). finalizeSession is a no-op once status != running, so
  // this is safe if the script beats us to it.
  await finalizeAutoresearchSession(sessionId, "stopped");

  console.info("[autoresearch][stop]", {
    sessionId,
    pid: session.pid,
  });

  return Response.json(
    { ok: true, signaled: true, sessionId, pid: session.pid },
    { status: 200 },
  );
}
