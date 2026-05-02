
var exports = module.exports = {};
const crypto = require('crypto');

const db = require("./database/connect/config");
const dbcon = require("./dbcon");
const redisClient = require('./util/redis.util');
const runtimeState = require("./runtime-state");
const splitTakeProfit = require("./split-take-profit");
const gridEngine = require("./grid-engine");
const pidPositionLedger = require("./pid-position-ledger");
const strategyControlState = require("./strategy-control-state");
const signalStrategyIdentity = require("./signal-strategy-identity");
const adminOrderMonitor = require("./admin-order-monitor");

const coin = require("./coin");
const dt = require("./data");

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');
require('dayjs/locale/ko');
dayjs.locale('ko');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
// dayjs.tz.setDefault('Asia/Seoul');

let ST = false;
// let driver = null;
let serverInfo = null;

let runST = false;
let runTestST = false;
let runMainST = false;
const playRuntimeLocks = new Map();
let runtimeStartPromise = null;
let runtimeStarted = false;
let runMainTimer = null;
const RUN_MAIN_STUCK_THRESHOLD_MS = 10000;
const RUN_MAIN_INFO_LOG_THROTTLE_MS = 30000;
const runtimeLoopHealth = {
    runtimeStartedAt: null,
    runtimeOwnerLabel: null,
    lastTickStartedAt: null,
    lastTickCompletedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    lastErrorStack: null,
    lastRunningStage: null,
    currentTickId: 0,
    lastInfoLogAt: {
        enter: 0,
        complete: 0,
        stuck: 0,
    },
    bootSafetyGate: null,
};

const TRADE_MODE_LIVE = 0;
const TRADE_MODE_TEST = 1;
const DEBUG_TIME_EXPIRY = process.env.DEBUG_TIME_EXPIRY === '1';
const SIGNAL_ENTRY_PENDING_STALE_SECONDS = Math.max(
    10,
    Number(process.env.SIGNAL_ENTRY_PENDING_STALE_SECONDS || 30)
);

const buildSignalSystemAuditPayload = (play, actionCode, note, metadata = {}) => {
    const controlState = runtimeState.getControlState(play);
    const enabledFlag = controlState === 'ON' ? 'Y' : 'N';
    return {
        actorUserId: null,
        targetUserId: play?.uid || null,
        actionCode,
        previousEnabled: enabledFlag,
        nextEnabled: enabledFlag,
        requestIp: 'system:seon',
        note,
        metadata,
    };
};

const randomSleep = async (min=100, max=250) => { 
    const num = Math.floor(Math.random() * (max - min)) + min;
    await sleep(num);
}

const sleep = (ms) => {
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

const buildRuntimeErrorPayload = (error) => ({
    name: error?.name || 'Error',
    message: error?.message || String(error || 'Unknown error'),
    stack: error?.stack || null,
});

const shouldLogRunMainInfo = (stage, force = false) => {
    if(force){
        return true;
    }
    const now = Date.now();
    const lastAt = Number(runtimeLoopHealth.lastInfoLogAt?.[stage] || 0);
    if(lastAt > 0 && (now - lastAt) < RUN_MAIN_INFO_LOG_THROTTLE_MS){
        return false;
    }
    runtimeLoopHealth.lastInfoLogAt[stage] = now;
    return true;
};

const logRunMainState = (stage, payload = {}, options = {}) => {
    if(!shouldLogRunMainInfo(stage, Boolean(options.force))){
        return;
    }
    try{
        console.log(`[SEON_RUNTIME][${stage}] ${JSON.stringify(payload)}`);
    }catch(logError){
        console.log(`[SEON_RUNTIME][${stage}]`);
    }
};

const logRunMainFailure = (stage, error, extra = {}) => {
    const errorPayload = buildRuntimeErrorPayload(error);
    runtimeLoopHealth.lastFailureAt = new Date().toISOString();
    runtimeLoopHealth.lastErrorMessage = errorPayload.message;
    runtimeLoopHealth.lastErrorStack = errorPayload.stack;
    console.error(
        `[SEON_RUNTIME][RUN_MAIN_FAILED] ${JSON.stringify({
            file: 'seon.js',
            function: 'runMain',
            stage,
            ...extra,
            ...errorPayload,
        })}`
    );
};

const isBootSafetyGateDisabled = () => (
    String(process.env.DISABLE_BOOT_SAFETY_GATE || '').trim() === '1'
);

const getBootSafetyExcludedUids = () => new Set(
    String(process.env.RUNTIME_EXCLUDED_UIDS || '')
        .split(',')
        .map((value) => Number(String(value || '').trim()))
        .filter((uid) => Number.isFinite(uid) && uid > 0)
);

const loadBootSafetyGateUids = async () => {
    const [rows] = await db.query(
        `SELECT DISTINCT uid
           FROM (
                 SELECT uid FROM live_play_list WHERE enabled = 'Y'
                 UNION
                 SELECT uid FROM live_grid_strategy_list WHERE enabled = 'Y'
                 UNION
                 SELECT uid FROM live_pid_position_snapshot WHERE ABS(openQty) > 0.000000001
                 UNION
                 SELECT uid FROM live_pid_exit_reservation
                  WHERE status IN ('ACTIVE','PARTIAL','CANCEL_REQUESTED','CANCEL_PENDING','UNKNOWN_CANCEL_STATE')
                ) AS runtime_uid_scope
          WHERE uid IS NOT NULL`
    );
    const excludedUids = getBootSafetyExcludedUids();
    return (rows || [])
        .map((row) => Number(row.uid || 0))
        .filter((uid) => uid > 0 && !excludedUids.has(uid));
};

const runBootSafetyGate = async (ownerLabel = null) => {
    if(isBootSafetyGateDisabled()){
        return {
            ok: true,
            disabled: true,
            phase: 'SAFE_TO_TRADE',
            status: 'DISABLED_BY_ENV',
            ownerLabel,
        };
    }

    const uids = await loadBootSafetyGateUids();
    const checks = [];
    for(const uid of uids){
        const monitor = await adminOrderMonitor.buildAdminOrderMonitor(uid, {});
        const sourceFailed = (monitor.sourceStatus || []).some((item) => item && item.ok === false);
        const currentCriticalCount = Number(monitor?.summary?.currentCriticalCount || 0);
        checks.push({
            uid,
            sourceFailed,
            currentCriticalCount,
            openIssueCount: Number(monitor?.summary?.openIssueCount || 0),
            symbols: monitor.symbols || [],
        });
    }

    const blocked = checks.some((check) => check.sourceFailed || check.currentCriticalCount > 0);
    return {
        ok: !blocked,
        ownerLabel,
        phase: blocked ? 'RECONCILING' : 'SAFE_TO_TRADE',
        status: blocked ? 'BOOT_RECOVERY_BLOCKED_BY_CURRENT_RISK' : 'BOOT_RECOVERY_CLEAN',
        uids,
        checks,
    };
};

const runMainStage = async (stage, worker, context = {}) => {
    runtimeLoopHealth.lastRunningStage = stage;
    try{
        await worker();
        return true;
    }catch(error){
        logRunMainFailure(stage, error, context);
        return false;
    }
};

const markRunMainTickStart = (tickId) => {
    runtimeLoopHealth.currentTickId = tickId;
    runtimeLoopHealth.lastTickStartedAt = new Date().toISOString();
    runtimeLoopHealth.lastRunningStage = 'tick-start';
    logRunMainState('RUN_MAIN_TICK_ENTER', {
        file: 'seon.js',
        function: 'runMain',
        tickId,
        ownerLabel: runtimeLoopHealth.runtimeOwnerLabel,
    });
};

const markRunMainTickComplete = (tickId, summary = {}) => {
    const completedAt = new Date().toISOString();
    runtimeLoopHealth.lastTickCompletedAt = completedAt;
    runtimeLoopHealth.lastSuccessAt = completedAt;
    runtimeLoopHealth.lastRunningStage = 'idle';
    logRunMainState('RUN_MAIN_TICK_COMPLETE', {
        file: 'seon.js',
        function: 'runMain',
        tickId,
        ownerLabel: runtimeLoopHealth.runtimeOwnerLabel,
        ...summary,
    });
};

const logRunMainStuck = () => {
    const startedAt = runtimeLoopHealth.lastTickStartedAt
        ? new Date(runtimeLoopHealth.lastTickStartedAt).getTime()
        : 0;
    if(!startedAt){
        return;
    }

    const elapsedMs = Date.now() - startedAt;
    if(elapsedMs < RUN_MAIN_STUCK_THRESHOLD_MS){
        return;
    }

    logRunMainState('RUN_MAIN_STUCK', {
        file: 'seon.js',
        function: 'runMain',
        tickId: runtimeLoopHealth.currentTickId,
        ownerLabel: runtimeLoopHealth.runtimeOwnerLabel,
        lastTickStartedAt: runtimeLoopHealth.lastTickStartedAt,
        lastTickCompletedAt: runtimeLoopHealth.lastTickCompletedAt,
        lastRunningStage: runtimeLoopHealth.lastRunningStage,
        elapsedMs,
        lastFailureAt: runtimeLoopHealth.lastFailureAt,
        lastErrorMessage: runtimeLoopHealth.lastErrorMessage,
    });
};

const reserveRedisPlayLock = async (key, token, ttlSeconds = 15) => {
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
            clearTimeout(timeoutId);
            resolve(value);
        };

        const timeoutId = setTimeout(() => finish(null), 250);

        try{
            redisClient.set(key, token, 'EX', ttlSeconds, 'NX', (error, response) => {
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

const releaseRedisPlayLock = async (key, token) => {
    if(!redisClient || typeof redisClient.get !== 'function'){
        return;
    }

    if(redisClient.isOpen === false || redisClient.isReady === false){
        return;
    }

    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if(settled){
                return;
            }

            settled = true;
            clearTimeout(timeoutId);
            resolve();
        };

        const timeoutId = setTimeout(() => finish(), 250);

        try{
            redisClient.get(key, (getError, currentValue) => {
                if(getError || currentValue !== token){
                    finish();
                    return;
                }

                redisClient.del(key, () => finish());
            });
        }catch(error){
            finish();
        }
    });
};

const withPlayRuntimeLock = async (scope, playId, handler) => {
    if(!playId){
        await handler();
        return true;
    }

    const lockKey = `${scope}:${playId}`;
    if(playRuntimeLocks.has(lockKey)){
        return false;
    }

    const lockToken = crypto.randomBytes(8).toString('hex');
    playRuntimeLocks.set(lockKey, lockToken);

    const redisLockKey = `play:lock:${lockKey}`;
    const redisReserved = await reserveRedisPlayLock(redisLockKey, lockToken);
    if(redisReserved === false){
        playRuntimeLocks.delete(lockKey);
        return false;
    }

    try{
        await handler();
        return true;
    }finally{
        playRuntimeLocks.delete(lockKey);
        await releaseRedisPlayLock(redisLockKey, lockToken);
    }
}

const setLivePlayReadyIfCurrent = async (playId, expectedStatus, fallbackPlay = null) => {
    if(!playId || !expectedStatus){
        return false;
    }

    try{
        const [result] = await db.query(
            `UPDATE live_play_list
                SET status = 'READY', st = NULL, autoST = NULL
              WHERE id = ?
                AND status = ?
              LIMIT 1`,
            [playId, expectedStatus]
        );

        if(Number(result?.affectedRows || 0) > 0){
            await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [playId]);
            return true;
        }
    }catch(error){
    }

    const latest = await loadLivePlaySnapshot(playId, fallbackPlay);
    if(!latest || latest.status !== expectedStatus){
        return false;
    }

    const controlState = runtimeState.getControlState(latest);
    await strategyControlState.applyPlayControlState({
        mode: 'LIVE',
        pid: latest.id,
        enabled: controlState === 'ON' ? 'Y' : 'N',
        status: 'READY',
        resetRuntime: true,
        audit: buildSignalSystemAuditPayload(
            latest,
            'SYSTEM_RESET_READY',
            `seon:set-live-ready-if-current:${expectedStatus}`,
            {
                expectedStatus,
            }
        ),
    });
    return true;
}

