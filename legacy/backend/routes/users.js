var express = require('express');
var router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const refresh = require("../middleware/refresh");
const redisClient = require('../util/redis.util');
const jwt = require('../util/jwt.util');
const db = require('../database/connect/config');
const requestIp = require('request-ip');
const seon = require('../seon');
const dbcon = require("../dbcon");
const gridRuntime = require("../grid-runtime");
const gridEngine = require("../grid-engine");
const signalStrategyIdentity = require("../signal-strategy-identity");
const { insertWebhookEventLog, insertWebhookEventTargetLogs } = require("../webhook-event-log");

const { validateRegister, validateRegister1, validateRegister2, validateLogin } = require('./validation');
const fs = require("fs");

let policyEngine = null;

const getPolicyEngine = () => {
  if (!policyEngine) {
    policyEngine = require("../policy-engine");
  }

  return policyEngine;
};

const coolsms = require('coolsms-node-sdk').default;
const messageService = new coolsms(process.env.COOL_SMS_KEY, process.env.COOL_SMS_SECRET);

const isEmpty = function(value){
	if( value == "" || value == null || value == undefined || ( value != null && typeof value == "object" && !Object.keys(value).length ) ){
	  return null;
	}else{
	  return value;
	}
};

const isEmpty2 = function(value){
  if( value == "" || value == null || value == undefined || ( value != null && typeof value == "object" && !Object.keys(value).length ) ){
	return 0;
  }else{
	return value;
  }
};

const webhookIdempotencyCache = new Map();

const cleanupWebhookIdempotencyCache = () => {
  const now = Date.now();
  for(const [key, expiresAt] of webhookIdempotencyCache.entries()){
    if(expiresAt <= now){
      webhookIdempotencyCache.delete(key);
    }
  }
};

const reserveLocalWebhookKey = (key, ttlMs) => {
  cleanupWebhookIdempotencyCache();

  if(webhookIdempotencyCache.has(key)){
    return false;
  }

  webhookIdempotencyCache.set(key, Date.now() + ttlMs);
  return true;
};

const reserveRedisWebhookKey = async (key, ttlSeconds) => {
  if(!redisClient || typeof redisClient.set !== 'function'){
    return null;
  }

  if(redisClient.isOpen === false || redisClient.isReady === false){
    return null;
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if(settled){
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), 250);
    try{
      redisClient.set(key, '1', 'EX', ttlSeconds, 'NX', (error, response) => {
        if(error){
          finish(null);
          return;
        }

        finish(response === 'OK');
      });
    }catch(error){
      finish(null);
    }
  });
};

const buildWebhookExecutionKey = (payload) => {
  const stablePayload = {
    db_type: String(payload?.db_type || '').trim(),
    type: String(payload?.type || '').trim(),
    symbol: String(payload?.symbol || '').trim(),
    bunbong: String(payload?.bunbong || '').trim(),
    uuid: String(payload?.uuid || '').trim(),
    time: String(payload?.time || '').trim(),
    close: String(payload?.close || '').trim(),
  };

  return crypto
    .createHash('sha1')
    .update(JSON.stringify(stablePayload))
    .digest('hex');
};

const reserveWebhookExecution = async (payload, ttlMs = 30000) => {
  const key = buildWebhookExecutionKey(payload);
  const redisReserved = await reserveRedisWebhookKey(`hook:idempotency:${key}`, Math.max(1, Math.ceil(ttlMs / 1000)));
  if(redisReserved === true){
    return { key, duplicate: false, source: 'redis' };
  }

  if(redisReserved === false){
    return { key, duplicate: true, source: 'redis' };
  }

  return {
    key,
    duplicate: !reserveLocalWebhookKey(key, ttlMs),
    source: 'memory',
  };
};

const validateHookPayload = (payload) => {
  if(!payload || typeof payload !== 'object'){
    return { ok: false, reason: 'empty-payload' };
  }

  const uuid = String(payload?.uuid || '').trim();
  if(uuid && uuid.length > 100){
    return { ok: false, reason: 'uuid-too-long' };
  }

  const dbType = String(payload?.db_type || '').trim();
  const signalType = String(payload?.type || '').trim();
  const symbol = String(payload?.symbol || '').trim();

  if(!dbType){
    return { ok: false, reason: 'missing-db-type' };
  }

  if(!signalType){
    return { ok: false, reason: 'missing-type' };
  }

  if(!symbol){
    return { ok: false, reason: 'missing-symbol' };
  }

  return { ok: true };
};

const normalizeExchangeScopedSymbol = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_]+:/, "")
    .replace(/\.P$/i, "");

const normalizeTradeHookSymbol = (value) => normalizeExchangeScopedSymbol(value);

const normalizeTradeHookBunbong = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }

  const minuteMatch = normalized.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)$/);
  if (minuteMatch) {
    return minuteMatch[1];
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  return normalized.replace(/\s+/g, "");
};

const normalizeTradeHookPayload = (payload = {}) => ({
  ...payload,
  db_type: String(payload?.db_type || "").trim(),
  type: String(payload?.type || "").trim().toUpperCase(),
  symbol: normalizeTradeHookSymbol(payload?.symbol),
  bunbong: normalizeTradeHookBunbong(payload?.bunbong),
  uuid: String(payload?.uuid || "").trim(),
  time: String(payload?.time || "").trim(),
  close: payload?.close,
});

