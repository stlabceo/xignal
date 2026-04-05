import { strict as assert } from "node:assert";
import test from "node:test";

import { NotificationErrorsUpdaterService } from "../notification-errors-updater.service.js";
import type {
  NotificationErrorInsert,
  NotificationErrorRecord,
  NotificationErrorsRepository,
  NotificationErrorUpdate,
  ProjectionEventInput
} from "../projection.types.js";

class InMemoryNotificationErrorsRepository
  implements NotificationErrorsRepository
{
  private rows: NotificationErrorRecord[] = [];
  private nextId = 1;

  async withTransaction<T>(
    run: (repository: NotificationErrorsRepository) => Promise<T>
  ): Promise<T> {
    return run(this);
  }

  async findLatestUnresolvedByDedupeKeyForUpdate(input: {
    dedupeKey: string;
  }): Promise<NotificationErrorRecord | null> {
    return (
      this.rows
        .filter((row) => row.dedupeKey === input.dedupeKey && row.resolvedAt === null)
        .sort((left, right) => right.errorInstanceSeq - left.errorInstanceSeq)[0] ?? null
    );
  }

  async findMaxInstanceSeqByDedupeKeyForUpdate(input: {
    dedupeKey: string;
  }): Promise<number | null> {
    const matches = this.rows.filter((row) => row.dedupeKey === input.dedupeKey);
    if (matches.length === 0) {
      return null;
    }

    return Math.max(...matches.map((row) => row.errorInstanceSeq));
  }

  async insert(input: NotificationErrorInsert): Promise<void> {
    this.rows.push({
      id: this.nextId++,
      executionUnitId: input.executionUnitId,
      context: input.context,
      severity: input.severity,
      dedupeKey: input.dedupeKey,
      errorInstanceSeq: input.errorInstanceSeq,
      errorCode: input.errorCode,
      message: input.message,
      sourceEventId: input.sourceEventId,
      sourceTaskId: input.sourceTaskId,
      sourceOrderExecutionId: input.sourceOrderExecutionId,
      firstOccurredAt: input.firstOccurredAt,
      lastOccurredAt: input.lastOccurredAt,
      resolvedAt: input.resolvedAt,
      occurrenceCount: input.occurrenceCount
    });
  }

  async updateById(id: number, input: NotificationErrorUpdate): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);

    if (!row) {
      throw new Error(`Row ${id} not found`);
    }

    row.lastOccurredAt = input.lastOccurredAt;
    row.occurrenceCount = input.occurrenceCount;
    row.sourceEventId = input.sourceEventId;
    row.sourceTaskId = input.sourceTaskId;
    row.sourceOrderExecutionId = input.sourceOrderExecutionId;
    row.message = input.message;
    row.resolvedAt = input.resolvedAt ?? null;
  }

  snapshot(): NotificationErrorRecord[] {
    return this.rows.map((row) => ({ ...row }));
  }
}

function createBaseErrorEvent(
  overrides: Partial<ProjectionEventInput> = {}
): ProjectionEventInput {
  return {
    eventId: 1,
    executionUnitId: 100,
    context: "live",
    eventType: "order_failed",
    eventStatus: "error",
    eventSource: "exchange-adapter",
    occurredAt: "2026-04-05T10:00:00.000Z",
    executionTaskId: 200,
    orderExecutionId: 300,
    errorCode: "E-ORDER",
    message: "Order rejected",
    ...overrides
  };
}

test("same unresolved error increments occurrence_count", async () => {
  const repository = new InMemoryNotificationErrorsRepository();
  const service = new NotificationErrorsUpdaterService(repository);

  await service.handleEvent(createBaseErrorEvent({ eventId: 1 }));
  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 2,
      occurredAt: "2026-04-05T10:01:00.000Z"
    })
  );

  const rows = repository.snapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.occurrenceCount, 2);
  assert.equal(rows[0]?.errorInstanceSeq, 1);
});

test("resolved then recurred error creates next error_instance_seq", async () => {
  const repository = new InMemoryNotificationErrorsRepository();
  const service = new NotificationErrorsUpdaterService(repository);

  await service.handleEvent(createBaseErrorEvent({ eventId: 1 }));
  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 2,
      eventType: "error_resolved",
      occurredAt: "2026-04-05T10:02:00.000Z",
      errorSourceCategory: "exchange",
      notificationSeverity: "error"
    })
  );
  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 3,
      occurredAt: "2026-04-05T10:03:00.000Z"
    })
  );

  const rows = repository.snapshot().sort((left, right) => left.id - right.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.resolvedAt, "2026-04-05T10:02:00.000Z");
  assert.equal(rows[1]?.errorInstanceSeq, 2);
  assert.equal(rows[1]?.occurrenceCount, 1);
});