const resetLivePlayToReady = async (play, expectedStatuses = []) => {
    if(!play?.id){
        return false;
    }

    const statuses = Array.isArray(expectedStatuses) && expectedStatuses.length > 0
        ? expectedStatuses
        : [play.status].filter(Boolean);

    if(statuses.length === 0){
        return false;
    }

    for(const expectedStatus of statuses){
        const changed = await setLivePlayReadyIfCurrent(play.id, expectedStatus, play);
        if(changed){
            return true;
        }
    }

    return false;
}

const resetTestPlayToReady = async (play) => {
    const controlState = runtimeState.getControlState(play);
    await strategyControlState.applyPlayControlState({
        mode: 'TEST',
        pid: play.id,
        enabled: controlState === 'ON' ? 'Y' : 'N',
        status: 'READY',
        resetRuntime: true,
        audit: buildSignalSystemAuditPayload(
            play,
            'SYSTEM_RESET_READY',
            'seon:reset-test-ready',
            {
                expectedStatus: play?.status || null,
            }
        ),
    });
}

const isEnabledFlag = (value) => (
    value === true
    || value === 'true'
    || value === 'Y'
    || value === 1
    || value === '1'
);

const hasConfiguredPercentStopLoss = (play) => (
    play?.lossTradeType === 'per'
    && Number(play?.stopLoss || 0) > 0
);

const isReverseSignalExitEnabled = (play) => isEnabledFlag(play?.stopLossReverseEnabled);
const isTimeExpiryExitEnabled = (play) => (
    isEnabledFlag(play?.stopLossTimeEnabled)
    && Number(play?.stopLossTimeValue || 0) > 0
);

const normalizeSignalStrategyType = (value) =>
    signalStrategyIdentity.normalizeSignalStrategyKey(value);

const normalizeSignalRouteBunbong = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if(!normalized){
        return '';
    }

    const minuteMatch = normalized.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)$/);
    if(minuteMatch){
        return minuteMatch[1];
    }

    if(/^\d+$/.test(normalized)){
        return normalized;
    }

    return normalized.replace(/\s+/g, '');
};

const normalizePlayList = (value) => {
    if(Array.isArray(value)){
        return value;
    }

    if(value && typeof value === 'object'){
        return [value];
    }

    return [];
};

const uniquePlayTargets = (items = []) => {
    const seen = new Set();
    return items.filter((item) => {
        const key = `${item?.live_ST || 'N'}:${item?.id || ''}`;
        if(seen.has(key)){
            return false;
        }
        seen.add(key);
        return true;
    });
};

const loadSignalTargetsByUuid = async (tableName, liveSt, reqData) => {
    const uuid = String(reqData?.uuid || '').trim();
    if(!uuid){
        return [];
    }

    const rows = await dbcon.DBOriginCall(
        `SELECT p.*, p.stoch_id AS uuid
         FROM ${tableName} p
         WHERE p.enabled = 'Y'
           AND (p.status = 'READY' OR p.status = 'EXACT_WAIT' OR p.status = 'EXACT')
           AND p.stoch_id = ?
           AND p.symbol = ?`,
        [uuid, reqData.symbol]
    );

    return normalizePlayList(rows).map((item) => ({
        ...item,
        live_ST: item?.live_ST || liveSt,
        uuid: item?.uuid || item?.stoch_id || uuid,
    }));
};

const loadSignalTargetsByRoute = async (tableName, liveSt, reqData, side) => {
    const strategyType = normalizeSignalStrategyType(reqData?.db_type);
    const bunbong = normalizeSignalRouteBunbong(reqData?.bunbong);

    if(!strategyType || !reqData?.symbol || !bunbong || !side){
        return [];
    }

    const rows = await dbcon.DBOriginCall(
        `SELECT p.*, p.stoch_id AS uuid
         FROM ${tableName} p
         WHERE p.enabled = 'Y'
           AND (p.status = 'READY' OR p.status = 'EXACT_WAIT' OR p.status = 'EXACT')
           AND LOWER(p.type) = ?
           AND p.symbol = ?
           AND p.bunbong = ?
           AND p.signalType = ?`,
        [strategyType, reqData.symbol, bunbong, side]
    );

    return normalizePlayList(rows).map((item) => ({
        ...item,
        live_ST: item?.live_ST || liveSt,
        uuid: item?.uuid || item?.stoch_id || null,
    }));
};

const loadSignalTargets = async (reqData, side) => {
    const liveExact = await loadSignalTargetsByUuid('live_play_list', 'Y', reqData);
    const testExact = await loadSignalTargetsByUuid('test_play_list', 'N', reqData);
    const exactMatches = uniquePlayTargets(liveExact.concat(testExact));
    if(exactMatches.length > 0){
        return exactMatches;
    }

    const liveRoute = await loadSignalTargetsByRoute('live_play_list', 'Y', reqData, side);
    const testRoute = await loadSignalTargetsByRoute('test_play_list', 'N', reqData, side);
    return uniquePlayTargets(liveRoute.concat(testRoute));
};

const liveCloseReasonMap = new Map();
const testCloseReasonMap = new Map();

const getCloseReasonMap = (liveST = 'Y') => (liveST === 'Y' ? liveCloseReasonMap : testCloseReasonMap);

