export type TransactionRetryEvent = {
  operationName: string;
  attempt: number;
  maxAttempts: number;
  code: string;
  message: string;
  occurredAt: string;
};

export type TransactionFailureEvent = {
  operationName: string;
  attempts: number;
  code: string | null;
  message: string;
  occurredAt: string;
};

type TransactionObservabilityState = {
  processStartedAt: string;
  retryCount: number;
  failureCount: number;
  lastRetry: TransactionRetryEvent | null;
  lastFailure: TransactionFailureEvent | null;
  retryEvents: TransactionRetryEvent[];
};

const MAX_RECORDED_RETRY_EVENTS = 50;

const state: TransactionObservabilityState = {
  processStartedAt: new Date().toISOString(),
  retryCount: 0,
  failureCount: 0,
  lastRetry: null,
  lastFailure: null,
  retryEvents: []
};

export function recordTransactionRetry(event: TransactionRetryEvent): void {
  state.retryCount += 1;
  state.lastRetry = event;
  state.retryEvents.push(event);

  if (state.retryEvents.length > MAX_RECORDED_RETRY_EVENTS) {
    state.retryEvents.shift();
  }
}

export function recordTransactionFailure(event: TransactionFailureEvent): void {
  state.failureCount += 1;
  state.lastFailure = event;
}

export function getTransactionObservabilitySnapshot() {
  return {
    processStartedAt: state.processStartedAt,
    retryCount: state.retryCount,
    failureCount: state.failureCount,
    lastRetry: state.lastRetry,
    lastFailure: state.lastFailure,
    retryEvents: [...state.retryEvents]
  };
}

export function resetTransactionObservability(): void {
  state.retryCount = 0;
  state.failureCount = 0;
  state.lastRetry = null;
  state.lastFailure = null;
  state.retryEvents = [];
}
