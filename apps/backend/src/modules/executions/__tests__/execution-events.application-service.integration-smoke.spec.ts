import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createApp, createApplicationServices } from "../../../app.js";
import { loadEnv } from "../../../config/env.js";
import type { DatabasePool, DatabaseRow } from "../../../infrastructure/db/db.types.js";
import { createMysqlPool } from "../../../infrastructure/db/mysql-pool.js";
import { ExecutionEventsApplicationService } from "../execution-events.application-service.js";
import type { PersistedExecutionEvent } from "../execution-events.application-service.js";
import { MysqlExecutionEventsRepository } from "../repositories/execution-events.repository.js";
import { MysqlExecutionUnitIngressRepository } from "../repositories/execution-unit-ingress.repository.js";
import { ExecutionUnitRuntimeUpdaterService } from "../../projections/execution-unit-runtime-updater.service.js";
import { ExecutionUnitSummaryUpdaterService } from "../../projections/execution-unit-summary-updater.service.js";
import { NotificationErrorsUpdaterService } from "../../projections/notification-errors-updater.service.js";
import { ProjectionUpdaterService } from "../../projections/projection-updater.service.js";
import { MysqlExecutionUnitRuntimeRepository } from "../../projections/repositories/execution-unit-runtime.repository.js";
import { MysqlExecutionUnitSummaryRepository } from "../../projections/repositories/execution-unit-summary.repository.js";
import { MysqlNotificationErrorsRepository } from "../../projections/repositories/notification-errors.repository.js";
import type { ProjectionEventInput } from "../../projections/projection.types.js";

const smokeTest = process.env.RUN_DB_SMOKE_TEST === "1" ? test : test.skip;

test("route validation rejects missing required fields without persisting", async () => {
  let callCount = 0;

  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        context: "live",
        eventType: "order_failed",
        eventStatus: "error",
        eventSource: "validation-test",
        occurredAt: "2026-04-05T19:00:00.000Z"
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 422);
    assert.equal(payload.success, false);
    assert.match(payload.error.message, /executionUnitId/i);
  }, () => {
    callCount += 1;
    throw new Error("service should not be called for invalid payload");
  });

  assert.equal(callCount, 0);
});

test("route validation rejects invalid context and eventType format", async () => {
  let callCount = 0;

  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        eventId: 0,
        executionUnitId: 9001,
        context: "paper",
        eventType: "Order-Failed",
        eventStatus: "error",
        eventSource: "validation-test",
        occurredAt: "2026-04-05T19:01:00.000Z"
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 422);
    assert.equal(payload.success, false);
    assert.equal(payload.error.message, "context must be either 'live' or 'test'");
  }, () => {
    callCount += 1;
    throw new Error("service should not be called for invalid payload");
  });

  assert.equal(callCount, 0);
});

test("route validation rejects invalid datetime and executionUnitId type", async () => {
  let callCount = 0;

  await withTestServer(async (baseUrl) => {
    const badTypeResponse = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        eventId: 0,
        executionUnitId: "9001",
        context: "live",
        eventType: "order_failed",
        eventStatus: "error",
        eventSource: "validation-test",
        occurredAt: "2026-04-05T19:02:00.000Z"
      })
    });
    const badTypePayload = await badTypeResponse.json();

    assert.equal(badTypeResponse.status, 422);
    assert.equal(badTypePayload.error.message, "executionUnitId must be a positive integer");

    const badDateResponse = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        eventId: 0,
        executionUnitId: 9001,
        context: "live",
        eventType: "order_failed",
        eventStatus: "error",
        eventSource: "validation-test",
        occurredAt: "not-a-datetime"
      })
    });
    const badDatePayload = await badDateResponse.json();

    assert.equal(badDateResponse.status, 422);
    assert.equal(badDatePayload.error.message, "occurredAt must be a valid datetime string");
  }, () => {
    callCount += 1;
    throw new Error("service should not be called for invalid payload");
  });

  assert.equal(callCount, 0);
});

test("route validation rejects malformed JSON with 400", async () => {
  let callCount = 0;

  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: "{bad-json"
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.error.message, "Malformed JSON payload");
  }, () => {
    callCount += 1;
    throw new Error("service should not be called for invalid payload");
  });

  assert.equal(callCount, 0);
});

