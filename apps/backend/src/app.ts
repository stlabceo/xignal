import express from "express";
import type { Request, Response } from "express";

import { ExecutionEventsApplicationService } from "./modules/executions/execution-events.application-service.js";
import { ExecutionEventIngressError } from "./modules/executions/execution-events.application-service.js";
import { ProjectionUpdaterService } from "./modules/projections/projection-updater.service.js";
import { ExecutionUnitRuntimeUpdaterService } from "./modules/projections/execution-unit-runtime-updater.service.js";
import { ExecutionUnitSummaryUpdaterService } from "./modules/projections/execution-unit-summary-updater.service.js";
import { NotificationErrorsUpdaterService } from "./modules/projections/notification-errors-updater.service.js";
import { MysqlExecutionEventsRepository } from "./modules/executions/repositories/execution-events.repository.js";
import { MysqlExecutionUnitIngressRepository } from "./modules/executions/repositories/execution-unit-ingress.repository.js";
import { MysqlExecutionUnitRuntimeRepository } from "./modules/projections/repositories/execution-unit-runtime.repository.js";
import { MysqlExecutionUnitSummaryRepository } from "./modules/projections/repositories/execution-unit-summary.repository.js";
import { MysqlNotificationErrorsRepository } from "./modules/projections/repositories/notification-errors.repository.js";
import type { DatabasePool } from "./infrastructure/db/db.types.js";
import {
  getTransactionObservabilitySnapshot,
  resetTransactionObservability
} from "./infrastructure/db/transaction-observability.js";
import type { ProjectionEventInput } from "./modules/projections/projection.types.js";

type ApplicationServices = {
  executionEventsApplicationService: ExecutionEventsApplicationService;
};

const INTERNAL_EVENT_CONTEXTS = new Set(["live", "test"]);
const INTERNAL_EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function createApp(services: ApplicationServices) {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "backend",
      stage: "scaffold"
    });
  });

  app.get("/api/v1/internal/observability/transaction-retries", (_request, response) => {
    response.json({
      success: true,
      data: getTransactionObservabilitySnapshot()
    });
  });

  app.post("/api/v1/internal/observability/transaction-retries/reset", (_request, response) => {
    resetTransactionObservability();
    response.status(202).json({
      success: true
    });
  });

  app.post("/api/v1/webhooks/tradingview", (request, response) => {
    response.status(202).json({
      success: true,
      message: "Webhook accepted in scaffold mode.",
      todo: [
        "Validate webhook secret",
        "Persist raw alert event",
        "Normalize payload",
        "Create execution tasks"
      ],
      receivedPayloadKeys: Object.keys(request.body ?? {})
    });
  });

  app.post("/api/v1/internal/execution-events", async (request, response, next) => {
    try {
      const payload = validateInternalExecutionEventPayload(request.body);
      const persistedEvent =
        await services.executionEventsApplicationService.recordExecutionEvent(payload);

      response.status(202).json({
        success: true,
        data: persistedEvent
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    if (isJsonParseError(error)) {
      response.status(400).json({
        success: false,
        error: {
          message: "Malformed JSON payload"
        }
      });
      return;
    }

    if (error instanceof HttpError || error instanceof ExecutionEventIngressError) {
      response.status(error.statusCode).json({
        success: false,
        error: {
          message: error.message
        }
      });
      return;
    }

    const message =
      error instanceof Error ? error.message : "Unknown backend error";

    response.status(500).json({
      success: false,
      error: {
        message
      }
    });
  });

  return app;
}

function validateInternalExecutionEventPayload(body: unknown): ProjectionEventInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  const candidate = body as Record<string, unknown>;

  if (!isPositiveInteger(candidate.executionUnitId)) {
    throw new HttpError(422, "executionUnitId must be a positive integer");
  }

  if (!isNonEmptyString(candidate.context) || !INTERNAL_EVENT_CONTEXTS.has(candidate.context)) {
    throw new HttpError(422, "context must be either 'live' or 'test'");
  }

  if (!isNonEmptyString(candidate.eventType)) {
    throw new HttpError(422, "eventType is required");
  }

  if (!INTERNAL_EVENT_TYPE_PATTERN.test(candidate.eventType)) {
    throw new HttpError(
      422,
      "eventType must use lowercase snake_case characters only"
    );
  }

  if (!isNonEmptyString(candidate.eventStatus)) {
    throw new HttpError(422, "eventStatus is required");
  }

  if (!isNonEmptyString(candidate.eventSource)) {
    throw new HttpError(422, "eventSource is required");
  }

  if (!isNonEmptyString(candidate.occurredAt)) {
    throw new HttpError(422, "occurredAt is required");
  }

  const occurredAt = new Date(candidate.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new HttpError(422, "occurredAt must be a valid datetime string");
  }

  return candidate as ProjectionEventInput;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError && "body" in error;
}

export function createApplicationServices(pool: DatabasePool): ApplicationServices {
  const notificationErrorsRepository = new MysqlNotificationErrorsRepository(pool);
  const executionUnitRuntimeRepository = new MysqlExecutionUnitRuntimeRepository(pool);
  const executionUnitSummaryRepository = new MysqlExecutionUnitSummaryRepository(pool);
  const executionEventsRepository = new MysqlExecutionEventsRepository(pool);
  const executionUnitIngressRepository = new MysqlExecutionUnitIngressRepository(pool);

  const notificationErrorsUpdater = new NotificationErrorsUpdaterService(
    notificationErrorsRepository
  );
  const executionUnitRuntimeUpdater = new ExecutionUnitRuntimeUpdaterService(
    executionUnitRuntimeRepository
  );
  const executionUnitSummaryUpdater = new ExecutionUnitSummaryUpdaterService(
    executionUnitSummaryRepository
  );

  const projectionUpdater = new ProjectionUpdaterService(
    notificationErrorsUpdater,
    executionUnitRuntimeUpdater,
    executionUnitSummaryUpdater
  );

  const executionEventsApplicationService = new ExecutionEventsApplicationService(
    executionEventsRepository,
    projectionUpdater,
    executionUnitIngressRepository
  );

  return {
    executionEventsApplicationService
  };
}
