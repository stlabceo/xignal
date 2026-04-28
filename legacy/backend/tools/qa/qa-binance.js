const axios = require("axios");
const crypto = require("crypto");
const { getMember, normalizeSymbol } = require("./qa-db");

const FUTURES_BASE_URL = "https://fapi.binance.com";
let futuresServerOffsetMs = 0;
let futuresServerOffsetSyncedAt = 0;

const syncServerTime = async (force = false) => {
  const now = Date.now();
  if (!force && futuresServerOffsetSyncedAt > 0 && now - futuresServerOffsetSyncedAt < 60000) {
    return futuresServerOffsetMs;
  }

  const response = await axios.get(`${FUTURES_BASE_URL}/fapi/v1/time`, {
    timeout: 5000,
  });
  const serverTime = Number(response?.data?.serverTime || 0);
  if (serverTime > 0) {
    futuresServerOffsetMs = serverTime - Date.now();
    futuresServerOffsetSyncedAt = Date.now();
  }
  return futuresServerOffsetMs;
};

const getFuturesTimestamp = () => Date.now() + futuresServerOffsetMs - 1000;

const maskKey = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (raw.length <= 8) {
    return raw;
  }
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
};

const buildSignedQuery = (secret, params = {}) => {
  const query = new URLSearchParams(params).toString();
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  return `${query}&signature=${signature}`;
};

const getCredentials = async (uid) => {
  const member = await getMember(uid);
  if (!member?.appKey || !member?.appSecret) {
    throw new Error(`QA_BINANCE_CREDENTIALS_MISSING:${uid}`);
  }
  return {
    uid: Number(member.id),
    memId: member.mem_id,
    tradeAccessMode: member.tradeAccessMode,
    appKey: member.appKey,
    appSecret: member.appSecret,
    appKeyMasked: maskKey(member.appKey),
  };
};

const signedGet = async (uid, path, params = {}) => {
  const credentials = await getCredentials(uid);
  await syncServerTime(false);

  const requestOnce = async () => {
    const signedQuery = buildSignedQuery(credentials.appSecret, {
      ...params,
      recvWindow: 10000,
      timestamp: getFuturesTimestamp(),
    });

    const response = await axios.get(`${FUTURES_BASE_URL}${path}?${signedQuery}`, {
      timeout: 10000,
      headers: {
        "X-MBX-APIKEY": credentials.appKey,
      },
    });
    return response.data;
  };

  try {
    return await requestOnce();
  } catch (error) {
    if (Number(error?.response?.data?.code || 0) === -1021) {
      await syncServerTime(true);
      return await requestOnce();
    }
    throw error;
  }
};

const getPositionRisk = async (uid, symbol = null) => {
  const positions = await signedGet(uid, "/fapi/v2/positionRisk", {});
  if (!symbol) {
    return Array.isArray(positions) ? positions : [];
  }
  const normalizedSymbol = normalizeSymbol(symbol);
  return (Array.isArray(positions) ? positions : []).filter((item) => item.symbol === normalizedSymbol);
};

const getOpenOrders = async (uid, symbol = null) =>
  await signedGet(uid, "/fapi/v1/openOrders", symbol ? { symbol: normalizeSymbol(symbol) } : {});

const getOpenAlgoOrders = async (uid, symbol = null) =>
  await signedGet(uid, "/fapi/v1/openAlgoOrders", symbol ? { symbol: normalizeSymbol(symbol) } : {});

const getAllOrders = async (uid, symbol, limit = 50) =>
  await signedGet(uid, "/fapi/v1/allOrders", {
    symbol: normalizeSymbol(symbol),
    limit,
  });

const getUserTrades = async (uid, symbol, limit = 50) =>
  await signedGet(uid, "/fapi/v1/userTrades", {
    symbol: normalizeSymbol(symbol),
    limit,
  });

const getPositionMode = async (uid) =>
  await signedGet(uid, "/fapi/v1/positionSide/dual", {});

const getReadOnlyConnectivity = async (uid, symbol = null) => {
  const credentials = await getCredentials(uid);
  const result = {
    uid: credentials.uid,
    memId: credentials.memId,
    tradeAccessMode: credentials.tradeAccessMode,
    appKeyMasked: credentials.appKeyMasked,
    positionRisk: { ok: false, count: 0, error: null },
    openOrders: { ok: false, count: 0, error: null },
    openAlgoOrders: { ok: false, count: 0, error: null },
    allOrders: { ok: false, count: 0, error: null },
    userTrades: { ok: false, count: 0, error: null },
    positionMode: { ok: false, value: null, error: null },
  };

  try {
    const rows = await getPositionRisk(uid, symbol);
    result.positionRisk = { ok: true, count: rows.length, error: null };
  } catch (error) {
    result.positionRisk.error = error?.message || String(error);
  }

  try {
    const rows = await getOpenOrders(uid, symbol);
    result.openOrders = { ok: true, count: Array.isArray(rows) ? rows.length : 0, error: null };
  } catch (error) {
    result.openOrders.error = error?.message || String(error);
  }

  try {
    const rows = await getOpenAlgoOrders(uid, symbol);
    result.openAlgoOrders = { ok: true, count: Array.isArray(rows) ? rows.length : 0, error: null };
  } catch (error) {
    result.openAlgoOrders.error = error?.message || String(error);
  }

  if (symbol) {
    try {
      const rows = await getAllOrders(uid, symbol, 20);
      result.allOrders = { ok: true, count: Array.isArray(rows) ? rows.length : 0, error: null };
    } catch (error) {
      result.allOrders.error = error?.message || String(error);
    }

    try {
      const rows = await getUserTrades(uid, symbol, 20);
      result.userTrades = { ok: true, count: Array.isArray(rows) ? rows.length : 0, error: null };
    } catch (error) {
      result.userTrades.error = error?.message || String(error);
    }
  }

  try {
    const mode = await getPositionMode(uid);
    result.positionMode = {
      ok: true,
      value: mode?.dualSidePosition,
      error: null,
    };
  } catch (error) {
    result.positionMode.error = error?.message || String(error);
  }

  return result;
};

module.exports = {
  FUTURES_BASE_URL,
  maskKey,
  getCredentials,
  signedGet,
  getPositionRisk,
  getOpenOrders,
  getOpenAlgoOrders,
  getAllOrders,
  getUserTrades,
  getPositionMode,
  getReadOnlyConnectivity,
};