const setPendingPlayCloseReason = (liveST, pid, reason) => {
    if(!pid || !reason){
        return;
    }

    getCloseReasonMap(liveST).set(Number(pid), reason);
};

const getPendingPlayCloseReason = (liveST, pid) => {
    if(!pid){
        return null;
    }

    return getCloseReasonMap(liveST).get(Number(pid)) || null;
};

const clearPendingPlayCloseReason = (liveST, pid) => {
    if(!pid){
        return;
    }

    getCloseReasonMap(liveST).delete(Number(pid));
};

exports.setPendingPlayCloseReason = setPendingPlayCloseReason;
exports.clearPendingPlayCloseReason = clearPendingPlayCloseReason;

const getSignalPositionSide = (signalType = null) =>
    String(signalType || '').trim().toUpperCase() === 'BUY' ? 'LONG' : 'SHORT';

const hasActiveSignalMarketExitReservation = async (play) => {
    if(!play?.uid || !play?.id || !play?.symbol || !play?.r_signalType){
        return false;
    }

    const reservations = await pidPositionLedger.loadActiveReservations({
        uid: play.uid,
        pid: play.id,
        strategyCategory: 'signal',
        positionSide: getSignalPositionSide(play.r_signalType),
    });

    return reservations.some((reservation) =>
        String(reservation?.reservationKind || '').toUpperCase().startsWith('MARKET_')
    );
};

const parseDatabaseUtcTime = (value) => {
    if(!value){
        return null;
    }

    if(value instanceof Date){
        const parsed = dayjs.utc(value);
        return parsed.isValid() ? parsed : null;
    }

    if(typeof value === 'string'){
        const normalized = value
            .trim()
            .replace('T', ' ')
            .replace(/\.\d+$/, '')
            .replace(/Z$/i, '');

        if(!normalized){
            return null;
        }

        const parsed = dayjs.utc(
            normalized,
            ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm'],
            true
        );

        return parsed.isValid() ? parsed : null;
    }

    const localLike = dayjs(value);
    if(!localLike.isValid()){
        return null;
    }

    const parsed = dayjs.utc(localLike.format('YYYY-MM-DD HH:mm:ss'), 'YYYY-MM-DD HH:mm:ss', true);
    return parsed.isValid() ? parsed : null;
};

const getTimeExpiryState = (play, now = dayjs.utc()) => {
    if(!isTimeExpiryExitEnabled(play) || !play?.r_exactTime){
        return { enabled: false, triggered: false, elapsedMinutes: 0, exactTime: null, now };
    }

    const exactTime = parseDatabaseUtcTime(play.r_exactTime);
    if(!exactTime){
        return { enabled: true, triggered: false, elapsedMinutes: 0, exactTime: null, now };
    }

    const elapsedMinutes = now.diff(exactTime, 'minute', true);
    const limitMinutes = Number(play.stopLossTimeValue || 0);

    return {
        enabled: true,
        triggered: elapsedMinutes >= limitMinutes,
        elapsedMinutes,
        limitMinutes,
        exactTime,
        now,
    };
};

const logPlayRuntimeEvent = (fun, code, play, message, options = {}) => {
    const snapshot = runtimeState.formatRuntimeSnapshot(play, options);
    const runtimeMessage = message
        ? `${message}, ${snapshot}`
        : snapshot;

    coin.msgAdd(
        fun,
        code,
        runtimeMessage,
        play?.uid,
        play?.id,
        play?.r_tid || null,
        play?.symbol || null,
        play?.r_signalType || null
    );
};

const logTimeExpiryDebug = (scope, play, timeExpiryState) => {
    if(!DEBUG_TIME_EXPIRY){
        return;
    }

    const exactTimeText = timeExpiryState?.exactTime
        ? timeExpiryState.exactTime.tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')
        : String(play?.r_exactTime || 'null');
    const nowText = timeExpiryState?.now
        ? timeExpiryState.now.tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')
        : dayjs().tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss');
    const debugMessage = [
        `scope:${scope}`,
        `pid:${play?.id}`,
        `status:${play?.status}`,
        `enabled:${String(timeExpiryState?.enabled)}`,
        `stopLossTimeEnabled:${String(play?.stopLossTimeEnabled)}`,
        `stopLossTimeValue:${String(play?.stopLossTimeValue)}`,
        `exactTimeKst:${exactTimeText}`,
        `nowKst:${nowText}`,
        `elapsed:${Number(timeExpiryState?.elapsedMinutes || 0).toFixed(6)}`,
        `limit:${Number(timeExpiryState?.limitMinutes || 0).toFixed(6)}`,
        `triggered:${String(timeExpiryState?.triggered)}`,
    ].join(', ');

    console.log(`[TIME_EXPIRY_DEBUG] ${debugMessage}`);
};

const setTestPlayReadyModeIfCurrent = async (play, expectedStatus) => {
    if(!play?.id || !expectedStatus){
        return false;
    }

    const controlState = runtimeState.getControlState(play);
    const latest = await loadTestPlaySnapshot(play.id, play);
    if(!latest || latest.status !== expectedStatus){
        return false;
    }

    await strategyControlState.applyPlayControlState({
        mode: 'TEST',
        pid: play.id,
        enabled: controlState === 'ON' ? 'Y' : 'N',
        status: 'READY',
        resetRuntime: true,
        audit: buildSignalSystemAuditPayload(
            latest,
            'SYSTEM_RESET_READY',
            `seon:set-test-ready-if-current:${expectedStatus}`,
            {
                expectedStatus,
            }
        ),
    });
    return true;
}

const loadTestPlaySnapshot = async (playId, fallback = null) => {
    if(!playId){
        return fallback;
    }

    try{
        const latest = await dbcon.DBOneCall(`CALL SP_TEST_PLAY_ST_NEW_GET(?)`, [playId]);
        return latest || fallback;
    }catch(error){
        return fallback;
    }
}

const loadLivePlaySnapshot = async (playId, fallback = null) => {
    if(!playId){
        return fallback;
    }

    try{
        const latest = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_NEW_GET(?)`, [playId]);
        return latest || fallback;
    }catch(error){
        return fallback;
    }
}

const getRunnableSignalPlayList = async (mode = 'LIVE') => {
    const normalizedMode = String(mode || 'LIVE').trim().toUpperCase() === 'TEST' ? 'TEST' : 'LIVE';
    const tableName = normalizedMode === 'TEST' ? 'test_play_list' : 'live_play_list';
    const [rows] = await db.query(
        `SELECT *
           FROM ${tableName}
          WHERE status IN ('EXACT_WAIT', 'EXACT')
             OR (enabled = 'Y' AND status = 'READY')
          ORDER BY
              CASE status
                  WHEN 'EXACT_WAIT' THEN 0
                  WHEN 'EXACT' THEN 1
                  ELSE 2
              END,
              id ASC`
    );

    return Array.isArray(rows) ? rows : [];
};

const getSignalEntryPendingStaleInfo = (play, now = dayjs.utc()) => {
    if(String(play?.status || '').trim().toUpperCase() !== 'EXACT_WAIT'){
        return {
            stale: false,
            ageSeconds: 0,
            signalTime: null,
            reason: null,
        };
    }

    const signalTime = parseDatabaseUtcTime(play?.r_signalTime);
    if(!signalTime){
        return {
            stale: true,
            ageSeconds: null,
            signalTime: null,
            reason: 'missing-signal-time',
        };
    }

    const ageSeconds = now.diff(signalTime, 'second', true);
    return {
        stale: ageSeconds >= SIGNAL_ENTRY_PENDING_STALE_SECONDS,
        ageSeconds,
        signalTime,
        reason: ageSeconds >= SIGNAL_ENTRY_PENDING_STALE_SECONDS
            ? 'dispatch-timeout'
            : null,
    };
};

const updateTestPlayStatusIfCurrent = async (playId, expectedStatus, nextStatus) => {
    if(!playId || !expectedStatus || !nextStatus){
        return false;
    }

    try{
        const result = await dbcon.DBOneCall(
            `CALL SP_TEST_PLAY_ST_EDIT_IF_STATUS(?,?,?)`,
            [playId, expectedStatus, nextStatus]
        );

        if(Number(result?.affectedRows || 0) > 0){
            return true;
        }
    }catch(error){
    }

    const latest = await loadTestPlaySnapshot(playId);
    if(!latest || latest.status !== expectedStatus){
        return false;
    }

    await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EDIT(?,?)`, [playId, nextStatus]);
    return true;
}

