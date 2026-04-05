import type {
  DatabaseMutationResult,
  DatabasePool,
  DatabaseRow
} from "../../../infrastructure/db/db.types.js";
import { toMysqlDateTime } from "../../../infrastructure/db/datetime.js";
import type {
  ExecutionEventsRepository,
  PersistedExecutionEvent
} from "../execution-events.application-service.js";
import type { ProjectionEventInput } from "../../projections/projection.types.js";

type ExecutionEventInsertRow = DatabaseRow & {
  id: number;
  created_at: string;
};

export class MysqlExecutionEventsRepository
  implements ExecutionEventsRepository
{
  constructor(private readonly pool: DatabasePool) {}

  async insertExecutionEvent(
    input: ProjectionEventInput
  ): Promise<PersistedExecutionEvent> {
    const insertSql = `
      INSERT INTO execution_events (
        execution_unit_id,
        execution_task_id,
        order_execution_id,
        context,
        event_type,
        event_source,
        event_status,
        correlation_id,
        payload,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3)
      )
    `;

    const payload = JSON.stringify({
      errorCode: input.errorCode ?? null,
      message: input.message ?? null,
      failureReason: input.failureReason ?? null,
      metadata: input.metadata ?? null,
      errorSourceCategory: input.errorSourceCategory ?? null,
      notificationSeverity: input.notificationSeverity ?? null
    });

    const [insertResult] = await this.pool.execute<DatabaseMutationResult>(insertSql, [
      input.executionUnitId,
      input.executionTaskId ?? null,
      input.orderExecutionId ?? null,
      input.context,
      input.eventType,
      input.eventSource,
      input.eventStatus,
      null,
      payload,
      toMysqlDateTime(input.occurredAt)
    ]);

    const insertedId = insertResult.insertId;

    const selectSql = `
      SELECT id, created_at
      FROM execution_events
      WHERE id = ?
      LIMIT 1
    `;

    const [rows] = await this.pool.execute<ExecutionEventInsertRow[]>(selectSql, [
      insertedId
    ]);

    const [row] = rows;

    return {
      ...input,
      eventId: row?.id ?? insertedId,
      persistedAt: row?.created_at ?? input.occurredAt
    };
  }
}

// TODO:
// 1. Map alert_event_id and normalized_signal_id once upstream services provide them.
// 2. Add correlation_id generation and outbox linkage when execution orchestration is introduced.
