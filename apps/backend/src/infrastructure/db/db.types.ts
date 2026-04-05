import type {
  Pool,
  PoolConnection,
  QueryResult,
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";

export type DatabasePool = Pool;

export type DatabaseConnection = PoolConnection;

export type DatabaseRow = RowDataPacket;

export type DatabaseMutationResult = ResultSetHeader;

export type DatabaseQueryResult<T extends QueryResult = QueryResult> = [T, unknown];

export type DatabaseExecutor = {
  execute<T extends QueryResult = QueryResult>(
    sql: string,
    params?: unknown[]
  ): Promise<DatabaseQueryResult<T>>;
};
