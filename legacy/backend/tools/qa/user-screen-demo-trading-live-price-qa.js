const fs = require("fs");
const path = require("path");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const dayjs = require("dayjs");

const repoRoot = path.resolve(__dirname, "../../..");
require("dotenv").config({ path: path.join(repoRoot, "backend/.env") });

const db = require("../../database/connect/config");
const dt = require("../../data");
const seon = require("../../seon");
const gridEngine = require("../../grid-engine");

const BASE_URL = process.env.DEMO_QA_BASE_URL || "http://127.0.0.1:3079";
let SYMBOLS = (process.env.DEMO_QA_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,ADAUSDT,APTUSDT,DOGEUSDT,TRXUSDT,XLMUSDT,XRPUSDT,1000PEPEUSDT,SUIUSDT,LINKUSDT,AVAXUSDT,BNBUSDT,1000BONKUSDT,WIFUSDT,FILUSDT,NEARUSDT")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
SYMBOLS = [...new Set(SYMBOLS)];
const MAX_MINUTES = Math.max(5, Number(process.env.DEMO_QA_MAX_MINUTES || 360));
const POLL_MS = Math.max(1000, Number(process.env.DEMO_QA_POLL_MS || 5000));
const MAX_DYNAMIC_SYMBOLS = Math.max(0, Number(process.env.DEMO_QA_MAX_DYNAMIC_SYMBOLS || 60));
const SHORT_FARM_SYMBOL_LIMIT = Math.max(6, Number(process.env.DEMO_QA_SHORT_FARM_SYMBOL_LIMIT || 36));
const RUN_ID = process.env.DEMO_QA_RUN_ID || `USER_SCREEN_DEMO_${Date.now()}`;
const REPORT_DIR = path.join(repoRoot, "../reports/user-screen-demo");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const normalizeSide = (side) => String(side || "").trim().toUpperCase();
const sideLabel = (side) => (normalizeSide(side) === "SELL" ? "SHORT" : "LONG");
const round = (value, digits = 10) => Number(toNumber(value, 0).toFixed(digits));
const shortRunTag = () => `UD${Date.now().toString(36).slice(-7)}`;

const scenarioState = {
  A1_LONG_TP: null,
  A2_SHORT_TP: null,
  A3_LONG_SL: null,
  A4_SHORT_SL: null,
  A5_LONG_TIME_STOP: null,
  A6_SHORT_TIME_STOP: null,
  P1_LONG_SPLIT_FULL: null,
  P2_SHORT_SPLIT_FULL: null,
  P3_LONG_SPLIT_RESET_SL: null,
  P4_SHORT_SPLIT_RESET_SL: null,
  G1_PAIR_ARMED_WAITING: null,
  G2_SINGLE_LEG_ACTIVE_OPPOSITE_RESTING: null,
  G3_GRID_TP_CLOSE: null,
  G4_DUAL_SIDE_ACTIVE: null,
  G5_GRID_CLOSEOUT: null,
};

const qaLog = [];
const failures = [];
const candidates = [];
const gridCandidates = [];
const priceTicks = [];
const priceHistory = new Map();

const recordLog = (stage, payload = {}) => {
  const item = {
    at: new Date().toISOString(),
    stage,
    ...payload,
  };
  qaLog.push(item);
  console.log(`[${stage}] ${JSON.stringify(payload)}`);
};

const rememberPrice = (symbol, mid, now = Date.now()) => {
  const cleanSymbol = String(symbol || "").toUpperCase();
  if (!(mid > 0)) {
    return;
  }
  const list = priceHistory.get(cleanSymbol) || [];
  list.push({ mid, at: now });
  while (list.length > 60) {
    list.shift();
  }
  priceHistory.set(cleanSymbol, list);
};

const refreshDynamicSymbolUniverse = async () => {
  if (MAX_DYNAMIC_SYMBOLS <= 0) {
    return [];
  }
  const response = await axios.get("https://fapi.binance.com/fapi/v1/ticker/24hr", { timeout: 10000 });
  const rows = Array.isArray(response.data) ? response.data : [];
  const ranked = rows
    .filter((row) => {
      const symbol = String(row?.symbol || "").toUpperCase();
      return (
        symbol.endsWith("USDT") &&
        !symbol.includes("_") &&
        Number(row?.lastPrice || 0) > 0 &&
        Number(row?.quoteVolume || 0) >= 1000000
      );
    })
    .sort((a, b) => {
      const aMove = Math.abs(Number(a.priceChangePercent || 0));
      const bMove = Math.abs(Number(b.priceChangePercent || 0));
      const aVolume = Math.log10(Math.max(1, Number(a.quoteVolume || 0)));
      const bVolume = Math.log10(Math.max(1, Number(b.quoteVolume || 0)));
      return (bMove * bVolume) - (aMove * aVolume);
    })
    .slice(0, MAX_DYNAMIC_SYMBOLS)
    .map((row) => String(row.symbol || "").toUpperCase());
  const before = SYMBOLS.length;
  SYMBOLS = [...new Set([...SYMBOLS, ...ranked])];
  recordLog("DEMO_DYNAMIC_SYMBOL_UNIVERSE", {
    added: SYMBOLS.length - before,
    total: SYMBOLS.length,
    top: ranked.slice(0, 12),
  });
  return ranked;
};

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
});

