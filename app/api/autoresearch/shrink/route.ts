import {
  getAutoresearchSession,
  shrinkAutoresearchSession,
} from "@/lib/autoresearch-session";

export const runtime = "nodejs";

interface ShrinkRequestBody {
  sessionId?: string;
  plannedIterations?: number;
}

export async function POST(request: Request) {
  let body: ShrinkRequestBody = {};
  try {
    body = (await request.json()) as ShrinkRequestBody;
  } catch {
    return Response.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { sessionId, plannedIterations } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return Response.json(
      { ok: false, error: "sessionId is required" },
      { status: 400 },
    );
  }
  if (typeof plannedIterations !== "number" || plannedIterations < 0) {
    return Response.json(
      { ok: false, error: "plannedIterations must be a non-negative number" },
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
      { ok: false, error: `session is ${session.status}, not running` },
      { status: 409 },
    );
  }

  await shrinkAutoresearchSession(sessionId, plannedIterations);

  return Response.json({ ok: true, sessionId, plannedIterations }, { status: 200 });
}