const updateLivePlayStatusIfCurrent = async (playId, expectedStatus, nextStatus) => {
    if(!playId || !expectedStatus || !nextStatus){
        return false;
    }

    try{
        const result = await dbcon.DBOneCall(
            `CALL SP_LIVE_PLAY_ST_EDIT_IF_STATUS(?,?,?)`,
            [playId, expectedStatus, nextStatus]
        );

        if(Number(result?.affectedRows || 0) > 0){
            return true;
        }
    }catch(error){
    }

    const latest = await loadLivePlaySnapshot(playId);
    if(!latest || latest.status !== expectedStatus){
        return false;
    }

    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EDIT(?,?)`, [playId, nextStatus]);
    return true;
}

const beginLivePlayExactWaitIfStatus = async (playId, signalPrice, signalType, expectedStatus = 'READY', tid = null) => {
    if(!playId || !signalType || !expectedStatus){
        return false;
    }

    const [result] = await db.query(
        `UPDATE live_play_list
            SET
                status = 'EXACT_WAIT',
                st = NULL,
                autoST = NULL,
                r_tid = ?,
                r_signalPrice = ?,
                r_signalType = ?,
                r_signalTime = NOW()
          WHERE id = ?
            AND status = ?
          LIMIT 1`,
        [
            tid,
            signalPrice,
            signalType,
            playId,
            expectedStatus,
        ]
    );

    return Number(result?.affectedRows || 0) > 0;
}

const beginTestPlayExactWaitIfStatus = async (playId, signalPrice, signalType, expectedStatus = 'READY', tid = null) => {
    if(!playId || !signalType || !expectedStatus){
        return false;
    }

    const [result] = await db.query(
        `UPDATE test_play_list
            SET
                status = 'EXACT_WAIT',
                st = NULL,
                autoST = NULL,
                r_tid = ?,
                r_signalPrice = ?,
                r_signalType = ?,
                r_signalTime = NOW()
          WHERE id = ?
            AND status = ?
          LIMIT 1`,
        [
            tid,
            signalPrice,
            signalType,
            playId,
            expectedStatus,
        ]
    );

    return Number(result?.affectedRows || 0) > 0;
}

const beginLivePlayExactIfStatus = async (playId, uid, exactPrice, tid = null, charge = 0, expectedStatus = 'EXACT_WAIT') => {
    if(!playId || !uid || exactPrice == null || !expectedStatus){
        return false;
    }

    const latest = await loadLivePlaySnapshot(playId);
    if(!latest || latest.status !== expectedStatus){
        return false;
    }

    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT(?,?,?,?,?)`, [
        playId,
        uid,
        exactPrice,
        tid,
        charge,
    ]);
    return true;
}