smokeTest("execution event persists and updates projections", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const projectionUpdater = new ProjectionUpdaterService(
      new NotificationErrorsUpdaterService(new MysqlNotificationErrorsRepository(pool)),
      new ExecutionUnitRuntimeUpdaterService(
        new MysqlExecutionUnitRuntimeRepository(pool)
      ),
      new ExecutionUnitSummaryUpdaterService(
        new MysqlExecutionUnitSummaryRepository(pool)
      )
    );

    const service = new ExecutionEventsApplicationService(
      new MysqlExecutionEventsRepository(pool),
      projectionUpdater
    );

    const input: ProjectionEventInput = {
      eventId: 0,
      executionUnitId: 9001,
      context: "live",
      eventType: "order_failed",
      eventStatus: "error",
      eventSource: "integration-smoke",
      occurredAt: new Date().toISOString(),
      executionTaskId: null,
      orderExecutionId: null,
      errorCode: "SMOKE_ORDER_FAIL",
      message: "Smoke order failure for projection update"
    };

    const persisted = await service.recordExecutionEvent(input);

    assert.ok(persisted.eventId > 0);

    const [executionEvents] = await pool.execute<
      Array<DatabaseRow & { total: number }>
    >("SELECT COUNT(*) AS total FROM execution_events WHERE execution_unit_id = 9001");
    const [notificationErrors] = await pool.execute<
      Array<DatabaseRow & { total: number }>
    >("SELECT COUNT(*) AS total FROM notification_errors WHERE execution_unit_id = 9001");
    const [runtimeStates] = await pool.execute<
      Array<DatabaseRow & { total: number }>
    >(
      "SELECT COUNT(*) AS total FROM execution_unit_runtime_states WHERE execution_unit_id = 9001"
    );
    const [summaries] = await pool.execute<
      Array<DatabaseRow & { total: number }>
    >(
      "SELECT COUNT(*) AS total FROM execution_unit_summaries WHERE execution_unit_id = 9001"
    );

    assert.equal(executionEvents[0]?.total, 1);
    assert.equal(notificationErrors[0]?.total, 1);
    assert.equal(runtimeStates[0]?.total, 1);
    assert.equal(summaries[0]?.total, 1);
  } finally {
    await pool.end();
  }
});

smokeTest("resolved recurrence keeps dedupe_key and increments error_instance_seq", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await service.recordExecutionEvent(createOrderFailedEvent(1, "2026-04-05T12:00:00.000Z"));
    await service.recordExecutionEvent(
      createOrderFailedEvent(2, "2026-04-05T12:00:30.000Z")
    );
    await service.recordExecutionEvent({
      eventId: 0,
      executionUnitId: 9001,
      context: "live",
      eventType: "error_resolved",
      eventStatus: "error",
      eventSource: "manual-smoke",
      occurredAt: "2026-04-05T12:01:00.000Z",
      executionTaskId: null,
      orderExecutionId: null,
      errorCode: "SMOKE_ORDER_FAIL",
      errorSourceCategory: "exchange",
      notificationSeverity: "error",
      message: "Resolve smoke order failure"
    });
    await service.recordExecutionEvent(createOrderFailedEvent(3, "2026-04-05T12:02:00.000Z"));

    const [rows] = await pool.execute<
      Array<
        DatabaseRow & {
          dedupe_key: string;
          error_instance_seq: number;
          occurrence_count: number;
          resolved_at: string | null;
        }
      >
    >(
      `
        SELECT dedupe_key, error_instance_seq, occurrence_count, resolved_at
        FROM notification_errors
        WHERE execution_unit_id = 9001
        ORDER BY error_instance_seq ASC
      `
    );

    assert.equal(rows.length, 2);
    assert.ok(rows[0]?.resolved_at !== null);
    assert.equal(rows[0]?.occurrence_count, 2);
    assert.equal(rows[1]?.error_instance_seq, 2);
    assert.equal(rows[1]?.occurrence_count, 1);
    assert.equal(rows[0]?.dedupe_key, rows[1]?.dedupe_key);
  } finally {
    await pool.end();
  }
});

