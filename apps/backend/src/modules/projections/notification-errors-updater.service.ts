import {
  type NotificationErrorInsert,
  type NotificationErrorsRepository,
  type NotificationSeverity,
  type NotificationErrorSourceCategory,
  type ProjectionEventInput,
  type ResolveEventType
} from "./projection.types.js";

const RESOLVE_EVENT_TYPES: ResolveEventType[] = ["error_resolved", "unit_recovered"];

const ERROR_EVENT_TYPES = new Set([
  "order_failed",
  "task_failed",
  "exchange_error",
  "validation_failed",
  "runtime_error"
]);

export class NotificationErrorsUpdaterService {
  constructor(private readonly repository: NotificationErrorsRepository) {}

  async handleEvent(event: ProjectionEventInput): Promise<void> {
    if (this.isResolveEvent(event.eventType)) {
      await this.resolveUnresolvedInstance(event);
      return;
    }

    if (!this.isErrorEvent(event.eventType)) {
      return;
    }

    await this.upsertUnresolvedInstance(event);
  }

  computeBaseDedupeKey(event: ProjectionEventInput): string {
    const sourceCategory = this.resolveSourceCategory(event);
    const severity = this.resolveSeverity(event);
    const errorCode = this.resolveErrorCode(event);

    return [
      event.executionUnitId,
      event.context,
      errorCode,
      severity,
      sourceCategory
    ].join("|");
  }

  private async upsertUnresolvedInstance(event: ProjectionEventInput): Promise<void> {
    const dedupeKey = this.computeBaseDedupeKey(event);
    const metadata = this.buildMetadata(event);

    await this.repository.withTransaction(async (repository) => {
      // TODO:
      // This flow should execute in a DB transaction because two workers may process
      // the same error concurrently. We also need a row lock on the unresolved row
      // or the dedupe-key sequence lookup so occurrence_count and error_instance_seq
      // remain correct under race conditions.
      const unresolved = await repository.findLatestUnresolvedByDedupeKeyForUpdate({
        dedupeKey
      });

      if (unresolved) {
        await repository.updateById(unresolved.id, {
          lastOccurredAt: event.occurredAt,
          occurrenceCount: unresolved.occurrenceCount + 1,
          sourceEventId: event.eventId,
          sourceTaskId: event.executionTaskId ?? null,
          sourceOrderExecutionId: event.orderExecutionId ?? null,
          message: this.resolveMessage(event),
          resolvedAt: null,
          metadata
        });

        return;
      }

      const currentMaxInstanceSeq =
        (await repository.findMaxInstanceSeqByDedupeKeyForUpdate({
          dedupeKey
        })) ?? 0;

      const nextInstanceSeq = currentMaxInstanceSeq + 1;

      const payload: NotificationErrorInsert = {
        executionUnitId: event.executionUnitId,
        context: event.context,
        severity: this.resolveSeverity(event),
        dedupeKey,
        errorInstanceSeq: nextInstanceSeq,
        errorCode: this.resolveErrorCode(event, null),
        message: this.resolveMessage(event),
        sourceEventId: event.eventId,
        sourceTaskId: event.executionTaskId ?? null,
        sourceOrderExecutionId: event.orderExecutionId ?? null,
        firstOccurredAt: event.occurredAt,
        lastOccurredAt: event.occurredAt,
        resolvedAt: null,
        occurrenceCount: 1,
        metadata
      };

      await repository.insert(payload);
    });
  }

  private async resolveUnresolvedInstance(event: ProjectionEventInput): Promise<void> {
    const dedupeKey = this.computeResolveTargetDedupeKey(event);
    if (!dedupeKey) {
      return;
    }

    const metadata = this.buildMetadata(event);

    await this.repository.withTransaction(async (repository) => {
      // TODO:
      // Use SELECT ... FOR UPDATE or equivalent so a resolve event and a fresh error
      // recurrence cannot both mutate the same unresolved row at once.
      const unresolved = await repository.findLatestUnresolvedByDedupeKeyForUpdate({
        dedupeKey
      });

      if (!unresolved) {
        return;
      }

      await repository.updateById(unresolved.id, {
        lastOccurredAt: event.occurredAt,
        occurrenceCount: unresolved.occurrenceCount,
        sourceEventId: event.eventId,
        sourceTaskId: event.executionTaskId ?? unresolved.sourceTaskId,
        sourceOrderExecutionId:
          event.orderExecutionId ?? unresolved.sourceOrderExecutionId,
        message: unresolved.message,
        resolvedAt: event.occurredAt,
        metadata
      });
    });
  }

