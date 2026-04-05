import type {
  DatabaseMutationResult,
  DatabasePool
} from "../../../infrastructure/db/db.types.js";
import { toMysqlDateTime } from "../../../infrastructure/db/datetime.js";
import {
  type ExecutionUnitSummaryRepository,
  type SummaryProjectionPatch
} from "../projection.types.js";

export class MysqlExecutionUnitSummaryRepository
  implements ExecutionUnitSummaryRepository
{
  constructor(private readonly pool: DatabasePool) {}

  async upsertSummaryPatch(patch: SummaryProjectionPatch): Promise<void> {
    const sql = `
      INSERT INTO execution_unit_summaries (
        execution_unit_id,
        context,
        display_name,
        user_id,
        user_display_name,
        exchange_account_id,
        exchange_type,
        symbol,
        timeframe,
        activation_status,
        position_status,
        today_pnl,
        cumulative_pnl,
        trade_count,
        last_event_at,
        last_event_type,
        last_error_message,
        created_at,
        updated_at
      )
      SELECT
        eu.id,
        eu.context,
        eu.name,
        u.id,
        u.display_name,
        ea.id,
        ea.exchange_type,
        eu.symbol,
        eu.timeframe,
        eu.activation_status,
        COALESCE(existing.position_status, 'flat'),
        COALESCE(existing.today_pnl, 0),
        COALESCE(existing.cumulative_pnl, 0),
        COALESCE(existing.trade_count, 0),
        ?,
        ?,
        ?,
        CURRENT_TIMESTAMP(3),
        CURRENT_TIMESTAMP(3)
      FROM execution_units eu
      INNER JOIN users u
        ON u.id = eu.user_id
      INNER JOIN exchange_accounts ea
        ON ea.id = eu.exchange_account_id
      LEFT JOIN execution_unit_summaries existing
        ON existing.execution_unit_id = eu.id
      WHERE eu.id = ?
      ON DUPLICATE KEY UPDATE
        context = VALUES(context),
        display_name = VALUES(display_name),
        user_id = VALUES(user_id),
        user_display_name = VALUES(user_display_name),
        exchange_account_id = VALUES(exchange_account_id),
        exchange_type = VALUES(exchange_type),
        symbol = VALUES(symbol),
        timeframe = VALUES(timeframe),
        activation_status = VALUES(activation_status),
        last_event_at = VALUES(last_event_at),
        last_event_type = VALUES(last_event_type),
        last_error_message = VALUES(last_error_message),
        updated_at = CURRENT_TIMESTAMP(3)
    `;

    await this.pool.execute<DatabaseMutationResult>(sql, [
      toMysqlDateTime(patch.lastEventAt),
      patch.lastEventType,
      patch.lastErrorMessage ?? null,
      patch.executionUnitId
    ]);
  }
}