const normalizeWebhookResultCode = (value, fallback = "RECEIVED") =>
  String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;

const buildSignalWebhookOutcome = (summary = {}) => {
  const processedCount =
    Number(summary.enteredCount || 0) +
    Number(summary.reverseCloseCount || 0) +
    Number(summary.reverseCancelCount || 0);
  const ignoredCount =
    Number(summary.ignoredNotReadyCount || 0) +
    Number(summary.ignoredSignalMismatchCount || 0) +
    Number(summary.lockSkippedCount || 0) +
    Number(summary.entryRejectedCount || 0);

  if (!summary.ok) {
    return {
      status: "IGNORED",
      resultCode: normalizeWebhookResultCode(summary.reason, "IGNORED"),
      matchedCount: Number(summary.matchedCount || 0),
      processedCount,
      ignoredCount: Math.max(ignoredCount, 1),
      note: summary.reason || null,
    };
  }

  if (summary.enteredCount > 0) {
    return {
      status: "PROCESSED",
      resultCode: "ENTERED_PENDING",
      matchedCount: Number(summary.matchedCount || 0),
      processedCount,
      ignoredCount,
      note: "strategy-enter-pending",
    };
  }

  if (summary.reverseCloseCount > 0) {
    return {
      status: "PROCESSED",
      resultCode: "REVERSE_SIGNAL_CLOSE",
      matchedCount: Number(summary.matchedCount || 0),
      processedCount,
      ignoredCount,
      note: "reverse-signal-close-dispatched",
    };
  }

  if (summary.reverseCancelCount > 0) {
    return {
      status: "PROCESSED",
      resultCode: "REVERSE_SIGNAL_CANCEL",
      matchedCount: Number(summary.matchedCount || 0),
      processedCount,
      ignoredCount,
      note: "reverse-signal-cancelled-entry-pending",
    };
  }

  if (!summary.matchedCount) {
    return {
      status: "IGNORED",
      resultCode: "NO_MATCHING_STRATEGY",
      matchedCount: 0,
      processedCount,
      ignoredCount: Math.max(ignoredCount, 1),
      note: "no-started-strategy-matched",
    };
  }

  if (summary.ignoredSignalMismatchCount > 0 && processedCount === 0) {
    return {
      status: "IGNORED",
      resultCode: "SIGNAL_TYPE_MISMATCH",
      matchedCount: Number(summary.matchedCount || 0),
      processedCount,
      ignoredCount: Math.max(ignoredCount, 1),
      note: "matched-strategy-but-direction-not-enabled",
    };
  }

  return {
    status: "IGNORED",
    resultCode: "RUNTIME_NOT_READY",
    matchedCount: Number(summary.matchedCount || 0),
    processedCount,
    ignoredCount: Math.max(ignoredCount, 1),
    note: "matched-strategy-not-ready-or-locked",
  };
};

const buildGridWebhookOutcome = (result = {}) => {
  if (result.armed > 0) {
    return {
      status: "PROCESSED",
      resultCode: "GRID_ARMED",
      matchedCount: Number(result.matched || 0),
      processedCount: Number(result.armed || 0),
      ignoredCount: Number(result.ignoredActive || 0) + Number(result.ignoredSignal || 0),
      note: "grid-regime-armed",
    };
  }

  if ((result.ignoredActive || 0) > 0 && (result.matched || 0) > 0) {
    return {
      status: "IGNORED",
      resultCode: "GRID_ACTIVE_IGNORED",
      matchedCount: Number(result.matched || 0),
      processedCount: 0,
      ignoredCount: Number(result.ignoredActive || 0),
      note: "active-grid-regime-kept",
    };
  }

  if ((result.ignoredSignal || 0) > 0 && (result.matched || 0) === 0) {
    return {
      status: "IGNORED",
      resultCode: "GRID_SIGNAL_MISMATCH",
      matchedCount: 0,
      processedCount: 0,
      ignoredCount: Number(result.ignoredSignal || 0),
      note: "started-grid-strategy-signal-mismatch",
    };
  }

  return {
    status: "IGNORED",
    resultCode: "NO_MATCHING_STRATEGY",
    matchedCount: Number(result.matched || 0),
    processedCount: 0,
    ignoredCount:
      Number(result.ignoredActive || 0) + Number(result.ignoredSignal || 0) + 1,
    note: "no-started-grid-strategy-matched",
  };
};

const normalizeBacktestStrategyKey = (value) => {
  const normalized = signalStrategyIdentity.normalizeSignalStrategyKey(value);
  if (!normalized) {
    return '';
  }

  const aliasMap = {
    stoch: 'scalping',
    signal: 'scalping',
    signals: 'scalping',
    green_light: 'greenlight',
    greenlight: 'greenlight',
    'atf+vixfix': 'atf+vixfix',
    atf_vixfix: 'atf+vixfix',
    atfvixfix: 'atf+vixfix',
  };

  return aliasMap[normalized] || normalized;
};