smokeTest("resolve fallback metadata can close unresolved row", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await service.recordExecutionEvent(createOrderFailedEvent(1, "2026-04-05T13:00:00.000Z"));
    await service.recordExecutionEvent({
      eventId: 0,
      executionUnitId: 9001,
      context: "live",
      eventType: "error_resolved",
      eventStatus: "error",
      eventSource: "resolver-worker",
      occurredAt: "2026-04-05T13:01:00.000Z",
      executionTaskId: null,
      orderExecutionId: null,
      errorCode: null,
      errorSourceCategory: null,
      notificationSeverity: null,
      message: "Resolved with metadata fallback",
      metadata: {
        targetErrorSourceCategory: "exchange",
        targetNotificationSeverity: "error",
        targetErrorCode: "SMOKE_ORDER_FAIL"
      }
    });

    const [rows] = await pool.execute<
      Array<DatabaseRow & { resolved_at: string | null }>
    >(
      `
        SELECT resolved_at
        FROM notification_errors
        WHERE execution_unit_id = 9001
        ORDER BY error_instance_seq ASC
      `
    );

    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.resolved_at !== null);
  } finally {
    await pool.end();
  }
});

smokeTest("unit_recovered closes unresolved row and next recurrence gets seq 2", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await service.recordExecutionEvent(createOrderFailedEvent(1, "2026-04-05T14:00:00.000Z"));
    await service.recordExecutionEvent({
      eventId: 0,
      executionUnitId: 9001,
      context: "live",
      eventType: "unit_recovered",
      eventStatus: "ok",
      eventSource: "recovery-worker",
      occurredAt: "2026-04-05T14:01:00.000Z",
      executionTaskId: null,
      orderExecutionId: null,
      errorCode: "SMOKE_ORDER_FAIL",
      errorSourceCategory: "exchange",
      notificationSeverity: "error",
      message: "Unit recovered after exchange failure"
    });
    await service.recordExecutionEvent(createOrderFailedEvent(2, "2026-04-05T14:02:00.000Z"));

    const [rows] = await pool.execute<
      Array<
        DatabaseRow & {
          dedupe_key: string;
          error_instance_seq: number;
          occurrence_count: number;
          resolved_at: string | null;
        }
      >
    >(
      `
        SELECT dedupe_key, error_instance_seq, occurrence_count, resolved_at
        FROM notification_errors
        WHERE execution_unit_id = 9001
        ORDER BY error_instance_seq ASC
      `
    );

    assert.equal(rows.length, 2);
    assert.ok(rows[0]?.resolved_at !== null);
    assert.equal(rows[0]?.error_instance_seq, 1);
    assert.equal(rows[1]?.error_instance_seq, 2);
    assert.equal(rows[0]?.dedupe_key, rows[1]?.dedupe_key);
  } finally {
    await pool.end();
  }
});

smokeTest("different severity and source category create separate dedupe identities", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 1,
        eventType: "order_failed",
        eventStatus: "error",
        eventSource: "exchange-adapter",
        occurredAt: "2026-04-05T15:00:00.000Z",
        errorCode: "SMOKE_SPLIT",
        errorSourceCategory: "exchange",
        notificationSeverity: "error",
        message: "Exchange error severity error"
      })
    );
    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 2,
        eventType: "order_failed",
        eventStatus: "warning",
        eventSource: "exchange-adapter",
        occurredAt: "2026-04-05T15:01:00.000Z",
        errorCode: "SMOKE_SPLIT",
        errorSourceCategory: "exchange",
        notificationSeverity: "warning",
        message: "Exchange warning"
      })
    );
    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 3,
        eventType: "runtime_error",
        eventStatus: "error",
        eventSource: "runtime-worker",
        occurredAt: "2026-04-05T15:02:00.000Z",
        errorCode: "SMOKE_SPLIT",
        errorSourceCategory: "runtime",
        notificationSeverity: "error",
        message: "Runtime error"
      })
    );

    const [rows] = await pool.execute<
      Array<
        DatabaseRow & {
          dedupe_key: string;
          error_instance_seq: number;
          occurrence_count: number;
          resolved_at: string | null;
        }
      >
    >(
      `
        SELECT dedupe_key, error_instance_seq, occurrence_count, resolved_at
        FROM notification_errors
        WHERE execution_unit_id = 9001
        ORDER BY dedupe_key ASC, error_instance_seq ASC
      `
    );

    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((row) => row.dedupe_key),
      [
        "9001|live|SMOKE_SPLIT|error|exchange",
        "9001|live|SMOKE_SPLIT|error|runtime",
        "9001|live|SMOKE_SPLIT|warning|exchange"
      ]
    );
    assert.ok(rows.every((row) => row.error_instance_seq === 1));
    assert.ok(rows.every((row) => row.occurrence_count === 1));
    assert.ok(rows.every((row) => row.resolved_at === null));
  } finally {
    await pool.end();
  }
});

