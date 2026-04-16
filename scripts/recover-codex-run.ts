import { readFile } from "node:fs/promises";

async function main() {
  const runId = process.argv[2]?.trim();

  if (!runId) {
    console.error(
      "Usage: node --env-file=.env.local --import tsx scripts/recover-codex-run.ts <run-id>",
    );
    process.exit(2);
  }

  const checkpointPath = new URL(
    `../.data/codex-checkpoints/${runId}.json`,
    import.meta.url,
  );

  const raw = JSON.parse(await readFile(checkpointPath, "utf8")) as {
    portfolioDraft?: unknown;
  };

  if (!Array.isArray(raw.portfolioDraft)) {
    console.error(
      `Checkpoint ${checkpointPath.pathname} has no portfolioDraft array.`,
    );
    process.exit(1);
  }

  const transactions = raw.portfolioDraft
    .filter(
      (
        entry,
      ): entry is {
        ticker?: string;
        nasdaq_code?: string;
        amount: number;
      } =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            (typeof (entry as { ticker?: unknown }).ticker === "string" ||
              typeof (entry as { nasdaq_code?: unknown }).nasdaq_code ===
                "string") &&
            typeof (entry as { amount?: unknown }).amount === "number",
        ),
    )
    .map((entry) => ({
      nasdaq_code: (entry.nasdaq_code ?? entry.ticker ?? "")
        .trim()
        .toUpperCase(),
      amount: Math.trunc(entry.amount),
    }));

  const totalAllocated = transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );

  console.log(
    JSON.stringify(
      {
        runId,
        checkpointPath: checkpointPath.pathname,
        transactionCount: transactions.length,
        totalAllocated,
        submissionPayload: {
          team_id: process.env.TEAM_ID ?? "",
          model_agent_name: "mrkrabs-codex-cli-recovered",
          model_agent_version: "recovered",
          transactions,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
