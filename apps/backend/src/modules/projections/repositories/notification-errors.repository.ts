import {
  type NotificationErrorInsert,
  type NotificationErrorRecord,
  type NotificationErrorsRepository,
  type NotificationErrorUpdate
} from "../projection.types.js";
import type {
  DatabaseConnection,
  DatabaseMutationResult,
  DatabasePool,
  DatabaseRow
} from "../../../infrastructure/db/db.types.js";
import { toMysqlDateTime } from "../../../infrastructure/db/datetime.js";
import { runInTransaction } from "../../../infrastructure/db/transaction-runner.js";

type NotificationErrorRow = DatabaseRow & {
  id: number;
  execution_unit_id: number;
  context: "live" | "test";
  severity: "warning" | "error";
  dedupe_key: string;
  error_instance_seq: number;
  error_code: string | null;
  message: string;
  source_event_id: number | null;
  source_task_id: number | null;
  source_order_execution_id: number | null;
  first_occurred_at: string;
  last_occurred_at: string;
  resolved_at: string | null;
  occurrence_count: number;
};

export class MysqlNotificationErrorsRepository
  implements NotificationErrorsRepository
{
  constructor(
    private readonly pool: DatabasePool,
    private readonly connection?: DatabaseConnection
  ) {}

  async withTransaction<T>(
    run: (repository: NotificationErrorsRepository) => Promise<T>
  ): Promise<T> {
    if (this.connection) {
      return run(this);
    }

    return runInTransaction(this.pool, async (connection) => {
      const repository = new MysqlNotificationErrorsRepository(this.pool, connection);
      return run(repository);
    }, { operationName: "notification_errors" });
  }

  async findLatestUnresolvedByDedupeKeyForUpdate(input: {
    dedupeKey: string;
  }): Promise<NotificationErrorRecord | null> {
    const sql = `
      SELECT
        id,
        execution_unit_id,
        context,
        severity,
        dedupe_key,
        error_instance_seq,
        error_code,
        message,
        source_event_id,
        source_task_id,
        source_order_execution_id,
        first_occurred_at,
        last_occurred_at,
        resolved_at,
        occurrence_count
      FROM notification_errors
      WHERE dedupe_key = ?
        AND resolved_at IS NULL
      ORDER BY error_instance_seq DESC
      LIMIT 1
      FOR UPDATE
    `;

    const [rows] = await this.getExecutor().execute<NotificationErrorRow[]>(sql, [
      input.dedupeKey
    ]);

    const [row] = rows;
    return row ? this.toRecord(row) : null;
  }

  async findMaxInstanceSeqByDedupeKeyForUpdate(input: {
    dedupeKey: string;
  }): Promise<number | null> {
    const sql = `
      SELECT MAX(error_instance_seq) AS max_instance_seq
      FROM notification_errors
      WHERE dedupe_key = ?
      FOR UPDATE
    `;

    const [rows] = await this.getExecutor().execute<
      Array<DatabaseRow & { max_instance_seq: number | null }>
    >(
      sql,
      [input.dedupeKey]
    );

    return rows[0]?.max_instance_seq ?? null;
  }

  async insert(input: NotificationErrorInsert): Promise<void> {
    const sql = `
      INSERT INTO notification_errors (
        execution_unit_id,
        context,
        severity,
        dedupe_key,
        error_instance_seq,
        error_code,
        message,
        source_event_id,
        source_task_id,
        source_order_execution_id,
        first_occurred_at,
        last_occurred_at,
        resolved_at,
        occurrence_count,
        metadata,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
    `;

    await this.getExecutor().execute<DatabaseMutationResult>(sql, [
      input.executionUnitId,
      input.context,
      input.severity,
      input.dedupeKey,
      input.errorInstanceSeq,
      input.errorCode,
      input.message,
      input.sourceEventId,
      input.sourceTaskId,
      input.sourceOrderExecutionId,
      toMysqlDateTime(input.firstOccurredAt),
      toMysqlDateTime(input.lastOccurredAt),
      input.resolvedAt ? toMysqlDateTime(input.resolvedAt) : null,
      input.occurrenceCount,
      JSON.stringify(input.metadata ?? null)
    ]);
  }

  async updateById(id: number, input: NotificationErrorUpdate): Promise<void> {
    const sql = `
      UPDATE notification_errors
      SET
        last_occurred_at = ?,
        occurrence_count = ?,
        source_event_id = ?,
        source_task_id = ?,
        source_order_execution_id = ?,
        message = ?,
        resolved_at = ?,
        metadata = ?,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `;

    await this.getExecutor().execute<DatabaseMutationResult>(sql, [
      toMysqlDateTime(input.lastOccurredAt),
      input.occurrenceCount,
      input.sourceEventId,
      input.sourceTaskId,
      input.sourceOrderExecutionId,
      input.message,
      input.resolvedAt ? toMysqlDateTime(input.resolvedAt) : null,
      JSON.stringify(input.metadata ?? null),
      id
    ]);
  }

  private getExecutor(): DatabaseConnection | DatabasePool {
    if (this.connection) {
      return this.connection;
    }

    return this.pool;
  }

  private toRecord(row: NotificationErrorRow): NotificationErrorRecord {
    return {
      id: row.id,
      executionUnitId: row.execution_unit_id,
      context: row.context,
      severity: row.severity,
      dedupeKey: row.dedupe_key,
      errorInstanceSeq: row.error_instance_seq,
      errorCode: row.error_code,
      message: row.message,
      sourceEventId: row.source_event_id,
      sourceTaskId: row.source_task_id,
      sourceOrderExecutionId: row.source_order_execution_id,
      firstOccurredAt: row.first_occurred_at,
      lastOccurredAt: row.last_occurred_at,
      resolvedAt: row.resolved_at,
      occurrenceCount: row.occurrence_count
    };
  }
}

// TODO:
// 1. Add deadlock-aware retry behavior around transaction boundaries.
// 2. Normalize DATETIME values into ISO strings at the repository boundary if driver config changes.
// 3. Consider an additional lookup by (dedupe_key, error_instance_seq) for explicit recurrence inspection.