smokeTest("missing errorCode falls back to unknown dedupe key", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 1,
        eventType: "runtime_error",
        eventStatus: "error",
        eventSource: "runtime-worker",
        occurredAt: "2026-04-05T16:00:00.000Z",
        errorCode: null,
        errorSourceCategory: "runtime",
        notificationSeverity: "error",
        message: "Runtime error without code"
      })
    );
    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 2,
        eventType: "runtime_error",
        eventStatus: "error",
        eventSource: "runtime-worker",
        occurredAt: "2026-04-05T16:01:00.000Z",
        errorCode: null,
        errorSourceCategory: "runtime",
        notificationSeverity: "error",
        message: "Runtime error without code again"
      })
    );

    const [rows] = await pool.execute<
      Array<
        DatabaseRow & {
          dedupe_key: string;
          error_instance_seq: number;
          occurrence_count: number;
        }
      >
    >(
      `
        SELECT dedupe_key, error_instance_seq, occurrence_count
        FROM notification_errors
        WHERE execution_unit_id = 9001
        ORDER BY error_instance_seq ASC
      `
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.dedupe_key, "9001|live|unknown|error|runtime");
    assert.equal(rows[0]?.error_instance_seq, 1);
    assert.equal(rows[0]?.occurrence_count, 2);
  } finally {
    await pool.end();
  }
});

smokeTest("warning severity resolve then recurrence keeps warning dedupe identity", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 1,
        eventType: "order_failed",
        eventStatus: "warning",
        eventSource: "exchange-adapter",
        occurredAt: "2026-04-05T17:00:00.000Z",
        errorCode: "WARN_DEGRADED",
        errorSourceCategory: "exchange",
        notificationSeverity: "warning",
        message: "Warning severity degraded order"
      })
    );
    await service.recordExecutionEvent({
      eventId: 0,
      executionUnitId: 9001,
      context: "live",
      eventType: "error_resolved",
      eventStatus: "warning",
      eventSource: "resolver-worker",
      occurredAt: "2026-04-05T17:01:00.000Z",
      executionTaskId: null,
      orderExecutionId: null,
      errorCode: "WARN_DEGRADED",
      errorSourceCategory: "exchange",
      notificationSeverity: "warning",
      message: "Resolved warning severity degraded order"
    });
    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 2,
        eventType: "order_failed",
        eventStatus: "warning",
        eventSource: "exchange-adapter",
        occurredAt: "2026-04-05T17:02:00.000Z",
        errorCode: "WARN_DEGRADED",
        errorSourceCategory: "exchange",
        notificationSeverity: "warning",
        message: "Warning severity degraded order recurred"
      })
    );

    const [rows] = await pool.execute<
      Array<
        DatabaseRow & {
          dedupe_key: string;
          error_instance_seq: number;
          occurrence_count: number;
          resolved_at: string | null;
        }
      >
    >(
      `
        SELECT dedupe_key, error_instance_seq, occurrence_count, resolved_at
        FROM notification_errors
        WHERE execution_unit_id = 9001
        ORDER BY error_instance_seq ASC
      `
    );

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.dedupe_key, "9001|live|WARN_DEGRADED|warning|exchange");
    assert.equal(rows[1]?.dedupe_key, "9001|live|WARN_DEGRADED|warning|exchange");
    assert.ok(rows[0]?.resolved_at !== null);
    assert.equal(rows[0]?.error_instance_seq, 1);
    assert.equal(rows[1]?.error_instance_seq, 2);
  } finally {
    await pool.end();
  }
});