const beginTestPlayExactIfStatus = async (playId, uid, exactPrice, tid = null, charge = 0, qty = 0, expectedStatus = 'EXACT_WAIT') => {
    if(!playId || !uid || exactPrice == null || !expectedStatus){
        return false;
    }

    const latest = await loadTestPlaySnapshot(playId);
    if(!latest || latest.status !== expectedStatus){
        return false;
    }

    await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EXACT(?,?,?,?,?,?)`, [
        playId,
        uid,
        exactPrice,
        tid,
        charge,
        qty,
    ]);
    return true;
}

const persistTestBoundPrices = async (playId, profitPrice = 0, stopPrice = 0) => {
    if(!playId){
        return false;
    }

    await dbcon.DBCall(`UPDATE test_play_list SET r_profitPrice = ?, r_stopPrice = ? WHERE id = ?`, [
        Number(profitPrice || 0),
        Number(stopPrice || 0),
        playId,
    ]);

    return true;
}

const persistTestSplitRuntime = async (playId, values = {}) => {
    if(!playId || !values || typeof values !== 'object'){
        return false;
    }

    const allowedKeys = [
        'r_qty',
        'r_profitPrice',
        'r_stopPrice',
        'r_splitEntryQty',
        'r_splitStageIndex',
        'r_splitRealizedQty',
        'r_splitRealizedPnl',
        'r_splitRealizedCharge',
    ];
    const setClauses = [];
    const params = [];

    allowedKeys.forEach((key) => {
        if(Object.prototype.hasOwnProperty.call(values, key)){
            setClauses.push(`${key} = ?`);
            params.push(Number(values[key] || 0));
        }
    });

    if(!setClauses.length){
        return false;
    }

    params.push(playId);
    await dbcon.DBCall(`UPDATE test_play_list SET ${setClauses.join(', ')} WHERE id = ?`, params);
    return true;
}

const getTestSplitTakeProfitConfig = (play) => splitTakeProfit.parseSplitTakeProfitConfig(play);

const resolveTestSplitStageContext = (play, exactPrice = null) => {
    if(!play){
        return null;
    }

    const config = getTestSplitTakeProfitConfig(play);
    if(!config.enabled){
        return null;
    }

    const entryPrice = Number(exactPrice || play.r_exactPrice || 0);
    if(!(entryPrice > 0)){
        return null;
    }

    const stageCount = splitTakeProfit.getSplitTakeProfitStageCount(config);
    if(stageCount <= 0){
        return null;
    }

    const stageIndex = Math.min(stageCount - 1, Math.max(0, Number(play.r_splitStageIndex || 0)));
    const stage = splitTakeProfit.getSplitTakeProfitStage(config, stageIndex);
    if(!stage){
        return null;
    }

    const entryQty = Number(play.r_splitEntryQty || play.r_qty || 0);
    const remainingQty = Number(play.r_qty || 0);
    const isLastStage = stageIndex >= stageCount - 1;
    const profitPrice = splitTakeProfit.computeStagePrice(play.r_signalType, entryPrice, stage.tpPercent);
    const fallbackStopPrice = resolveTestBoundStopPrice(play, entryPrice);
    const stopPrice = stageIndex > 0
        ? splitTakeProfit.computeRatchetedStopPrice({
            signalType: play.r_signalType,
            entryPrice,
            stageTpPercent: stage.tpPercent,
            gapPercent: config.gapPercent,
            fallbackStopPrice,
        })
        : fallbackStopPrice;
    const stageQty = splitTakeProfit.resolveStageCloseQty({
        entryQty,
        remainingQty,
        stage,
        isLastStage,
        roundQty: (qty) => Number(Number(qty || 0).toFixed(10)),
        minQty: 0,
    });

    return {
        config,
        stageIndex,
        stage,
        stageCount,
        isLastStage,
        entryPrice,
        entryQty,
        remainingQty,
        stageQty,
        profitPrice: Number(profitPrice || 0),
        stopPrice: Number(stopPrice || 0),
    };
}

const resolveTestBoundProfitPrice = (play, entryPrice) => {
    if(!play || !Number(entryPrice)){
        return 0;
    }

    let rawPrice = 0;
    if(play.profitTradeType == 'abs'){
        rawPrice = Number(play.profitAbsValue || 0);
    }else if(Number(play.profit || 0) > 0){
        const profitRate = Number(play.profit || 0) * 0.01;
        rawPrice = play.r_signalType == 'BUY'
            ? Number(entryPrice) * (1 + profitRate)
            : Number(entryPrice) * (1 - profitRate);
    }

    return rawPrice > 0 ? Number(rawPrice.toFixed(10)) : 0;
}

const resolveTestBoundStopPrice = (play, entryPrice) => {
    if(!play || !Number(entryPrice)){
        return 0;
    }

    let rawPrice = 0;
    if(play.lossTradeType == 'abs'){
        rawPrice = Number(play.lossAbsValue || 0);
    }else if(hasConfiguredPercentStopLoss(play)){
        const stopRate = Number(play.stopLoss || 0) * 0.01;
        rawPrice = play.r_signalType == 'BUY'
            ? Number(entryPrice) * (1 - stopRate)
            : Number(entryPrice) * (1 + stopRate);
    }

    return rawPrice > 0 ? Number(rawPrice.toFixed(10)) : 0;
}

const syncTestBoundExitPrices = async (play, exactPrice = null) => {
    const entryPrice = Number(exactPrice || play?.r_exactPrice || 0);
    let profitPrice = resolveTestBoundProfitPrice(play, entryPrice);
    let stopPrice = resolveTestBoundStopPrice(play, entryPrice);
    let splitContext = null;

    if(splitTakeProfit.isSplitTakeProfitEnabled(play)){
        splitContext = resolveTestSplitStageContext(play, entryPrice);
        profitPrice = Number(splitContext?.profitPrice || 0);
        stopPrice = Number(splitContext?.stopPrice || 0);
        await persistTestSplitRuntime(play?.id, {
            r_profitPrice: profitPrice,
            r_stopPrice: stopPrice,
            r_splitEntryQty: Number(play?.r_splitEntryQty || splitContext?.entryQty || play?.r_qty || 0),
            r_splitStageIndex: Number(splitContext?.stageIndex || play?.r_splitStageIndex || 0),
        });
    }else{
        await persistTestBoundPrices(play?.id, profitPrice, stopPrice);
    }

    if(play){
        play.r_profitPrice = profitPrice;
        play.r_stopPrice = stopPrice;
        if(splitContext){
            play.r_splitEntryQty = Number(play.r_splitEntryQty || splitContext.entryQty || play.r_qty || 0);
            play.r_splitStageIndex = Number(splitContext.stageIndex || 0);
        }
    }

    return { profitPrice, stopPrice, splitContext };
}

const ensureTestBoundExitPrices = async (play) => {
    if(!play){
        return { profitPrice: 0, stopPrice: 0 };
    }

    const profitPrice = Number(play.r_profitPrice || 0);
    const stopPrice = Number(play.r_stopPrice || 0);
    if(profitPrice > 0 || stopPrice > 0){
        return { profitPrice, stopPrice };
    }

    return await syncTestBoundExitPrices(play, play.r_exactPrice);
}
const finalizeTestPlayCycle = async (play, endType) => {
    await setTestPlayReadyModeIfCurrent(play, play.status);
}

// exports.charge = 4300;
exports.charge = 0;
exports.marketST = true;

const runMain = async (st_ = false) => {
    if(!exports.marketST && !st_){
        return
    }

    if(runMainST){
        logRunMainStuck();
        return
    }

    runMainST = true
    const tickId = Number(runtimeLoopHealth.currentTickId || 0) + 1;
    markRunMainTickStart(tickId);

    let failedStages = 0;
    try{
        await sleep(300);
        if(!(await runMainStage('runPlayLive', () => runPlayLive(), {
            file: 'seon.js',
            function: 'runPlayLive',
            tickId,
        }))){
            failedStages += 1;
        }
        if(!(await runMainStage('gridEngine.runLive', () => gridEngine.runLive(), {
            file: 'grid-engine.js',
            function: 'runLive',
            tickId,
        }))){
            failedStages += 1;
        }

        // await sleep(300);
        // await runPrice();

        if(!(await runMainStage('runPlayTest', () => runPlayTest(), {
            file: 'seon.js',
            function: 'runPlayTest',
            tickId,
        }))){
            failedStages += 1;
        }
        if(!(await runMainStage('gridEngine.runTest', () => gridEngine.runTest(), {
            file: 'grid-engine.js',
            function: 'runTest',
            tickId,
        }))){
            failedStages += 1;
        }
        markRunMainTickComplete(tickId, {
            failedStages,
            status: failedStages > 0 ? 'PARTIAL_FAILURE' : 'OK',
        });
    }catch(error){
        failedStages += 1;
        logRunMainFailure('runMain', error, {
            file: 'seon.js',
            function: 'runMain',
            tickId,
        });
        markRunMainTickComplete(tickId, {
            failedStages,
            status: 'FAILED',
        });
    }finally{
        runMainST = false
    }
}

const runPlayLive = async (st_ = false) => {
    if(!exports.marketST && !st_){
        return
    }

    if(runST){
        return
    }

    runST = true

    try{
        const playList = await getRunnableSignalPlayList('LIVE');

        for(let i=0;i<playList.length;i++){
            let play = playList[i];

            if(!play){
                continue
            }

            const acquired = await withPlayRuntimeLock('live-loop', play.id, async () => {
                play = await loadLivePlaySnapshot(play.id, play);
                if(!play){
                    return;
                }

                if(play.status == 'READY'){
                    return;
                }

                const cPrice = dt.getPrice(play.symbol);
                if(!cPrice.st){
                    return;
                }

                if(play.status == 'EXACT_WAIT'){
                    const controlState = runtimeState.getControlState(play);
                    const staleInfo = getSignalEntryPendingStaleInfo(play);
                    if(controlState !== 'ON'){
                        logPlayRuntimeEvent(
                            'entryPendingResetLive',
                            'ENTRY_PENDING_DISABLED_RESET',
                            play,
                            `controlState:${controlState}`,
                            { exitReason: 'entry-fail', endType: 'MANUAL' }
                        );
                        await resetLivePlayToReady(play, ['EXACT_WAIT']);
                        return;
                    }

                    if(staleInfo.stale){
                        const signalTimeText = staleInfo.signalTime
                            ? staleInfo.signalTime.tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')
                            : 'null';
                        logPlayRuntimeEvent(
                            'entryPendingResetLive',
                            'ENTRY_PENDING_STALE_RESET',
                            play,
                            `reason:${staleInfo.reason}, ageSeconds:${staleInfo.ageSeconds == null ? 'null' : Number(staleInfo.ageSeconds).toFixed(3)}, signalTimeKst:${signalTimeText}`,
                            { exitReason: 'entry-fail', endType: 'MANUAL' }
                        );
                        await resetLivePlayToReady(play, ['EXACT_WAIT']);
                        return;
                    }

                    const newPrice = play.r_signalType == 'BUY' ? cPrice.bestBid : cPrice.bestAsk;
                    console.log(`[LIVE_ENTER_DISPATCH] pid:${play.id}, signalType:${play.r_signalType}, price:${newPrice}`);

                    const sendData = await coin.sendEnter(
                        play.symbol,
                        play.r_signalType,
                        play.leverage,
                        play.margin,
                        play.uid,
                        play.id,
                        play.limitST,
                        null
                    );

                    if(sendData && sendData.status){
                        await updateLivePlayStatusIfCurrent(play.id, 'EXACT_WAIT', 'EXACT');
                    }
                    return;
                }

                const pendingCloseReason = getPendingPlayCloseReason('Y', play.id);
                if(runtimeState.isLegacyOpenStatus(play.status) || pendingCloseReason){
                    const price = play.r_signalType == 'BUY' ? cPrice.bestBid : cPrice.bestAsk;
                    let endType = null;
                    let runtimeExitReason = null;
                    const legacyLivePriceExit = false;

                    if(play.r_exactPrice != null && Number(play.r_exactPrice) > 0){
                        let real_tick = 0;
                        if(play.r_signalType == 'BUY'){
                            real_tick = (((price - play.r_exactPrice) / play.r_exactPrice) * (play.leverage * play.margin)) - play.r_charge;
                        }else{
                            real_tick = (((play.r_exactPrice - price) / play.r_exactPrice) * (play.leverage * play.margin)) - play.r_charge;
                        }

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_TICK(?,?)`,[
                            play.id,
                            real_tick
                        ]);
                    }

                    if(pendingCloseReason){
                        runtimeExitReason = pendingCloseReason;
                        endType = pendingCloseReason === 'reverse-signal' ? 'STOP' : 'MANUAL';
                    }

                    const timeExpiryState = getTimeExpiryState(play);
                    logTimeExpiryDebug('live', play, timeExpiryState);
                    if(!endType && timeExpiryState.triggered){
                        endType = 'STOP';
                        runtimeExitReason = 'time-expire';
                    }

                    if(endType){
                        if(await hasActiveSignalMarketExitReservation(play)){
                            return;
                        }

                        console.log(
                            `[LIVE_CLOSE_DECISION] pid:${play.id}, status:${play.status}, endType:${endType}, reason:${runtimeExitReason || 'state-driven'}, signalType:${play.r_signalType}, price:${price}`
                        );

                        if(runtimeExitReason === 'time-expire'){
                            const exactTimeText = timeExpiryState.exactTime?.tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss') || String(play.r_exactTime);
                            logPlayRuntimeEvent(
                                'timeExpiryClose',
                                'TIME_EXPIRE',
                                play,
                                `minutes:${play.stopLossTimeValue}, elapsed:${Number(timeExpiryState.elapsedMinutes || 0).toFixed(3)}, exactTimeKst:${exactTimeText}, nowKst:${timeExpiryState.now.tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')}, price:${price}`,
                                { exitReason: runtimeExitReason, endType }
                            );
                        }

                        logPlayRuntimeEvent(
                            'closeDispatchLive',
                            'CLOSE_DISPATCH',
                            play,
                            `legacyLivePriceExit:${legacyLivePriceExit}, price:${price}`,
                            { exitReason: runtimeExitReason, endType }
                        );

                        const closeOrderType = runtimeState.getCloseOrderType(runtimeExitReason);

                        const sendData = await coin.sendForcing(
                            closeOrderType,
                            play.symbol,
                            play.r_signalType,
                            play.r_qty,
                            play.uid,
                            play.id,
                            play.r_tid,
                            play.limitST,
                        );

                        if(!sendData || !sendData.status){
                            // Keep EXACT state and pending close reason for the next retry cycle.
                        }else{
                            clearPendingPlayCloseReason('Y', play.id);
                        }
                    }
                }
            });

            if(!acquired){
                continue;
            }
        }

    }catch(e){
        console.log('runPlayLive ERROR :: ', e);
    }

    runST = false
}

