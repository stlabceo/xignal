export type NotificationErrorSourceCategory =
  | "validation"
  | "exchange"
  | "runtime"
  | "recovery"
  | "system";

export type NotificationSeverity = "warning" | "error";

export type ResolveEventType = "error_resolved" | "unit_recovered";

export type ProjectionEventInput = {
  eventId: number;
  executionUnitId: number;
  context: "live" | "test";
  eventType: string;
  eventStatus: string;
  eventSource: string;
  occurredAt: string;
  executionTaskId?: number | null;
  orderExecutionId?: number | null;
  errorCode?: string | null;
  message?: string | null;
  failureReason?: string | null;
  errorSourceCategory?: NotificationErrorSourceCategory | null;
  notificationSeverity?: NotificationSeverity | null;
  metadata?: Record<string, unknown> | null;
};

export type RuntimeProjectionPatch = {
  executionUnitId: number;
  context: "live" | "test";
  lastEventAt: string;
  lastEventType: string;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  isActive?: boolean;
  workerStatus?: string;
  healthStatus?: string;
};

export type SummaryProjectionPatch = {
  executionUnitId: number;
  context: "live" | "test";
  lastEventAt: string;
  lastEventType: string;
  lastErrorMessage?: string | null;
};

export type NotificationErrorRecord = {
  id: number;
  executionUnitId: number;
  context: "live" | "test";
  severity: NotificationSeverity;
  dedupeKey: string;
  errorInstanceSeq: number;
  errorCode: string | null;
  message: string;
  sourceEventId: number | null;
  sourceTaskId: number | null;
  sourceOrderExecutionId: number | null;
  firstOccurredAt: string;
  lastOccurredAt: string;
  resolvedAt: string | null;
  occurrenceCount: number;
};

export type NotificationErrorInsert = {
  executionUnitId: number;
  context: "live" | "test";
  severity: NotificationSeverity;
  dedupeKey: string;
  errorInstanceSeq: number;
  errorCode: string | null;
  message: string;
  sourceEventId: number | null;
  sourceTaskId: number | null;
  sourceOrderExecutionId: number | null;
  firstOccurredAt: string;
  lastOccurredAt: string;
  resolvedAt: string | null;
  occurrenceCount: number;
  metadata?: Record<string, unknown> | null;
};

export type NotificationErrorUpdate = {
  lastOccurredAt: string;
  occurrenceCount: number;
  sourceEventId: number | null;
  sourceTaskId: number | null;
  sourceOrderExecutionId: number | null;
  message: string;
  resolvedAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

export interface NotificationErrorsRepository {
  withTransaction<T>(run: (repository: NotificationErrorsRepository) => Promise<T>): Promise<T>;
  findLatestUnresolvedByDedupeKeyForUpdate(input: {
    dedupeKey: string;
  }): Promise<NotificationErrorRecord | null>;
  findMaxInstanceSeqByDedupeKeyForUpdate(input: {
    dedupeKey: string;
  }): Promise<number | null>;
  insert(input: NotificationErrorInsert): Promise<void>;
  updateById(id: number, input: NotificationErrorUpdate): Promise<void>;
}

export interface ExecutionUnitRuntimeRepository {
  upsertRuntimePatch(patch: RuntimeProjectionPatch): Promise<void>;
}

export interface ExecutionUnitSummaryRepository {
  upsertSummaryPatch(patch: SummaryProjectionPatch): Promise<void>;
}