smokeTest("unit_recovered metadata fallback resolves unknown warning identity", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 1,
        eventType: "order_failed",
        eventStatus: "warning",
        eventSource: "exchange-adapter",
        occurredAt: "2026-04-05T18:00:00.000Z",
        errorCode: null,
        errorSourceCategory: "exchange",
        notificationSeverity: "warning",
        message: "Warning without explicit code"
      })
    );
    await service.recordExecutionEvent({
      eventId: 0,
      executionUnitId: 9001,
      context: "live",
      eventType: "unit_recovered",
      eventStatus: "ok",
      eventSource: "recovery-worker",
      occurredAt: "2026-04-05T18:01:00.000Z",
      executionTaskId: null,
      orderExecutionId: null,
      errorCode: null,
      errorSourceCategory: null,
      notificationSeverity: null,
      message: "Recovered warning via metadata fallback",
      metadata: {
        targetErrorSourceCategory: "exchange",
        targetNotificationSeverity: "warning",
        targetErrorCode: "unknown"
      }
    });

    const [rows] = await pool.execute<
      Array<
        DatabaseRow & {
          dedupe_key: string;
          error_instance_seq: number;
          occurrence_count: number;
          resolved_at: string | null;
        }
      >
    >(
      `
        SELECT dedupe_key, error_instance_seq, occurrence_count, resolved_at
        FROM notification_errors
        WHERE execution_unit_id = 9001
        ORDER BY error_instance_seq ASC
      `
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.dedupe_key, "9001|live|unknown|warning|exchange");
    assert.equal(rows[0]?.error_instance_seq, 1);
    assert.equal(rows[0]?.occurrence_count, 1);
    assert.ok(rows[0]?.resolved_at !== null);
  } finally {
    await pool.end();
  }
});

smokeTest("parallel same dedupe_key errors keep one unresolved row with occurrence_count 2", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await Promise.all([
      service.recordExecutionEvent(
        createErrorEvent({
          eventId: 101,
          eventType: "order_failed",
          eventStatus: "error",
          eventSource: "parallel-worker-a",
          occurredAt: "2026-04-05T21:00:00.000Z",
          errorCode: "SMOKE_CONCURRENCY",
          errorSourceCategory: "exchange",
          notificationSeverity: "error",
          message: "Concurrent order failure A"
        })
      ),
      service.recordExecutionEvent(
        createErrorEvent({
          eventId: 102,
          eventType: "order_failed",
          eventStatus: "error",
          eventSource: "parallel-worker-b",
          occurredAt: "2026-04-05T21:00:00.100Z",
          errorCode: "SMOKE_CONCURRENCY",
          errorSourceCategory: "exchange",
          notificationSeverity: "error",
          message: "Concurrent order failure B"
        })
      )
    ]);

    const rows = await selectNotificationErrors(pool);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.dedupe_key, "9001|live|SMOKE_CONCURRENCY|error|exchange");
    assert.equal(rows[0]?.error_instance_seq, 1);
    assert.equal(rows[0]?.occurrence_count, 2);
    assert.equal(rows[0]?.resolved_at, null);
  } finally {
    await pool.end();
  }
});

smokeTest("parallel resolve versus recurrence never creates duplicate unresolved instances", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    const service = createSmokeApplicationService(pool);

    await service.recordExecutionEvent(
      createErrorEvent({
        eventId: 201,
        eventType: "order_failed",
        eventStatus: "error",
        eventSource: "seed-worker",
        occurredAt: "2026-04-05T21:10:00.000Z",
        errorCode: "SMOKE_RACE",
        errorSourceCategory: "exchange",
        notificationSeverity: "error",
        message: "Seed unresolved row"
      })
    );

    await Promise.all([
      service.recordExecutionEvent({
        eventId: 202,
        executionUnitId: 9001,
        context: "live",
        eventType: "error_resolved",
        eventStatus: "error",
        eventSource: "resolver-worker",
        occurredAt: "2026-04-05T21:10:01.000Z",
        executionTaskId: null,
        orderExecutionId: null,
        errorCode: "SMOKE_RACE",
        errorSourceCategory: "exchange",
        notificationSeverity: "error",
        message: "Concurrent resolve"
      }),
      service.recordExecutionEvent(
        createErrorEvent({
          eventId: 203,
          eventType: "order_failed",
          eventStatus: "error",
          eventSource: "recur-worker",
          occurredAt: "2026-04-05T21:10:01.100Z",
          errorCode: "SMOKE_RACE",
          errorSourceCategory: "exchange",
          notificationSeverity: "error",
          message: "Concurrent recurrence"
        })
      )
    ]);

    const rows = await selectNotificationErrors(pool);
    const unresolvedRows = rows.filter((row) => row.resolved_at === null);
    const unresolvedSeqs = new Set(unresolvedRows.map((row) => row.error_instance_seq));

    assert.ok(rows.length === 1 || rows.length === 2);
    assert.ok(unresolvedRows.length <= 1);
    assert.equal(unresolvedSeqs.size, unresolvedRows.length);

    if (rows.length === 1) {
      assert.equal(rows[0]?.dedupe_key, "9001|live|SMOKE_RACE|error|exchange");
      assert.equal(rows[0]?.error_instance_seq, 1);
      assert.equal(rows[0]?.occurrence_count, 2);
      assert.ok(rows[0]?.resolved_at !== null);
    } else {
      assert.equal(rows[0]?.dedupe_key, "9001|live|SMOKE_RACE|error|exchange");
      assert.equal(rows[1]?.dedupe_key, "9001|live|SMOKE_RACE|error|exchange");
      assert.ok(rows[0]?.resolved_at !== null);
      assert.equal(rows[0]?.error_instance_seq, 1);
      assert.equal(rows[1]?.error_instance_seq, 2);
      assert.equal(rows[1]?.resolved_at, null);
    }
  } finally {
    await pool.end();
  }
});

