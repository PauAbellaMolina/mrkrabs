import { HybridRunDetail } from "@/components/hybrid-run-detail";
import {
  listRunSummaries,
  readRunRecord,
  type AgentRunRecord,
} from "@/lib/agent-runs";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let serverRun: AgentRunRecord | null = null;
  let serverBaseline: AgentRunRecord | null = null;

  try {
    serverRun = await readRunRecord(id);
  } catch {
    serverRun = null;
  }

  if (serverRun?.result) {
    const summaries = await listRunSummaries();
    const candidate = summaries.find(
      summary => summary.id !== serverRun!.id && summary.status === "completed",
    );
    if (candidate) {
      try {
        serverBaseline = await readRunRecord(candidate.id);
      } catch {
        serverBaseline = null;
      }
    }
  }

  return (
    <HybridRunDetail
      runId={id}
      serverRun={serverRun}
      serverBaseline={serverBaseline}
    />
  );
}