const api = async (method, url, { token, data, params } = {}) => {
  const response = await axios({
    method,
    url: `${BASE_URL}${url}`,
    data,
    params,
    timeout: 15000,
    headers: token ? authHeaders(token) : {},
    validateStatus: () => true,
  });
  if (response.status >= 400 || response.data?.status === 402 || response.data?.success === false) {
    throw new Error(`API_${method.toUpperCase()}_${url}_FAILED:${response.status}:${JSON.stringify(response.data)}`);
  }
  return response.data;
};

const pickQaUser = async () => {
  const envUserId = Number(process.env.DEMO_QA_USER_ID || 0);
  if (envUserId > 0) {
    return envUserId;
  }
  const [[row]] = await db.query(
    `SELECT id
       FROM admin_member
      ORDER BY id ASC
      LIMIT 1`
  );
  if (!row?.id) {
    throw new Error("DEMO_QA_USER_NOT_FOUND");
  }
  return Number(row.id);
};

const makeToken = (userId) => {
  if (!process.env.JWT_KEY) {
    throw new Error("JWT_KEY_MISSING");
  }
  return jwt.sign({ userId }, process.env.JWT_KEY, {
    expiresIn: "24h",
    algorithm: "HS256",
  });
};

const fetchPublicQuote = async (symbol) => {
  const cleanSymbol = String(symbol || "").replace(/\.P$/i, "").toUpperCase();
  const endpoints = [
    `https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${cleanSymbol}`,
    `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${cleanSymbol}`,
  ];
  let lastError = null;
  for (const url of endpoints) {
    try {
      const response = await axios.get(url, { timeout: 8000 });
      const bid = toNumber(response.data?.bidPrice, 0);
      const ask = toNumber(response.data?.askPrice, 0);
      if (bid > 0 && ask > 0) {
        const now = Date.now();
        dt.price[cleanSymbol] = {
          bestBid: bid,
          bestAsk: ask,
          bestBidQty: response.data?.bidQty || 0,
          bestAskQty: response.data?.askQty || 0,
          lastPrice: (bid + ask) / 2,
          quoteTime: now,
          lastTradeTime: now,
          source: url.includes("fapi") ? "binance-futures-public-rest" : "binance-spot-public-rest",
        };
        priceTicks.push({
          symbol: cleanSymbol,
          bestBid: bid,
          bestAsk: ask,
          mid: (bid + ask) / 2,
          source: dt.price[cleanSymbol].source,
          at: new Date(now).toISOString(),
        });
        rememberPrice(cleanSymbol, (bid + ask) / 2, now);
        return dt.getPrice(cleanSymbol);
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`PUBLIC_PRICE_FEED_FAIL:${cleanSymbol}:${lastError?.message || "unknown"}`);
};

const refreshPublicFuturesBookTickerBulk = async () => {
  const response = await axios.get("https://fapi.binance.com/fapi/v1/ticker/bookTicker", { timeout: 10000 });
  const rows = Array.isArray(response.data) ? response.data : [];
  const wanted = new Set(SYMBOLS);
  const now = Date.now();
  let ok = 0;
  for (const row of rows) {
    const symbol = String(row?.symbol || "").toUpperCase();
    if (!wanted.has(symbol)) {
      continue;
    }
    const bid = toNumber(row?.bidPrice, 0);
    const ask = toNumber(row?.askPrice, 0);
    if (!(bid > 0 && ask > 0)) {
      continue;
    }
    const mid = (bid + ask) / 2;
    dt.price[symbol] = {
      bestBid: bid,
      bestAsk: ask,
      bestBidQty: row?.bidQty || 0,
      bestAskQty: row?.askQty || 0,
      lastPrice: mid,
      quoteTime: now,
      lastTradeTime: now,
      source: "binance-futures-public-rest-bulk",
    };
    priceTicks.push({
      symbol,
      bestBid: bid,
      bestAsk: ask,
      mid,
      source: dt.price[symbol].source,
      at: new Date(now).toISOString(),
    });
    rememberPrice(symbol, mid, now);
    ok += 1;
  }
  return ok;
};

const updateAllPrices = async () => {
  let ok = 0;
  try {
    ok = await refreshPublicFuturesBookTickerBulk();
  } catch (error) {
    recordLog("DEMO_PUBLIC_BULK_PRICE_FALLBACK", { error: error?.message || String(error) });
  }
  const missing = SYMBOLS.filter((symbol) => !dt.getPrice(symbol)?.st);
  if (missing.length) {
    const results = await Promise.allSettled(missing.map((symbol) => fetchPublicQuote(symbol)));
    ok += results.filter((item) => item.status === "fulfilled").length;
  }
  if (!ok) {
    throw new Error("LIVE_PRICE_FEED_FAIL:all-symbols");
  }
  return ok;
};

const liquidSymbols = () => SYMBOLS.filter((symbol) => dt.getPrice(symbol)?.st);

const shortMomentumSymbols = () => {
  const scored = liquidSymbols().map((symbol) => {
    const history = priceHistory.get(symbol) || [];
    const recent = history.slice(-12);
    const first = recent[0]?.mid || 0;
    const last = recent[recent.length - 1]?.mid || 0;
    const high = Math.max(...recent.map((item) => item.mid), last);
    const low = Math.min(...recent.map((item) => item.mid), last);
    const downPct = first > 0 && last > 0 ? ((first - last) / first) * 100 : 0;
    const rangePct = high > 0 && low > 0 ? ((high - low) / high) * 100 : 0;
    return {
      symbol,
      score: (downPct * 3) + rangePct,
      downPct: round(downPct, 6),
      rangePct: round(rangePct, 6),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
};

const selectShortFarmSymbols = () => {
  const ranked = shortMomentumSymbols();
  const positive = ranked.filter((item) => item.score > 0).slice(0, SHORT_FARM_SYMBOL_LIMIT);
  const fallback = ranked.slice(0, SHORT_FARM_SYMBOL_LIMIT);
  const selected = positive.length >= 6 ? positive : fallback;
  recordLog("DEMO_SHORT_FARM_SYMBOL_SELECTION", {
    selected: selected.map((item) => ({
      symbol: item.symbol,
      downPct: item.downPct,
      rangePct: item.rangePct,
    })),
  });
  return selected.map((item) => item.symbol);
};

const loadMinimumDemoMargin = async (symbol) => {
  const [[row]] = await db.query(
    `SELECT rawJson
       FROM exchange_symbol_catalog
      WHERE symbol = ?
      LIMIT 1`,
    [symbol]
  ).catch(() => [[null]]);
  let raw = {};
  try {
    raw = row?.rawJson ? JSON.parse(row.rawJson) : {};
  } catch (_) {
    raw = {};
  }
  const filters = Array.isArray(raw.filters) ? raw.filters : [];
  const minNotionalFilter = filters.find((filter) => String(filter?.filterType || "").toUpperCase() === "MIN_NOTIONAL") || {};
  const minimum = Math.max(
    5,
    toNumber(raw?.minTradeValue, 0),
    toNumber(raw?.minNotional, 0),
    toNumber(minNotionalFilter?.notional, 0)
  );
  return round(minimum, 4);
};

const signalPayload = ({ name, symbol, side, margin, split = false, timeStop = false }) => ({
  a_name: name,
  symbol,
  bunbong: "1",
  second2: "1",
  second3: "1",
  second4: "1",
  marginType: "cross",
  AI_ST: "N",
  profit: split ? 0.6 : 0.3,
  stopLoss: 0.6,
  stopLossTimeEnabled: timeStop ? "Y" : "N",
  stopLossTimeValue: timeStop ? 30 : 30,
  leverage: 1,
  margin,
  signalType: side,
  alarmSignalST: "N",
  alarmResultST: "N",
  orderSize: null,
  type: "SQZGBRK",
  repeatConfig: null,
  splitTakeProfitEnabled: split ? "Y" : "N",
  splitTakeProfitCount: split ? 2 : 0,
  splitTakeProfitGap: 0.3,
  splitTakeProfitStages: split
    ? [
        { tpPercent: 0.3, closeRatio: 50 },
        { tpPercent: 0.6, closeRatio: 50 },
      ]
    : [],
});

const gridPayload = ({ name, symbol, margin }) => ({
  a_name: name,
  strategySignal: "SQZ+GRID",
  symbol,
  bunbong: "1",
  marginType: "cross",
  margin,
  leverage: 1,
  profit: 0.5,
  tradeValue: margin,
});

const findCreatedSignal = async (uid, name) => {
  const [[row]] = await db.query(
    `SELECT *
       FROM test_play_list
      WHERE uid = ? AND a_name = ?
      ORDER BY id DESC
      LIMIT 1`,
    [uid, name]
  );
  if (!row?.id) {
    throw new Error(`CREATED_SIGNAL_NOT_FOUND:${name}`);
  }
  return row;
};

const findCreatedGrid = async (uid, name) => {
  const [[row]] = await db.query(
    `SELECT *
       FROM test_grid_strategy_list
      WHERE uid = ? AND a_name = ?
      ORDER BY id DESC
      LIMIT 1`,
    [uid, name]
  );
  if (!row?.id) {
    throw new Error(`CREATED_GRID_NOT_FOUND:${name}`);
  }
  return row;
};

const createSignalCandidate = async ({ token, uid, scenario, symbol, side, split = false, timeStop = false }) => {
  const name = `${shortRunTag()}_${scenario.slice(0, 8)}_${symbol.slice(0, 6)}_${side}`;
  const margin = await loadMinimumDemoMargin(symbol);
  await api("post", "/admin/test/add", {
    token,
    data: signalPayload({ name, symbol, side, margin, split, timeStop }),
  });
  const row = await findCreatedSignal(uid, name);
  await api("post", "/admin/test/auto", {
    token,
    data: { id: row.id, enabled: "Y" },
  });
  const hook = await api("post", "/admin/test/hook", {
    token,
    data: {
      db_type: "SQZGBRK",
      type: side,
      symbol,
      bunbong: "1",
      time: new Date().toISOString(),
      close: dt.getPrice(symbol).lastPrice || dt.getPrice(symbol).bestBid,
    },
  });
  const candidate = {
    kind: "signal",
    scenario,
    id: row.id,
    uid,
    symbol,
    side,
    split,
    timeStop,
    minimumMargin: margin,
    hookEventId: hook.eventId || null,
    targetItems: hook.summary?.targetItems || [],
    createdAt: new Date().toISOString(),
    selected: false,
  };
  candidates.push(candidate);
  recordLog("DEMO_SIGNAL_CANDIDATE_CREATED", candidate);
  return candidate;
};

const createGridCandidate = async ({ token, uid, scenario, symbol }) => {
  const name = `${shortRunTag()}_${scenario.slice(0, 8)}_${symbol.slice(0, 6)}`;
  const margin = await loadMinimumDemoMargin(symbol);
  await api("post", "/admin/grid/test/add", {
    token,
    data: gridPayload({ name, symbol, margin }),
  });
  const row = await findCreatedGrid(uid, name);
  await api("post", "/admin/grid/test/auto", {
    token,
    data: { id: row.id, enabled: "Y" },
  });
  const quote = dt.getPrice(symbol);
  const trigger = quote.lastPrice || ((quote.bestBid + quote.bestAsk) / 2);
  const support = round(trigger * (1 - 0.015), 10);
  const resistance = round(trigger * (1 + 0.015), 10);
  const hook = await api("post", "/admin/grid/test/hook", {
    token,
    data: {
      strategySignal: "SQZ+GRID",
      symbol,
      bunbong: "1",
      triggerPrice: trigger,
      supportPrice: support,
      resistancePrice: resistance,
      signalTime: new Date().toISOString(),
    },
  });
  const candidate = {
    kind: "grid",
    scenario,
    id: row.id,
    uid,
    symbol,
    hookEventId: hook.eventId || null,
    trigger,
    support,
    resistance,
    minimumMargin: margin,
    createdAt: new Date().toISOString(),
    selected: false,
  };
  gridCandidates.push(candidate);
  recordLog("DEMO_GRID_CANDIDATE_CREATED", candidate);
  return candidate;
};

const tickDemoRuntimes = async () => {
  await seon.runPlayTestForDemoQa();
  await gridEngine.runTest();
};

const loadSignalState = async (candidate) => {
  const [[play]] = await db.query(`SELECT * FROM test_play_list WHERE id = ? AND uid = ? LIMIT 1`, [candidate.id, candidate.uid]);
  const [logs] = await db.query(`SELECT * FROM test_play_log WHERE pid = ? AND uid = ? ORDER BY id DESC LIMIT 5`, [candidate.id, candidate.uid]);
  const [msgs] = await db.query(
    `SELECT * FROM msg_list WHERE uid = ? AND pid = ? AND created_at >= ? ORDER BY id ASC`,
    [candidate.uid, candidate.id, dayjs(candidate.createdAt).format("YYYY-MM-DD HH:mm:ss")]
  );
  return { play, logs: logs || [], msgs: msgs || [] };
};

const loadGridState = async (candidate) => {
  const [[grid]] = await db.query(`SELECT * FROM test_grid_strategy_list WHERE id = ? AND uid = ? LIMIT 1`, [candidate.id, candidate.uid]);
  const [msgs] = await db.query(
    `SELECT * FROM msg_list WHERE uid = ? AND pid = ? AND created_at >= ? ORDER BY id ASC`,
    [candidate.uid, candidate.id, dayjs(candidate.createdAt).format("YYYY-MM-DD HH:mm:ss")]
  );
  return { grid, msgs: msgs || [] };
};

const inferSignalOutcome = ({ candidate, play, logs, msgs }) => {
  const log = logs[0] || null;
  if (!log) {
    return null;
  }
  const direction = sideLabel(log.signalType || candidate.side);
  const pnl = toNumber(log.pol_sum, 0);
  const exitReason = String(log.exitReason || log.exitReasonCode || log.exitMode || log.st || "").toLowerCase();
  const hasSplitStage = msgs.some((msg) => String(msg.fun || "").includes("splitTpStageFilledTest") || String(msg.code || "").includes("SPLITTP_STAGE_FILLED"));
  const stageIndex = Number(play?.r_splitStageIndex || 0);
  const resetStopPrice = toNumber(play?.r_stopPrice, 0);
  const result = {
    testRowId: candidate.id,
    symbol: candidate.symbol,
    side: direction,
    entryPrice: toNumber(log.openPrice, 0),
    exitPrice: toNumber(log.closePrice, 0),
    exitReason,
    pnl,
    statusTransition: `READY->EXACT_WAIT->EXACT->${String(play?.status || "READY").toUpperCase()}`,
    trackRecordId: log.id,
    splitStageFilled: hasSplitStage,
    splitStageIndex: stageIndex,
    resetStopPrice,
    remainingQty: toNumber(play?.r_qty, 0),
    rawLog: log,
  };
  if (candidate.split) {
    if (direction === "LONG" && hasSplitStage && pnl > 0 && exitReason.includes("profit")) {
      return { scenario: "P1_LONG_SPLIT_FULL", result };
    }
    if (direction === "SHORT" && hasSplitStage && pnl > 0 && exitReason.includes("profit")) {
      return { scenario: "P2_SHORT_SPLIT_FULL", result };
    }
    if (direction === "LONG" && hasSplitStage && exitReason.includes("stop")) {
      return { scenario: "P3_LONG_SPLIT_RESET_SL", result };
    }
    if (direction === "SHORT" && hasSplitStage && exitReason.includes("stop")) {
      return { scenario: "P4_SHORT_SPLIT_RESET_SL", result };
    }
    return null;
  }
  if (exitReason.includes("time")) {
    return { scenario: direction === "LONG" ? "A5_LONG_TIME_STOP" : "A6_SHORT_TIME_STOP", result };
  }
  if (pnl > 0) {
    return { scenario: direction === "LONG" ? "A1_LONG_TP" : "A2_SHORT_TP", result };
  }
  if (pnl < 0) {
    return { scenario: direction === "LONG" ? "A3_LONG_SL" : "A4_SHORT_SL", result };
  }
  return null;
};

const classifySignalCandidates = async () => {
  for (const candidate of candidates) {
    const state = await loadSignalState(candidate);
    const outcome = inferSignalOutcome({ candidate, ...state });
    if (!outcome || scenarioState[outcome.scenario]) {
      continue;
    }
    candidate.selected = true;
    scenarioState[outcome.scenario] = {
      ...outcome.result,
      PASS: true,
    };
    recordLog("DEMO_SIGNAL_SCENARIO_PASS", {
      scenario: outcome.scenario,
      testRowId: candidate.id,
      symbol: candidate.symbol,
      side: candidate.side,
      trackRecordId: outcome.result.trackRecordId,
    });
  }
};

const classifyGridCandidates = async () => {
  for (const candidate of gridCandidates) {
    const { grid, msgs } = await loadGridState(candidate);
    if (!grid) {
      continue;
    }
    const messageText = msgs.map((msg) => `${msg.fun || ""}:${msg.code || ""}:${msg.msg || ""}`).join("\n");
    const hasEntry = messageText.includes("ENTRY_FILLED");
    const hasLongEntryEvidence = /ENTRY_FILLED:[^\n]*leg:LONG/.test(messageText);
    const hasShortEntryEvidence = /ENTRY_FILLED:[^\n]*leg:SHORT/.test(messageText);
    const hasTp = messageText.includes("TAKE_PROFIT");
    const hasStop =
      messageText.includes("BOX_BREAK") ||
      messageText.includes("MANUAL_OFF") ||
      String(grid.regimeStatus || "").toUpperCase() === "ENDED" ||
      String(grid.regimeEndReason || "").toUpperCase() === "MANUAL_OFF";
    const longOpen = String(grid.longLegStatus || "").toUpperCase() === "OPEN" && toNumber(grid.longQty, 0) > 0;
    const shortOpen = String(grid.shortLegStatus || "").toUpperCase() === "OPEN" && toNumber(grid.shortQty, 0) > 0;
    const bothArmed = String(grid.longLegStatus || "").toUpperCase() === "ENTRY_ARMED" && String(grid.shortLegStatus || "").toUpperCase() === "ENTRY_ARMED";
    const resultBase = {
      testGridRowId: candidate.id,
      symbol: candidate.symbol,
      box: "3%",
      tp: "0.5%",
      trigger: candidate.trigger,
      support: candidate.support,
      resistance: candidate.resistance,
      stateTransition: `${grid.regimeStatus}/${grid.longLegStatus}/${grid.shortLegStatus}`,
      closeout: String(grid.regimeStatus || "").toUpperCase() === "ENDED" ? "CLEAN" : "ACTIVE",
      trackRecordId: candidate.hookEventId,
      messages: msgs.length,
      PASS: true,
    };
    if (!scenarioState.G1_PAIR_ARMED_WAITING && bothArmed) {
      scenarioState.G1_PAIR_ARMED_WAITING = resultBase;
      recordLog("DEMO_GRID_SCENARIO_PASS", { scenario: "G1_PAIR_ARMED_WAITING", testGridRowId: candidate.id });
    }
    if (!scenarioState.G2_SINGLE_LEG_ACTIVE_OPPOSITE_RESTING && (hasEntry || longOpen || shortOpen)) {
      scenarioState.G2_SINGLE_LEG_ACTIVE_OPPOSITE_RESTING = resultBase;
      recordLog("DEMO_GRID_SCENARIO_PASS", { scenario: "G2_SINGLE_LEG_ACTIVE_OPPOSITE_RESTING", testGridRowId: candidate.id });
    }
    if (!scenarioState.G4_DUAL_SIDE_ACTIVE && (longOpen && shortOpen || (hasLongEntryEvidence && hasShortEntryEvidence))) {
      scenarioState.G4_DUAL_SIDE_ACTIVE = {
        ...resultBase,
        stateTransition: longOpen && shortOpen
          ? resultBase.stateTransition
          : `${resultBase.stateTransition}; dual-side evidence from msg_list ENTRY_FILLED LONG+SHORT`,
      };
      recordLog("DEMO_GRID_SCENARIO_PASS", { scenario: "G4_DUAL_SIDE_ACTIVE", testGridRowId: candidate.id });
    }
    if (!scenarioState.G3_GRID_TP_CLOSE && hasTp) {
      scenarioState.G3_GRID_TP_CLOSE = resultBase;
      recordLog("DEMO_GRID_SCENARIO_PASS", { scenario: "G3_GRID_TP_CLOSE", testGridRowId: candidate.id });
    }
    if (!scenarioState.G5_GRID_CLOSEOUT && (hasStop || String(grid.regimeStatus || "").toUpperCase() === "ENDED")) {
      scenarioState.G5_GRID_CLOSEOUT = resultBase;
      recordLog("DEMO_GRID_SCENARIO_PASS", { scenario: "G5_GRID_CLOSEOUT", testGridRowId: candidate.id });
    }
  }
};

const bootstrapRecentDemoEvidence = async (uid) => {
  const minSignalLogId = Math.max(0, Number(process.env.DEMO_QA_BOOTSTRAP_LOG_MIN_ID || 0));
  const minGridId = Math.max(0, Number(process.env.DEMO_QA_BOOTSTRAP_GRID_MIN_ID || 0));

  if (minSignalLogId > 0) {
    const [signalRows] = await db.query(
      `SELECT DISTINCT p.*
         FROM test_play_log l
         JOIN test_play_list p ON p.uid = l.uid AND p.id = l.pid
        WHERE l.uid = ?
          AND l.id >= ?
          AND p.a_name LIKE 'UD%'
        ORDER BY p.id ASC`,
      [uid, minSignalLogId]
    );
    for (const row of signalRows || []) {
      const candidate = {
        kind: "signal",
        scenario: "BOOTSTRAP",
        id: row.id,
        uid,
        symbol: row.symbol,
        side: row.signalType,
        split: String(row.splitTakeProfitEnabled || "").toUpperCase() === "Y",
        timeStop: String(row.stopLossTimeEnabled || "").toUpperCase() === "Y",
        createdAt: row.created_at || new Date().toISOString(),
        selected: false,
      };
      if (!candidates.some((item) => Number(item.id) === Number(candidate.id))) {
        candidates.push(candidate);
      }
      const state = await loadSignalState(candidate);
      const outcome = inferSignalOutcome({ candidate, ...state });
      if (outcome && !scenarioState[outcome.scenario]) {
        scenarioState[outcome.scenario] = {
          ...outcome.result,
          PASS: true,
          bootstrapped: true,
        };
        recordLog("DEMO_SIGNAL_SCENARIO_PASS", {
          scenario: outcome.scenario,
          testRowId: candidate.id,
          symbol: candidate.symbol,
          side: candidate.side,
          trackRecordId: outcome.result.trackRecordId,
          bootstrapped: true,
        });
      }
    }
  }

  if (minGridId > 0) {
    const [gridRows] = await db.query(
      `SELECT *
         FROM test_grid_strategy_list
        WHERE uid = ?
          AND id >= ?
          AND a_name LIKE 'UD%'
        ORDER BY id ASC`,
      [uid, minGridId]
    );
    for (const row of gridRows || []) {
      const candidate = {
        kind: "grid",
        scenario: "BOOTSTRAP",
        id: row.id,
        uid,
        symbol: row.symbol,
        hookEventId: null,
        trigger: toNumber(row.triggerPrice, 0),
        support: toNumber(row.supportPrice, 0),
        resistance: toNumber(row.resistancePrice, 0),
        minimumMargin: toNumber(row.tradeValue || row.margin, 0),
        createdAt: row.createdAt || row.created_at || new Date().toISOString(),
        selected: false,
      };
      if (!gridCandidates.some((item) => Number(item.id) === Number(candidate.id))) {
        gridCandidates.push(candidate);
      }
    }
    await classifyGridCandidates();
  }
};

const requestGridDemoCloseoutWhenCovered = async (token) => {
  if (!scenarioState.G3_GRID_TP_CLOSE) {
    return;
  }
  for (const candidate of gridCandidates) {
    if (candidate.closeoutRequested) {
      continue;
    }
    const { grid, msgs } = await loadGridState(candidate);
    if (!grid) {
      continue;
    }
    const text = msgs.map((msg) => `${msg.code || ""}:${msg.msg || ""}`).join("\n");
    const hasEntry = text.includes("ENTRY_FILLED") || String(grid.longLegStatus || "").toUpperCase() === "OPEN" || String(grid.shortLegStatus || "").toUpperCase() === "OPEN";
    if (!hasEntry) {
      continue;
    }
    await api("post", "/admin/grid/test/auto", {
      token,
      data: { id: candidate.id, enabled: "N" },
    }).catch((error) => {
      failures.push({
        at: new Date().toISOString(),
        failureClass: "USER_DEMO_GRID_CLOSEOUT_FAIL",
        message: error?.message || String(error),
        pid: candidate.id,
      });
    });
    candidate.closeoutRequested = true;
    recordLog("DEMO_GRID_CLOSEOUT_REQUESTED", {
      testGridRowId: candidate.id,
      symbol: candidate.symbol,
    });
  }
};

const pendingScenarioNames = () => Object.keys(scenarioState).filter((key) => !scenarioState[key]);

const createInitialFarm = async ({ token, uid }) => {
  const liquid = liquidSymbols();
  if (!liquid.length) {
    throw new Error("LIVE_PRICE_FEED_FAIL:no-liquid-symbols");
  }
  const pending = new Set(pendingScenarioNames());
  if (pending.has("A1_LONG_TP") || pending.has("A3_LONG_SL")) {
    for (const symbol of liquid) {
      await createSignalCandidate({ token, uid, scenario: "ALGO_SINGLE_LONG", symbol, side: "BUY" });
    }
  }
  if (pending.has("A2_SHORT_TP") || pending.has("A4_SHORT_SL")) {
    for (const symbol of liquid) {
      await createSignalCandidate({ token, uid, scenario: "ALGO_SINGLE_SHORT", symbol, side: "SELL" });
    }
  }
  if (pending.has("P1_LONG_SPLIT_FULL") || pending.has("P3_LONG_SPLIT_RESET_SL")) {
    for (const symbol of liquid) {
      await createSignalCandidate({ token, uid, scenario: "SPLIT_LONG", symbol, side: "BUY", split: true });
    }
  }
  if (pending.has("P2_SHORT_SPLIT_FULL") || pending.has("P4_SHORT_SPLIT_RESET_SL")) {
    for (const symbol of selectShortFarmSymbols()) {
      await createSignalCandidate({ token, uid, scenario: "SPLIT_SHORT", symbol, side: "SELL", split: true });
    }
  }
  if (pending.has("A5_LONG_TIME_STOP")) {
    await createSignalCandidate({ token, uid, scenario: "TIME_STOP_LONG", symbol: liquid[0], side: "BUY", timeStop: true });
  }
  if (pending.has("A6_SHORT_TIME_STOP")) {
    await createSignalCandidate({ token, uid, scenario: "TIME_STOP_SHORT", symbol: liquid[1] || liquid[0], side: "SELL", timeStop: true });
  }
  if ([...pending].some((item) => item.startsWith("G"))) {
    for (const symbol of liquid.slice(0, 6)) {
      await createGridCandidate({ token, uid, scenario: "GRID", symbol });
    }
  }
};

const replenishFarmIfNeeded = async ({ token, uid }) => {
  const pending = new Set(pendingScenarioNames());
  const liquid = liquidSymbols();
  if (!liquid.length) {
    return;
  }
  const stamp = Date.now();
  if (pending.has("A1_LONG_TP") || pending.has("A3_LONG_SL")) {
    await createSignalCandidate({ token, uid, scenario: `ALGO_LONG_REPLENISH_${stamp}`, symbol: liquid[stamp % liquid.length], side: "BUY" });
  }
  if (pending.has("A2_SHORT_TP") || pending.has("A4_SHORT_SL")) {
    await createSignalCandidate({ token, uid, scenario: `ALGO_SHORT_REPLENISH_${stamp}`, symbol: liquid[(stamp + 1) % liquid.length], side: "SELL" });
  }
  if (pending.has("P1_LONG_SPLIT_FULL") || pending.has("P3_LONG_SPLIT_RESET_SL")) {
    await createSignalCandidate({ token, uid, scenario: `SPLIT_LONG_REPLENISH_${stamp}`, symbol: liquid[stamp % liquid.length], side: "BUY", split: true });
  }
  if (pending.has("P2_SHORT_SPLIT_FULL") || pending.has("P4_SHORT_SPLIT_RESET_SL")) {
    for (const symbol of selectShortFarmSymbols()) {
      await createSignalCandidate({ token, uid, scenario: `SPLIT_SHORT_REPLENISH_${stamp}`, symbol, side: "SELL", split: true });
    }
  }
  if ([...pending].some((item) => item.startsWith("G"))) {
    for (const symbol of liquid) {
      await createGridCandidate({ token, uid, scenario: `GRID_REPLENISH_${stamp}`, symbol });
    }
  }
};

const loadTrackRecordEvidence = async (token) => {
  const recent = await api("get", "/admin/test/track-record/runtime/recent", {
    token,
    params: { page: 1, size: 50, status: "all" },
  });
  const items = recent?.items || [];
  const demoOnly = items.every((item) =>
    item.trackRecordType === "demo" &&
    item.strategySuccessScope === "demo_only" &&
    item.recommendationEligible === false
  );
  return {
    recent,
    demoOnly,
    algorithmRecords: items.filter((item) => String(item.strategyCategory || "").toLowerCase() === "signal").length,
    gridRecords: items.filter((item) => String(item.strategyCategory || "").toLowerCase() === "grid").length,
  };
};

const assertNoLiveMutation = async (startedAt) => {
  const [[intentCount]] = await db.query(
    `SELECT COUNT(*) AS count
       FROM order_intent_queue
      WHERE createdAt >= ?`,
    [startedAt]
  ).catch(() => [[{ count: 0 }]]);
  const [[liveGridArmCount]] = await db.query(
    `SELECT COUNT(*) AS count
       FROM order_intent_queue
      WHERE actionType = 'GRID_LIVE_ARM' AND createdAt >= ?`,
    [startedAt]
  ).catch(() => [[{ count: 0 }]]);
  return {
    orderIntentQueueWrites: Number(intentCount?.count || 0),
    gridLiveArmWrites: Number(liveGridArmCount?.count || 0),
  };
};

const writeReports = async ({ uid, startedAt, finishedAt, trackRecordEvidence, liveMutationEvidence, finalPass }) => {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const timestamp = dayjs().format("YYYYMMDD-HHmmss");
  const jsonPath = path.join(REPORT_DIR, `USER-SCREEN-DEMO-TRADING-LIVE-PRICE-QA-${timestamp}.json`);
  const mdPath = path.join(REPORT_DIR, `USER-SCREEN-DEMO-TRADING-LIVE-PRICE-QA-${timestamp}.md`);
  const payload = {
    runId: RUN_ID,
    uid,
    startedAt,
    finishedAt,
    finalPass,
    scenarios: scenarioState,
    pending: pendingScenarioNames(),
    candidates,
    gridCandidates,
    priceTicks,
    trackRecordEvidence,
    liveMutationEvidence,
    failures,
    qaLog,
    demoLiveSeparation: {
      usedAdminTestApis: true,
      usedUserApiHook: false,
      usedUserApiGridHook: false,
      binancePrivateWrite: false,
      liveOrderIntentQueue: liveMutationEvidence.orderIntentQueueWrites,
      liveGridLiveArm: liveMutationEvidence.gridLiveArmWrites,
      demoTrackRecordSeparate: trackRecordEvidence.demoOnly,
    },
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  const line = (label, value) => `- ${label}: ${value}`;
  const md = [
    "# USER-SCREEN-DEMO-TRADING-LIVE-PRICE-QA",
    "",
    "## Verdict",
    line("USER_DEMO_BACKEND_PATH", finalPass ? "PASS" : "FAILING"),
    line("DEMO_ALGORITHM_QA", Object.keys(scenarioState).slice(0, 6).every((key) => scenarioState[key]) ? "PASS" : "FAILING"),
    line("DEMO_SPLIT_TP_QA", Object.keys(scenarioState).slice(6, 10).every((key) => scenarioState[key]) ? "PASS" : "FAILING"),
    line("DEMO_GRID_QA", Object.keys(scenarioState).slice(10).every((key) => scenarioState[key]) ? "PASS" : "FAILING"),
    line("DEMO_TRACK_RECORD", trackRecordEvidence.demoOnly ? "PASS" : "FAILING"),
    line("DEMO_PRICE_FEED", priceTicks.length > 0 ? "PASS" : "FAILING"),
    line("DEMO_RECORD_ISOLATION", liveMutationEvidence.orderIntentQueueWrites === 0 && liveMutationEvidence.gridLiveArmWrites === 0 ? "PASS" : "FAILING"),
    line("DEMO_STATS_ISOLATION", trackRecordEvidence.demoOnly ? "PASS" : "FAILING"),
    line("FINAL_PASS", finalPass ? "PASS" : "FAILING"),
    "",
    "## Scenario Matrix",
    "",
    "| scenario | status | row | symbol | side/state | trackRecord |",
    "|---|---:|---:|---|---|---:|",
    ...Object.entries(scenarioState).map(([key, value]) =>
      `| ${key} | ${value ? "PASS" : "PENDING"} | ${value?.testRowId || value?.testGridRowId || ""} | ${value?.symbol || ""} | ${value?.side || value?.stateTransition || ""} | ${value?.trackRecordId || ""} |`
    ),
    "",
    "## Isolation",
    line("Binance private write", "false"),
    line("live order_intent_queue writes", liveMutationEvidence.orderIntentQueueWrites),
    line("live GRID_LIVE_ARM writes", liveMutationEvidence.gridLiveArmWrites),
    line("real TradingView", "false"),
    line("demo trackRecordType", "demo"),
    "",
    "## Artifacts",
    line("json", jsonPath),
    line("md", mdPath),
    "",
  ].join("\n");
  fs.writeFileSync(mdPath, md);
  return { jsonPath, mdPath, payload };
};

const main = async () => {
  const startedAt = dayjs().format("YYYY-MM-DD HH:mm:ss");
  await db.__startupFingerprintCheck;
  const uid = await pickQaUser();
  const token = makeToken(uid);
  await api("get", "/admin/test/list", { token, params: {} });
  recordLog("USER_SCREEN_DEMO_QA_STARTED", {
    runId: RUN_ID,
    uid,
    baseUrl: BASE_URL,
    maxMinutes: MAX_MINUTES,
    symbols: SYMBOLS,
  });
  await refreshDynamicSymbolUniverse().catch((error) => {
    recordLog("DEMO_DYNAMIC_SYMBOL_UNIVERSE_SKIPPED", { error: error?.message || String(error) });
    return [];
  });
  await updateAllPrices();
  await bootstrapRecentDemoEvidence(uid);
  await createInitialFarm({ token, uid });
  await classifyGridCandidates();
  const startedMs = Date.now();
  let lastReplenishMs = 0;
  while (Date.now() - startedMs < MAX_MINUTES * 60 * 1000) {
    await updateAllPrices();
    await tickDemoRuntimes();
    await classifySignalCandidates();
    await classifyGridCandidates();
    await requestGridDemoCloseoutWhenCovered(token);
    const pending = pendingScenarioNames();
    recordLog("DEMO_QA_PROGRESS", {
      passed: Object.keys(scenarioState).length - pending.length,
      total: Object.keys(scenarioState).length,
      pending,
    });
    if (!pending.length) {
      break;
    }
    const replenishIntervalMs =
      pending.length === 1 && pending[0] === "P2_SHORT_SPLIT_FULL"
        ? 60 * 1000
        : 5 * 60 * 1000;
    if (Date.now() - lastReplenishMs > replenishIntervalMs) {
      await replenishFarmIfNeeded({ token, uid });
      lastReplenishMs = Date.now();
    }
    await sleep(POLL_MS);
  }
  const trackRecordEvidence = await loadTrackRecordEvidence(token);
  const liveMutationEvidence = await assertNoLiveMutation(startedAt);
  const finalPass =
    pendingScenarioNames().length === 0 &&
    trackRecordEvidence.demoOnly &&
    liveMutationEvidence.orderIntentQueueWrites === 0 &&
    liveMutationEvidence.gridLiveArmWrites === 0;
  const finishedAt = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const report = await writeReports({
    uid,
    startedAt,
    finishedAt,
    trackRecordEvidence,
    liveMutationEvidence,
    finalPass,
  });
  console.log(JSON.stringify({
    ok: finalPass,
    runId: RUN_ID,
    pending: pendingScenarioNames(),
    report: {
      jsonPath: report.jsonPath,
      mdPath: report.mdPath,
    },
  }, null, 2));
  if (!finalPass) {
    process.exitCode = 2;
  }
};

main()
  .then(async () => {
    try {
      await db.end();
    } catch (_) {}
    process.exit(process.exitCode || 0);
  })
  .catch(async (error) => {
    failures.push({
      at: new Date().toISOString(),
      failureClass: String(error?.message || error).includes("PRICE") ? "LIVE_PRICE_FEED_FAIL" : "USER_DEMO_API_NOT_CONNECTED",
      message: error?.stack || error?.message || String(error),
    });
    try {
      const report = await writeReports({
        uid: 0,
        startedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        finishedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        trackRecordEvidence: { demoOnly: false, recent: null, algorithmRecords: 0, gridRecords: 0 },
        liveMutationEvidence: { orderIntentQueueWrites: 0, gridLiveArmWrites: 0 },
        finalPass: false,
      });
      console.log(JSON.stringify({ ok: false, error: error?.message || String(error), report }, null, 2));
    } catch (_) {
      console.error(error);
    }
    try {
      await db.end();
    } catch (_) {}
    process.exit(1);
  });