const normalizeBacktestSymbol = (value) => normalizeExchangeScopedSymbol(value);

const normalizeBacktestSignalType = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'LONG') {
    return 'BUY';
  }

  if (normalized === 'SHORT') {
    return 'SELL';
  }

  return normalized;
};

const normalizeBacktestBunbong = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return '';
  }

  const minuteMatch = normalized.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)$/);
  if (minuteMatch) {
    return `${minuteMatch[1]}MIN`;
  }

  if (/^\d+$/.test(normalized)) {
    return `${normalized}MIN`;
  }

  return normalized.replace(/\s+/g, '');
};

const parseBacktestNumber = (value, fallback = 0) => {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return fallback;
  }

  const lower = normalized.toLowerCase();
  if (['na', 'n/a', 'null', 'undefined', '-', '--'].includes(lower)) {
    return fallback;
  }

  const cleaned = normalized.replace(/,/g, '').replace(/%/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
};

const parseBacktestHitRate = (value) => {
  const parsed = parseBacktestNumber(value, 0);
  if (parsed > 0 && parsed <= 1) {
    return Number((parsed * 100).toFixed(4));
  }
  return parsed;
};

const parseBacktestTpValue = (value) => {
  const raw = String(value ?? '').trim();
  const parsed = parseBacktestNumber(value, 0);
  if (raw.includes('%')) {
    return parsed;
  }
  if (parsed > 0 && parsed < 1) {
    return Number((parsed * 100).toFixed(8));
  }
  return parsed;
};

const parseBacktestCount = (value) => {
  const parsed = Math.trunc(parseBacktestNumber(value, 0));
  return parsed > 0 ? parsed : 0;
};

const parseBacktestNullableNumber = (value) => {
  const parsed = parseBacktestNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildBacktestPayloadHash = (payload) =>
  crypto.createHash('sha1').update(JSON.stringify(payload || {})).digest('hex');

const toMonthSnapshot = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};

const normalizeBacktestRows = (payload) => {
  const strategyKey = normalizeBacktestStrategyKey(
    payload?.strategyKey ||
      payload?.strategy ||
      payload?.strategy_name ||
      payload?.signal ||
      payload?.type ||
      payload?.db_type ||
      payload?.category
  );
  const symbol = normalizeBacktestSymbol(payload?.symbol || payload?.ticker || payload?.market);
  const bunbong = normalizeBacktestBunbong(
    payload?.bunbong || payload?.timeframe || payload?.timeFrame || payload?.interval || payload?.candle_min
  );
  const signalType = normalizeBacktestSignalType(
    payload?.signalType || payload?.signal_type || payload?.direction || payload?.side || payload?.positionSide
  );
  const generatedAt = payload?.generatedAt || payload?.generated_at || payload?.updatedAt || payload?.createdAt || null;
  const source = payload?.source || payload?.hook_type || 'webhook';

  const candidateRows =
    payload?.rows ||
    payload?.stats ||
    payload?.results ||
    payload?.records ||
    payload?.tpStats ||
    payload?.data ||
    payload?.backtestRows ||
    payload?.payload?.rows ||
    [];

  if (!strategyKey || !symbol || !bunbong || !Array.isArray(candidateRows) || !candidateRows.length) {
    return [];
  }

  if (!signalType) {
    const longCount = parseBacktestCount(payload?.final_dataset_counts?.long ?? payload?.buy_count);
    const shortCount = parseBacktestCount(payload?.final_dataset_counts?.short ?? payload?.sell_count);
    const dedupeMap = new Map();

    const pushStandardRow = (row, nextSignalType, hitRateRaw, pnlRaw, cagrRaw, count) => {
      const hasMeaningfulValue =
        Number.isFinite(parseBacktestNumber(hitRateRaw, Number.NaN)) ||
        Number.isFinite(parseBacktestNumber(pnlRaw, Number.NaN)) ||
        Number.isFinite(parseBacktestNumber(cagrRaw, Number.NaN));

      if (!count && !hasMeaningfulValue) {
        return;
      }

      const tpValue = parseBacktestTpValue(
        row?.tpValue ?? row?.tp ?? row?.takeProfit ?? row?.profitTarget ?? row?.target ?? row?.tpPercent ?? row?.tp_pct
      );
      if (!Number.isFinite(tpValue) || tpValue <= 0) {
        return;
      }

      const normalizedRow = {
        strategyKey,
        symbol,
        bunbong,
        signalType: nextSignalType,
        tpValue,
        pnlValue: parseBacktestNumber(pnlRaw, 0),
        hitRate: parseBacktestHitRate(hitRateRaw),
        tradeCount: count,
        sampleCount: count,
        generatedAt,
        source,
        rawRow: JSON.stringify({
          ...(row || {}),
          parsedFromStandard: true,
          signalType: nextSignalType,
          hitRateRaw,
          pnlRaw,
          cagrRaw: parseBacktestNullableNumber(cagrRaw),
        }),
      };

      dedupeMap.set(`${nextSignalType}:${tpValue}`, normalizedRow);
    };

    for (const row of candidateRows) {
      const vector = String(row?.v || '').trim();
      const parts = vector.split('/');
      if (parts.length < 6) {
        continue;
      }

      const [longHitRate, longCagr, longPnl, shortHitRate, shortCagr, shortPnl] = parts;
      pushStandardRow(row, 'BUY', longHitRate, longPnl, longCagr, longCount);
      pushStandardRow(row, 'SELL', shortHitRate, shortPnl, shortCagr, shortCount);
    }

    return [...dedupeMap.values()].sort((a, b) => {
      if (a.signalType === b.signalType) {
        return a.tpValue - b.tpValue;
      }
      return a.signalType.localeCompare(b.signalType);
    });
  }

  const dedupeMap = new Map();
  for (const row of candidateRows) {
    const tpValue = parseBacktestTpValue(
      row?.tpValue ?? row?.tp ?? row?.takeProfit ?? row?.profitTarget ?? row?.target ?? row?.tpPercent ?? row?.tp_pct
    );
    if (!Number.isFinite(tpValue) || tpValue <= 0) {
      continue;
    }

    const normalizedRow = {
      strategyKey,
      symbol,
      bunbong,
      signalType,
      tpValue,
      pnlValue: parseBacktestNumber(row?.pnl ?? row?.profit ?? row?.netProfit ?? row?.net_pnl, 0),
      hitRate: parseBacktestHitRate(row?.hitRate ?? row?.hitrate ?? row?.winRate ?? row?.win_rate ?? row?.accuracy ?? row?.successRate),
      tradeCount: parseBacktestCount(row?.tradeCount ?? row?.trade_count ?? row?.trades ?? row?.bars),
      sampleCount: parseBacktestCount(row?.sampleCount ?? row?.sample_count ?? row?.samples ?? row?.bars),
      generatedAt,
      source,
      rawRow: JSON.stringify(row || {}),
    };

    dedupeMap.set(String(tpValue), normalizedRow);
  }

  return [...dedupeMap.values()].sort((a, b) => a.tpValue - b.tpValue);
};

