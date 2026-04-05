import { ExecutionUnitRuntimeUpdaterService } from "./execution-unit-runtime-updater.service.js";
import { ExecutionUnitSummaryUpdaterService } from "./execution-unit-summary-updater.service.js";
import { NotificationErrorsUpdaterService } from "./notification-errors-updater.service.js";
import { type ProjectionEventInput } from "./projection.types.js";

export class ProjectionUpdaterService {
  constructor(
    private readonly notificationErrorsUpdater: NotificationErrorsUpdaterService,
    private readonly executionUnitRuntimeUpdater: ExecutionUnitRuntimeUpdaterService,
    private readonly executionUnitSummaryUpdater: ExecutionUnitSummaryUpdaterService
  ) {}

  async handleExecutionEvent(event: ProjectionEventInput): Promise<void> {
    await this.notificationErrorsUpdater.handleEvent(event);
    await this.executionUnitRuntimeUpdater.handleEvent(event);
    await this.executionUnitSummaryUpdater.handleEvent(event);
  }
}
