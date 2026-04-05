import type { DatabasePool, DatabaseRow } from "../../../infrastructure/db/db.types.js";
import type {
  ExecutionUnitIngressRecord,
  ExecutionUnitIngressRepository
} from "../execution-events.application-service.js";

type ExecutionUnitIngressRow = DatabaseRow & {
  id: number;
  context: "live" | "test";
  status: string;
  activation_status: string;
  is_deleted: number;
};

export class MysqlExecutionUnitIngressRepository
  implements ExecutionUnitIngressRepository
{
  constructor(private readonly pool: DatabasePool) {}

  async findExecutionUnitById(
    executionUnitId: number
  ): Promise<ExecutionUnitIngressRecord | null> {
    const sql = `
      SELECT
        id,
        context,
        status,
        activation_status,
        is_deleted
      FROM execution_units
      WHERE id = ?
      LIMIT 1
    `;

    const [rows] = await this.pool.execute<ExecutionUnitIngressRow[]>(sql, [
      executionUnitId
    ]);

    const [row] = rows;
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      context: row.context,
      status: row.status,
      activationStatus: row.activation_status,
      isDeleted: row.is_deleted === 1
    };
  }
}
