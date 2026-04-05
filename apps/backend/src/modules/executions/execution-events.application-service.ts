import { type ProjectionUpdaterService } from "../projections/projection-updater.service.js";
import { type ProjectionEventInput } from "../projections/projection.types.js";

export type PersistedExecutionEvent = ProjectionEventInput & {
  persistedAt: string;
};

export interface ExecutionEventsRepository {
  insertExecutionEvent(input: ProjectionEventInput): Promise<PersistedExecutionEvent>;
}

export type ExecutionUnitIngressRecord = {
  id: number;
  context: "live" | "test";
  status: string;
  activationStatus: string;
  isDeleted: boolean;
};

export interface ExecutionUnitIngressRepository {
  findExecutionUnitById(executionUnitId: number): Promise<ExecutionUnitIngressRecord | null>;
}

export class ExecutionEventIngressError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ExecutionEventIngressError";
  }
}

export class ExecutionEventsApplicationService {
  constructor(
    private readonly executionEventsRepository: ExecutionEventsRepository,
    private readonly projectionUpdater: ProjectionUpdaterService,
    private readonly executionUnitIngressRepository?: ExecutionUnitIngressRepository
  ) {}

  async recordExecutionEvent(
    input: ProjectionEventInput
  ): Promise<PersistedExecutionEvent> {
    await this.validateExecutionUnitIngress(input);

    const persistedEvent =
      await this.executionEventsRepository.insertExecutionEvent(input);

    await this.projectionUpdater.handleExecutionEvent(persistedEvent);

    return persistedEvent;
  }

  private async validateExecutionUnitIngress(
    input: ProjectionEventInput
  ): Promise<void> {
    if (!this.executionUnitIngressRepository) {
      return;
    }

    const executionUnit = await this.executionUnitIngressRepository.findExecutionUnitById(
      input.executionUnitId
    );

    if (!executionUnit) {
      throw new ExecutionEventIngressError(404, "execution unit not found");
    }

    if (executionUnit.context !== input.context) {
      throw new ExecutionEventIngressError(
        409,
        "execution unit context does not match request context"
      );
    }

    if (executionUnit.isDeleted) {
      throw new ExecutionEventIngressError(
        409,
        "execution unit is deleted and cannot accept events"
      );
    }

    if (
      executionUnit.status !== "active" ||
      executionUnit.activationStatus !== "active"
    ) {
      throw new ExecutionEventIngressError(
        409,
        "execution unit is not active for event ingestion"
      );
    }
  }
}

// TODO:
// 1. Split persistence and projection update via outbox when worker split is introduced.
// 2. Decide whether projection update failures should fail the request or schedule async recovery.
// 3. Add audit logging / tracing around the event persist -> projection update chain.