const runPlayTest = async (st_ = false) => {

    if(runTestST){
        return
    }

    runTestST = true

    try{
        const playList = await getRunnableSignalPlayList('TEST');
        for(let i=0;i<playList.length;i++){
            let play = playList[i];

            if(!play){
                continue
            }

            const acquired = await withPlayRuntimeLock('test-loop', play.id, async () => {
                play = await loadTestPlaySnapshot(play.id, play);
                if(!play){
                    return;
                }

                if(play.status == 'READY'){
                    return;
                }

                const cPrice = dt.getPrice(play.symbol);
                if(!cPrice.st){
                    return;
                }

                if(play.status == 'EXACT_WAIT'){
                    const controlState = runtimeState.getControlState(play);
                    const staleInfo = getSignalEntryPendingStaleInfo(play);
                    if(controlState !== 'ON'){
                        logPlayRuntimeEvent(
                            'entryPendingResetTest',
                            'ENTRY_PENDING_DISABLED_RESET',
                            play,
                            `controlState:${controlState}`,
                            { exitReason: 'entry-fail', endType: 'MANUAL' }
                        );
                        await setTestPlayReadyModeIfCurrent(play, 'EXACT_WAIT');
                        return;
                    }

                    if(staleInfo.stale){
                        const signalTimeText = staleInfo.signalTime
                            ? staleInfo.signalTime.tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')
                            : 'null';
                        logPlayRuntimeEvent(
                            'entryPendingResetTest',
                            'ENTRY_PENDING_STALE_RESET',
                            play,
                            `reason:${staleInfo.reason}, ageSeconds:${staleInfo.ageSeconds == null ? 'null' : Number(staleInfo.ageSeconds).toFixed(3)}, signalTimeKst:${signalTimeText}`,
                            { exitReason: 'entry-fail', endType: 'MANUAL' }
                        );
                        await setTestPlayReadyModeIfCurrent(play, 'EXACT_WAIT');
                        return;
                    }

                    const newPrice = play.r_signalType == 'BUY' ? cPrice.bestAsk : cPrice.bestBid;
                    const positionSize = play.leverage * play.margin;
                    const qty = positionSize / newPrice;
                    const movedToExact = await beginTestPlayExactIfStatus(play.id, play.uid, newPrice, null, 0, qty, 'EXACT_WAIT');
                    if(movedToExact){
                        play.status = 'EXACT';
                        play.r_exactPrice = newPrice;
                        play.r_qty = qty;
                        if(splitTakeProfit.isSplitTakeProfitEnabled(play)){
                            await persistTestSplitRuntime(play.id, {
                                r_splitEntryQty: qty,
                                r_splitStageIndex: 0,
                                r_splitRealizedQty: 0,
                                r_splitRealizedPnl: 0,
                                r_splitRealizedCharge: 0,
                            });
                            play.r_splitEntryQty = qty;
                            play.r_splitStageIndex = 0;
                            play.r_splitRealizedQty = 0;
                            play.r_splitRealizedPnl = 0;
                            play.r_splitRealizedCharge = 0;
                        }
                        await syncTestBoundExitPrices(play, newPrice);
                    }
                    return;
                }

                const pendingCloseReason = getPendingPlayCloseReason('N', play.id);
                if(runtimeState.isLegacyOpenStatus(play.status) || pendingCloseReason){
                    const price = play.r_signalType == 'BUY' ? cPrice.bestBid : cPrice.bestAsk;
                    let endType = null;
                    let runtimeExitReason = null;
                    let real_tick = 0;

                    if(play.r_exactPrice != null && Number(play.r_exactPrice) > 0){
                        if(play.r_signalType == 'BUY'){
                            real_tick = (((price - play.r_exactPrice) / play.r_exactPrice) * (play.leverage * play.margin));
                        }else{
                            real_tick = (((play.r_exactPrice - price) / play.r_exactPrice) * (play.leverage * play.margin));
                        }

                        await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_TICK(?,?)`,[
                            play.id,
                            real_tick
                        ]);
                    }

                    const boundExit = await ensureTestBoundExitPrices(play);
                    const profitPrice = Number(boundExit?.profitPrice || 0);
                    const stopPrice = Number(boundExit?.stopPrice || 0);
                    const splitContext = boundExit?.splitContext || (splitTakeProfit.isSplitTakeProfitEnabled(play)
                        ? resolveTestSplitStageContext(play, play.r_exactPrice)
                        : null);

                    if(pendingCloseReason){
                        runtimeExitReason = pendingCloseReason;
                        endType = pendingCloseReason === 'reverse-signal' ? 'STOP' : 'MANUAL';
                    }

                    if(!endType && profitPrice > 0 && exports.ckProfit2(profitPrice, play.r_exactPrice, price, play.r_signalType)){
                        if(splitContext?.stage && !splitContext.isLastStage){
                            const stageQty = Number(splitContext.stageQty || 0);
                            if(stageQty > 0){
                                const stagePnl = play.r_signalType == 'BUY'
                                    ? (price - play.r_exactPrice) * stageQty
                                    : (play.r_exactPrice - price) * stageQty;
                                const nextRemainingQty = Math.max(0, Number(play.r_qty || 0) - stageQty);
                                const nextStageIndex = Number(splitContext.stageIndex || 0) + 1;
                                const nextRealizedQty = Number(play.r_splitRealizedQty || 0) + stageQty;
                                const nextRealizedPnl = Number(play.r_splitRealizedPnl || 0) + stagePnl;
                                const nextRealizedCharge = Number(play.r_splitRealizedCharge || 0);

                                await persistTestSplitRuntime(play.id, {
                                    r_qty: nextRemainingQty,
                                    r_splitEntryQty: Number(play.r_splitEntryQty || splitContext.entryQty || play.r_qty || 0),
                                    r_splitStageIndex: nextStageIndex,
                                    r_splitRealizedQty: nextRealizedQty,
                                    r_splitRealizedPnl: nextRealizedPnl,
                                    r_splitRealizedCharge: nextRealizedCharge,
                                    r_profitPrice: 0,
                                    r_stopPrice: 0,
                                });

                                play.r_qty = nextRemainingQty;
                                play.r_splitEntryQty = Number(play.r_splitEntryQty || splitContext.entryQty || play.r_qty || 0);
                                play.r_splitStageIndex = nextStageIndex;
                                play.r_splitRealizedQty = nextRealizedQty;
                                play.r_splitRealizedPnl = nextRealizedPnl;
                                play.r_splitRealizedCharge = nextRealizedCharge;
                                play.r_profitPrice = 0;
                                play.r_stopPrice = 0;

                                await syncTestBoundExitPrices(play, play.r_exactPrice);
                                logPlayRuntimeEvent(
                                    'splitTpStageFilledTest',
                                    'SPLITTP_STAGE_FILLED',
                                    play,
                                    `stageIndex:${splitContext.stageIndex}, stageQty:${stageQty}, remainingQty:${nextRemainingQty}, triggerPrice:${profitPrice}, fillPrice:${price}`,
                                    { exitReason: 'split-take-profit-stage', endType: 'PROFIT' }
                                );
                                return;
                            }
                        }

                        endType = 'PROFIT';
                        runtimeExitReason = 'bound-profit';
                    }

                    if(!endType && stopPrice > 0 && exports.ckStop2(stopPrice, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'STOP';
                        runtimeExitReason = 'bound-stop';
                    }

                    const timeExpiryState = getTimeExpiryState(play);
                    logTimeExpiryDebug('test', play, timeExpiryState);
                    if(!endType && timeExpiryState.triggered){
                        endType = 'STOP';
                        runtimeExitReason = 'time-expire';
                    }

                    if(endType){
                        if(runtimeExitReason === 'time-expire'){
                            const exactTimeText = timeExpiryState.exactTime?.tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss') || String(play.r_exactTime);
                            logPlayRuntimeEvent(
                                'timeExpiryCloseTest',
                                'TIME_EXPIRE',
                                play,
                                `minutes:${play.stopLossTimeValue}, elapsed:${Number(timeExpiryState.elapsedMinutes || 0).toFixed(3)}, exactTimeKst:${exactTimeText}, nowKst:${timeExpiryState.now.tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')}, price:${price}`,
                                { exitReason: runtimeExitReason, endType }
                            );
                        }

                        logPlayRuntimeEvent(
                            'closeDispatchTest',
                            'CLOSE_DISPATCH',
                            play,
                            `profitPrice:${profitPrice}, stopPrice:${stopPrice}, price:${price}`,
                            { exitReason: runtimeExitReason, endType }
                        );
                        const closeTime = new Date();

                        let pol_price = 0;
                        if(play.r_signalType == 'BUY'){
                            pol_price = (price - play.r_exactPrice) * play.r_qty
                        }else{
                            pol_price = (play.r_exactPrice - price) * play.r_qty
                        }
                        const accumulatedPnl = Number(play.r_splitRealizedPnl || 0);
                        const accumulatedCharge = Number(play.r_splitRealizedCharge || 0);
                        const totalPnl = pol_price + accumulatedPnl;
                        const totalTick = real_tick + accumulatedPnl;

                        const positionSize = play.leverage * play.margin;

                        const exitReasonCode = runtimeState.getExitReasonCode(runtimeExitReason || (endType === 'PROFIT' ? 'bound-profit' : 'bound-stop'));
                        const exitMode = runtimeState.getExitMode(runtimeExitReason || (endType === 'PROFIT' ? 'bound-profit' : 'bound-stop'), endType);
                        await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
                            play.uid,
                            play.id,
                            null,
                            null,
                            endType,

                            play.symbol,
                            play.leverage,
                            play.margin,
                            positionSize,

                            play.type,
                            play.bunbong,

                            play.r_signalType,
                            play.r_signalPrice,
                            play.r_signalTime,

                            play.r_exactPrice,
                            price,

                            totalPnl,
                            totalTick,
                            totalPnl > 0 ? true : false,
                            totalPnl < 0 ? true : false,

                            accumulatedCharge,
                            play.r_exactTime,
                            closeTime,
                            exitReasonCode,
                            exitMode,
                        ]);

                        await finalizeTestPlayCycle(play, endType);
                        clearPendingPlayCloseReason('N', play.id);
                    }
                }
            });

            if(!acquired){
                continue;
            }
        }

    }catch(e){
        console.log('runPlayTest ERROR :: ', e);
    }

    runTestST = false
}

