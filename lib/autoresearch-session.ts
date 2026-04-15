import { api } from "../convex/_generated/api";
import { getConvexClient } from "./convex-client";

// Thin wrapper around the session Convex mutations/queries. The route that
// spawns a session uses createSession + attachSessionPid; the script that
// runs inside the session uses incrementSessionProgress + finalizeSession;
// the stop endpoint + UI loader use getSession/listSessions.

export type AutoresearchSessionStatus =
  | "running"
  | "completed"
  | "stopped"
  | "failed";

export interface AutoresearchSession {
  sessionId: string;
  status: AutoresearchSessionStatus;
  startedAt: string;
  finishedAt?: string;
  pid: number | null;
  host: string | null;
  model: string;
  plannedIterations: number;
  completedIterations: number;
  errorMessage?: string;
}

export async function createAutoresearchSession(input: {
  sessionId: string;
  startedAt: string;
  model: string;
  plannedIterations: number;
  host?: string;
}): Promise<void> {
  await getConvexClient().mutation(api.autoresearch.createSession, input);
}

export async function attachAutoresearchSessionPid(
  sessionId: string,
  pid: number,
): Promise<void> {
  await getConvexClient().mutation(api.autoresearch.attachSessionPid, {
    sessionId,
    pid,
  });
}

export async function incrementAutoresearchSessionProgress(
  sessionId: string,
): Promise<void> {
  await getConvexClient().mutation(
    api.autoresearch.incrementSessionProgress,
    { sessionId },
  );
}

export async function finalizeAutoresearchSession(
  sessionId: string,
  status: Exclude<AutoresearchSessionStatus, "running">,
  errorMessage?: string,
): Promise<void> {
  await getConvexClient().mutation(api.autoresearch.finalizeSession, {
    sessionId,
    status,
    errorMessage,
  });
}

export async function listAutoresearchSessions(): Promise<
  AutoresearchSession[]
> {
  const rows = await getConvexClient().query(
    api.autoresearch.listSessions,
    {},
  );
  return rows as unknown as AutoresearchSession[];
}

export async function getAutoresearchSession(
  sessionId: string,
): Promise<AutoresearchSession | null> {
  const row = await getConvexClient().query(api.autoresearch.getSession, {
    sessionId,
  });
  return row as unknown as AutoresearchSession | null;
}
