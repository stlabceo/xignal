import type { DatabaseConnection, DatabasePool } from "./db.types.js";
import { logJson } from "../logging/json-logger.js";
import {
  recordTransactionFailure,
  recordTransactionRetry
} from "./transaction-observability.js";

const MAX_TRANSACTION_RETRIES = 3;
const RETRYABLE_TRANSACTION_ERROR_CODES = new Set([
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT"
]);

type TransactionRunOptions = {
  operationName?: string;
};

export async function runInTransaction<T>(
  pool: DatabasePool,
  run: (connection: DatabaseConnection) => Promise<T>,
  options: TransactionRunOptions = {}
): Promise<T> {
  const operationName = options.operationName ?? "transaction";

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt += 1) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await run(connection);
      await connection.commit();

      return result;
    } catch (error) {
      await connection.rollback();

      if (isRetryableTransactionError(error) && attempt < MAX_TRANSACTION_RETRIES) {
        const event = {
          operationName,
          attempt,
          maxAttempts: MAX_TRANSACTION_RETRIES,
          code: error.code,
          message: readErrorMessage(error),
          occurredAt: new Date().toISOString()
        };

        recordTransactionRetry(event);
        logJson({
          level: "warn",
          category: "db.transaction.retry",
          ...event
        });
        await sleep(25 * attempt);
        continue;
      }

      if (isRetryableTransactionError(error)) {
        const failureEvent = {
          operationName,
          attempts: attempt,
          code: error.code,
          message: readErrorMessage(error),
          occurredAt: new Date().toISOString()
        };

        recordTransactionFailure(failureEvent);
        logJson({
          level: "error",
          category: "db.transaction.failure",
          ...failureEvent
        });

        throw new Error(
          `Transaction failed after ${attempt} attempts for ${operationName}: ${readErrorMessage(error)}`
        );
      }

      throw error;
    } finally {
      connection.release();
    }
  }

  throw new Error("Transaction retry loop exhausted unexpectedly");
}

function isRetryableTransactionError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    RETRYABLE_TRANSACTION_ERROR_CODES.has((error as { code: string }).code)
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// TODO:
// 1. Tune retry count/backoff once real worker concurrency is measured.
// 2. Attach tracing/logging hooks around begin/commit/rollback and retry attempts.