const insertBacktestWebhookLog = async (payload, payloadHash, options = {}) => {
  const {
    status = 'RECEIVED',
    rowCount = 0,
    note = null,
    strategyKey = null,
    symbol = null,
    bunbong = null,
    signalType = null,
    signalTag = null,
    candleMin = null,
    bestMetric = null,
    firstSignalDate = null,
    rowsJson = null,
    bestWindowsJson = null,
  } = options;

  const [result] = await db.query(
    `INSERT INTO backtest_webhook_log
      (hook_type, signal_tag, status, strategy_key, symbol, bunbong, signal_type, candle_min, best_metric, first_signal_date, payload_hash, row_count, note, raw_body, rows_json, best_windows_json)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'backtest',
      signalTag,
      status,
      strategyKey,
      symbol,
      bunbong,
      signalType,
      candleMin,
      bestMetric,
      firstSignalDate,
      payloadHash,
      rowCount,
      note,
      JSON.stringify(payload || {}),
      rowsJson,
      bestWindowsJson,
    ]
  );

  return result.insertId;
};

const replaceCurrentBacktestStats = async (rows, payloadHash) => {
  const groupMap = new Map();
  for (const row of rows) {
    const key = `${row.strategyKey}|${row.symbol}|${row.bunbong}|${row.signalType}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        strategyKey: row.strategyKey,
        symbol: row.symbol,
        bunbong: row.bunbong,
        signalType: row.signalType,
      });
    }
  }

  for (const group of groupMap.values()) {
    await db.query(
      `DELETE FROM backtest_stat_current
       WHERE strategy_key = ? AND symbol = ? AND bunbong = ? AND signal_type = ?`,
      [group.strategyKey, group.symbol, group.bunbong, group.signalType]
    );
  }

  for (const row of rows) {
    await db.query(
      `INSERT INTO backtest_stat_current
        (strategy_key, symbol, bunbong, signal_type, tp_value, pnl_value, hit_rate, trade_count, sample_count, generated_at, source, payload_hash, raw_row)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.strategyKey,
        row.symbol,
        row.bunbong,
        row.signalType,
        row.tpValue,
        row.pnlValue,
        row.hitRate,
        row.tradeCount,
        row.sampleCount,
        row.generatedAt,
        row.source,
        payloadHash,
        row.rawRow,
      ]
    );
  }
};

const archiveBacktestStatsIfMonthStart = async (rows, payloadHash) => {
  const now = new Date();
  if (now.getDate() !== 1) {
    return false;
  }

  const snapshotMonth = toMonthSnapshot(now);
  for (const row of rows) {
    await db.query(
      `INSERT INTO backtest_stat_archive
        (snapshot_month, strategy_key, symbol, bunbong, signal_type, tp_value, pnl_value, hit_rate, trade_count, sample_count, generated_at, source, payload_hash, raw_row)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        pnl_value = VALUES(pnl_value),
        hit_rate = VALUES(hit_rate),
        trade_count = VALUES(trade_count),
        sample_count = VALUES(sample_count),
        generated_at = VALUES(generated_at),
        source = VALUES(source),
        payload_hash = VALUES(payload_hash),
        raw_row = VALUES(raw_row)`,
      [
        snapshotMonth,
        row.strategyKey,
        row.symbol,
        row.bunbong,
        row.signalType,
        row.tpValue,
        row.pnlValue,
        row.hitRate,
        row.tradeCount,
        row.sampleCount,
        row.generatedAt,
        row.source,
        payloadHash,
        row.rawRow,
      ]
    );
  }

  return true;
};

router.post('/access', async (req, res) =>{
  const userIp = requestIp.getClientIp(req);

  await dbcon.DBCall(`CALL SP_U_ACCESS_LOG(?)`,[userIp]);
  
  return res.send(true);
});

/* GET users listing. */
router.get('/refresh', refresh, function(req, res, next) {
  res.send('respond with a resource');
});

router.post('/admin/login', validateLogin, async (req, res) =>{
  let info = {type: false, message: ''};
  let {userId, password} = req.body
  
  if(!(userId && password)){
    return res.status(400).json({
      status: 400,
      errors: [{msg:'12312'}]
    });
  }

  const reData = await dbcon.DBOneCall(`CALL SP_A_LOGIN(?,?)`,[
    userId,
    password
  ]);

  if(reData && reData.id){
    const accessToken = jwt.sign(reData.id+'');
    const refreshToken = jwt.refresh();

    redisClient.set(reData.id+'', refreshToken);

    info.message = 'success';
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Authorization', 'Bearer ' + accessToken);
    res.setHeader('Refresh', 'Bearer ' + refreshToken);
    return res.status(200).json({
        status: 200,
        info: info,
        token: {
            accessToken: accessToken,
            refreshToken: refreshToken
        }
    });
  }
  else{
    return res.status(400).json({
      status: 400,
      errors: [
        {msg:'?대쫫怨??대찓?쇱쓣 ?낅젰?댁＜?몄슂', param: "userId", location: "body"},
        {msg:'?대쫫怨??대찓?쇱쓣 ?낅젰?댁＜?몄슂', param: "password", location: "body"},
      ]
    });
  }
  
});

router.get('/n/image', async function(req, res){
  try{
    const reData = await dbcon.DBOneCall(`CALL SP_NAVER_FILE_GET(?,?)`, [req.query.uid, req.query.n_id]);
    const reBuffer = fs.readFileSync(reData.path);

    res.writeHead(200, { "Context-Type": reData.type });
    res.write(reBuffer);  
    res.end();  
  }catch(e){
    console.log(e);
    return res.send('');
  }
});

router.get('/api/hook', async function(req, res){
  // console.log(req.query);

});
router.post('/api/hook', async function(req, res){
  const rawPayload = req.body || {};
  const reqData = normalizeTradeHookPayload(rawPayload);
  const hookValidation = validateHookPayload(reqData);
  const clientIp = requestIp.getClientIp(req) || null;
  const baseWebhookLog = {
    hookCategory: 'signal',
    routePath: '/user/api/hook',
    requestIp: clientIp,
    rawBody: rawPayload,
    normalizedBody: reqData,
    strategyKey: reqData?.db_type || null,
    strategyUuid: reqData?.uuid || null,
    symbol: reqData?.symbol || null,
    bunbong: reqData?.bunbong || null,
    signalType: reqData?.type || null,
  };

  try{
    if(!hookValidation.ok){
      console.log(`[hook] invalid payload ignored reason=${hookValidation.reason}`);
      await insertWebhookEventLog({
        ...baseWebhookLog,
      status: 'IGNORED',
      resultCode: 'INVALID_PAYLOAD',
      ignoredCount: 1,
      httpStatus: 200,
      note: hookValidation.reason,
      responseBody: true,
      });
      return res.send(false);
    }

    const signalKillSwitch = await getPolicyEngine().getGlobalKillSwitchState({
      category: 'signal',
    });
    if(signalKillSwitch.active){
      console.log(`[hook] blocked by global kill switch mode=${signalKillSwitch.mode}`);
      await insertWebhookEventLog({
        ...baseWebhookLog,
        status: 'IGNORED',
        resultCode: 'KILL_SWITCH_BLOCKED',
        ignoredCount: 1,
        httpStatus: 200,
        note: `mode:${signalKillSwitch.mode}, category:signal, note:${signalKillSwitch.note || '-'}`,
        responseBody: {
          ok: true,
          blocked: true,
          reason: 'kill-switch',
          mode: signalKillSwitch.mode,
        },
      });
      return res.send(true);
    }

    const hookReservation = await reserveWebhookExecution(reqData);
    if(hookReservation.duplicate){
      console.log(`[hook] duplicate ignored (${hookReservation.source}) key=${hookReservation.key}`);
    await insertWebhookEventLog({
      ...baseWebhookLog,
      status: 'DUPLICATE',
      resultCode: 'DUPLICATE',
      duplicateFlag: 'Y',
      ignoredCount: 1,
      httpStatus: 200,
      note: `duplicate-source:${hookReservation.source}`,
      responseBody: true,
    });
    return res.send(true);
  }

  console.log(
    `[hook] accepted db_type=${reqData?.db_type} type=${reqData?.type} symbol=${reqData?.symbol} bunbong=${reqData?.bunbong} uuid=${reqData?.uuid}`
  );

  const summary = await seon.enterCoin(reqData);
  const outcome = buildSignalWebhookOutcome(summary);
  const webhookEventId = await insertWebhookEventLog({
    ...baseWebhookLog,
    status: outcome.status,
    resultCode: outcome.resultCode,
    matchedCount: outcome.matchedCount,
    processedCount: outcome.processedCount,
    ignoredCount: outcome.ignoredCount,
    httpStatus: 200,
    note: outcome.note,
    responseBody: {
      ok: true,
      summary,
    },
  });
  await insertWebhookEventTargetLogs(webhookEventId, summary?.targetItems || []);

  return res.send(true);
  }catch(error){
    console.log('[hook] runtime error', error?.message || error);
    await insertWebhookEventLog({
      ...baseWebhookLog,
      status: 'ERROR',
      resultCode: 'RUNTIME_ERROR',
      ignoredCount: 1,
      httpStatus: 500,
      note: error?.message || 'signal-hook-runtime-error',
      responseBody: {
        ok: false,
        reason: 'runtime-error',
      },
    });
    return res.status(500).send(false);
  }
});

router.post('/api/grid/hook', async function(req, res){
  const rawPayload = req.body || {};
  const validation = gridRuntime.validateGridWebhookPayload(req.body || {});
  const clientIp = requestIp.getClientIp(req) || null;
  const normalizedPayload = validation.payload || {};
  const baseWebhookLog = {
    hookCategory: 'grid',
    routePath: '/user/api/grid/hook',
    requestIp: clientIp,
    rawBody: rawPayload,
    normalizedBody: normalizedPayload,
    strategyKey: normalizedPayload?.strategySignalKey || null,
    signalTag: normalizedPayload?.strategySignal || null,
    symbol: normalizedPayload?.symbol || null,
    bunbong: normalizedPayload?.bunbong || null,
  };

  try{
    if(!validation.ok){
      console.log(`[grid-hook] invalid payload ignored reason=${validation.reason}`);
      await insertWebhookEventLog({
        ...baseWebhookLog,
      status: 'IGNORED',
      resultCode: 'INVALID_PAYLOAD',
      ignoredCount: 1,
      httpStatus: 400,
      note: validation.reason,
      responseBody: {
        ok: false,
        reason: validation.reason,
      },
      });
      return res.status(400).send({
        ok: false,
        reason: validation.reason,
      });
    }

    const payload = validation.payload;
    const gridKillSwitch = await getPolicyEngine().getGlobalKillSwitchState({
      category: 'grid',
    });
    if(gridKillSwitch.active){
      const blockedResponse = {
        ok: true,
        blocked: true,
        reason: 'kill-switch',
        mode: gridKillSwitch.mode,
        category: 'grid',
      };
      console.log(`[grid-hook] blocked by global kill switch mode=${gridKillSwitch.mode}`);
      await insertWebhookEventLog({
        ...baseWebhookLog,
        status: 'IGNORED',
        resultCode: 'KILL_SWITCH_BLOCKED',
        ignoredCount: 1,
        httpStatus: 200,
        note: `mode:${gridKillSwitch.mode}, category:grid, note:${gridKillSwitch.note || '-'}`,
        responseBody: blockedResponse,
      });
      return res.send(blockedResponse);
    }

    const result = await gridRuntime.processGridWebhook(payload);
    const livePrimed = await gridEngine.primeLiveEntriesForTargetItems(result?.targetItems || []);

  console.log(
    `[grid-hook] signal=${payload.strategySignal} symbol=${payload.symbol} bunbong=${payload.bunbong} matched=${result.matched} armed=${result.armed} ignoredActive=${result.ignoredActive} livePrimed=${livePrimed}`
  );

  const responseBody = {
    ok: true,
    strategySignal: payload.strategySignal,
    symbol: payload.symbol,
    bunbong: payload.bunbong,
    matched: result.matched,
    armed: result.armed,
    livePrimed,
    ignoredActive: result.ignoredActive,
    ignoredConflict: result.ignoredConflict,
    ignoredSignal: result.ignoredSignal,
    live: result.live,
    test: result.test,
  };
  const outcome = buildGridWebhookOutcome(result);
  const webhookEventId = await insertWebhookEventLog({
    ...baseWebhookLog,
    status: outcome.status,
    resultCode: outcome.resultCode,
    matchedCount: outcome.matchedCount,
    processedCount: outcome.processedCount,
    ignoredCount: outcome.ignoredCount,
    httpStatus: 200,
    note: outcome.note,
    responseBody,
  });
  await insertWebhookEventTargetLogs(webhookEventId, result?.targetItems || []);

  return res.send(responseBody);
  }catch(error){
    console.log('[grid-hook] runtime error', error?.message || error);
    await insertWebhookEventLog({
      ...baseWebhookLog,
      status: 'ERROR',
      resultCode: 'RUNTIME_ERROR',
      ignoredCount: 1,
      httpStatus: 500,
      note: error?.message || 'grid-hook-runtime-error',
      responseBody: {
        ok: false,
        reason: 'runtime-error',
      },
    });
    return res.status(500).send({
      ok: false,
      reason: 'runtime-error',
    });
  }
});

router.post('/api/backtest/hook', async function(req, res){
  const payload = req.body || {};
  const payloadHash = buildBacktestPayloadHash(payload);
  const clientIp = requestIp.getClientIp(req) || null;
  const strategyKeyFromPayload = normalizeBacktestStrategyKey(
    payload?.strategyKey ||
      payload?.strategy ||
      payload?.strategy_name ||
      payload?.signal ||
      payload?.type ||
      payload?.db_type ||
      payload?.category
  );
  const normalizedRows = normalizeBacktestRows(payload);
  const signalTag = String(payload?.signal || '').trim() || null;
  const candleMin = parseBacktestCount(payload?.candle_min);
  const bestMetric = String(payload?.best_metric || '').trim() || null;
  const firstSignalDate = String(payload?.first_signal_date || '').trim() || null;
  const rowsJson = payload?.rows ? JSON.stringify(payload.rows) : null;
  const bestWindowsJson = payload?.best_windows ? JSON.stringify(payload.best_windows) : null;
  const baseWebhookLog = {
    hookCategory: 'backtest',
    routePath: '/user/api/backtest/hook',
    requestIp: clientIp,
    payloadHash,
    rawBody: payload,
    normalizedBody: {
      strategyKey: strategyKeyFromPayload || null,
      signalTag,
      symbol: normalizeBacktestSymbol(payload?.symbol || payload?.ticker || payload?.market),
      bunbong: normalizeBacktestBunbong(
        payload?.bunbong || payload?.timeframe || payload?.timeFrame || payload?.interval || payload?.candle_min
      ),
      signalType: normalizeBacktestSignalType(
        payload?.signalType || payload?.signal_type || payload?.direction || payload?.side || payload?.positionSide
      ),
      candleMin: candleMin || null,
      bestMetric,
      firstSignalDate,
      normalizedRowCount: normalizedRows.length,
    },
    strategyKey: strategyKeyFromPayload || null,
    signalTag,
    symbol: normalizeBacktestSymbol(payload?.symbol || payload?.ticker || payload?.market) || null,
    bunbong: normalizeBacktestBunbong(
      payload?.bunbong || payload?.timeframe || payload?.timeFrame || payload?.interval || payload?.candle_min
    ) || null,
    signalType: normalizeBacktestSignalType(
      payload?.signalType || payload?.signal_type || payload?.direction || payload?.side || payload?.positionSide
    ) || null,
  };
  const [existingRows] = await db.query(
    `SELECT id, status FROM backtest_webhook_log WHERE payload_hash = ? ORDER BY id DESC LIMIT 1`,
    [payloadHash]
  );

  if (existingRows.length) {
    const existingStatus = String(existingRows[0].status || '');

    if (existingStatus.startsWith('STORED_ONLY') && normalizedRows.length) {
      await replaceCurrentBacktestStats(normalizedRows, payloadHash);
      const archiveApplied = await archiveBacktestStatsIfMonthStart(normalizedRows, payloadHash);
      const sample = normalizedRows[0];

      await db.query(
        `UPDATE backtest_webhook_log
         SET status = ?, strategy_key = ?, symbol = ?, bunbong = ?, signal_type = ?, row_count = ?, note = ?, rows_json = ?, best_windows_json = ?, signal_tag = ?, candle_min = ?, best_metric = ?, first_signal_date = ?
         WHERE id = ?`,
        [
          'IMPORTED',
          sample.strategyKey,
          sample.symbol,
          sample.bunbong,
          sample.signalType,
          normalizedRows.length,
          archiveApplied ? 'promoted-from-stored-only-and-archived' : 'promoted-from-stored-only',
          rowsJson,
          bestWindowsJson,
          signalTag,
          candleMin || null,
          bestMetric,
          firstSignalDate,
          existingRows[0].id,
        ]
      );

      const responseBody = {
        ok: true,
        duplicate: true,
        storedOnly: false,
        rowCount: normalizedRows.length,
        archiveApplied,
        logId: existingRows[0].id,
        promoted: true,
      };
      await insertWebhookEventLog({
        ...baseWebhookLog,
        status: 'PROCESSED',
        resultCode: 'BACKTEST_PROMOTED',
        matchedCount: normalizedRows.length,
        processedCount: normalizedRows.length,
        duplicateFlag: 'Y',
        httpStatus: 200,
        note: archiveApplied ? 'promoted-and-archived' : 'promoted-from-stored-only',
        responseBody,
      });
      return res.send(responseBody);
    }

    const responseBody = {
      ok: true,
      duplicate: true,
      storedOnly: existingStatus.startsWith('STORED_ONLY'),
      logId: existingRows[0].id,
    };
    await insertWebhookEventLog({
      ...baseWebhookLog,
      status: 'DUPLICATE',
      resultCode: 'BACKTEST_DUPLICATE',
      duplicateFlag: 'Y',
      ignoredCount: 1,
      httpStatus: 200,
      note: `existing-status:${existingStatus || 'UNKNOWN'}`,
      responseBody,
    });
    return res.send(responseBody);
  }

  if (!normalizedRows.length && (rowsJson || bestWindowsJson)) {
    const logId = await insertBacktestWebhookLog(payload, payloadHash, {
      status: 'STORED_ONLY_STANDARD',
      rowCount: Array.isArray(payload?.rows) ? payload.rows.length : 0,
      note: 'standard-pine-payload-stored-only',
      strategyKey: strategyKeyFromPayload || null,
      signalTag,
      candleMin: candleMin || null,
      bestMetric,
      firstSignalDate,
      rowsJson,
      bestWindowsJson,
    });

    const responseBody = {
      ok: true,
      duplicate: false,
      storedOnly: true,
      rowCount: Array.isArray(payload?.rows) ? payload.rows.length : 0,
      archiveApplied: false,
      logId,
    };
    await insertWebhookEventLog({
      ...baseWebhookLog,
      status: 'PROCESSED',
      resultCode: 'BACKTEST_STORED_ONLY',
      matchedCount: Array.isArray(payload?.rows) ? payload.rows.length : 0,
      processedCount: Array.isArray(payload?.rows) ? payload.rows.length : 0,
      httpStatus: 200,
      note: 'standard-pine-payload-stored-only',
      responseBody,
    });
    return res.send(responseBody);
  }

  if (!normalizedRows.length) {
    const logId = await insertBacktestWebhookLog(payload, payloadHash, {
      status: 'IGNORED',
      rowCount: 0,
      note: 'no-normalized-rows',
      strategyKey: strategyKeyFromPayload || null,
      signalTag,
      candleMin: candleMin || null,
      bestMetric,
      firstSignalDate,
      rowsJson,
      bestWindowsJson,
    });

    const responseBody = {
      ok: false,
      duplicate: false,
      reason: 'no-normalized-rows',
      logId,
    };
    await insertWebhookEventLog({
      ...baseWebhookLog,
      status: 'IGNORED',
      resultCode: 'NO_NORMALIZED_ROWS',
      ignoredCount: 1,
      httpStatus: 400,
      note: 'no-normalized-rows',
      responseBody,
    });
    return res.status(400).send(responseBody);
  }

  await replaceCurrentBacktestStats(normalizedRows, payloadHash);
  const archiveApplied = await archiveBacktestStatsIfMonthStart(normalizedRows, payloadHash);
  const sample = normalizedRows[0];
  const logId = await insertBacktestWebhookLog(payload, payloadHash, {
    status: 'IMPORTED',
    rowCount: normalizedRows.length,
    note: archiveApplied ? 'current-replaced-and-archived' : 'current-replaced',
    strategyKey: sample.strategyKey,
    symbol: sample.symbol,
    bunbong: sample.bunbong,
    signalType: sample.signalType,
    signalTag,
    candleMin: candleMin || null,
    bestMetric,
    firstSignalDate,
    rowsJson,
    bestWindowsJson,
  });

  const responseBody = {
    ok: true,
    duplicate: false,
    storedOnly: false,
    rowCount: normalizedRows.length,
    archiveApplied,
    logId,
  };
  await insertWebhookEventLog({
    ...baseWebhookLog,
    status: 'PROCESSED',
    resultCode: 'BACKTEST_IMPORTED',
    matchedCount: normalizedRows.length,
    processedCount: normalizedRows.length,
    httpStatus: 200,
    note: archiveApplied ? 'current-replaced-and-archived' : 'current-replaced',
    responseBody,
  });
  return res.send(responseBody);
});

// validateRegister
router.post('/reg', async function(req, res){
  try{
    req.body.mobile = '01000000000'

    const {userID} = await dbcon.DBOneCall(`CALL SP_U_USER_ADD(?,?,?,?,?,?)`,[
      req.body.memberid,
      req.body.username,
      req.body.mobile,
      req.body.password,
      req.body.email,
      req.body.recom,
    ]);
  
  
    const isId = userID;
    return res.status(200).json({
      status: 200,
    });

  }catch(e){
    return res.status(500).json({ errors: [{
        location: "body",
        msg: "?뚯닔?녿뒗 ?ㅻ쪟 /reg",
        param: "body",
        value: "body",
      }] 
    });
  }
});

router.post('/reg1', validateRegister1, async function(req, res){
  return res.status(200).json({
    status: 200,
  });
});
router.post('/reg2', validateRegister2, async function(req, res){
  return res.status(200).json({
    status: 200,
  });
});
router.post('/reg3', async function(req, res){
  return res.status(200).json({
    status: 200,
  });
});
router.post('/code', async function(req, res){
  const recom = req.body.recom;


  const codeList = [
    'A6561',
    'B6379',
    'C6541',
    'D7776',
    'E3927',
    'A8889',
    'A2822',
    'A5557',
    'B4780',
    'B0675',
    'C1491',
    'R0555',
  ]

  for(let i=0;i<codeList.length;i++){ 
    if(codeList[i] == recom){
      return res.status(200).json({
        status: 200,
      });
    }
  }

  return res.status(400).json({
    status: 400,
    errors: [{param:'recom', msg:'유효하지 않은 추천인 코드입니다'}]
  });
});


module.exports = router;
