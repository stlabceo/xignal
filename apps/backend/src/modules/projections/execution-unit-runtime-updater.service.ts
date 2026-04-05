import {
  type ExecutionUnitRuntimeRepository,
  type ProjectionEventInput,
  type RuntimeProjectionPatch
} from "./projection.types.js";

export class ExecutionUnitRuntimeUpdaterService {
  constructor(private readonly repository: ExecutionUnitRuntimeRepository) {}

  async handleEvent(event: ProjectionEventInput): Promise<void> {
    const patch: RuntimeProjectionPatch = {
      executionUnitId: event.executionUnitId,
      context: event.context,
      lastEventAt: event.occurredAt,
      lastEventType: event.eventType,
      lastErrorCode: event.errorCode ?? null,
      lastErrorMessage: event.message ?? event.failureReason ?? null,
      workerStatus: this.resolveWorkerStatus(event.eventType),
      healthStatus: this.resolveHealthStatus(event.eventType),
      isActive: this.resolveIsActive(event.eventType)
    };

    await this.repository.upsertRuntimePatch(patch);
  }

  private resolveWorkerStatus(eventType: string): string {
    switch (eventType) {
      case "execution_started":
      case "task_started":
        return "busy";
      case "task_failed":
      case "order_failed":
      case "exchange_error":
        return "degraded";
      default:
        return "ready";
    }
  }

  private resolveHealthStatus(eventType: string): string {
    switch (eventType) {
      case "task_failed":
      case "order_failed":
      case "exchange_error":
      case "runtime_error":
        return "error";
      case "error_resolved":
      case "unit_recovered":
        return "healthy";
      default:
        return "healthy";
    }
  }

  private resolveIsActive(eventType: string): boolean | undefined {
    switch (eventType) {
      case "unit_activated":
        return true;
      case "unit_deactivated":
        return false;
      default:
        return undefined;
    }
  }
}