test("resolve event closes unresolved row", async () => {
  const repository = new InMemoryNotificationErrorsRepository();
  const service = new NotificationErrorsUpdaterService(repository);

  await service.handleEvent(createBaseErrorEvent({ eventId: 1 }));
  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 2,
      eventType: "unit_recovered",
      occurredAt: "2026-04-05T10:04:00.000Z",
      errorSourceCategory: "exchange",
      notificationSeverity: "error"
    })
  );

  const rows = repository.snapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.resolvedAt, "2026-04-05T10:04:00.000Z");
});

test("resolve event is a no-op when no unresolved row exists", async () => {
  const repository = new InMemoryNotificationErrorsRepository();
  const service = new NotificationErrorsUpdaterService(repository);

  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 10,
      eventType: "error_resolved",
      occurredAt: "2026-04-05T10:05:00.000Z",
      errorSourceCategory: "exchange",
      notificationSeverity: "error"
    })
  );

  assert.equal(repository.snapshot().length, 0);
});

test("resolve event can target prior error identity via explicit metadata fallback", async () => {
  const repository = new InMemoryNotificationErrorsRepository();
  const service = new NotificationErrorsUpdaterService(repository);

  await service.handleEvent(createBaseErrorEvent({ eventId: 1 }));
  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 2,
      eventType: "error_resolved",
      eventSource: "worker-runtime",
      errorSourceCategory: null,
      notificationSeverity: null,
      errorCode: null,
      metadata: {
        targetErrorSourceCategory: "exchange",
        targetNotificationSeverity: "error",
        targetErrorCode: "E-ORDER"
      }
    })
  );

  const rows = repository.snapshot();
  assert.equal(rows.length, 1);
  assert.ok(rows[0]?.resolvedAt);
});

test("resolve event with insufficient target identity falls back to no-op", async () => {
  const repository = new InMemoryNotificationErrorsRepository();
  const service = new NotificationErrorsUpdaterService(repository);

  await service.handleEvent(createBaseErrorEvent({ eventId: 1 }));
  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 2,
      eventType: "error_resolved",
      eventSource: "resolver",
      errorSourceCategory: null,
      notificationSeverity: null,
      errorCode: null,
      metadata: null
    })
  );

  const rows = repository.snapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.resolvedAt, null);
});

test("resolve event can infer target identity from unit_recovered source hints", async () => {
  const repository = new InMemoryNotificationErrorsRepository();
  const service = new NotificationErrorsUpdaterService(repository);

  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 1,
      eventType: "runtime_error",
      eventSource: "runtime-worker",
      errorCode: "E-RUNTIME",
      errorSourceCategory: "runtime"
    })
  );
  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 2,
      eventType: "unit_recovered",
      eventSource: "runtime-worker",
      occurredAt: "2026-04-05T10:06:00.000Z",
      errorSourceCategory: null,
      notificationSeverity: null,
      errorCode: "E-RUNTIME",
      metadata: null
    })
  );

  const rows = repository.snapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.resolvedAt, "2026-04-05T10:06:00.000Z");
});

test("missing errorCode falls back to unknown dedupe identity and accumulates", async () => {
  const repository = new InMemoryNotificationErrorsRepository();
  const service = new NotificationErrorsUpdaterService(repository);

  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 1,
      eventType: "runtime_error",
      eventSource: "runtime-worker",
      errorCode: null,
      errorSourceCategory: "runtime"
    })
  );
  await service.handleEvent(
    createBaseErrorEvent({
      eventId: 2,
      eventType: "runtime_error",
      eventSource: "runtime-worker",
      occurredAt: "2026-04-05T10:07:00.000Z",
      errorCode: null,
      errorSourceCategory: "runtime"
    })
  );

  const rows = repository.snapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dedupeKey, "100|live|unknown|error|runtime");
  assert.equal(rows[0]?.occurrenceCount, 2);
});

test.todo(
  "concurrency: two simultaneous unresolved events should not create duplicate instance rows when DB locks are enabled"
);