smokeTest("referential validation rejects nonexistent execution unit", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    await withSmokeServer(pool, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          eventId: 0,
          executionUnitId: 999999,
          context: "live",
          eventType: "order_failed",
          eventStatus: "error",
          eventSource: "referential-test",
          occurredAt: "2026-04-05T20:00:00.000Z"
        })
      });
      const payload = await response.json();

      assert.equal(response.status, 404);
      assert.equal(payload.error.message, "execution unit not found");
    });

    await assertNoProjectionWrites(pool);
  } finally {
    await pool.end();
  }
});

smokeTest("referential validation rejects context mismatch", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    await withSmokeServer(pool, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          eventId: 0,
          executionUnitId: 9001,
          context: "test",
          eventType: "order_failed",
          eventStatus: "error",
          eventSource: "referential-test",
          occurredAt: "2026-04-05T20:01:00.000Z"
        })
      });
      const payload = await response.json();

      assert.equal(response.status, 409);
      assert.equal(
        payload.error.message,
        "execution unit context does not match request context"
      );
    });

    await assertNoProjectionWrites(pool);
  } finally {
    await pool.end();
  }
});

smokeTest("referential validation rejects inactive and deleted execution units", async () => {
  const env = loadEnv();
  const pool = createMysqlPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName
  });

  try {
    await prepareSmokeSeed(pool);

    await pool.execute(`
      UPDATE execution_units
      SET activation_status = 'inactive'
      WHERE id = 9001
    `);

    await withSmokeServer(pool, async (baseUrl) => {
      const inactiveResponse = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          eventId: 0,
          executionUnitId: 9001,
          context: "live",
          eventType: "order_failed",
          eventStatus: "error",
          eventSource: "referential-test",
          occurredAt: "2026-04-05T20:02:00.000Z"
        })
      });
      const inactivePayload = await inactiveResponse.json();

      assert.equal(inactiveResponse.status, 409);
      assert.equal(
        inactivePayload.error.message,
        "execution unit is not active for event ingestion"
      );
    });

    await assertNoProjectionWrites(pool);

    await pool.execute(`
      UPDATE execution_units
      SET activation_status = 'active',
          is_deleted = 1
      WHERE id = 9001
    `);

    await withSmokeServer(pool, async (baseUrl) => {
      const deletedResponse = await fetch(`${baseUrl}/api/v1/internal/execution-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          eventId: 0,
          executionUnitId: 9001,
          context: "live",
          eventType: "order_failed",
          eventStatus: "error",
          eventSource: "referential-test",
          occurredAt: "2026-04-05T20:03:00.000Z"
        })
      });
      const deletedPayload = await deletedResponse.json();

      assert.equal(deletedResponse.status, 409);
      assert.equal(
        deletedPayload.error.message,
        "execution unit is deleted and cannot accept events"
      );
    });

    await assertNoProjectionWrites(pool);
  } finally {
    await pool.end();
  }
});

function createSmokeApplicationService(pool: DatabasePool) {
  return new ExecutionEventsApplicationService(
    new MysqlExecutionEventsRepository(pool),
    new ProjectionUpdaterService(
      new NotificationErrorsUpdaterService(new MysqlNotificationErrorsRepository(pool)),
      new ExecutionUnitRuntimeUpdaterService(
        new MysqlExecutionUnitRuntimeRepository(pool)
      ),
      new ExecutionUnitSummaryUpdaterService(
        new MysqlExecutionUnitSummaryRepository(pool)
      )
    ),
    new MysqlExecutionUnitIngressRepository(pool)
  );
}

function createOrderFailedEvent(
  eventId: number,
  occurredAt: string
): ProjectionEventInput {
  return createErrorEvent({
    eventId,
    occurredAt,
    eventType: "order_failed",
    eventStatus: "error",
    eventSource: "integration-smoke",
    errorCode: "SMOKE_ORDER_FAIL",
    message: "Smoke order failure for projection update"
  });
}

function createErrorEvent(
  overrides: Partial<ProjectionEventInput> = {}
): ProjectionEventInput {
  return {
    eventId: 0,
    executionUnitId: 9001,
    context: "live",
    eventType: "order_failed",
    eventStatus: "error",
    eventSource: "integration-smoke",
    occurredAt: "2026-04-05T12:00:00.000Z",
    executionTaskId: null,
    orderExecutionId: null,
    errorCode: "SMOKE_ORDER_FAIL",
    message: "Smoke order failure for projection update",
    ...overrides
  };
}

async function prepareSmokeSeed(pool: DatabasePool): Promise<void> {
  await pool.execute("DELETE FROM execution_unit_summaries WHERE execution_unit_id = 9001");
  await pool.execute(
    "DELETE FROM execution_unit_runtime_states WHERE execution_unit_id = 9001"
  );
  await pool.execute("DELETE FROM notification_errors WHERE execution_unit_id = 9001");
  await pool.execute("DELETE FROM execution_events WHERE execution_unit_id = 9001");

  await pool.execute(`
    INSERT INTO users (id, email, display_name, status, created_at, updated_at)
    VALUES (9001, 'smoke-user@example.com', 'Smoke User', 'active', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE
      display_name = VALUES(display_name),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP(3)
  `);

  await pool.execute(`
    INSERT INTO exchange_accounts (
      id, user_id, exchange_type, account_label, context, status, created_at, updated_at
    ) VALUES (
      9001, 9001, 'binance-futures', 'local-smoke-live', 'live', 'active', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
    )
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP(3)
  `);

  await pool.execute(`
    INSERT INTO execution_units (
      id, user_id, exchange_account_id, strategy_id, context, name, symbol, market_type, timeframe,
      status, activation_status, is_deleted, created_at, updated_at
    ) VALUES (
      9001, 9001, 9001, NULL, 'live', 'Local Smoke BTC Unit', 'BTCUSDT', 'futures', '5m',
      'active', 'active', 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
    )
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      activation_status = VALUES(activation_status),
      is_deleted = VALUES(is_deleted),
      updated_at = CURRENT_TIMESTAMP(3)
  `);
}

async function withTestServer(
  run: (baseUrl: string) => Promise<void>,
  recordExecutionEvent: (input: ProjectionEventInput) => Promise<PersistedExecutionEvent>
): Promise<void> {
  const app = createApp({
    executionEventsApplicationService: {
      async recordExecutionEvent(input: ProjectionEventInput) {
        return recordExecutionEvent(input);
      }
    } as unknown as ExecutionEventsApplicationService
  });

  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function withSmokeServer(
  pool: DatabasePool,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = createApp(createApplicationServices(pool));
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function assertNoProjectionWrites(pool: DatabasePool): Promise<void> {
  const [rows] = await pool.execute<Array<DatabaseRow & { total: number }>>(
    `
      SELECT COUNT(*) AS total FROM execution_events WHERE execution_unit_id = 9001
      UNION ALL
      SELECT COUNT(*) AS total FROM notification_errors WHERE execution_unit_id = 9001
      UNION ALL
      SELECT COUNT(*) AS total FROM execution_unit_runtime_states WHERE execution_unit_id = 9001
      UNION ALL
      SELECT COUNT(*) AS total FROM execution_unit_summaries WHERE execution_unit_id = 9001
    `
  );

  assert.deepEqual(
    rows.map((row) => row.total),
    [0, 0, 0, 0]
  );
}

async function selectNotificationErrors(
  pool: DatabasePool
): Promise<
  Array<
    DatabaseRow & {
      dedupe_key: string;
      error_instance_seq: number;
      occurrence_count: number;
      resolved_at: string | null;
    }
  >
> {
  const [rows] = await pool.execute<
    Array<
      DatabaseRow & {
        dedupe_key: string;
        error_instance_seq: number;
        occurrence_count: number;
        resolved_at: string | null;
      }
    >
  >(
    `
      SELECT dedupe_key, error_instance_seq, occurrence_count, resolved_at
      FROM notification_errors
      WHERE execution_unit_id = 9001
      ORDER BY error_instance_seq ASC
    `
  );

  return rows;
}
