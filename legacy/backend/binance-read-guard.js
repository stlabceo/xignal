const DEFAULT_429_BACKOFF_MS = 60 * 1000;
const DEFAULT_418_BACKOFF_MS = 60 * 60 * 1000;

const state = {
  globalBlockedUntil: 0,
  globalBlockReason: null,
  uidBlockedUntil: new Map(),
  uidBlockReason: new Map(),
  counters: new Map(),
  events: [],
};

const now = () => Date.now();

const normalizeEndpoint = (endpoint) => String(endpoint || "").split("?")[0] || "UNKNOWN";

const parseRetryAfterMs = (value, fallbackMs) => {
  if (value === undefined || value === null || value === "") {
    return fallbackMs;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.max(1000, Math.floor(numeric * 1000));
  }

  const dateMs = Date.parse(String(value));
  if (Number.isFinite(dateMs)) {
    return Math.max(1000, dateMs - now());
  }

  return fallbackMs;
};

const counterKey = ({ uid, endpoint, method, outcome }) =>
  [uid || "global", String(method || "GET").toUpperCase(), normalizeEndpoint(endpoint), outcome || "attempt"].join("|");

const incrementCounter = (input, amount = 1) => {
  const key = counterKey(input);
  state.counters.set(key, Number(state.counters.get(key) || 0) + amount);
};

const pushEvent = (event) => {
  state.events.push({
    at: new Date(now()).toISOString(),
    ...event,
  });
  if (state.events.length > 200) {
    state.events.splice(0, state.events.length - 200);
  }
};

const getHttpStatus = (error) => Number(error?.response?.status || error?.status || 0);

const getRetryAfterHeader = (error) =>
  error?.response?.headers?.["retry-after"] ||
  error?.response?.headers?.["Retry-After"] ||
  null;

const blockGlobal = ({ status, endpoint, uid, retryAfterMs, reason }) => {
  const until = now() + retryAfterMs;
  state.globalBlockedUntil = Math.max(state.globalBlockedUntil, until);
  state.globalBlockReason = reason || `BINANCE_HTTP_${status}`;
  pushEvent({
    type: "GLOBAL_BLOCK",
    uid,
    endpoint: normalizeEndpoint(endpoint),
    status,
    retryAfterMs,
    until: new Date(state.globalBlockedUntil).toISOString(),
    reason: state.globalBlockReason,
  });
};

const blockUid = ({ status, endpoint, uid, retryAfterMs, reason }) => {
  if (!uid) {
    return;
  }
  const current = Number(state.uidBlockedUntil.get(Number(uid)) || 0);
  const until = Math.max(current, now() + retryAfterMs);
  state.uidBlockedUntil.set(Number(uid), until);
  state.uidBlockReason.set(Number(uid), reason || `BINANCE_HTTP_${status}`);
  pushEvent({
    type: "UID_BLOCK",
    uid: Number(uid),
    endpoint: normalizeEndpoint(endpoint),
    status,
    retryAfterMs,
    until: new Date(until).toISOString(),
    reason: state.uidBlockReason.get(Number(uid)),
  });
};

const assertPrivateRequestAllowed = ({ uid, endpoint, method = "GET" } = {}) => {
  const ts = now();
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const normalizedMethod = String(method || "GET").toUpperCase();

  if (state.globalBlockedUntil > ts) {
    incrementCounter({ uid, endpoint: normalizedEndpoint, method: normalizedMethod, outcome: "blocked" });
    const error = new Error("Binance private request blocked by 418/429 circuit breaker");
    error.code = "BINANCE_PRIVATE_READ_CIRCUIT_OPEN";
    error.httpStatus = 418;
    error.retryAfterMs = state.globalBlockedUntil - ts;
    error.blockedUntil = new Date(state.globalBlockedUntil).toISOString();
    error.reason = state.globalBlockReason;
    throw error;
  }

  const uidUntil = Number(state.uidBlockedUntil.get(Number(uid)) || 0);
  if (uidUntil > ts) {
    incrementCounter({ uid, endpoint: normalizedEndpoint, method: normalizedMethod, outcome: "blocked" });
    const error = new Error("Binance private request blocked by UID rate-limit backoff");
    error.code = "BINANCE_UID_PRIVATE_READ_BACKOFF";
    error.httpStatus = 429;
    error.retryAfterMs = uidUntil - ts;
    error.blockedUntil = new Date(uidUntil).toISOString();
    error.reason = state.uidBlockReason.get(Number(uid));
    throw error;
  }

  incrementCounter({ uid, endpoint: normalizedEndpoint, method: normalizedMethod, outcome: "attempt" });
};

const recordPrivateRequestSuccess = ({ uid, endpoint, method = "GET" } = {}) => {
  incrementCounter({ uid, endpoint, method, outcome: "success" });
};

const recordPrivateRequestFailure = ({ uid, endpoint, method = "GET", error } = {}) => {
  const status = getHttpStatus(error);
  incrementCounter({ uid, endpoint, method, outcome: status ? `http_${status}` : "failure" });

  if (status === 418) {
    blockGlobal({
      status,
      uid,
      endpoint,
      retryAfterMs: parseRetryAfterMs(getRetryAfterHeader(error), DEFAULT_418_BACKOFF_MS),
      reason: "BINANCE_IP_BANNED_418",
    });
  } else if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(getRetryAfterHeader(error), DEFAULT_429_BACKOFF_MS);
    blockUid({
      status,
      uid,
      endpoint,
      retryAfterMs,
      reason: "BINANCE_RATE_LIMIT_429",
    });
    blockGlobal({
      status,
      uid,
      endpoint,
      retryAfterMs,
      reason: "BINANCE_RATE_LIMIT_429_GLOBAL_COOLDOWN",
    });
  }
};

const getStateSnapshot = () => {
  const ts = now();
  const counters = Array.from(state.counters.entries()).map(([key, count]) => {
    const [uid, method, endpoint, outcome] = key.split("|");
    return { uid, method, endpoint, outcome, count };
  });

  return {
    globalBlocked: state.globalBlockedUntil > ts,
    globalBlockedUntil: state.globalBlockedUntil ? new Date(state.globalBlockedUntil).toISOString() : null,
    globalRetryAfterMs: Math.max(0, state.globalBlockedUntil - ts),
    globalBlockReason: state.globalBlockReason,
    uidBlocks: Array.from(state.uidBlockedUntil.entries()).map(([uid, until]) => ({
      uid,
      blocked: until > ts,
      blockedUntil: new Date(until).toISOString(),
      retryAfterMs: Math.max(0, until - ts),
      reason: state.uidBlockReason.get(uid) || null,
    })),
    counters,
    events: state.events.slice(-50),
  };
};

const resetForTest = () => {
  state.globalBlockedUntil = 0;
  state.globalBlockReason = null;
  state.uidBlockedUntil.clear();
  state.uidBlockReason.clear();
  state.counters.clear();
  state.events.splice(0);
};

module.exports = {
  assertPrivateRequestAllowed,
  recordPrivateRequestSuccess,
  recordPrivateRequestFailure,
  getStateSnapshot,
  parseRetryAfterMs,
  resetForTest,
};
