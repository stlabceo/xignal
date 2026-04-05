import {
  type ExecutionUnitSummaryRepository,
  type ProjectionEventInput,
  type SummaryProjectionPatch
} from "./projection.types.js";

export class ExecutionUnitSummaryUpdaterService {
  constructor(private readonly repository: ExecutionUnitSummaryRepository) {}

  async handleEvent(event: ProjectionEventInput): Promise<void> {
    const patch: SummaryProjectionPatch = {
      executionUnitId: event.executionUnitId,
      context: event.context,
      lastEventAt: event.occurredAt,
      lastEventType: event.eventType,
      lastErrorMessage: this.resolveLastErrorMessage(event)
    };

    await this.repository.upsertSummaryPatch(patch);
  }

  private resolveLastErrorMessage(
    event: ProjectionEventInput
  ): string | null | undefined {
    if (
      ["order_failed", "task_failed", "exchange_error", "runtime_error"].includes(
        event.eventType
      )
    ) {
      return event.message ?? event.failureReason ?? "Unknown execution error";
    }

    if (["error_resolved", "unit_recovered"].includes(event.eventType)) {
      return null;
    }

    return undefined;
  }
}
