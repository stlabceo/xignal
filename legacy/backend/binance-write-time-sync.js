"use strict";

const DEFAULT_RECV_WINDOW_MS = 60000;
const DEFAULT_SYNC_TTL_MS = 60000;
const DEFAULT_TIMESTAMP_SAFETY_MS = 1000;
const TIMESTAMP_OUTSIDE_RECV_WINDOW = -1021;

const nowMsDefault = () => Date.now();

const createFuturesTimeSyncState = () => ({
  offsetMs: 0,
  syncedAtMs: 0,
  serverTimeMs: 0,
});

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const calculateFuturesTimeOffsetMs = (serverTimeMs, localTimeMs = nowMsDefault()) => {
  const server = toNumber(serverTimeMs);
  const local = toNumber(localTimeMs);
  if (server == null || server <= 0 || local == null || local <= 0) {
    const error = new Error("invalid Binance futures server time");
    error.code = "BINANCE_TIME_SYNC_INVALID_SERVER_TIME";
    throw error;
  }
  return server - local;
};

const getBinanceErrorCode = (error) => {
  const candidates = [
    error?.response?.data?.code,
    error?.body?.code,
    error?.data?.code,
    error?.code,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const isTimestampOutsideRecvWindowError = (error) =>
  getBinanceErrorCode(error) === TIMESTAMP_OUTSIDE_RECV_WINDOW ||
  /timestamp.*recvwindow|outside.*recvwindow|1000ms ahead/i.test(
    String(error?.response?.data?.msg || error?.body?.msg || error?.message || "")
  );

const syncFuturesServerTime = async ({
  state,
  force = false,
  fetchServerTime,
  nowMs = nowMsDefault,
  syncTtlMs = DEFAULT_SYNC_TTL_MS,
} = {}) => {
  if (!state) {
    throw new Error("time sync state is required");
  }
  if (typeof fetchServerTime !== "function") {
    throw new Error("fetchServerTime function is required");
  }

  const now = Number(nowMs());
  if (!force && state.syncedAtMs > 0 && (now - state.syncedAtMs) < syncTtlMs) {
    return {
      offsetMs: state.offsetMs,
      syncedAtMs: state.syncedAtMs,
      serverTimeMs: state.serverTimeMs,
      reused: true,
    };
  }

  const serverTimeMs = Number(await fetchServerTime());
  const afterFetch = Number(nowMs());
  const offsetMs = calculateFuturesTimeOffsetMs(serverTimeMs, afterFetch);
  state.offsetMs = offsetMs;
  state.syncedAtMs = afterFetch;
  state.serverTimeMs = serverTimeMs;

  return {
    offsetMs,
    syncedAtMs: afterFetch,
    serverTimeMs,
    reused: false,
  };
};

const getFuturesTimestamp = ({
  state,
  nowMs = nowMsDefault,
  safetyMs = DEFAULT_TIMESTAMP_SAFETY_MS,
} = {}) => Number(nowMs()) + Number(state?.offsetMs || 0) - Number(safetyMs || 0);

const applyTimeOffsetToNodeBinanceClient = (client, syncResult = {}, {
  safetyMs = DEFAULT_TIMESTAMP_SAFETY_MS,
} = {}) => {
  if (!client) {
    throw new Error("Binance client is required");
  }
  const offsetMs = Number(syncResult.offsetMs || 0) - Number(safetyMs || 0);
  client.timeOffset = offsetMs;
  client.__futuresServerTimeOffsetMs = offsetMs;
  client.__futuresServerTimeSyncedAtMs = syncResult.syncedAtMs || Date.now();
  return offsetMs;
};

const syncNodeBinanceFuturesClientTime = async (client, options = {}) => {
  const syncResult = await syncFuturesServerTime(options);
  applyTimeOffsetToNodeBinanceClient(client, syncResult, options);
  return syncResult;
};

const runWithTimestampRetry = async ({
  operation,
  syncTime,
  maxTimestampRetries = 1,
  onRetry = null,
  onFailure = null,
} = {}) => {
  if (typeof operation !== "function") {
    throw new Error("operation function is required");
  }
  if (typeof syncTime !== "function") {
    throw new Error("syncTime function is required");
  }

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation({ attempt });
    } catch (error) {
      const timestampError = isTimestampOutsideRecvWindowError(error);
      if (!timestampError || attempt > maxTimestampRetries) {
        if (timestampError && typeof onFailure === "function") {
          await onFailure({ attempt, error });
        }
        throw error;
      }

      const syncResult = await syncTime({ force: true, attempt, error });
      if (typeof onRetry === "function") {
        await onRetry({ attempt, error, syncResult });
      }
    }
  }
};

module.exports = {
  DEFAULT_RECV_WINDOW_MS,
  DEFAULT_SYNC_TTL_MS,
  DEFAULT_TIMESTAMP_SAFETY_MS,
  TIMESTAMP_OUTSIDE_RECV_WINDOW,
  applyTimeOffsetToNodeBinanceClient,
  calculateFuturesTimeOffsetMs,
  createFuturesTimeSyncState,
  getBinanceErrorCode,
  getFuturesTimestamp,
  isTimestampOutsideRecvWindowError,
  runWithTimestampRetry,
  syncFuturesServerTime,
  syncNodeBinanceFuturesClientTime,
};
