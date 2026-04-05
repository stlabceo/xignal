import type {
  DatabaseMutationResult,
  DatabasePool
} from "../../../infrastructure/db/db.types.js";
import { toMysqlDateTime } from "../../../infrastructure/db/datetime.js";
import {
  type ExecutionUnitRuntimeRepository,
  type RuntimeProjectionPatch
} from "../projection.types.js";

export class MysqlExecutionUnitRuntimeRepository
  implements ExecutionUnitRuntimeRepository
{
  constructor(private readonly pool: DatabasePool) {}

  async upsertRuntimePatch(patch: RuntimeProjectionPatch): Promise<void> {
    const sql = `
      INSERT INTO execution_unit_runtime_states (
        execution_unit_id,
        context,
        is_active,
        last_event_at,
        last_event_type,
        last_error_code,
        last_error_message,
        worker_status,
        health_status,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, COALESCE(?, 0), ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
      ON DUPLICATE KEY UPDATE
        context = VALUES(context),
        is_active = COALESCE(VALUES(is_active), is_active),
        last_event_at = VALUES(last_event_at),
        last_event_type = VALUES(last_event_type),
        last_error_code = VALUES(last_error_code),
        last_error_message = VALUES(last_error_message),
        worker_status = COALESCE(VALUES(worker_status), worker_status),
        health_status = COALESCE(VALUES(health_status), health_status),
        updated_at = CURRENT_TIMESTAMP(3)
    `;

    await this.pool.execute<DatabaseMutationResult>(sql, [
      patch.executionUnitId,
      patch.context,
      patch.isActive === undefined ? null : Number(patch.isActive),
      toMysqlDateTime(patch.lastEventAt),
      patch.lastEventType,
      patch.lastErrorCode ?? null,
      patch.lastErrorMessage ?? null,
      patch.workerStatus ?? null,
      patch.healthStatus ?? null
    ]);
  }
}