// runPrice();
exports.ckCancel = (cancel, oldPrice, curPrice, side) => {
    const enterPrice = cancel * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);
    if(side == 'BUY'){
        if(oldPrice + enterPrice <= curPrice){
            return true;
        }
    }else if(side == 'SELL'){
        if(curPrice <= oldPrice - enterPrice){
            // console.log(`SELL :: ${oldPrice + enterPrice}, ${curPrice} 痍⑥냼`)
            return true;
        }
    }

    return false;
}

exports.ckProfit = (profit, oldPrice, curPrice, side) => {
    const enterPrice = profit * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);

    // console.log('-----------------------------------------------');
    // console.log(`?꾩옱媛? ${curPrice} 吏꾩엯湲덉븸:${oldPrice}, 議곌굔??${profit} ??${oldPrice+enterPrice}`);
    // console.log('-----------------------------------------------');

    if(side == 'BUY'){
        if(oldPrice + enterPrice <= curPrice){
            // console.log(`BUY :: ${oldPrice + enterPrice}, ${curPrice} ?듭젅`)
            return true;
        }
    }else if(side == 'SELL'){
        if(curPrice <= oldPrice - enterPrice){
            // console.log(`SELL :: ${oldPrice - enterPrice}, ${curPrice} ?듭젅`)
            return true;
        }
    }

    return false;
}

exports.ckProfit2 = (profit, oldPrice, curPrice, side) => {
    // const enterPrice = profit * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);

    // console.log('-----------------------------------------------');
    // console.log(`?꾩옱媛? ${curPrice} 吏꾩엯湲덉븸:${oldPrice}, 議곌굔??${profit} ??${oldPrice+enterPrice}`);
    // console.log('-----------------------------------------------');

    if(side == 'BUY'){
        if(profit <= curPrice){
            // console.log(`BUY :: ${oldPrice + enterPrice}, ${curPrice} ?듭젅`)
            return true;
        }
    }else if(side == 'SELL'){
        if(curPrice <= profit){
            // console.log(`SELL :: ${oldPrice - enterPrice}, ${curPrice} ?듭젅`)
            return true;
        }
    }

    return false;
}

exports.ckStop = (stopLoss, oldPrice, curPrice, side) => {
    const enterPrice = stopLoss * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);

    // console.log('-----------------------------------------------');
    // console.log(`?먯젅 ${side} 吏꾩엯湲덉븸:${oldPrice}, 議곌굔??${stopLoss} ??${oldPrice+enterPrice}`);
    // console.log('-----------------------------------------------');

    if(side == 'BUY'){
        if(curPrice <= oldPrice - enterPrice){
            // console.log(`BUY :: ${oldPrice - enterPrice}, ${curPrice} ?먯젅`)
            return true;
        }
    }else if(side == 'SELL'){
        if(oldPrice + enterPrice <= curPrice){
            // console.log(`SELL :: ${oldPrice + enterPrice}, ${curPrice} ?먯젅`)
            return true;
        }
    }

    return false;
}

exports.ckStop2 = (stopLoss, oldPrice, curPrice, side) => {
    // const enterPrice = stopLoss * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);

    // console.log('-----------------------------------------------');
    // console.log(`?먯젅 ${side} 吏꾩엯湲덉븸:${oldPrice}, 議곌굔??${stopLoss} ??${oldPrice+enterPrice}`);
    // console.log('-----------------------------------------------');

    if(side == 'BUY'){
        if(curPrice <= stopLoss){
            // console.log(`BUY :: ${oldPrice - enterPrice}, ${curPrice} ?먯젅`)
            return true;
        }
    }else if(side == 'SELL'){
        if(stopLoss <= curPrice){
            // console.log(`SELL :: ${oldPrice + enterPrice}, ${curPrice} ?먯젅`)
            return true;
        }
    }

    return false;
}

exports.ckExStop = (stopLoss, oldPrice, curPrice, side) => {
    const enterPrice = stopLoss * oldPrice * 0.01

    if(side == 'BUY'){
        if(curPrice <= oldPrice + enterPrice){
            // console.log(`${stopLoss} :: ${curPrice} <= ${oldPrice+enterPrice} ------- ${bb} ${aa}`);
            return true;
        }
    }else if(side == 'SELL'){
        if(oldPrice - enterPrice <= curPrice){
            // console.log(`${stopLoss} :: ${curPrice} >= ${oldPrice+enterPrice} ------- ${bb} ${aa}`);
            return true;
        }
    }

    return false;
}

exports.resultPrice = (oldPrice, curPrice, side) => {
    const ustToKr = 1440    //?섏쑉
    const result = {
        pol_tick:0,
        pol_sum:0,
    }

    if(side == 'BUY'){
        result.pol_tick = curPrice - oldPrice
        // result.pol_sum = (result.pol_tick * 5 * ustToKr) 
        result.pol_sum = result.pol_tick
    }else if(side == 'SELL'){
        result.pol_tick = oldPrice - curPrice
        // result.pol_sum = (result.pol_tick * 5 * ustToKr)
        result.pol_sum = result.pol_tick
    }

    return result
}

