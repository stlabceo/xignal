import "dotenv/config";

import { loadEnv } from "../src/config/env.js";
import type { DatabasePool, DatabaseRow } from "../src/infrastructure/db/db.types.js";
import { createMysqlPool } from "../src/infrastructure/db/mysql-pool.js";

type StressMode = "same-dedupe" | "resolve-race";

type StressOptions = {
  url: string;
  runs: number;
  parallelism: number;
  mode: StressMode;
};

type TransactionObservabilitySnapshot = {
  retryCount: number;
  failureCount: number;
  lastRetry: unknown;
  lastFailure: unknown;
  retryEvents: unknown[];
};

async function main() {
  const options = readOptions(process.argv.slice(2));
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await resetState(pool, options.mode);
    await resetTransactionObservability(options.url);

    const results =
      options.mode === "same-dedupe"
        ? await runSameDedupeStress(options)
        : await runResolveRaceStress(options);

    const observability = await fetchTransactionObservability(options.url);
    const notificationErrors = await selectNotificationErrors(pool);

    console.log(
      JSON.stringify(
        {
          mode: options.mode,
          runs: options.runs,
          parallelism: options.parallelism,
          successCount: results.successCount,
          failureCount: results.failureCount,
          failedResponses: results.failedResponses,
          transactionObservability: observability,
          notificationErrors
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

async function runSameDedupeStress(options: StressOptions) {
  let successCount = 0;
  const failedResponses: Array<{ status: number; body: unknown }> = [];

  for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
    const requests = Array.from({ length: options.parallelism }, (_, parallelIndex) =>
      postJson(`${options.url}/api/v1/internal/execution-events`, {
        eventId: 1000 + runIndex * 100 + parallelIndex,
        executionUnitId: 9001,
        context: "live",
        eventType: "order_failed",
        eventStatus: "error",
        eventSource: `stress-worker-${parallelIndex}`,
        occurredAt: `2026-04-05T22:${String(runIndex).padStart(2, "0")}:${String(
          parallelIndex
        ).padStart(2, "0")}.000Z`,
        errorCode: "SMOKE_STRESS",
        errorSourceCategory: "exchange",
        notificationSeverity: "error",
        message: `Stress order failure run=${runIndex} worker=${parallelIndex}`
      })
    );

    const responses = await Promise.all(requests);

    for (const response of responses) {
      if (response.status === 202) {
        successCount += 1;
      } else {
        failedResponses.push(response);
      }
    }
  }

  return {
    successCount,
    failureCount: failedResponses.length,
    failedResponses
  };
}

async function runResolveRaceStress(options: StressOptions) {
  let successCount = 0;
  const failedResponses: Array<{ status: number; body: unknown }> = [];

  for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
    const seed = await postJson(`${options.url}/api/v1/internal/execution-events`, {
      eventId: 2000 + runIndex,
      executionUnitId: 9001,
      context: "live",
      eventType: "order_failed",
      eventStatus: "error",
      eventSource: "stress-seed",
      occurredAt: `2026-04-05T23:${String(runIndex).padStart(2, "0")}:00.000Z`,
      errorCode: "SMOKE_STRESS_RACE",
      errorSourceCategory: "exchange",
      notificationSeverity: "error",
      message: `Stress seed run=${runIndex}`
    });

    if (seed.status === 202) {
      successCount += 1;
    } else {
      failedResponses.push(seed);
      continue;
    }

    const [resolveResponse, recurrenceResponse] = await Promise.all([
      postJson(`${options.url}/api/v1/internal/execution-events`, {
        eventId: 3000 + runIndex,
        executionUnitId: 9001,
        context: "live",
        eventType: "error_resolved",
        eventStatus: "error",
        eventSource: "stress-resolver",
        occurredAt: `2026-04-05T23:${String(runIndex).padStart(2, "0")}:01.000Z`,
        errorCode: "SMOKE_STRESS_RACE",
        errorSourceCategory: "exchange",
        notificationSeverity: "error",
        message: `Stress resolve run=${runIndex}`
      }),
      postJson(`${options.url}/api/v1/internal/execution-events`, {
        eventId: 4000 + runIndex,
        executionUnitId: 9001,
        context: "live",
        eventType: "order_failed",
        eventStatus: "error",
        eventSource: "stress-recur",
        occurredAt: `2026-04-05T23:${String(runIndex).padStart(2, "0")}:01.100Z`,
        errorCode: "SMOKE_STRESS_RACE",
        errorSourceCategory: "exchange",
        notificationSeverity: "error",
        message: `Stress recurrence run=${runIndex}`
      })
    ]);

    for (const response of [resolveResponse, recurrenceResponse]) {
      if (response.status === 202) {
        successCount += 1;
      } else {
        failedResponses.push(response);
      }
    }
  }

  return {
    successCount,
    failureCount: failedResponses.length,
    failedResponses
  };
}

async function resetState(pool: DatabasePool, mode: StressMode): Promise<void> {
  await pool.execute(
    "DELETE FROM execution_unit_summaries WHERE execution_unit_id = 9001"
  );
  await pool.execute(
    "DELETE FROM execution_unit_runtime_states WHERE execution_unit_id = 9001"
  );
  await pool.execute("DELETE FROM notification_errors WHERE execution_unit_id = 9001");
  await pool.execute("DELETE FROM execution_events WHERE execution_unit_id = 9001");

  await pool.execute(`
    UPDATE execution_units
    SET context = 'live',
        status = 'active',
        activation_status = 'active',
        is_deleted = 0
    WHERE id = 9001
  `);

  if (mode === "resolve-race") {
    await pool.execute("DELETE FROM notification_errors WHERE execution_unit_id = 9001");
  }
}

async function resetTransactionObservability(url: string): Promise<void> {
  await fetch(`${url}/api/v1/internal/observability/transaction-retries/reset`, {
    method: "POST"
  });
}

async function fetchTransactionObservability(
  url: string
): Promise<TransactionObservabilitySnapshot> {
  const response = await fetch(`${url}/api/v1/internal/observability/transaction-retries`);
  const payload = (await response.json()) as {
    success: boolean;
    data: TransactionObservabilitySnapshot;
  };

  return payload.data;
}

async function postJson(
  url: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return {
    status: response.status,
    body: payload
  };
}

async function selectNotificationErrors(pool: DatabasePool) {
  const [rows] = await pool.execute<
    Array<
      DatabaseRow & {
        id: number;
        dedupe_key: string;
        error_instance_seq: number;
        occurrence_count: number;
        resolved_at: string | null;
      }
    >
  >(
    `
      SELECT
        id,
        dedupe_key,
        error_instance_seq,
        occurrence_count,
        resolved_at
      FROM notification_errors
      WHERE execution_unit_id = 9001
      ORDER BY dedupe_key ASC, error_instance_seq ASC
    `
  );

  return rows;
}

function readOptions(argv: string[]): StressOptions {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith("--") || !value) {
      continue;
    }

    args.set(key.slice(2), value);
  }

  return {
    url: args.get("url") ?? "http://localhost:3001",
    runs: Number(args.get("runs") ?? "5"),
    parallelism: Number(args.get("parallelism") ?? "2"),
    mode: (args.get("mode") as StressMode | undefined) ?? "same-dedupe"
  };
}

main().catch((error) => {
  console.error("[stress] failed", error);
  process.exitCode = 1;
});