  private computeResolveTargetDedupeKey(
    event: ProjectionEventInput
  ): string | null {
    const sourceCategory = this.resolveTargetSourceCategory(event);
    if (!sourceCategory) {
      return null;
    }

    const severity = this.resolveTargetSeverity(event);
    const errorCode = this.resolveTargetErrorCode(event);

    return [
      event.executionUnitId,
      event.context,
      errorCode,
      severity,
      sourceCategory
    ].join("|");
  }

  private isResolveEvent(eventType: string): eventType is ResolveEventType {
    return RESOLVE_EVENT_TYPES.includes(eventType as ResolveEventType);
  }

  private isErrorEvent(eventType: string): boolean {
    return ERROR_EVENT_TYPES.has(eventType);
  }

  private resolveSourceCategory(
    event: ProjectionEventInput
  ): NotificationErrorSourceCategory {
    if (event.errorSourceCategory) {
      return event.errorSourceCategory;
    }

    switch (event.eventType) {
      case "validation_failed":
        return "validation";
      case "exchange_error":
      case "order_failed":
        return "exchange";
      case "task_failed":
      case "runtime_error":
        return "runtime";
      case "error_resolved":
      case "unit_recovered":
        return "recovery";
      default:
        return "system";
    }
  }

  private resolveTargetSourceCategory(
    event: ProjectionEventInput
  ): NotificationErrorSourceCategory | null {
    if (!this.isResolveEvent(event.eventType)) {
      return this.resolveSourceCategory(event);
    }

    if (event.errorSourceCategory) {
      return event.errorSourceCategory;
    }

    const metadataCategory = this.readMetadataEnumValue(
      event,
      "targetErrorSourceCategory"
    );
    if (metadataCategory && this.isSourceCategory(metadataCategory)) {
      return metadataCategory;
    }

    const sourceHint = event.eventSource.toLowerCase();
    if (sourceHint.includes("exchange")) {
      return "exchange";
    }
    if (sourceHint.includes("valid")) {
      return "validation";
    }
    if (sourceHint.includes("runtime") || sourceHint.includes("worker")) {
      return "runtime";
    }

    return null;
  }

  private resolveSeverity(event: ProjectionEventInput): NotificationSeverity {
    if (event.notificationSeverity) {
      return event.notificationSeverity;
    }

    return event.eventStatus === "warning" || event.eventStatus === "degraded"
      ? "warning"
      : "error";
  }

  private resolveTargetSeverity(event: ProjectionEventInput): NotificationSeverity {
    if (!this.isResolveEvent(event.eventType)) {
      return this.resolveSeverity(event);
    }

    if (event.notificationSeverity) {
      return event.notificationSeverity;
    }

    const metadataSeverity = this.readMetadataEnumValue(
      event,
      "targetNotificationSeverity"
    );
    if (metadataSeverity === "warning" || metadataSeverity === "error") {
      return metadataSeverity;
    }

    return this.resolveSeverity(event);
  }

  private resolveErrorCode(
    event: ProjectionEventInput,
    fallback: string = "unknown"
  ): string {
    return event.errorCode?.trim() || fallback;
  }

  private resolveTargetErrorCode(event: ProjectionEventInput): string {
    if (!this.isResolveEvent(event.eventType)) {
      return this.resolveErrorCode(event);
    }

    const metadataErrorCode = this.readMetadataStringValue(event, "targetErrorCode");
    return event.errorCode?.trim() || metadataErrorCode || "unknown";
  }

  private resolveMessage(event: ProjectionEventInput): string {
    return (
      event.message?.trim() ||
      event.failureReason?.trim() ||
      `Projection error event: ${event.eventType}`
    );
  }

  private buildMetadata(event: ProjectionEventInput): Record<string, unknown> {
    return {
      dedupeKeyRule:
        "execution_unit_id|context|error_code_or_unknown|severity|source_category",
      sourceCategory: this.resolveSourceCategory(event),
      latestEventType: event.eventType,
      eventSource: event.eventSource,
      rawMetadata: event.metadata ?? null
    };
  }

  private readMetadataStringValue(
    event: ProjectionEventInput,
    key: string
  ): string | null {
    const value = event.metadata?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private readMetadataEnumValue(
    event: ProjectionEventInput,
    key: string
  ): string | null {
    return this.readMetadataStringValue(event, key);
  }

  private isSourceCategory(
    value: string
  ): value is NotificationErrorSourceCategory {
    return ["validation", "exchange", "runtime", "recovery", "system"].includes(
      value
    );
  }
}