exports.randomString = function(length){
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

exports.enterCoin = async function(reqData){
    try{
        let side = null;
        const summary = {
            ok: false,
            reason: null,
            signalType: null,
            matchedCount: 0,
            enteredCount: 0,
            reverseCloseCount: 0,
            reverseCancelCount: 0,
            ignoredNotReadyCount: 0,
            ignoredSignalMismatchCount: 0,
            lockSkippedCount: 0,
            entryRejectedCount: 0,
            targetItems: [],
        };
        const normalizedType = String(reqData?.type || '').trim().toUpperCase();
        const appendReverseEventLog = async (play, actionLabel, nextSt, nextStatus, signalPrice = null) => {
            if(play?.live_ST !== 'Y'){
                return;
            }

            const currentControlState = runtimeState.getControlState(play) === 'ON' ? 'START' : 'STOP';

            await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                play.uid,
                play.id,
                play.r_tid || null,
                null,
                actionLabel,
                currentControlState,
                nextSt,
                play.status,
                nextStatus,
                play.r_signalType,
                signalPrice,
                null,
            ]);
        };
        if(normalizedType == 'GOLD' || normalizedType == 'BUY' || normalizedType == 'LONG'){
            side = 'BUY'
        }else if(normalizedType == 'DEAD' || normalizedType == 'SELL' || normalizedType == 'SHORT'){
            side = 'SELL'
        }else{
            console.log(`[hook] unsupported signal type ignored type=${reqData?.type}`);
            summary.reason = 'unsupported-signal-type';
            return summary;
        }
        summary.signalType = side;

        let cPrice = dt.getPrice(reqData.symbol);

        if(!cPrice.st){
            cPrice = await coin.ensurePublicMarketPrice(reqData.symbol);
        }

        if(!cPrice.st){
            summary.reason = 'price-unavailable';
            return summary;
        }

        const itemList = await loadSignalTargets(reqData, side);
        summary.matchedCount = itemList.length;

        for(let i=0;i<itemList.length;i++){
            try{
                const signalPrice = side == "BUY" ? cPrice.bestBid : cPrice.bestAsk;
                const tgData = itemList[i];
                const targetBase = {
                    uid: tgData.uid,
                    pid: tgData.id,
                    strategyCategory: 'signal',
                    strategyMode: tgData.live_ST == 'Y' ? 'live' : 'test',
                    strategyName: tgData.a_name || null,
                    strategyUuid: tgData.uuid || reqData.uuid || null,
                    symbol: tgData.symbol || reqData.symbol || null,
                    bunbong: tgData.bunbong || reqData.bunbong || null,
                    legacyStatus: tgData.status || null,
                    controlState: runtimeState.getControlState(tgData),
                    autoST: null,
                    incomingSignalType: side,
                    runtimeSignalType: tgData.r_signalType || null,
                    note: null,
                };
                const pushTargetItem = (resultCode, note = null, extra = {}) => {
                    summary.targetItems.push({
                        ...targetBase,
                        resultCode,
                        note,
                        ...extra,
                    });
                };
                const handled = await withPlayRuntimeLock(tgData.live_ST == 'Y' ? 'live-enter' : 'test-enter', tgData.id, async () => {
                    const currentSignalType = String(tgData.r_signalType || '').trim().toUpperCase();
                    const isReverseSignal = currentSignalType && currentSignalType !== side;

                    if(tgData.status === 'EXACT_WAIT' && isReverseSignal && isReverseSignalExitEnabled(tgData)){
                        if(tgData.live_ST == 'Y'){
                            await resetLivePlayToReady(tgData, ['EXACT_WAIT']);
                            await appendReverseEventLog(
                                tgData,
                                'reverse_signal_cancel',
                                runtimeState.getControlState(tgData) === 'ON' ? 'START' : 'STOP',
                                'READY',
                                signalPrice
                            );
                        }else{
                            await setTestPlayReadyModeIfCurrent(tgData, 'EXACT_WAIT');
                        }
                        summary.reverseCancelCount += 1;
                        pushTargetItem('REVERSE_SIGNAL_CANCEL', 'entry-pending canceled by reverse signal');
                        return;
                    }

                    if(tgData.status === 'EXACT' && isReverseSignal && isReverseSignalExitEnabled(tgData)){
                        if(tgData.live_ST == 'Y'){
                            console.log(
                                `[LIVE_REVERSE_SIGNAL] pid:${tgData.id}, currentSignal:${currentSignalType}, incomingSignal:${side}, price:${signalPrice}`
                            );
                            setPendingPlayCloseReason('Y', tgData.id, 'reverse-signal');
                            await appendReverseEventLog(
                                tgData,
                                'reverse_signal_close',
                                runtimeState.getControlState(tgData) === 'ON' ? 'START' : 'STOP',
                                'EXACT',
                                signalPrice
                            );
                            summary.reverseCloseCount += 1;
                        }else{
                            setPendingPlayCloseReason('N', tgData.id, 'reverse-signal');
                            summary.reverseCloseCount += 1;
                        }
                        pushTargetItem('REVERSE_SIGNAL_CLOSE', 'open position scheduled for reverse-signal close');
                        return;
                    }

                    if(tgData.status !== 'READY'){
                        summary.ignoredNotReadyCount += 1;
                        pushTargetItem('RUNTIME_NOT_READY', `legacyStatus:${tgData.status}`);
                        return;
                    }

                    let tgSide = null;
                    if(side == 'BUY' && tgData.signalType == 'BUY'){
                        tgSide = 'BUY';
                    }else if(side == 'SELL' && tgData.signalType == 'SELL'){
                        tgSide = 'SELL';
                    }else{
                        summary.ignoredSignalMismatchCount += 1;
                        pushTargetItem('SIGNAL_TYPE_MISMATCH', `playSignalType:${tgData.signalType}`);
                        return;
                    }
                    if(tgData.live_ST == 'Y'){
                        const movedToExactWait = await beginLivePlayExactWaitIfStatus(
                            tgData.id,
                            signalPrice,
                            tgSide,
                            'READY',
                            null
                        );
                        if(!movedToExactWait){
                            summary.entryRejectedCount += 1;
                            pushTargetItem('ENTRY_REJECTED', 'failed to move READY -> EXACT_WAIT');
                            return;
                        }
                        summary.enteredCount += 1;
                        pushTargetItem('ENTERED_PENDING', `signalPrice:${signalPrice}`, {
                            processedSignalType: tgSide,
                        });
                    }else{
                        const movedToExactWait = await beginTestPlayExactWaitIfStatus(
                            tgData.id,
                            signalPrice,
                            tgSide,
                            'READY',
                            null
                        );
                        if(!movedToExactWait){
                            summary.entryRejectedCount += 1;
                            pushTargetItem('ENTRY_REJECTED', 'failed to move READY -> EXACT_WAIT');
                            return;
                        }
                        summary.enteredCount += 1;
                        pushTargetItem('ENTERED_PENDING', `signalPrice:${signalPrice}`, {
                            processedSignalType: tgSide,
                        });
                    }
                });

                if(!handled){
                    summary.lockSkippedCount += 1;
                    pushTargetItem('LOCK_SKIPPED', 'runtime lock was already held');
                    continue;
                }

            }catch(e){
                console.log('runEnter ERROR :: ', e);
            }
            
        }
        
        summary.ok = true;
        summary.reason = summary.matchedCount > 0 ? 'processed' : 'no-matching-strategy';
        return summary;
    }catch(e){
        console.log('!!!',e);
        return {
            ok: false,
            reason: 'runtime-error',
            signalType: null,
            matchedCount: 0,
            enteredCount: 0,
            reverseCloseCount: 0,
            reverseCancelCount: 0,
            ignoredNotReadyCount: 0,
            ignoredSignalMismatchCount: 0,
            lockSkippedCount: 0,
            entryRejectedCount: 0,
        };
    }
};

exports.startRuntime = async (options = {}) => {
    const enabled = options.enabled !== false;
    const ownerLabel = String(options.ownerLabel || process.env.PORT || 'unknown');

    if(!enabled){
        console.log(`[SEON_RUNTIME] skipped owner:${ownerLabel}`);
        return {
            started: false,
            skipped: true,
            ownerLabel,
        };
    }

    if(runtimeStartPromise){
        return runtimeStartPromise;
    }

    runtimeStartPromise = (async () => {
        if(runtimeStarted){
            return {
                started: true,
                reused: true,
                ownerLabel,
            };
        }

        console.log(`[SEON_RUNTIME] start owner:${ownerLabel}`);
        runtimeLoopHealth.runtimeStartedAt = new Date().toISOString();
        runtimeLoopHealth.runtimeOwnerLabel = ownerLabel;
        logRunMainState('RUNTIME_START', {
            file: 'seon.js',
            function: 'startRuntime',
            ownerLabel,
            runtimeStartedAt: runtimeLoopHealth.runtimeStartedAt,
        }, { force: true });

        const bootGate = await runBootSafetyGate(ownerLabel);
        runtimeLoopHealth.bootSafetyGate = bootGate;
        if(!bootGate.ok){
            logRunMainState('BOOT_SAFETY_GATE_BLOCKED', {
                file: 'seon.js',
                function: 'startRuntime',
                ownerLabel,
                bootGate,
                action: 'runtime-loop-not-started',
            }, { force: true });
            runtimeStartPromise = null;
            return {
                started: false,
                blocked: true,
                ownerLabel,
                reason: 'BOOT_SAFETY_GATE_BLOCKED',
                bootGate,
            };
        }

        await coin.init({
            enablePublicFeeds: true,
            enableUserStreams: true,
            enableAccountPolling: true,
            enableSocket: true,
            enableCandleSchedules: true,
        });

        if(!runMainTimer){
            runMainTimer = setInterval(runMain, 1 * 300);
        }

        runtimeStarted = true;
        return {
            started: true,
            ownerLabel,
        };
    })();

    try{
        return await runtimeStartPromise;
    }catch(error){
        runtimeStartPromise = null;
        throw error;
    }
};

exports.getRuntimeLoopHealth = () => ({
    ...runtimeLoopHealth,
    runMainST,
});

exports.runBootSafetyGateForQa = runBootSafetyGate;

exports.normalizeSignalStrategyType = normalizeSignalStrategyType;
