const WebSocket = require('ws');
const axios = require('axios');
const dbcon = require("./dbcon");
const db = require("./database/connect/config");
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const dt = require("./data");
const runtimeState = require("./runtime-state");
const splitTakeProfit = require("./split-take-profit");
const positionOwnership = require("./position-ownership");
const pidPositionLedger = require("./pid-position-ledger");
const { getExchangeSymbolRuleSummary } = require("./admin-management");
const { insertBinanceRuntimeEventLog } = require("./binance-runtime-event-log");
const strategyControlState = require("./strategy-control-state");
const binanceWriteGuard = require("./binance-write-guard");
const binanceReadGuard = require("./binance-read-guard");
const credentialSecrets = require("./credential-secrets");
let gridEngine = null;
let policyEngine = null;
const Binance = require('node-binance-api');
const schedule = require("node-schedule");
const crypto = require("crypto");

require('dayjs/locale/ko');
dayjs.locale('ko');
dayjs.extend(utc);
dayjs.extend(timezone);

var exports = module.exports = {};

let APP_KEY = process.env.COIN_KEY;
let APP_SECRET = process.env.COIN_SECRET;

const TEST_MODE = false;

let ACCESS_TOKEN = '';
let binance = {};
const initializingBinanceClients = new Set();
const binanceInitRetryAt = {};
const binanceClientRuntime = {};
const binanceRuntimeMeta = {};
const recentOrderRuntimeEvents = new Map();
const liveBoundSyncLocks = new Map();
const signalOrderRuntimeLocks = new Map();
const recentBoundRegistrationTargets = new Map();
const completedBoundRegistrationEntries = new Map();
const liveSplitTradeAccumulators = new Map();
const accountRiskSnapshotCache = {};
let futuresServerTimeOffsetMs = 0;
let futuresServerTimeSyncedAt = 0;
const DEBUG_RUNTIME_TRACE = process.env.DEBUG_TIME_EXPIRY === '1' || process.env.DEBUG_RUNTIME_TRACE === '1';
const isQaReplayMode = binanceWriteGuard.isQaReplayMode;

let io = null;
const FUTURES_BASE_URL = 'https://fapi.binance.com';
const REST_ONLY_RUNTIME_STATUS = 'REST_READY';
const isRuntimeOwnerProcess = () => String(process.env.PORT || '') === String(process.env.RUNTIME_OWNER_PORT || '3000');
const EXCLUDED_RUNTIME_UIDS = new Set(
    String(process.env.RUNTIME_EXCLUDED_UIDS || '146')
        .split(',')
        .map((value) => Number(String(value || '').trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
);
const isExcludedRuntimeUid = (uid) => EXCLUDED_RUNTIME_UIDS.has(Number(uid || 0));

const markBinanceRuntimeExcluded = (uid) => {
    updateBinanceRuntimeMeta(uid, {
        connected: false,
        status: 'EXCLUDED',
        retryAt: null,
        disabledUntil: null,
        listenKey: null,
        lastErrorCode: null,
        lastErrorMessage: 'runtime excluded',
    });
};

const ensureBinanceRuntimeMeta = (uid) => {
    if(!uid){
        return null;
    }

    if(!binanceRuntimeMeta[uid]){
        binanceRuntimeMeta[uid] = {
            uid,
            status: 'DISCONNECTED',
            connected: false,
            disabledUntil: null,
            retryAt: null,
            lastInitAt: null,
            lastReadyAt: null,
            lastMessageAt: null,
            lastKeepAliveAt: null,
            lastCloseAt: null,
            lastErrorAt: null,
            lastAlgoUpdateAt: null,
            lastConditionalRejectAt: null,
            lastAccountRiskAt: null,
            lastRiskSnapshotAt: null,
            lastRiskLevel: null,
            lastHedgeMode: null,
            lastAccountMarginRatio: null,
            lastAccountEquity: null,
            lastAccountMaintMargin: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            listenKey: null,
            updatedAt: null,
        };
    }

    return binanceRuntimeMeta[uid];
}

const createBinanceApiClient = (appKey, appSecret) => new Binance().options({
    APIKEY: appKey,
    APISECRET: credentialSecrets.revealSecret(appSecret),
    useServerTime: true,
    recvWindow: 60000,
    test: TEST_MODE,
    futures: true,
    hedgeMode: true,
});

const isQaTempMarker = (value) => String(value || '').trim().toUpperCase().startsWith('QA_');
const isQaReplayMockBinanceClient = (uid) => Boolean(binance?.[uid]?.__qaMockBinanceClient);

const loadLiveGridWriteGuardRow = async (uid, pid) => {
    if(!uid || !pid){
        return null;
    }

    try{
        const [rows] = await db.query(
            `SELECT id, uid, a_name, symbol, enabled, regimeStatus
               FROM live_grid_strategy_list
              WHERE uid = ?
                AND id = ?
              LIMIT 1`,
            [uid, pid]
        );
        return rows?.[0] || null;
    }catch(error){
        return null;
    }
};

const shouldBlockGridCloseBinanceWrite = async ({ uid, pid, symbol } = {}) => {
    const allowQaMockClient = isQaReplayMode() && isQaReplayMockBinanceClient(uid);
    if(isQaReplayMode() && !allowQaMockClient){
        return {
            blocked: true,
            reason: 'QA_REPLAY_MODE_BINANCE_WRITE_BLOCKED',
            row: null,
        };
    }

    const row = await loadLiveGridWriteGuardRow(uid, pid);
    if(!allowQaMockClient && row && (isQaTempMarker(row.a_name) || isQaTempMarker(row.symbol))){
        return {
            blocked: true,
            reason: 'QA_TEMP_STRATEGY_BINANCE_WRITE_BLOCKED',
            row,
        };
    }

    if(!allowQaMockClient && isQaTempMarker(symbol)){
        return {
            blocked: true,
            reason: 'QA_SYMBOL_BINANCE_WRITE_BLOCKED',
            row,
        };
    }

    return { blocked: false, reason: null, row };
};

const logBlockedGridCloseBinanceWrite = async ({ uid, pid, symbol, leg, qty, reason, row } = {}) => {
    const note = `blocked grid market close before Binance write: ${reason}`;
    console.log(`[BINANCE_WRITE_BLOCKED] ${note}`, {
        uid,
        pid,
        symbol,
        leg,
        qty,
        strategyName: row?.a_name || null,
    });

    if(isQaReplayMode()){
        return null;
    }

    return await insertBinanceRuntimeEventLog({
        uid,
        pid,
        strategyCategory: 'grid',
        eventType: 'BINANCE_WRITE_BLOCKED',
        eventCode: reason || 'GRID_MARKET_CLOSE_BLOCKED',
        severity: 'critical',
        symbol,
        side: leg === 'LONG' ? 'SELL' : leg === 'SHORT' ? 'BUY' : null,
        positionSide: leg || null,
        quantity: qty,
        note,
        payload: {
            callsite: 'coin.closeGridLegMarketOrder',
            qaReplayMode: isQaReplayMode(),
            strategyName: row?.a_name || null,
            strategySymbol: row?.symbol || null,
            enabled: row?.enabled || null,
            regimeStatus: row?.regimeStatus || null,
        },
    });
};

const logBlockedBinanceWrite = async ({ error, context = {} } = {}) => {
    const guardContext = error?.guardContext || context || {};
    const reason = error?.guardReason || error?.guardDecision?.reason || 'BINANCE_WRITE_BLOCKED_BY_GUARD';
    const note = `blocked Binance write before exchange call: ${reason}`;
    console.log(`[BINANCE_WRITE_BLOCKED_BY_GUARD] ${note}`, guardContext);

    if(isQaReplayMode()){
        return null;
    }

    try{
        return await insertBinanceRuntimeEventLog({
            uid: guardContext.uid || context.uid || null,
            pid: guardContext.pid || context.pid || null,
            strategyCategory: guardContext.strategyCategory || context.strategyCategory || null,
            eventType: 'BINANCE_WRITE_BLOCKED',
            eventCode: reason,
            severity: 'critical',
            symbol: guardContext.symbol || context.symbol || null,
            side: guardContext.side || context.side || null,
            positionSide: guardContext.positionSide || context.positionSide || null,
            clientOrderId: guardContext.clientOrderId || context.clientOrderId || null,
            orderId: guardContext.orderId || context.orderId || null,
            orderType: context.orderType || null,
            quantity: context.quantity || null,
            note,
            payload: {
                callsite: guardContext.caller || context.caller || null,
                guardReason: reason,
                qaReplayMode: isQaReplayMode(),
                action: guardContext.action || context.action || null,
            },
        });
    }catch(logError){
        return null;
    }
};

const assertBinanceWriteAllowedOrLog = async (context = {}) => {
    const client = context.uid ? binance?.[context.uid] : null;
    try{
        return binanceWriteGuard.assertBinanceWriteAllowed({
            ...context,
            clientIsMock: context.clientIsMock === true || Boolean(client?.__qaMockBinanceClient),
        });
    }catch(error){
        if(binanceWriteGuard.isBinanceWriteGuardError(error)){
            await logBlockedBinanceWrite({ error, context });
        }
        throw error;
    }
};

const submitFuturesOrder = async (context = {}, type, side, symbol, qty, price, options = {}) => {
    await assertBinanceWriteAllowedOrLog({
        ...context,
        action: context.action || 'WRITE_CREATE_ORDER',
        symbol,
        side,
        positionSide: options?.positionSide || context.positionSide || null,
        clientOrderId: options?.newClientOrderId || context.clientOrderId || null,
        orderType: type,
        quantity: qty,
    });
    return await binance[context.uid].futuresOrder(type, side, symbol, qty, price, options);
};

const cancelFuturesOrder = async (context = {}, symbol, orderId) => {
    await assertBinanceWriteAllowedOrLog({
        ...context,
        action: context.action || 'WRITE_CANCEL_ORDER',
        symbol,
        orderId,
    });
    return await binance[context.uid].futuresCancel(symbol, orderId);
};

const privateFuturesClientWrite = async (context = {}, endpoint, params = {}, method = 'POST') => {
    await assertBinanceWriteAllowedOrLog({
        ...context,
        action: context.action || `PRIVATE_FUTURES_${String(method || 'POST').toUpperCase()}`,
        symbol: params?.symbol || context.symbol || null,
        clientOrderId: params?.clientAlgoId || params?.newClientOrderId || context.clientOrderId || null,
        orderId: params?.orderId || params?.algoId || context.orderId || null,
    });
    return await binance[context.uid].privateFuturesRequest(endpoint, params, method);
};

const updateBinanceRuntimeMeta = (uid, patch = {}) => {
    const meta = ensureBinanceRuntimeMeta(uid);
    if(!meta){
        return null;
    }

    Object.assign(meta, patch, {
        uid,
        updatedAt: new Date().toISOString(),
    });
    return meta;
}

const maskApiKey = (value) => {
    const raw = String(value || '').trim();
    if(!raw){
        return null;
    }

    if(raw.length <= 8){
        return raw;
    }

    return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

const symbolList = [
    'BTCUSDT',  //1
    'ETHUSDT',  //2
    'XRPUSDT',
    'SOLUSDT',
    'DOGEUSDT',
    'PUMPUSDT',
]

const ensurePriceSlot = (symbol) => {
    if(!dt.price[symbol]){
        dt.price[symbol] = {
            symbol,
            bestBid: 0,
            bestBidQty: 0,
            bestAsk: 0,
            bestAskQty: 0,
            lastPrice: 0,
            lastQty: 0,
            lastTradeTime: 0,
        };
    }

    return dt.price[symbol];
}

const hydratePriceSlotFromBookTicker = async (symbol) => {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    if(!normalizedSymbol){
        return dt.getPrice(symbol);
    }

    const response = await axios.get(`${FUTURES_BASE_URL}/fapi/v1/ticker/bookTicker`, {
        params: { symbol: normalizedSymbol },
        timeout: 5000,
    });
    const data = response?.data || {};
    const slot = ensurePriceSlot(normalizedSymbol);
    dt.price[normalizedSymbol] = {
        ...slot,
        symbol: normalizedSymbol,
        bestBid: data.bidPrice || slot.bestBid || 0,
        bestBidQty: data.bidQty || slot.bestBidQty || 0,
        bestAsk: data.askPrice || slot.bestAsk || 0,
        bestAskQty: data.askQty || slot.bestAskQty || 0,
        lastPrice:
            slot.lastPrice ||
            data.bidPrice ||
            data.askPrice ||
            0,
        lastQty: slot.lastQty || 0,
        lastTradeTime: Date.now(),
    };

    return dt.getPrice(normalizedSymbol);
}

// const ckCode = (code_) => {
//     const code = Number(code_);

//     try{
//         if(0 <= code && code <= 999){
//             return true;
//         }else{
//             return false;
//         }
//     }catch(e){
//         return false;
//     }
// }

const getKorTime = (time) => {
    const formatted = dayjs(time).tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss');

    return formatted;
}

const toMysqlDateTimeOrNull = (value) => {
    const normalized = Number(value || 0);
    if(!(normalized > 0)){
        return null;
    }

    const parsed = dayjs(normalized).utc();
    if(!parsed.isValid()){
        return null;
    }

    return parsed.format('YYYY-MM-DD HH:mm:ss');
}

const buildSignalTruthSyncOrderBy = (mode = 'STATUS') => {
    const normalizedMode = String(mode || 'STATUS').trim().toUpperCase();
    if(normalizedMode === 'RUNTIME_VALUE'){
        return `ORDER BY
              COALESCE(r_exactTime, r_signalTime, created_at) DESC,
              r_exactTime DESC,
              r_signalTime DESC,
              created_at DESC,
              id DESC`;
    }

    return `ORDER BY
              COALESCE(r_signalTime, r_exactTime, created_at) DESC,
              r_signalTime DESC,
              r_exactTime DESC,
              created_at DESC,
              id DESC`;
}

const sleep = (ms) => {
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

const getGridEngine = () => {
    if(!gridEngine){
        gridEngine = require("./grid-engine");
    }

    return gridEngine;
}

const getPolicyEngine = () => {
    if(!policyEngine){
        policyEngine = require("./policy-engine");
    }

    return policyEngine;
}

const evaluateLiveStrategyPoliciesAfterClose = async (uid, strategyPid) => {
    if(!uid || !strategyPid){
        return [];
    }

    try{
        return await getPolicyEngine().evaluateUserStrategyPolicies({
            uid,
            persist: true,
            executeActions: true,
            strategyPid,
        });
    }catch(error){
        console.log(`[POLICY_STRATEGY_EVAL_ERROR] uid:${uid}, pid:${strategyPid}, msg:${error?.message || error}`);
        return [];
    }
}

const withLiveBoundSyncLock = async (key, worker) => {
    if(!key){
        return await worker();
    }

    if(liveBoundSyncLocks.has(key)){
        return false;
    }

    liveBoundSyncLocks.set(key, true);
    try{
        return await worker();
    }finally{
        liveBoundSyncLocks.delete(key);
    }
}

const withQueuedSignalOrderRuntimeLock = async (key, worker, waitMs = 15000, pollMs = 15) => {
    if(!key){
        return await worker();
    }

    const deadline = Date.now() + Math.max(0, Number(waitMs || 0));
    while(signalOrderRuntimeLocks.has(key)){
        if(Date.now() >= deadline){
            console.log(`[SIGNAL_ORDER_RUNTIME_LOCK_TIMEOUT] key:${key}`);
            return false;
        }

        await sleep(pollMs);
    }

    signalOrderRuntimeLocks.set(key, true);
    try{
        return await worker();
    }finally{
        signalOrderRuntimeLocks.delete(key);
    }
}

const acquireDbNamedLock = async (lockKey, timeoutSeconds = 0) => {
    if(!lockKey){
        return null;
    }

    let connection = null;
    try{
        connection = await db.getConnection();
        const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS locked', [lockKey, timeoutSeconds]);
        if(Number(rows?.[0]?.locked || 0) !== 1){
            connection.release();
            return null;
        }

        return connection;
    }catch(error){
        if(connection){
            connection.release();
        }
        return null;
    }
}

const releaseDbNamedLock = async (connection, lockKey) => {
    if(!connection){
        return;
    }

    try{
        if(lockKey){
            await connection.query('DO RELEASE_LOCK(?)', [lockKey]);
        }
    }catch(error){
    }finally{
        connection.release();
    }
}

const pruneRecentOrderRuntimeEvents = () => {
    const now = Date.now();
    for(const [key, expireAt] of recentOrderRuntimeEvents.entries()){
        if(expireAt <= now){
            recentOrderRuntimeEvents.delete(key);
        }
    }
}

const pruneRecentBoundRegistrationTargets = () => {
    const now = Date.now();
    for(const [key, expireAt] of recentBoundRegistrationTargets.entries()){
        if(expireAt <= now){
            recentBoundRegistrationTargets.delete(key);
        }
    }
}

const pruneCompletedBoundRegistrationEntries = () => {
    const now = Date.now();
    for(const [key, expireAt] of completedBoundRegistrationEntries.entries()){
        if(expireAt <= now){
            completedBoundRegistrationEntries.delete(key);
        }
    }
}

const logOrderRuntimeTrace = (stage, payload = {}) => {
    try{
        console.log(`[BINANCE_RUNTIME][${stage}] ${JSON.stringify(payload)}`);
    }catch(error){
        console.log(`[BINANCE_RUNTIME][${stage}]`);
    }
}

const shouldSkipDuplicateOrderRuntimeEvent = (uid, payload) => {
    try{
        const order = payload?.o;
        if(!order){
            return false;
        }

        pruneRecentOrderRuntimeEvents();
        const eventKey = [
            uid,
            order.i || 0,
            order.c || '',
            order.x || '',
            order.X || '',
            order.z || '',
            order.ap || order.L || order.p || '',
            order.S || '',
            order.o || '',
            order.ot || '',
            order.sp || '',
            order.ps || '',
            String(order.cp || false),
        ].join(':');

        if(recentOrderRuntimeEvents.has(eventKey)){
            logOrderRuntimeTrace('ORDER_RUNTIME_DEDUPE', {
                uid,
                skip: true,
                reason: 'RECENT_DUPLICATE',
                dedupeKey: eventKey,
                eventType: payload?.e || null,
                orderId: order.i || null,
                clientOrderId: order.c || null,
                symbol: order.s || null,
                side: order.S || null,
                positionSide: order.ps || null,
            });
            return true;
        }

        recentOrderRuntimeEvents.set(eventKey, Date.now() + 120000);
        logOrderRuntimeTrace('ORDER_RUNTIME_DEDUPE', {
            uid,
            skip: false,
            reason: 'ACCEPTED',
            dedupeKey: eventKey,
            eventType: payload?.e || null,
            orderId: order.i || null,
            clientOrderId: order.c || null,
            symbol: order.s || null,
            side: order.S || null,
            positionSide: order.ps || null,
        });
        return false;
    }catch(error){
        logOrderRuntimeTrace('ORDER_RUNTIME_DEDUPE_ERROR', {
            uid,
            message: error?.message || String(error),
            stack: error?.stack || null,
        });
        return false;
    }
}

const RETRY_ERROR_CODES = new Set([
    -1001,
    -1003,
    -1008,
    -1021,
    -4509,
]);
const RETRY_DELAY_MS = 350;

const REQUERY_ERROR_CODES = new Set([
    -1006,
    -1007,
    -2011,
    -2012,
    -2013,
    -2021,
    -2020,
    -2022,
    -2024,
]);

const MANUAL_ERROR_CODES = new Set([
    -2014,
    -2015,
    -2018,
    -2019,
    -2023,
    -2025,
    -4051,
    -4061,
    -4118,
    -4120,
    -4131,
    -4142,
    -4164,
    -4192,
    -4400,
    -4401,
]);

const BINANCE_ERROR_GUIDE = {
    [-1001]: '?ㅽ듃?뚰겕 遺덉븞???먮뒗 ?쇱떆 ?⑥젅?낅땲?? ?좎떆 ???ъ떆????곸엯?덈떎.',
    [-1003]: '?몄텧 ?쒗븳 珥덇낵?낅땲?? 吏㏃? ?湲????ъ떆????곸엯?덈떎.',
    [-1006]: '?묐떟 ?곹깭媛 遺덈챸?뺥빀?덈떎. 二쇰Ц ?ъ“?뚭? ?꾩슂?⑸땲??',
    [-1007]: '??꾩븘?껋엯?덈떎. 二쇰Ц ?ъ“?뚭? ?꾩슂?⑸땲??',
    [-1008]: '?쒕쾭 怨쇰???媛?μ꽦?낅땲?? 吏㏃? ?湲????ъ떆????곸엯?덈떎.',
    [-1021]: '?쒕쾭 ?쒓컙 遺덉씪移섏엯?덈떎. ?ъ떆?????쒓컙 ?숆린???뺤씤???꾩슂?⑸땲??',
    [-2011]: '痍⑥냼 嫄곗젅 ?먮뒗 ?대? 泥섎━??二쇰Ц?낅땲?? ?ъ“?뚭? ?꾩슂?⑸땲??',
    [-2013]: '二쇰Ц??李얠쓣 ???놁뒿?덈떎. ?ㅼ젣 泥닿껐/痍⑥냼 ?곹깭瑜??ъ“?뚰빐???⑸땲??',
    [-2014]: 'API ???뺤떇 ?먮뒗 怨꾩젙 ?ㅼ젙 臾몄젣?낅땲?? ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-2015]: 'API 沅뚰븳, IP ?덉슜, 怨꾩젙 沅뚰븳 臾몄젣?낅땲?? ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-2018]: '?붽퀬 遺議깆엯?덈떎. ?먮룞 ?ъ＜臾?湲덉? ??곸엯?덈떎.',
    [-2019]: '利앷굅湲?遺議깆엯?덈떎. ?먮룞 ?ъ＜臾?湲덉? ??곸엯?덈떎.',
    [-2022]: 'reduceOnly 異⑸룎 媛?μ꽦?낅땲?? 湲곗〈 ?ъ??섍낵 二쇰Ц ?곹깭 ?ъ“?뚭? ?꾩슂?⑸땲??',
    [-2024]: '?ъ????섎웾 遺議깆엯?덈떎. ?꾩옱 ?ъ????ъ“?뚭? ?꾩슂?⑸땲??',
    [-2025]: '理쒕? 二쇰Ц ???쒗븳?낅땲?? ?섎룞 ?뺣━媛 ?꾩슂?⑸땲??',
    [-4051]: '?ъ???紐⑤뱶/二쇰Ц ?뚮씪誘명꽣 異⑸룎?낅땲?? ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-4120]: '議곌굔遺 二쇰Ц???쇰컲 二쇰Ц ?붾뱶?ъ씤?몃줈 蹂대궦 ?곹깭?낅땲?? /fapi/v1/algoOrder 遺꾧린? ?대? ?섑띁 ?뺤씤???꾩슂?⑸땲??',
    [-4192]: '怨꾩젙 ?쒗븳 ?먮뒗 洹쒖젙 ?쒗븳 媛?μ꽦?낅땲?? ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-4400]: '二쇰Ц ?뚮씪誘명꽣媛 ?좏슚?섏? ?딆뒿?덈떎. ?낅젰 ?섏젙???꾩슂?⑸땲??',
    [-4401]: '二쇰Ц 議곌굔???좏슚?섏? ?딆뒿?덈떎. ?낅젰 ?섏젙???꾩슂?⑸땲??',
};

const BINANCE_ERROR_GUIDE_KO = {
    [-1001]: '?ㅽ듃?뚰겕 ?곌껐??遺덉븞?뺥븯嫄곕굹 ?쇱떆 ?μ븷媛 諛쒖깮?덉뒿?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄??二쇱꽭??',
    [-1003]: '?몄텧 ?쒗븳??珥덇낵?덉뒿?덈떎. ?좎떆 ?湲고븳 ???ㅼ떆 ?쒕룄??二쇱꽭??',
    [-1006]: '嫄곕옒???묐떟 ?곹깭媛 遺덈챸?뺥빀?덈떎. 二쇰Ц ?곹깭 ?ъ“?뚭? ?꾩슂?⑸땲??',
    [-1007]: '?붿껌???쒓컙 珥덇낵?섏뿀?듬땲?? 二쇰Ц ?곹깭 ?ъ“?뚭? ?꾩슂?⑸땲??',
    [-1008]: '嫄곕옒???쒕쾭媛 怨쇰????곹깭?낅땲?? ?좎떆 ?湲????ㅼ떆 ?쒕룄??二쇱꽭??',
    [-1021]: '?쒕쾭 ?쒓컙 遺덉씪移섍? 諛쒖깮?덉뒿?덈떎. ?쒖뒪???쒓컙 ?숆린?붽? ?꾩슂?⑸땲??',
    [-2011]: '痍⑥냼 嫄곗젅 ?먮뒗 ?대? 泥섎━??二쇰Ц?낅땲?? ?ㅼ젣 二쇰Ц ?곹깭 ?ъ“?뚭? ?꾩슂?⑸땲??',
    [-2013]: '二쇰Ц??李얠쓣 ???놁뒿?덈떎. ?대? 泥닿껐?섏뿀嫄곕굹 痍⑥냼?섏뿀?붿? ?ъ“?뚭? ?꾩슂?⑸땲??',
    [-2014]: 'API ???뺤떇 ?먮뒗 怨꾩젙 ?ㅼ젙??臾몄젣媛 ?덉뒿?덈떎. ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-2015]: 'API 沅뚰븳, ?덉슜 IP, 怨꾩젙 沅뚰븳 臾몄젣?낅땲?? ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-2018]: '?붽퀬媛 遺議깊빀?덈떎. ?먮룞 ?ъ＜臾??놁씠 ?ъ슜???뺤씤???꾩슂?⑸땲??',
    [-2019]: '利앷굅湲덉씠 遺議깊빀?덈떎. ?먮룞 ?ъ＜臾??놁씠 ?ъ슜???뺤씤???꾩슂?⑸땲??',
    [-2021]: '二쇰Ц??利됱떆 ?몃━嫄곕릺??議곌굔?낅땲?? 媛寃??먮뒗 ?몃━嫄?媛믪쓣 ?ㅼ떆 ?뺤씤?댁빞 ?⑸땲??',
    [-2022]: 'Reduce Only 二쇰Ц???꾩옱 ?ъ????곹깭? 異⑸룎?⑸땲?? ?ъ????ъ“?뚭? ?꾩슂?⑸땲??',
    [-2024]: '?ъ????섎웾??遺議깊빀?덈떎. ?꾩옱 蹂댁쑀 ?ъ????ъ“?뚭? ?꾩슂?⑸땲??',
    [-2025]: '二쇰Ц 媛??媛쒖닔 ?쒕룄瑜?珥덇낵?덉뒿?덈떎. 湲곗〈 二쇰Ц ?뺣━媛 ?꾩슂?⑸땲??',
    [-4004]: '理쒖냼 ?섎웾蹂대떎 ?묒? 二쇰Ц?낅땲?? 二쇰Ц ?섎웾???ㅼ떆 怨꾩궛?댁빞 ?⑸땲??',
    [-4014]: '?멸? ?⑥쐞(tick size)??留욎? ?딅뒗 媛寃⑹엯?덈떎. 媛寃??뺢퇋?붽? ?꾩슂?⑸땲??',
    [-4023]: '?섎웾 ?⑥쐞(step size)??留욎? ?딅뒗 二쇰Ц?낅땲?? ?섎웾 ?뺢퇋?붽? ?꾩슂?⑸땲??',
    [-4051]: '?ъ???紐⑤뱶 ?먮뒗 二쇰Ц ?뚮씪誘명꽣媛 異⑸룎?⑸땲?? ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-4061]: '?ъ???紐⑤뱶? 二쇰Ц 諛⑺뼢???쇱튂?섏? ?딆뒿?덈떎. 怨꾩젙 ?ㅼ젙 ?뺤씤???꾩슂?⑸땲??',
    [-4118]: '二쇰Ц 議고빀 ?먮뒗 Reduce Only 議곌굔???좏슚?섏? ?딆뒿?덈떎. ?꾩옱 二쇰Ц ?곹깭 ?뺤씤???꾩슂?⑸땲??',
    [-4120]: '議곌굔遺 二쇰Ц???쇰컲 二쇰Ц 寃쎈줈濡?蹂대궦 寃쎌슦?낅땲?? STOP/TAKE_PROFIT/TRAILING 怨꾩뿴? /fapi/v1/algoOrder ?ъ슜 ?щ?瑜?癒쇱? ?뺤씤?댁빞 ?⑸땲??',
    [-4131]: '?쒖옣媛 二쇰Ц??媛寃?蹂댄샇 洹쒖튃??嫄몃졇?듬땲?? 媛寃??댄깉 ?щ? ?뺤씤???꾩슂?⑸땲??',
    [-4142]: '二쇰Ц 議곌굔???꾩옱 嫄곕옒???뺤콉怨?留욎? ?딆뒿?덈떎. ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-4164]: '?덈쾭由ъ? ?먮뒗 留덉쭊 愿???쒗븳??嫄몃졇?듬땲?? 怨꾩젙 ?ㅼ젙 ?뺤씤???꾩슂?⑸땲??',
    [-4192]: '怨꾩젙 ?쒗븳 ?먮뒗 洹쒖젙 ?쒗븳 媛?μ꽦???덉뒿?덈떎. ?섎룞 ?뺤씤???꾩슂?⑸땲??',
    [-4400]: '二쇰Ц ?뚮씪誘명꽣媛 ?좏슚?섏? ?딆뒿?덈떎. ?낅젰媛??섏젙???꾩슂?⑸땲??',
    [-4401]: '二쇰Ц 議곌굔???좏슚?섏? ?딆뒿?덈떎. ?낅젰媛??섏젙???꾩슂?⑸땲??',
};

const BINANCE_ERROR_GUIDE_CLEAN_KO = {
    [-1001]: 'Binance 내부 오류입니다. 잠시 후 자동 재시도합니다.',
    [-1003]: 'Binance 요청 제한에 도달했습니다. Retry-After 이후에만 다시 조회합니다.',
    [-1006]: 'Binance 응답이 불명확합니다. 주문/체결 상태를 재조회해야 합니다.',
    [-1007]: 'Binance 요청 시간이 초과되었습니다. 주문/체결 상태를 재조회해야 합니다.',
    [-1008]: 'Binance 서버가 바쁜 상태입니다. 잠시 후 자동 재시도합니다.',
    [-1021]: '요청 시간이 Binance 서버 시간과 맞지 않습니다. 시간 동기화 후 재시도합니다.',
    [-2011]: '주문을 찾을 수 없습니다. 최신 주문 상태를 재조회해야 합니다.',
    [-2013]: '해당 주문이 존재하지 않습니다. 주문 ID와 계정 범위를 확인해야 합니다.',
    [-2014]: 'API 키 형식 또는 권한 문제가 있습니다. API 설정을 확인해 주세요.',
    [-2015]: 'API 키, Secret, IP 제한 또는 Futures 권한 문제가 있습니다.',
    [-2018]: '잔고가 부족합니다. 주문 수량과 사용 가능 증거금을 확인해 주세요.',
    [-2019]: '증거금이 부족합니다. 주문 수량과 레버리지 설정을 확인해 주세요.',
    [-2021]: '주문이 즉시 체결되어야 하는 조건을 만족하지 않습니다. 가격과 주문 방향을 확인해야 합니다.',
    [-2022]: 'Reduce Only 주문이 현재 포지션과 맞지 않습니다. 포지션/주문 상태를 재조회해야 합니다.',
    [-2024]: '포지션이 부족합니다. 현재 포지션 수량을 확인해야 합니다.',
    [-2025]: '허용 가능한 주문 수를 초과했습니다. 열린 주문을 확인해 주세요.',
    [-4004]: '주문 수량이 최소 수량보다 작습니다. 심볼 step size와 주문 수량을 확인해 주세요.',
    [-4014]: '주문 가격이 tick size와 맞지 않습니다. 가격 단위를 확인해 주세요.',
    [-4023]: '주문 수량이 step size와 맞지 않습니다. 수량 단위를 확인해 주세요.',
    [-4051]: 'Position Side 설정이 맞지 않습니다. Hedge Mode/positionSide 설정을 확인해 주세요.',
    [-4061]: 'Position Side가 계정 모드와 맞지 않습니다. Hedge Mode와 주문 positionSide를 확인해 주세요.',
    [-4118]: 'Reduce Only 주문 조건이 현재 포지션과 맞지 않습니다. 포지션 수량을 확인해 주세요.',
    [-4120]: '조건부 주문 타입 또는 엔드포인트가 맞지 않습니다. algoOrder 엔드포인트 사용 여부를 확인해야 합니다.',
    [-4131]: '주문 가격이 허용 범위를 벗어났습니다. 가격 보호/필터 조건을 확인해 주세요.',
    [-4142]: '주문 수량 또는 명목 금액이 허용 범위를 벗어났습니다. 주문 수량을 확인해 주세요.',
    [-4164]: '주문이 심볼 제한 조건을 만족하지 않습니다. 거래 규칙을 확인해 주세요.',
    [-4192]: 'Reduce Only 또는 포지션 방향 조건이 맞지 않습니다. 포지션과 주문 방향을 확인해 주세요.',
    [-4400]: '계정 거래가 제한된 상태입니다. Binance 계정 상태를 확인해 주세요.',
    [-4401]: '계정 주문 기능이 제한된 상태입니다. Binance 계정 상태를 확인해 주세요.',
};

Object.assign(BINANCE_ERROR_GUIDE, BINANCE_ERROR_GUIDE_CLEAN_KO);
Object.assign(BINANCE_ERROR_GUIDE_KO, BINANCE_ERROR_GUIDE_CLEAN_KO);

const extractBinanceError = (error) => {
    const fallback = {
        code: 404,
        msg: error?.message || 'unknown error',
    };

    if (error?.response?.data) {
        const responseCode = Number(error.response.data.code);
        return {
            code: Number.isFinite(responseCode) ? responseCode : fallback.code,
            msg: error.response.data.msg || fallback.msg,
        };
    }

    if (!error || !error.message) {
        return fallback;
    }

    const match = error.message.match(/\{.*\}/);

    if (!match) {
        return fallback;
    }

    try{
        const json = JSON.parse(match[0]);
        return {
            code: Number.isFinite(Number(json.code)) ? Number(json.code) : fallback.code,
            msg: json.msg || fallback.msg,
        };
    }catch(parseError){
        return fallback;
    }
}

const classifyBinanceError = (code) => {
    if(RETRY_ERROR_CODES.has(code)){
        return 'retry';
    }

    if(REQUERY_ERROR_CODES.has(code)){
        return 'requery';
    }

    if(MANUAL_ERROR_CODES.has(code)){
        return 'manual';
    }

    return 'reject';
}

const toRuntimeMessage = (message, extra = null) => {
    if(extra){
        return `${message} | ${extra}`;
    }

    return message;
}

const BINANCE_ACTION_LABEL_KO = {
    retry: '자동 재시도',
    requery: '주문 재조회',
    manual: '사용자 확인 필요',
    reject: '요청 거부',
};

const describeBinanceAction = (action) => {
    return BINANCE_ACTION_LABEL_KO[action] || BINANCE_ACTION_LABEL_KO.reject;

    switch(action){
        case 'retry':
            return '자동 재시도';
        case 'requery':
            return '주문 재조회';
        case 'manual':
            return '?섎룞 ?뺤씤';
        default:
            return '利됱떆 嫄곕?';
    }
}

const appendBinanceErrorGuide = (message, code, action) => {
    const guide = BINANCE_ERROR_GUIDE[code];
    const actionLabel = describeBinanceAction(action);

    if(guide){
        return toRuntimeMessage(message, `조치:${actionLabel}, 안내:${guide}`);
    }

    return toRuntimeMessage(message, `조치:${actionLabel}`);

    if(guide){
        return toRuntimeMessage(message, `???${actionLabel}, ?덈궡:${guide}`);
    }

    return toRuntimeMessage(message, `???${actionLabel}`);
}

const formatBinanceErrorGuide = (message, code, action) => {
    const actionLabelMap = {
        retry: '자동 재시도',
        requery: '주문 재조회',
        manual: '?섎룞 ?뺤씤',
        reject: '利됱떆 嫄곕?',
    };
    const guide = BINANCE_ERROR_GUIDE_KO[code];
    const cleanActionLabel = BINANCE_ACTION_LABEL_KO[action] || BINANCE_ACTION_LABEL_KO.reject;

    if(guide){
        return toRuntimeMessage(message, `조치:${cleanActionLabel}, 안내:${guide}`);
    }

    return toRuntimeMessage(message, `조치:${cleanActionLabel}`);

    const actionLabel = actionLabelMap[action] || actionLabelMap.reject;

    if(guide){
        return toRuntimeMessage(message, `???${actionLabel}, ?덈궡:${guide}`);
    }

    return toRuntimeMessage(message, `???${actionLabel}`);
}

const formatBinanceErrorGuideClean = (message, code, action) => {
    const actionLabelMap = {
        retry: '자동 재시도',
        requery: '주문 재조회',
        manual: '?섎룞 ?뺤씤',
        reject: '利됱떆 嫄곕?',
    };
    const guide = BINANCE_ERROR_GUIDE_KO[code];
    const cleanActionLabel = BINANCE_ACTION_LABEL_KO[action] || BINANCE_ACTION_LABEL_KO.reject;

    if(guide){
        return toRuntimeMessage(message, `조치:${cleanActionLabel}, 안내:${guide}`);
    }

    return toRuntimeMessage(message, `조치:${cleanActionLabel}`);

    const actionLabel = actionLabelMap[action] || actionLabelMap.reject;

    if(guide){
        return toRuntimeMessage(message, `???${actionLabel}, ?덈궡:${guide}`);
    }

    return toRuntimeMessage(message, `???${actionLabel}`);
}

const buildBinanceRuntimeError = (error, extra = null) => {
    const errorInfo = extractBinanceError(error);
    const action = classifyBinanceError(errorInfo.code);
    const runtimeMessage = toRuntimeMessage(
        formatBinanceErrorGuideClean(errorInfo.msg, errorInfo.code, action),
        extra
    );

    return {
        code: errorInfo.code,
        msg: errorInfo.msg,
        action,
        runtimeMessage,
    };
}

const logBinanceRuntimeError = (scope, uid, error, extra = null) => {
    const runtimeError = buildBinanceRuntimeError(error, extra);

    console.log(`ERR :: ${scope} uid:${uid} code:${runtimeError.code} msg:${runtimeError.runtimeMessage}`);
    exports.msgAdd(scope, String(runtimeError.code), runtimeError.runtimeMessage, uid, null, null, null, null);

    return runtimeError;
}

const LIVE_ENTER_ALLOWED_STATES = new Set(['EXACT_WAIT']);
const LIVE_CLOSE_ALLOWED_STATES = new Set(['EXACT']);
const MSG_DEDUPE_WINDOW_MS = 60 * 1000;
const INVALID_CREDENTIAL_RETRY_MS = 6 * 60 * 60 * 1000;
const THROTTLED_LOG_WINDOW_MS = 10 * 60 * 1000;
const recentMsgCache = new Map();
const throttledLogCache = new Map();

const pruneRecentMsgCache = () => {
    const now = Date.now();
    for(const [cacheKey, cachedAt] of recentMsgCache.entries()){
        if(now - cachedAt > MSG_DEDUPE_WINDOW_MS){
            recentMsgCache.delete(cacheKey);
        }
    }
};

const shouldEmitThrottledLog = (cacheKey, windowMs = THROTTLED_LOG_WINDOW_MS) => {
    const now = Date.now();
    for(const [key, cachedAt] of throttledLogCache.entries()){
        if(now - cachedAt > windowMs){
            throttledLogCache.delete(key);
        }
    }

    const lastLoggedAt = throttledLogCache.get(cacheKey) || 0;
    if(now - lastLoggedAt < windowMs){
        return false;
    }

    throttledLogCache.set(cacheKey, now);
    return true;
};

const buildMsgDedupeKey = ({
    fun = null,
    code = null,
    msg = null,
    uid = null,
    pid = null,
    tid = null,
    symbol = null,
    side = null,
}) => [
    fun == null ? '' : String(fun),
    code == null ? '' : String(code),
    msg == null ? '' : String(msg),
    uid == null ? '' : String(uid),
    pid == null ? '' : String(pid),
    tid == null ? '' : String(tid),
    symbol == null ? '' : String(symbol),
    side == null ? '' : String(side),
].join('|');

const loadLivePlaySnapshot = async (pid) => {
    if(!pid){
        return null;
    }

    try{
        return await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_NEW_GET(?)`, [pid]);
    }catch(error){
        return null;
    }
}

const buildStateMismatchResponse = (code, message) => {
    return {
        status: false,
        errCode: code,
        errMsg: message,
        errAction: 'reject',
    };
}

const getRuntimeCallerHint = () => {
    try{
        const stackLines = String(new Error().stack || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => !line.includes('getRuntimeCallerHint') && !line.includes('exports.sendForcing'));

        return stackLines[0] || 'unknown-caller';
    }catch(error){
        return 'unknown-caller';
    }
}

const buildSignalSystemAuditPayload = (play, actionCode, note, metadata = {}) => {
    const controlState = runtimeState.getControlState(play);
    const enabledFlag = controlState === 'ON' ? 'Y' : 'N';
    return {
        actorUserId: null,
        targetUserId: play?.uid || null,
        actionCode,
        previousEnabled: enabledFlag,
        nextEnabled: enabledFlag,
        requestIp: 'system:coin',
        note,
        metadata,
    };
};

const setLivePlayReadyIfCurrent = async (pid, expectedStatus) => {
    if(!pid || !expectedStatus){
        return false;
    }

    const item = await loadLivePlaySnapshot(pid);

    try{
        const result = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_SET_READY_IF_STATUS(?,?)`, [
            pid,
            expectedStatus,
        ]);

        if(Number(result?.affectedRows || 0) > 0){
            await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [pid]);
            await positionOwnership.releaseAllPositionBucketOwnersByPid({
                ownerPid: pid,
                ownerStrategyCategory: 'signal',
            });
            return true;
        }
    }catch(error){
    }

    if(!item || item.status !== expectedStatus){
        return false;
    }

    const controlState = runtimeState.getControlState(item);
    const callerHint = getRuntimeCallerHint();
    await strategyControlState.applyPlayControlState({
        mode: 'LIVE',
        pid: item.id,
        enabled: controlState === 'ON' ? 'Y' : 'N',
        status: 'READY',
        resetRuntime: true,
        audit: buildSignalSystemAuditPayload(
            item,
            'SYSTEM_RESET_READY',
            `coin:set-ready-if-current:${expectedStatus}`,
            {
                expectedStatus,
                callerHint,
            }
        ),
    });
    await positionOwnership.releaseAllPositionBucketOwnersByPid({
        ownerPid: item.id,
        ownerStrategyCategory: 'signal',
    });

    return true;
}

const resetLivePlayToReady = async (pid, expectedStatuses = []) => {
    const item = await loadLivePlaySnapshot(pid);

    if(!item){
        return false;
    }

    const statuses = Array.isArray(expectedStatuses) && expectedStatuses.length > 0
        ? expectedStatuses
        : [item.status].filter(Boolean);

    for(const expectedStatus of statuses){
        const changed = await setLivePlayReadyIfCurrent(item.id, expectedStatus);
        if(changed){
            return item;
        }
    }

    return item;
}

const resetLivePlayToReadyIfStatus = async (pid, expectedStatuses = []) => {
    const item = await loadLivePlaySnapshot(pid);

    if(!item){
        return false;
    }

    if(Array.isArray(expectedStatuses) && expectedStatuses.length > 0 && !expectedStatuses.includes(item.status)){
        return item;
    }

    for(const expectedStatus of expectedStatuses){
        const changed = await setLivePlayReadyIfCurrent(item.id, expectedStatus);
        if(changed){
            return item;
        }
    }

    return item;
}

const setLivePlayReadyModeIfCurrent = async (play, expectedStatus) => {
    if(!play?.id || !expectedStatus){
        return false;
    }

    const controlState = runtimeState.getControlState(play);
    const latest = await loadLivePlaySnapshot(play.id);
    if(!latest || latest.status !== expectedStatus){
        return false;
    }
    const callerHint = getRuntimeCallerHint();
    await strategyControlState.applyPlayControlState({
        mode: 'LIVE',
        pid: play.id,
        enabled: controlState === 'ON' ? 'Y' : 'N',
        status: 'READY',
        resetRuntime: true,
        audit: buildSignalSystemAuditPayload(
            latest,
            'SYSTEM_RESET_READY',
            `coin:set-ready-mode-if-current:${expectedStatus}`,
            {
                expectedStatus,
                callerHint,
            }
        ),
    });
    await positionOwnership.releaseAllPositionBucketOwnersByPid({
        ownerPid: play.id,
        ownerStrategyCategory: 'signal',
    });
    return true;
}

const setLivePlayReadyModeIfCurrentWithoutRuntimeReset = async (play, expectedStatus, actionCode = 'SYSTEM_RESET_READY_NO_RUNTIME_RESET') => {
    if(!play?.id || !expectedStatus){
        return false;
    }

    const controlState = runtimeState.getControlState(play);
    const latest = await loadLivePlaySnapshot(play.id);
    if(!latest || latest.status !== expectedStatus){
        return false;
    }
    const callerHint = getRuntimeCallerHint();
    await strategyControlState.applyPlayControlState({
        mode: 'LIVE',
        pid: play.id,
        enabled: controlState === 'ON' ? 'Y' : 'N',
        status: 'READY',
        resetRuntime: false,
        audit: buildSignalSystemAuditPayload(
            latest,
            actionCode,
            `coin:set-ready-mode-no-runtime-reset-if-current:${expectedStatus}`,
            {
                expectedStatus,
                callerHint,
            }
        ),
    });
    await positionOwnership.releaseAllPositionBucketOwnersByPid({
        ownerPid: play.id,
        ownerStrategyCategory: 'signal',
    });
    return true;
}

const restoreLivePlayStatus = async (pid, status) => {
    if(!pid || !status){
        return false;
    }

    try{
        const result = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_EDIT_IF_STATUS(?,?,?)`, [
            pid,
            'EXACT',
            status,
        ]);

        if(Number(result?.affectedRows || 0) > 0){
            return true;
        }
    }catch(error){
    }

    const item = await loadLivePlaySnapshot(pid);
    if(!item || item.status !== 'EXACT'){
        return false;
    }

    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EDIT(?,?)`, [pid, status]);
    return true;
}

const logClosePartialFill = (closeType, ownerUserId, pid, oid, symbol, side, qty, price, endStatus) => {
    const runtimeMessage = `closeType:${closeType}, endStatus:${endStatus}, symbol:${symbol}, side:${side}, qty:${qty}, price:${price}`;
    exports.msgAdd('closePartialFill', endStatus, runtimeMessage, ownerUserId, pid, oid, symbol, side);
}

const TERMINAL_ORDER_STATUSES = new Set(['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED']);
const RECOVERABLE_FILL_ORDER_STATUSES = new Set(['FILLED', 'PARTIALLY_FILLED', 'CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED']);
const isTerminalOrderStatus = (status) => TERMINAL_ORDER_STATUSES.has(String(status || '').trim().toUpperCase());
const isRecoverableFillOrderStatus = (status) => RECOVERABLE_FILL_ORDER_STATUSES.has(String(status || '').trim().toUpperCase());
const getOrderExecutedQty = (order = {}) => {
    const values = [
        order?.executedQty,
        order?.cumQty,
        order?.z,
    ];
    for(const value of values){
        const numeric = Number(value || 0);
        if(numeric > 0){
            return numeric;
        }
    }
    return 0;
}

const getRecoveredFallbackFillQty = (order = {}) => {
    const executedQty = getOrderExecutedQty(order);
    if(executedQty > 0){
        return executedQty;
    }
    const status = String(order?.status || order?.X || '').trim().toUpperCase();
    return status === 'FILLED' ? Number(order?.origQty || order?.q || 0) : 0;
}

const getTerminalOrderAuditLabel = (status, hasFill) => {
    const normalized = String(status || '').trim().toUpperCase();
    if(normalized === 'EXPIRED_IN_MATCH'){
        return hasFill ? 'ORDER_EXPIRED_IN_MATCH_WITH_FILL' : 'ORDER_EXPIRED_IN_MATCH_NO_FILL';
    }
    if(normalized === 'REJECTED'){
        return hasFill ? 'ORDER_REJECTED_WITH_FILL' : 'ORDER_REJECTED_NO_FILL';
    }
    if(normalized === 'CANCELED'){
        return hasFill ? 'ORDER_PARTIAL_REMAINDER_CANCELED' : 'ORDER_TERMINAL_WITHOUT_FILL';
    }
    if(normalized === 'EXPIRED'){
        return hasFill ? 'ORDER_PARTIAL_REMAINDER_EXPIRED' : 'ORDER_TERMINAL_WITHOUT_FILL';
    }
    return hasFill ? 'ORDER_TERMINAL_WITH_EXECUTED_QTY' : 'ORDER_TERMINAL_WITHOUT_FILL';
}

const resolveEntrySignalTypeFromCloseSide = (signalType, closeSide) => {
    if(signalType){
        return signalType;
    }

    if(closeSide === 'SELL'){
        return 'BUY';
    }

    if(closeSide === 'BUY'){
        return 'SELL';
    }

    return null;
}

const hasKnownRuntimeClientOrderPrefix = (clientOrderId) => {
    const prefix = String(clientOrderId || '').split('_')[0];
    return (
        prefix === 'NEW'
        || runtimeState.isConditionalExitOrderType(prefix)
        || runtimeState.isMarketExitOrderType(prefix)
        || isGridClientOrderId(clientOrderId)
    );
}

const toRuntimeNumericId = (value, fallback = null) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : fallback;
}

const parseRuntimeClientOrderMeta = (clientOrderId, fallbackUid = null) => {
    const raw = String(clientOrderId || '').trim();
    const parts = raw.split('_');
    const prefix = parts[0] || '';

    if(isGridClientOrderId(raw)){
        return {
            raw,
            prefix,
            ownerUserId: toRuntimeNumericId(parts[2], fallbackUid),
            pid: toRuntimeNumericId(parts[3], null),
            leg: parts[1] === 'L' ? 'LONG' : parts[1] === 'S' ? 'SHORT' : null,
            suffix: parts[4] || null,
            isGrid: true,
        };
    }

    const isLegacyRuntimeOrder =
        prefix === 'NEW'
        || runtimeState.isConditionalExitOrderType(prefix)
        || runtimeState.isMarketExitOrderType(prefix);

    if(!isLegacyRuntimeOrder){
        return {
            raw,
            prefix,
            ownerUserId: toRuntimeNumericId(fallbackUid, null),
            pid: null,
            leg: null,
            suffix: null,
            isGrid: false,
        };
    }

    return {
        raw,
        prefix,
        ownerUserId: toRuntimeNumericId(parts[1], fallbackUid),
        pid: toRuntimeNumericId(parts[2], null),
        leg: null,
        suffix: parts[3] || null,
        isGrid: false,
    };
}

const getSignalPositionSide = (signalSide) => {
    const normalized = String(signalSide || '').trim().toUpperCase();
    if(normalized === 'BUY' || normalized === 'LONG'){
        return 'LONG';
    }

    if(normalized === 'SELL' || normalized === 'SHORT'){
        return 'SHORT';
    }

    return null;
}

const acquireSignalPositionOwnership = async ({
    uid,
    pid,
    symbol,
    signalSide,
    strategyName = null,
    sourceClientOrderId = null,
    ownerState = 'ENTRY_PENDING',
    note = null,
}) => {
    const positionSide = getSignalPositionSide(signalSide);
    if(!uid || !pid || !symbol || !positionSide){
        return {
            ok: false,
            conflict: false,
            reason: 'INVALID_SIGNAL_BUCKET',
            owner: null,
        };
    }

    return await positionOwnership.acquirePositionBucketOwner({
        uid,
        symbol,
        positionSide,
        ownerPid: pid,
        ownerStrategyCategory: 'signal',
        ownerSignalType: String(signalSide || '').trim().toUpperCase(),
        ownerStrategyName: strategyName || null,
        ownerState,
        sourceClientOrderId: sourceClientOrderId || null,
        note: note || null,
    });
}

const touchSignalPositionOwnership = async ({
    uid,
    pid,
    symbol,
    signalSide,
    ownerState = null,
    sourceClientOrderId = null,
    sourceOrderId = null,
    note = null,
}) => {
    const positionSide = getSignalPositionSide(signalSide);
    if(!uid || !pid || !symbol || !positionSide){
        return false;
    }

    return await positionOwnership.touchPositionBucketOwner({
        uid,
        symbol,
        positionSide,
        ownerPid: pid,
        ownerStrategyCategory: 'signal',
        ownerSignalType: String(signalSide || '').trim().toUpperCase(),
        ownerState,
        sourceClientOrderId: sourceClientOrderId || null,
        sourceOrderId: sourceOrderId == null ? null : String(sourceOrderId),
        note: note || null,
    });
}

const getFirstDefinedValue = (...values) => {
    for(const value of values){
        if(value !== undefined && value !== null && value !== ''){
            return value;
        }
    }

    return null;
}

const toNullableRuntimeNumber = (value) => {
    if(value === null || value === undefined || value === ''){
        return null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

const getSignalRuntimeOrderKind = (prefix) => {
    switch(String(prefix || '').toUpperCase()){
        case 'NEW':
            return 'ENTRY';
        case 'PROFIT':
            return 'TAKE_PROFIT';
        case 'STOP':
            return 'STOP_LOSS';
        case 'SPLITTP':
            return 'SPLIT_TAKE_PROFIT';
        case 'MANUAL':
        case 'FORCING':
        case 'TIME':
        case 'REVERSE':
            return 'MARKET_EXIT';
        default:
            return 'UNKNOWN';
    }
}

const getGridRuntimeOrderKind = (prefix) => {
    switch(String(prefix || '').toUpperCase()){
        case 'GENTRY':
            return 'ENTRY';
        case 'GTP':
            return 'TAKE_PROFIT';
        case 'GSTOP':
            return 'STOP_LOSS';
        case 'GMANUAL':
            return 'MANUAL_CLOSE';
        default:
            return 'UNKNOWN';
    }
}

const resolveRuntimeOrderContext = (clientOrderId, fallbackUid = null) => {
    const raw = String(clientOrderId || '').trim();
    if(!raw){
        return {
            strategyCategory: 'unknown',
            orderKind: 'UNKNOWN',
            uid: toNullableRuntimeNumber(fallbackUid),
            pid: null,
            leg: null,
            prefix: null,
            clientOrderId: null,
            clientAlgoId: null,
        };
    }

    if(isGridClientOrderId(raw)){
        const parsed = getGridEngine().parseGridClientOrderId(raw);
        return {
            strategyCategory: 'grid',
            orderKind: getGridRuntimeOrderKind(parsed?.type),
            uid: parsed?.uid ?? toNullableRuntimeNumber(fallbackUid),
            pid: parsed?.pid ?? null,
            leg: parsed?.leg ?? null,
            prefix: parsed?.type || raw.split('_')[0] || null,
            clientOrderId: raw,
            clientAlgoId: raw,
        };
    }

    const parsed = parseRuntimeClientOrderMeta(raw, fallbackUid);
    if(hasKnownRuntimeClientOrderPrefix(raw)){
        return {
            strategyCategory: 'signal',
            orderKind: getSignalRuntimeOrderKind(parsed.prefix),
            uid: parsed.ownerUserId ?? toNullableRuntimeNumber(fallbackUid),
            pid: parsed.pid ?? null,
            leg: parsed.leg ?? null,
            prefix: parsed.prefix || null,
            clientOrderId: raw,
            clientAlgoId: raw,
        };
    }

    return {
        strategyCategory: 'unknown',
        orderKind: 'UNKNOWN',
        uid: toNullableRuntimeNumber(fallbackUid),
        pid: null,
        leg: null,
        prefix: raw.split('_')[0] || null,
        clientOrderId: raw,
        clientAlgoId: raw,
    };
}

const resolveOrderRuntimeLifecycle = (order = {}) => {
    const endStatus = String(order.X || '').toUpperCase();
    const executedQty = Number(order.z || 0);
    const originalQty = Number(order.q || 0);

    if(endStatus === 'PARTIALLY_FILLED'){
        return 'PARTIALLY_FILLED';
    }

    if(endStatus === 'FILLED'){
        return 'FILLED';
    }

    if(endStatus === 'CANCELED'){
        return executedQty > 0 && (!originalQty || executedQty < originalQty)
            ? 'PARTIAL_CANCELED'
            : 'CANCELED';
    }

    if(endStatus === 'EXPIRED'){
        return executedQty > 0 && (!originalQty || executedQty < originalQty)
            ? 'PARTIAL_EXPIRED'
            : 'EXPIRED';
    }

    if(endStatus === 'EXPIRED_IN_MATCH'){
        return executedQty > 0 && (!originalQty || executedQty < originalQty)
            ? 'PARTIAL_EXPIRED_IN_MATCH'
            : 'EXPIRED_IN_MATCH';
    }

    if(endStatus === 'REJECTED'){
        return executedQty > 0
            ? 'PARTIAL_REJECTED'
            : 'REJECTED';
    }

    if(endStatus === 'NEW'){
        return 'NEW';
    }

    return String(order.x || order.X || 'UPDATED').toUpperCase();
}

const resolveAlgoRuntimeLifecycle = (status) => {
    const normalized = String(status || '').toUpperCase();
    if(!normalized){
        return 'UPDATED';
    }

    if(normalized.includes('REJECT')){
        return 'REJECTED';
    }

    if(normalized.includes('CANCEL')){
        return 'CANCELED';
    }

    if(normalized.includes('EXPIRE')){
        return 'EXPIRED';
    }

    if(normalized.includes('TRIGGER')){
        return 'TRIGGERED';
    }

    if(normalized.includes('FINISH') || normalized.includes('FILLED') || normalized.includes('COMPLETE')){
        return 'FINISHED';
    }

    if(normalized.includes('NEW') || normalized.includes('CREATE') || normalized.includes('INIT')){
        return 'NEW';
    }

    return normalized;
}

const resolveRuntimeEventSeverity = ({ orderKind = 'UNKNOWN', lifecycle = 'UPDATED', eventType = 'ORDER_TRADE_UPDATE' } = {}) => {
    const normalizedKind = String(orderKind || '').toUpperCase();
    const normalizedLifecycle = String(lifecycle || '').toUpperCase();
    const normalizedEventType = String(eventType || '').toUpperCase();

    if(normalizedEventType === 'CONDITIONAL_ORDER_TRIGGER_REJECT' || normalizedLifecycle.includes('REJECT')){
        return 'high';
    }

    if(['ENTRY', 'MARKET_EXIT', 'STOP_LOSS', 'MANUAL_CLOSE'].includes(normalizedKind)){
        if(
            normalizedLifecycle.startsWith('PARTIAL')
            || normalizedLifecycle === 'CANCELED'
            || normalizedLifecycle === 'EXPIRED'
            || normalizedLifecycle === 'EXPIRED_IN_MATCH'
            || normalizedLifecycle === 'REJECTED'
        ){
            return 'high';
        }
    }

    if(
        normalizedLifecycle.startsWith('PARTIAL')
        || normalizedLifecycle === 'CANCELED'
        || normalizedLifecycle === 'EXPIRED'
        || normalizedLifecycle === 'EXPIRED_IN_MATCH'
        || normalizedLifecycle === 'REJECTED'
        || normalizedLifecycle === 'TRIGGERED'
    ){
        return 'medium';
    }

    return 'low';
}

const buildRuntimeEventCode = ({ strategyCategory = 'unknown', orderKind = 'UNKNOWN', lifecycle = 'UPDATED' } = {}) => {
    const category = String(strategyCategory || 'unknown').trim().toUpperCase() || 'UNKNOWN';
    const kind = String(orderKind || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    const normalizedLifecycle = String(lifecycle || 'UPDATED').trim().toUpperCase() || 'UPDATED';
    return `${category}_${kind}_${normalizedLifecycle}`;
}

const getAlgoEventDetail = (data = {}) => data?.ao || data?.or || data?.o || {};

const buildAlgoRuntimeEventContext = (detail = {}, fallbackUid = null) => {
    const clientAlgoId = getFirstDefinedValue(
        detail.clientAlgoId,
        detail.caid,
        detail.c,
        detail.clientOrderId,
        detail.clientStrategyId,
        detail.newClientStrategyId
    );
    const orderContext = resolveRuntimeOrderContext(clientAlgoId, fallbackUid);
    return {
        ...orderContext,
        clientAlgoId: clientAlgoId || null,
        algoId: getFirstDefinedValue(detail.algoId, detail.aid, detail.strategyId, detail.sid),
        actualOrderId: getFirstDefinedValue(detail.actualOrderId, detail.orderId, detail.i),
    };
}

const logBinanceRuntimeEvent = async (event = {}) => {
    const uid = toNullableRuntimeNumber(event.uid);
    if(!(uid > 0)){
        return null;
    }

    return await insertBinanceRuntimeEventLog(event);
}

const logOrderTradeRuntimeEvent = (uid, data) => {
    try{
        const order = data?.o;
        if(!order){
            return;
        }

        const context = resolveRuntimeOrderContext(order.c, uid);
        const lifecycle = resolveOrderRuntimeLifecycle(order);
        const eventType = 'ORDER_TRADE_UPDATE';
        const eventCode = buildRuntimeEventCode({
            strategyCategory: context.strategyCategory,
            orderKind: context.orderKind,
            lifecycle,
        });

        Promise.resolve(logBinanceRuntimeEvent({
            uid: context.uid ?? uid,
            pid: context.pid,
            strategyCategory: context.strategyCategory,
            eventType,
            eventCode,
            severity: resolveRuntimeEventSeverity({
                orderKind: context.orderKind,
                lifecycle,
                eventType,
            }),
            symbol: order.s || null,
            side: order.S || null,
            positionSide: order.ps || null,
            clientOrderId: context.clientOrderId,
            clientAlgoId: null,
            orderId: order.i || null,
            algoId: null,
            actualOrderId: null,
            executionType: order.x || null,
            orderStatus: order.X || null,
            algoStatus: null,
            rejectReason: null,
            expireReason: order.er !== undefined && order.er !== null ? String(order.er) : null,
            orderType: order.o || null,
            origType: order.ot || null,
            quantity: order.q || null,
            executedQty: order.z || null,
            avgPrice: order.ap || null,
            lastPrice: order.L || null,
            eventTime: data.E || data.T || null,
            tradeTime: order.T || null,
            note: `execType:${order.x || '-'}, endStatus:${order.X || '-'}, expireReason:${order.er ?? '-'}`,
            payload: data,
        })).catch(() => {});
    }catch(error){
    }
}

const logAlgoUpdateRuntimeEvent = (uid, data) => {
    try{
        const detail = getAlgoEventDetail(data);
        const context = buildAlgoRuntimeEventContext(detail, uid);
        const algoStatus = getFirstDefinedValue(detail.algoStatus, detail.st, detail.X, detail.x, detail.status);
        const lifecycle = resolveAlgoRuntimeLifecycle(algoStatus);
        const eventType = 'ALGO_UPDATE';
        const eventCode = buildRuntimeEventCode({
            strategyCategory: context.strategyCategory,
            orderKind: context.orderKind,
            lifecycle,
        });

        updateBinanceRuntimeMeta(uid, {
            connected: true,
            status: 'CONNECTED',
            lastAlgoUpdateAt: new Date().toISOString(),
        });

        Promise.resolve(logBinanceRuntimeEvent({
            uid: context.uid ?? uid,
            pid: context.pid,
            strategyCategory: context.strategyCategory,
            eventType,
            eventCode,
            severity: resolveRuntimeEventSeverity({
                orderKind: context.orderKind,
                lifecycle,
                eventType,
            }),
            symbol: getFirstDefinedValue(detail.symbol, detail.s),
            side: getFirstDefinedValue(detail.side, detail.S),
            positionSide: getFirstDefinedValue(detail.positionSide, detail.ps),
            clientOrderId: null,
            clientAlgoId: context.clientAlgoId,
            orderId: null,
            algoId: context.algoId,
            actualOrderId: context.actualOrderId,
            executionType: null,
            orderStatus: null,
            algoStatus: algoStatus || null,
            rejectReason: getFirstDefinedValue(detail.rejectReason, detail.r),
            expireReason: detail.er !== undefined && detail.er !== null ? String(detail.er) : null,
            orderType: getFirstDefinedValue(detail.orderType, detail.ot, detail.type),
            origType: getFirstDefinedValue(detail.origType, detail.oot),
            quantity: getFirstDefinedValue(detail.quantity, detail.q),
            executedQty: getFirstDefinedValue(detail.executedQty, detail.z),
            avgPrice: getFirstDefinedValue(detail.avgPrice, detail.ap),
            lastPrice: getFirstDefinedValue(detail.lastPrice, detail.L),
            eventTime: data.E || data.T || null,
            tradeTime: getFirstDefinedValue(detail.tradeTime, detail.T),
            note: `algoStatus:${algoStatus || '-'}, clientAlgoId:${context.clientAlgoId || '-'}`,
            payload: data,
        })).catch(() => {});
    }catch(error){
    }
}

const logConditionalTriggerRejectRuntimeEvent = (uid, data) => {
    try{
        const detail = getAlgoEventDetail(data);
        const context = buildAlgoRuntimeEventContext(detail, uid);
        const eventType = 'CONDITIONAL_ORDER_TRIGGER_REJECT';
        const lifecycle = 'TRIGGER_REJECT';
        const rejectReason = getFirstDefinedValue(detail.rejectReason, detail.r, data?.m, data?.msg);

        updateBinanceRuntimeMeta(uid, {
            connected: true,
            status: 'CONNECTED',
            lastConditionalRejectAt: new Date().toISOString(),
        });

        Promise.resolve(logBinanceRuntimeEvent({
            uid: context.uid ?? uid,
            pid: context.pid,
            strategyCategory: context.strategyCategory,
            eventType,
            eventCode: buildRuntimeEventCode({
                strategyCategory: context.strategyCategory,
                orderKind: context.orderKind,
                lifecycle,
            }),
            severity: 'high',
            symbol: getFirstDefinedValue(detail.symbol, detail.s),
            side: getFirstDefinedValue(detail.side, detail.S),
            positionSide: getFirstDefinedValue(detail.positionSide, detail.ps),
            clientOrderId: null,
            clientAlgoId: context.clientAlgoId,
            orderId: null,
            algoId: context.algoId,
            actualOrderId: context.actualOrderId,
            executionType: null,
            orderStatus: null,
            algoStatus: null,
            rejectReason: rejectReason || null,
            expireReason: null,
            orderType: getFirstDefinedValue(detail.orderType, detail.ot, detail.type),
            origType: getFirstDefinedValue(detail.origType, detail.oot),
            quantity: getFirstDefinedValue(detail.quantity, detail.q),
            executedQty: getFirstDefinedValue(detail.executedQty, detail.z),
            avgPrice: getFirstDefinedValue(detail.avgPrice, detail.ap),
            lastPrice: getFirstDefinedValue(detail.lastPrice, detail.L),
            eventTime: data.E || data.T || null,
            tradeTime: getFirstDefinedValue(detail.tradeTime, detail.T),
            note: rejectReason || 'conditional trigger rejected',
            payload: data,
        })).catch(() => {});

        exports.msgAdd(
            'conditionalReject',
            'CONDITIONAL_ORDER_TRIGGER_REJECT',
            String(rejectReason || 'conditional trigger rejected'),
            context.uid ?? uid,
            context.pid,
            context.algoId || null,
            getFirstDefinedValue(detail.symbol, detail.s),
            getFirstDefinedValue(detail.side, detail.S)
        );
    }catch(error){
    }
}

const handleAlgoReservationRuntimeUpdate = async (uid, data) => {
    let tracePayload = {
        uid,
        eventType: data?.e || null,
    };
    let outcome = 'IGNORED';
    try{
        const detail = getAlgoEventDetail(data);
        const context = buildAlgoRuntimeEventContext(detail, uid);
        const clientAlgoId = String(context.clientAlgoId || '').trim();
        tracePayload = {
            ...tracePayload,
            pid: context.pid || null,
            clientAlgoId: clientAlgoId || null,
            algoId: context.algoId || null,
            actualOrderId: context.actualOrderId || null,
            symbol: getFirstDefinedValue(detail.symbol, detail.s),
            side: getFirstDefinedValue(detail.side, detail.S),
            positionSide: getFirstDefinedValue(detail.positionSide, detail.ps),
        };
        logOrderRuntimeTrace('ALGO_RUNTIME_HANDLER_START', {
            handler: 'handleAlgoReservationRuntimeUpdate',
            ...tracePayload,
        });
        if(!clientAlgoId){
            outcome = 'NO_CLIENT_ALGO_ID';
            return false;
        }

        const algoStatus = String(
            getFirstDefinedValue(detail.algoStatus, detail.st, detail.X, detail.x, detail.status) || ''
        ).trim().toUpperCase();

        if(context.actualOrderId){
            await pidPositionLedger.bindReservationActualOrderId(clientAlgoId, context.actualOrderId);
        }

        if(['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'].includes(algoStatus)){
            await pidPositionLedger.markReservationsCanceled([clientAlgoId]);
            outcome = `RESERVATION_${algoStatus}`;
            return true;
        }

        outcome = 'NO_STATE_CHANGE';
        return false;
    }catch(error){
        outcome = 'ERROR';
        logOrderRuntimeTrace('ALGO_RUNTIME_HANDLER_ERROR', {
            handler: 'handleAlgoReservationRuntimeUpdate',
            ...tracePayload,
            message: error?.message || String(error),
            stack: error?.stack || null,
        });
        return false;
    }finally{
        logOrderRuntimeTrace('ALGO_RUNTIME_HANDLER_END', {
            handler: 'handleAlgoReservationRuntimeUpdate',
            ...tracePayload,
            outcome,
        });
    }
}

const handleConditionalTriggerRejectReservationUpdate = async (uid, data) => {
    let tracePayload = {
        uid,
        eventType: data?.e || null,
    };
    let outcome = 'IGNORED';
    try{
        const detail = getAlgoEventDetail(data);
        const context = buildAlgoRuntimeEventContext(detail, uid);
        const clientAlgoId = String(context.clientAlgoId || '').trim();
        tracePayload = {
            ...tracePayload,
            pid: context.pid || null,
            clientAlgoId: clientAlgoId || null,
            algoId: context.algoId || null,
            actualOrderId: context.actualOrderId || null,
            symbol: getFirstDefinedValue(detail.symbol, detail.s),
            side: getFirstDefinedValue(detail.side, detail.S),
            positionSide: getFirstDefinedValue(detail.positionSide, detail.ps),
        };
        logOrderRuntimeTrace('ALGO_REJECT_HANDLER_START', {
            handler: 'handleConditionalTriggerRejectReservationUpdate',
            ...tracePayload,
        });
        if(!clientAlgoId){
            outcome = 'NO_CLIENT_ALGO_ID';
            return false;
        }

        await pidPositionLedger.markReservationsCanceled([clientAlgoId]);
        outcome = 'RESERVATION_CANCELED';
        return true;
    }catch(error){
        outcome = 'ERROR';
        logOrderRuntimeTrace('ALGO_REJECT_HANDLER_ERROR', {
            handler: 'handleConditionalTriggerRejectReservationUpdate',
            ...tracePayload,
            message: error?.message || String(error),
            stack: error?.stack || null,
        });
        return false;
    }finally{
        logOrderRuntimeTrace('ALGO_REJECT_HANDLER_END', {
            handler: 'handleConditionalTriggerRejectReservationUpdate',
            ...tracePayload,
            outcome,
        });
    }
}

const buildExternalCloseRuntimeOrderId = (uid, pid, oid = null) =>
    `EXTERNAL_${uid}_${pid}_${oid || Date.now()}`;

const loadLatestLivePlayForCloseSide = async (uid, symbol, closeSide) => {
    const signalType = resolveEntrySignalTypeFromCloseSide(null, closeSide);
    if(!uid || !symbol || !signalType){
        return null;
    }

    const rows = await dbcon.DBOriginCall(
        `SELECT * FROM live_play_list
          WHERE uid = ?
            AND symbol = ?
            AND status = 'EXACT'
            AND COALESCE(NULLIF(r_signalType, ''), signalType) = ?
          ORDER BY id DESC
          LIMIT 1`,
        [uid, symbol, signalType]
    );

    if(!Array.isArray(rows) || rows.length === 0){
        return null;
    }

    return rows[0];
}

const finalizeExternalClose = async ({
    uid,
    symbol,
    side,
    oid,
    clientOrderId,
    price,
    qty,
    charge,
    pnl,
    updateTime,
}) => {
    const play = await loadLatestLivePlayForCloseSide(uid, symbol, side);
    if(!play){
        return false;
    }

    const resolvedPlaySignalType = getResolvedLiveSignalType(play);
    const stillOpen = await waitForExchangeOpenPosition(uid, symbol, resolvedPlaySignalType, 4, 200);
    if(stillOpen){
        exports.msgAdd(
            'externalCloseCandidate',
            'EXTERNAL_CLOSE_SKIPPED',
            `pid:${play.id}, symbol:${symbol}, side:${side}, clientOrderId:${clientOrderId || 'NONE'}, reason:position-still-open`,
            uid,
            play.id,
            oid,
            symbol,
            side
        );
        return false;
    }

    await cancelBoundExitOrders(uid, symbol, play.id);

    const resolvedSignalType = resolvedPlaySignalType || resolveEntrySignalTypeFromCloseSide(null, side);
    const resolvedSignalTime = play.r_signalTime || play.r_exactTime || null;
    const totalPnl = Number(pnl || 0) + Number(play.r_splitRealizedPnl || 0);
    const totalCharge = Number(charge || 0) + Number(play.r_splitRealizedCharge || 0);
    const endType = totalPnl > 0 ? 'PROFIT' : 'STOP';
    const positionSize = play.leverage * play.margin;
    const exitReasonCode = runtimeState.getExitReasonCode('external-close');
    const exitMode = runtimeState.getExitMode('external-close', endType);

    const runtimeOrderId = buildExternalCloseRuntimeOrderId(uid, play.id, oid);

    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        uid,
        play.id,
        runtimeOrderId,
        oid || null,

        endType,

        play.symbol,
        play.leverage,
        play.margin,
        positionSize,

        play.type,
        play.bunbong,

        resolvedSignalType,
        play.r_signalPrice,
        resolvedSignalTime,

        play.r_exactPrice,
        price,

        totalPnl,
        totalPnl,

        totalPnl > 0 ? true : false,
        totalPnl < 0 ? true : false,

        totalCharge,
        parseFloat(totalCharge || 0) + parseFloat(play.r_t_charge || 0),
        play.r_exactTime,
        getKorTime(updateTime),
        exitReasonCode,
        exitMode,
    ]);

    await setLivePlayReadyModeIfCurrent(play, play.status);

    await evaluateLiveStrategyPoliciesAfterClose(uid, play.id);

    exports.msgAdd(
        'externalCloseReconcile',
        'EXTERNAL_CLOSE',
        `pid:${play.id}, symbol:${symbol}, side:${side}, clientOrderId:${clientOrderId || 'NONE'}, runtimeOrderId:${runtimeOrderId}, price:${price}, qty:${qty}, runtime:${runtimeState.getRuntimeState(play.status)}`,
        uid,
        play.id,
        oid,
        symbol,
        side
    );

    return true;
}

const getEnterClientOrderId = (uid, pid) => `NEW_${uid}_${pid}`;
const getCloseClientOrderId = (type, uid, pid, r_tid) => `${type}_${uid}_${pid}_${r_tid}`;
const BOUND_EXIT_TYPES = new Set(['PROFIT', 'STOP', 'SPLITTP']);

const buildSignedQuery = (secret, params = {}) => {
    const query = new URLSearchParams(params).toString();
    const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
    return `${query}&signature=${signature}`;
}

const syncFuturesServerTime = async (force = false) => {
    const now = Date.now();
    if(!force && futuresServerTimeSyncedAt > 0 && (now - futuresServerTimeSyncedAt) < 60000){
        return futuresServerTimeOffsetMs;
    }

    const response = await axios.get(`${FUTURES_BASE_URL}/fapi/v1/time`, {
        timeout: 5000,
    });
    const serverTime = Number(response?.data?.serverTime || 0);
    if(Number.isFinite(serverTime) && serverTime > 0){
        futuresServerTimeOffsetMs = serverTime - Date.now();
        futuresServerTimeSyncedAt = Date.now();
    }

    return futuresServerTimeOffsetMs;
}

const getFuturesTimestamp = () => Date.now() + futuresServerTimeOffsetMs - 1000;

const getMemberApiRuntime = (uid) => {
    return binanceClientRuntime[uid] || null;
}

const resolveMemberApiCredentials = async (uid) => {
    const runtime = getMemberApiRuntime(uid);
    if(runtime?.appKey && runtime?.appSecret){
        return {
            appKey: runtime.appKey,
            appSecret: credentialSecrets.revealSecret(runtime.appSecret),
        };
    }

    const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [uid]);
    if(member?.appKey && member?.appSecret){
        return {
            appKey: member.appKey,
            appSecret: credentialSecrets.revealSecret(member.appSecret),
        };
    }

    return null;
}

const ensureBinanceApiClient = async (uid, options = {}) => {
    if(!uid){
        return false;
    }

    if(isQaReplayMode() && !binance[uid]){
        updateBinanceRuntimeMeta(uid, {
            connected: false,
            status: 'QA_REPLAY_WRITE_BLOCKED',
            lastErrorCode: 'QA_REPLAY_MODE_BINANCE_CLIENT_BLOCKED',
            lastErrorMessage: 'QA replay cannot initialize a real Binance write-capable client',
        });
        return false;
    }

    if(isExcludedRuntimeUid(uid)){
        markBinanceRuntimeExcluded(uid);
        return false;
    }

    if(binance[uid]){
        return true;
    }

    const credentials = await resolveMemberApiCredentials(uid);
    if(!credentials?.appKey || !credentials?.appSecret){
        return false;
    }

    const result = await initAPI(uid, credentials.appKey, credentials.appSecret, {
        enableUserStream: options.enableUserStream === true,
    });

    return Boolean(result && binance[uid]);
}

const privateFuturesSignedRequest = async (uid, path, params = {}, method = 'GET') => {
    const normalizedMethod = String(method || 'GET').trim().toUpperCase();
    if(normalizedMethod !== 'GET'){
        await assertBinanceWriteAllowedOrLog({
            uid,
            action: `SIGNED_${normalizedMethod}`,
            symbol: params?.symbol || null,
            clientOrderId: params?.clientAlgoId || params?.newClientOrderId || params?.origClientOrderId || null,
            orderId: params?.orderId || params?.algoId || null,
            caller: `coin.privateFuturesSignedRequest:${path}`,
        });
    }

    if(isExcludedRuntimeUid(uid)){
        const error = new Error('runtime excluded');
        error.code = -90022;
        throw error;
    }

    binanceReadGuard.assertPrivateRequestAllowed({
        uid,
        endpoint: path,
        method: normalizedMethod,
    });

    const credentials = await resolveMemberApiCredentials(uid);
    if(!credentials?.appKey || !credentials?.appSecret){
        const error = new Error('futures api credentials not initialized');
        error.code = -90021;
        throw error;
    }

    await syncFuturesServerTime(false).catch(() => {});

    const requestOnce = async () => {
        const signedQuery = buildSignedQuery(credentials.appSecret, {
            ...params,
            recvWindow: 10000,
            timestamp: getFuturesTimestamp(),
        });

        const url = `${FUTURES_BASE_URL}${path}?${signedQuery}`;
        const response = await axios({
            method: normalizedMethod,
            url,
            timeout: 10000,
            headers: {
                'X-MBX-APIKEY': credentials.appKey,
            },
        });

        binanceReadGuard.recordPrivateRequestSuccess({
            uid,
            endpoint: path,
            method: normalizedMethod,
        });

        return response.data;
    };

    try{
        return await requestOnce();
    }catch(error){
        binanceReadGuard.recordPrivateRequestFailure({
            uid,
            endpoint: path,
            method: normalizedMethod,
            error,
        });
        const info = extractBinanceError(error);
        if(Number(info.code) === -1021){
            await syncFuturesServerTime(true);
            return await requestOnce();
        }
        throw error;
    }
}

const privateFuturesAlgoRequest = async (uid, path, params = {}, method = 'GET') => {
    return privateFuturesSignedRequest(uid, path, params, method);
}

const toAccountRiskNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

const getAccountRiskPercent = (numerator, denominator) => {
    const numericNumerator = toAccountRiskNumber(numerator);
    const numericDenominator = toAccountRiskNumber(denominator);
    if(numericDenominator <= 0){
        return numericNumerator > 0 ? 100 : 0;
    }
    return Number(((numericNumerator / numericDenominator) * 100).toFixed(4));
}

const getAccountRiskLevel = ({ accountMarginRatio = 0, accountEquity = 0, accountMaintMargin = 0, positionCount = 0 } = {}) => {
    const ratio = toAccountRiskNumber(accountMarginRatio);
    const equity = toAccountRiskNumber(accountEquity);
    const maint = toAccountRiskNumber(accountMaintMargin);
    const positions = Number(positionCount || 0);

    if(positions <= 0 && maint <= 0){
        return 'SAFE';
    }

    if(equity <= 0 && maint > 0){
        return 'CRITICAL';
    }

    if(ratio >= 80){
        return 'CRITICAL';
    }
    if(ratio >= 60){
        return 'DANGER';
    }
    if(ratio >= 40){
        return 'WARNING';
    }
    if(ratio >= 20){
        return 'WATCH';
    }

    return 'SAFE';
}

const ensureAccountRiskSnapshotCache = (uid) => {
    if(!uid){
        return null;
    }

    if(!accountRiskSnapshotCache[uid]){
        accountRiskSnapshotCache[uid] = {
            uid,
            latest: null,
            lastFetchedAt: null,
            lastPersistedAt: null,
        };
    }

    return accountRiskSnapshotCache[uid];
}

const buildAccountRiskSnapshot = (uid, accountInfo = {}, options = {}) => {
    const totalWalletBalance = toAccountRiskNumber(accountInfo.totalWalletBalance);
    const totalUnrealizedProfit = toAccountRiskNumber(accountInfo.totalUnrealizedProfit);
    const totalMarginBalance = toAccountRiskNumber(accountInfo.totalMarginBalance);
    const totalMaintMargin = toAccountRiskNumber(accountInfo.totalMaintMargin);
    const totalInitialMargin = toAccountRiskNumber(accountInfo.totalInitialMargin);
    const totalPositionInitialMargin = toAccountRiskNumber(accountInfo.totalPositionInitialMargin);
    const totalOpenOrderInitialMargin = toAccountRiskNumber(accountInfo.totalOpenOrderInitialMargin);
    const totalCrossWalletBalance = toAccountRiskNumber(accountInfo.totalCrossWalletBalance);
    const totalCrossUnPnl = toAccountRiskNumber(accountInfo.totalCrossUnPnl);
    const availableBalance = toAccountRiskNumber(accountInfo.availableBalance);
    const maxWithdrawAmount = toAccountRiskNumber(accountInfo.maxWithdrawAmount);
    const accountEquity = totalMarginBalance;
    const accountMaintMargin = totalMaintMargin;
    const accountMarginRatio = getAccountRiskPercent(accountMaintMargin, accountEquity);
    const accountInitialMarginRatio = getAccountRiskPercent(totalInitialMargin, accountEquity);
    const accountOpenOrderMarginRatio = getAccountRiskPercent(totalOpenOrderInitialMargin, accountEquity);
    const accountMarginBuffer = Number((accountEquity - accountMaintMargin).toFixed(8));
    const positions = Array.isArray(accountInfo.positions) ? accountInfo.positions : [];
    const positionCount = positions.filter((item) => Math.abs(toAccountRiskNumber(item?.positionAmt)) > 0).length;
    const accountMode = accountInfo.multiAssetsMargin ? 'MULTI_ASSET' : 'SINGLE_ASSET';
    const hedgeMode = Boolean(options.hedgeMode);
    const positionMode = hedgeMode ? 'HEDGE' : 'ONE_WAY';
    const riskLevel = getAccountRiskLevel({
        accountMarginRatio,
        accountEquity,
        accountMaintMargin,
        positionCount,
    });

    return {
        uid,
        accountMode,
        hedgeMode,
        positionMode,
        riskLevel,
        positionCount,
        totalWalletBalance,
        totalUnrealizedProfit,
        totalMarginBalance,
        totalMaintMargin,
        totalInitialMargin,
        totalPositionInitialMargin,
        totalOpenOrderInitialMargin,
        totalCrossWalletBalance,
        totalCrossUnPnl,
        availableBalance,
        maxWithdrawAmount,
        accountEquity,
        accountMaintMargin,
        accountMarginRatio,
        accountInitialMarginRatio,
        accountOpenOrderMarginRatio,
        accountMarginBuffer,
        payloadJson: accountInfo,
        capturedAt: new Date().toISOString(),
    };
}

const persistAccountRiskSnapshot = async (snapshot) => {
    if(!snapshot?.uid){
        return null;
    }

    await db.query(
        `INSERT INTO account_risk_snapshot (
            uid, account_mode, risk_level, position_count,
            total_wallet_balance, total_unrealized_profit, total_margin_balance,
            total_maint_margin, total_initial_margin, total_position_initial_margin,
            total_open_order_initial_margin, total_cross_wallet_balance, total_cross_un_pnl,
            available_balance, max_withdraw_amount, account_equity, account_maint_margin,
            account_margin_ratio, account_initial_margin_ratio, account_open_order_margin_ratio,
            account_margin_buffer, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            snapshot.uid,
            snapshot.accountMode,
            snapshot.riskLevel,
            snapshot.positionCount,
            snapshot.totalWalletBalance,
            snapshot.totalUnrealizedProfit,
            snapshot.totalMarginBalance,
            snapshot.totalMaintMargin,
            snapshot.totalInitialMargin,
            snapshot.totalPositionInitialMargin,
            snapshot.totalOpenOrderInitialMargin,
            snapshot.totalCrossWalletBalance,
            snapshot.totalCrossUnPnl,
            snapshot.availableBalance,
            snapshot.maxWithdrawAmount,
            snapshot.accountEquity,
            snapshot.accountMaintMargin,
            snapshot.accountMarginRatio,
            snapshot.accountInitialMarginRatio,
            snapshot.accountOpenOrderMarginRatio,
            snapshot.accountMarginBuffer,
            JSON.stringify(snapshot.payloadJson || {}),
        ]
    );

    return snapshot;
}

const getBinancePositionMode = async (uid) => {
    if(!uid){
        return false;
    }

    try{
        const response = await privateFuturesSignedRequest(uid, '/fapi/v1/positionSide/dual', {}, 'GET');
        return Boolean(response?.dualSidePosition);
    }catch(error){
        if(binance[uid]?.futuresPositionSideDual){
            try{
                const response = await binance[uid].futuresPositionSideDual();
                return Boolean(response?.dualSidePosition);
            }catch(innerError){
            }
        }

        throw error;
    }
}

const roundToStep = (value, step, mode = 'nearest') => {
    const numericValue = Number(value);
    const numericStep = Number(step);

    if(!Number.isFinite(numericValue) || !Number.isFinite(numericStep) || numericStep <= 0){
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    const precision = numericStep.toString().split('.')[1]?.length || 0;
    const ratio = Number((numericValue / numericStep).toFixed(12));
    const tolerance = 1e-9;

    let roundedRatio = Math.round(ratio);
    if(mode === 'up'){
        roundedRatio = Math.ceil(ratio - tolerance);
    }else if(mode === 'down'){
        roundedRatio = Math.floor(ratio + tolerance);
    }

    return Number((roundedRatio * numericStep).toFixed(precision));
}

const loadSymbolOrderRules = async (uid, symbol) => {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase().replace(/\.P$/i, '');
    if(!normalizedSymbol){
        return null;
    }

    try{
        const sharedRules = await getExchangeSymbolRuleSummary(normalizedSymbol);
        if(sharedRules){
            return {
                symbolInfo: sharedRules,
                stepSize: Number(sharedRules.stepSize || sharedRules.marketStepSize || 0),
                minQty: Number(sharedRules.minQty || sharedRules.marketMinQty || 0),
                tickSize: Number(sharedRules.tickSize || 0),
                minTradeValue: Number(sharedRules.minTradeValue || 0),
            };
        }
    }catch(ruleError){
    }

    if(!(await ensureBinanceApiClient(uid))){
        return null;
    }

    const client = binance?.[uid];
    if(!client || typeof client.futuresExchangeInfo !== 'function'){
        return null;
    }

    const info = await client.futuresExchangeInfo();
    const symbolInfo = info?.symbols?.find((item) => item.symbol === normalizedSymbol);
    if(!symbolInfo){
        return null;
    }

    const lotSize = symbolInfo.filters.find((item) => item.filterType === 'LOT_SIZE');
    const marketLotSize = symbolInfo.filters.find((item) => item.filterType === 'MARKET_LOT_SIZE');
    const priceFilter = symbolInfo.filters.find((item) => item.filterType === 'PRICE_FILTER');
    const minNotional = symbolInfo.filters.find((item) => item.filterType === 'MIN_NOTIONAL');
    const notional = symbolInfo.filters.find((item) => item.filterType === 'NOTIONAL');

    return {
        symbolInfo,
        stepSize: Number(marketLotSize?.stepSize || lotSize?.stepSize || 0),
        minQty: Number(marketLotSize?.minQty || lotSize?.minQty || 0),
        tickSize: Number(priceFilter?.tickSize || 0),
        minTradeValue: Number(minNotional?.notional || notional?.minNotional || notional?.notional || 0),
    };
}

const persistLiveBoundPrices = async (pid, profitPrice = 0, stopPrice = 0) => {
    if(!pid){
        return;
    }

    try{
        const result = await dbcon.DBCall(`CALL SP_LIVE_PLAY_BOUND_PRICE_SET(?,?,?)`, [
            pid,
            Number(profitPrice || 0),
            Number(stopPrice || 0),
        ]);

        if(result !== false){
            return;
        }
    }catch(error){
    }

    await dbcon.DBCall(
        `UPDATE live_play_list SET r_profitPrice = ?, r_stopPrice = ? WHERE id = ?`,
        [Number(profitPrice || 0), Number(stopPrice || 0), pid]
    );
}

const persistLiveSplitRuntime = async (pid, values = {}) => {
    if(!pid || !values || typeof values !== 'object'){
        return false;
    }

    const allowedFields = [
        'r_qty',
        'r_profitPrice',
        'r_stopPrice',
        'r_splitEntryQty',
        'r_splitStageIndex',
        'r_splitRealizedQty',
        'r_splitRealizedPnl',
        'r_splitRealizedCharge',
    ];
    const updateKeys = Object.keys(values).filter((key) => allowedFields.includes(key));
    if(updateKeys.length === 0){
        return true;
    }

    const setClause = updateKeys.map((key) => `${key} = ?`).join(', ');
    const params = updateKeys.map((key) => values[key]).concat(pid);
    const result = await dbcon.DBCall(
        `UPDATE live_play_list SET ${setClause} WHERE id = ?`,
        params
    );

    return result !== false;
}

const getLiveSplitTakeProfitConfig = (play) => splitTakeProfit.parseSplitTakeProfitConfig(play);

const resolveLiveSplitStageContext = (play, entryPrice, orderRules) => {
    const config = getLiveSplitTakeProfitConfig(play);
    if(!config.enabled){
        return null;
    }

    const stageIndex = Math.max(0, Number(play?.r_splitStageIndex || 0));
    const stage = config.stages[stageIndex] || null;
    const previousStage = stageIndex > 0 ? config.stages[stageIndex - 1] : null;
    const exactPrice = Number(entryPrice || play?.r_exactPrice || 0);
    const entryQty = Number(play?.r_splitEntryQty || play?.r_qty || 0);
    const remainingQty = Number(play?.r_qty || 0);

    if(!stage || !exactPrice || !entryQty || !remainingQty){
        return {
            enabled: true,
            config,
            stageIndex,
            stage: null,
            previousStage,
            exactPrice,
            entryQty,
            remainingQty,
            stopPrice: 0,
            profitPrice: 0,
            stageQty: 0,
            isLastStage: true,
        };
    }

    const isLastStage = stageIndex >= config.stages.length - 1;
    const initialStopPrice = resolveBoundStopPrice(play, exactPrice, orderRules?.tickSize);
    const ratchetedStopPrice = previousStage
        ? splitTakeProfit.computeRatchetedStopPrice({
            signalType: play?.r_signalType,
            entryPrice: exactPrice,
            stageTpPercent: previousStage.tpPercent,
            gapPercent: config.gapPercent,
            fallbackStopPrice: initialStopPrice,
        })
        : initialStopPrice;
    const profitPrice = splitTakeProfit.computeStagePrice(
        play?.r_signalType,
        exactPrice,
        stage.tpPercent
    );
    const stageQty = splitTakeProfit.resolveStageCloseQty({
        entryQty,
        remainingQty,
        stage,
        isLastStage,
        roundQty: (value) => roundToStep(value, orderRules?.stepSize || 0.001, 'down'),
        minQty: Number(orderRules?.minQty || 0),
    });

    return {
        enabled: true,
        config,
        stageIndex,
        stage,
        previousStage,
        exactPrice,
        entryQty,
        remainingQty,
        stopPrice: roundToStep(ratchetedStopPrice, orderRules?.tickSize || 0.01, 'nearest'),
        profitPrice: roundToStep(profitPrice, orderRules?.tickSize || 0.01, 'nearest'),
        stageQty,
        isLastStage,
    };
}

const getSplitTradeAccumulatorKey = (uid, pid, oid, clientOrderId) =>
    `${uid}:${pid}:${oid || '0'}:${clientOrderId || 'NONE'}`;

const appendSplitTradeAccumulator = ({ uid, pid, oid, clientOrderId, qty = 0, pnl = 0, charge = 0 }) => {
    const key = getSplitTradeAccumulatorKey(uid, pid, oid, clientOrderId);
    const current = liveSplitTradeAccumulators.get(key) || {
        qty: 0,
        pnl: 0,
        charge: 0,
    };

    current.qty += Number(qty || 0);
    current.pnl += Number(pnl || 0);
    current.charge += Number(charge || 0);
    liveSplitTradeAccumulators.set(key, current);
    return { key, current };
}

const consumeSplitTradeAccumulator = ({ uid, pid, oid, clientOrderId }) => {
    const key = getSplitTradeAccumulatorKey(uid, pid, oid, clientOrderId);
    const current = liveSplitTradeAccumulators.get(key) || {
        qty: 0,
        pnl: 0,
        charge: 0,
    };
    liveSplitTradeAccumulators.delete(key);
    return current;
}

const resolveBoundProfitPrice = (play, entryPrice, tickSize) => {
    if(!play || !Number(entryPrice)){
        return 0;
    }

    const signalType = getResolvedLiveSignalType(play);
    if(!signalType){
        return 0;
    }

    let rawPrice = 0;
    if(play.profitTradeType === 'abs'){
        rawPrice = Number(play.profitAbsValue || 0);
    }else{
        const profitRate = Number(play.profit || 0) * 0.01;
        rawPrice = signalType === 'BUY'
            ? Number(entryPrice) * (1 + profitRate)
            : Number(entryPrice) * (1 - profitRate);
    }

    if(rawPrice <= 0){
        return 0;
    }

    return roundToStep(rawPrice, tickSize || 0.01, 'nearest');
}

const hasConfiguredPercentStopLoss = (play) => (
    play?.lossTradeType === 'per'
    && Number(play?.stopLoss || 0) > 0
);

const resolveBoundStopPrice = (play, entryPrice, tickSize) => {
    if(!play || !hasConfiguredPercentStopLoss(play) || !Number(entryPrice)){
        return 0;
    }

    const signalType = getResolvedLiveSignalType(play);
    if(!signalType){
        return 0;
    }

    const stopRate = Number(play.stopLoss || 0) * 0.01;
    const rawPrice = signalType === 'BUY'
        ? Number(entryPrice) * (1 - stopRate)
        : Number(entryPrice) * (1 + stopRate);

    if(rawPrice <= 0){
        return 0;
    }

    return roundToStep(rawPrice, tickSize || 0.01, 'nearest');
}

const getResolvedLiveSignalType = (play) => {
    const normalized = String(play?.r_signalType || play?.signalType || '')
        .trim()
        .toUpperCase();
    return normalized || null;
}

const listOpenBoundExitOrders = async (uid, symbol, pid) => {
    if(!symbol || !pid){
        return [];
    }

    if(!(await ensureBinanceApiClient(uid))){
        return [];
    }

    try{
        const openOrders = await binance[uid].futuresOpenOrders(symbol);
        const futuresOrders = (openOrders || [])
            .filter((order) => {
                const clientOrderId = String(order.clientOrderId || order.origClientOrderId || '');
                return clientOrderId.includes(`_${uid}_${pid}_`) && BOUND_EXIT_TYPES.has(clientOrderId.split('_')[0]);
            })
            .map((order) => ({
                orderId: order.orderId,
                clientOrderId: String(order.clientOrderId || order.origClientOrderId || ''),
                __isAlgo: false,
                quantity: Number(order.origQty || order.quantity || 0),
                triggerPrice: Number(order.stopPrice || 0),
                price: Number(order.price || 0),
                raw: order,
            }));

        let algoOrders = [];
        try{
            const openAlgoOrders = await privateFuturesAlgoRequest(uid, '/fapi/v1/openAlgoOrders', { symbol }, 'GET');
            algoOrders = (openAlgoOrders || []).filter((order) => {
                const clientOrderId = String(order.clientAlgoId || order.newClientStrategyId || '');
                return clientOrderId.includes(`_${uid}_${pid}_`) && BOUND_EXIT_TYPES.has(clientOrderId.split('_')[0]);
            }).map((order) => ({
                orderId: order.algoId || order.strategyId,
                clientOrderId: String(order.clientAlgoId || order.newClientStrategyId || ''),
                __isAlgo: true,
                quantity: Number(order.quantity || order.origQty || 0),
                triggerPrice: Number(order.triggerPrice || order.stopPrice || 0),
                price: Number(order.price || 0),
                raw: order,
            }));
        }catch(error){
        }

        return [...futuresOrders, ...algoOrders];
    }catch(error){
        return [];
    }
}

const getBoundOrderPrefix = (clientOrderId) => String(clientOrderId || '').split('_')[0];

const isBinanceTruthy = (value) => {
    if(typeof value === 'boolean'){
        return value;
    }

    const normalized = String(value ?? '').trim().toUpperCase();
    return normalized === 'TRUE' || normalized === '1' || normalized === 'Y';
}

const toExchangeEventTime = (value) => {
    if(value == null || value === ''){
        return 0;
    }

    const numeric = Number(value);
    if(Number.isFinite(numeric) && numeric > 0){
        return numeric;
    }

    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const compareRecoveredFillUnits = (left, right) => {
    const timeDiff = Number(left?.tradeTime || 0) - Number(right?.tradeTime || 0);
    if(timeDiff !== 0){
        return timeDiff;
    }

    const orderDiff = String(left?.orderId || '').localeCompare(String(right?.orderId || ''));
    if(orderDiff !== 0){
        return orderDiff;
    }

    const tradeDiff = String(left?.tradeId || '').localeCompare(String(right?.tradeId || ''));
    if(tradeDiff !== 0){
        return tradeDiff;
    }

    return String(left?.clientOrderId || '').localeCompare(String(right?.clientOrderId || ''));
}

const buildRecoveredOrderFillUnits = ({
    targetOrder,
    matchedTrades = [],
    side,
    positionSide,
    defaultRealizedPnl = 0,
}) => {
    const normalizedSide = String(side || '').trim().toUpperCase();
    const normalizedPositionSide = String(positionSide || '').trim().toUpperCase();
    const clientOrderId = String(targetOrder?.clientOrderId || '').trim();
    const orderId = Number(targetOrder?.orderId || 0) || null;
    const fallbackPrice = Number(targetOrder?.avgPrice || 0) > 0
        ? Number(targetOrder?.avgPrice || 0)
        : Number(targetOrder?.price || 0);
    const fallbackTradeTime = Number(targetOrder?.updateTime || targetOrder?.time || 0) || Date.now();

    const fillUnits = matchedTrades.length > 0
        ? matchedTrades
            .map((trade) => {
                const tradeQty = Number(trade?.qty || 0);
                const tradeQuoteQty = Number(trade?.quoteQty || 0);
                const tradePrice = Number(trade?.price || 0) > 0
                    ? Number(trade?.price || 0)
                    : tradeQty > 0 && tradeQuoteQty > 0
                        ? tradeQuoteQty / tradeQty
                        : fallbackPrice;
                const tradeTime = Number(trade?.time || fallbackTradeTime);
                if(!(tradeQty > 0) || !(tradePrice > 0)){
                    return null;
                }

                return {
                    clientOrderId,
                    orderId,
                    tradeId: trade?.id ?? trade?.tradeId ?? null,
                    qty: tradeQty,
                    fee: Number(trade?.commission || 0),
                    realizedPnl: Number(trade?.realizedPnl || defaultRealizedPnl || 0),
                    price: tradePrice,
                    tradeTime: tradeTime > 0 ? tradeTime : Date.now(),
                    side: normalizedSide,
                    positionSide: normalizedPositionSide,
                    rawOrder: targetOrder,
                    rawTrade: trade,
                };
            })
            .filter(Boolean)
            .sort(compareRecoveredFillUnits)
        : [{
            clientOrderId,
            orderId,
            tradeId: null,
            qty: getRecoveredFallbackFillQty(targetOrder),
            fee: 0,
            realizedPnl: Number(defaultRealizedPnl || 0),
            price: fallbackPrice,
            tradeTime: fallbackTradeTime,
            side: normalizedSide,
            positionSide: normalizedPositionSide,
            rawOrder: targetOrder,
            rawTrade: null,
        }];

    return fillUnits.filter((fill) => Number(fill?.qty || 0) > 0 && Number(fill?.price || 0) > 0);
}

const loadRecentSignalCloseExecutionFromExchange = async ({
    uid,
    pid,
    symbol,
    positionSide,
    candidateClientOrderIds = [],
    notBeforeTradeTime = null,
}) => {
    if(!uid || !pid || !symbol || !positionSide || !(await ensureBinanceApiClient(uid))){
        return null;
    }

    const normalizedPositionSide = String(positionSide || '').trim().toUpperCase();
    const closeSide = normalizedPositionSide === 'LONG' ? 'SELL' : normalizedPositionSide === 'SHORT' ? 'BUY' : null;
    if(!closeSide){
        return null;
    }

    const clientOrderIdSet = new Set(
        []
            .concat(candidateClientOrderIds || [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    );
    const pidNeedle = `_${uid}_${pid}_`;
    const minTradeTime = toExchangeEventTime(notBeforeTradeTime);

    let exchangeOrders = [];
    try{
        exchangeOrders = await binance[uid].futuresAllOrders(symbol, { limit: 100 });
    }catch(error){
        return null;
    }

    const candidates = (exchangeOrders || [])
        .filter((order) => {
            const clientOrderId = String(order?.clientOrderId || '').trim();
            if(!clientOrderId){
                return false;
            }

            const status = String(order?.status || '').toUpperCase();
            if(!isRecoverableFillOrderStatus(status)){
                return false;
            }

            if(String(order?.side || '').toUpperCase() !== closeSide){
                return false;
            }

            const orderPositionSide = String(order?.positionSide || '').trim().toUpperCase();
            if(orderPositionSide && orderPositionSide !== normalizedPositionSide){
                return false;
            }

            const prefix = getBoundOrderPrefix(clientOrderId);
            const isKnownExitOrder =
                runtimeState.isConditionalExitOrderType(prefix)
                || runtimeState.isMarketExitOrderType(prefix);
            if(!isKnownExitOrder && !isBinanceTruthy(order?.reduceOnly)){
                return false;
            }

            const orderTime = Number(order?.updateTime || order?.time || 0);
            if(minTradeTime > 0 && !(orderTime >= minTradeTime)){
                return false;
            }

            return clientOrderIdSet.has(clientOrderId) || clientOrderId.includes(pidNeedle);
        })
        .sort((left, right) =>
            Number(right?.updateTime || right?.time || 0) - Number(left?.updateTime || left?.time || 0)
        );

    if(candidates.length === 0){
        return null;
    }

    const targetOrder = candidates[0];

    let relatedTrades = [];
    try{
        relatedTrades = await binance[uid].futuresUserTrades(symbol, { limit: 100 });
    }catch(error){
        relatedTrades = [];
    }

    const fillUnits = candidates
        .flatMap((order) => {
            const matchedTrades = (relatedTrades || []).filter((trade) => {
                const tradeTime = Number(trade?.time || 0);
                if(minTradeTime > 0 && !(tradeTime >= minTradeTime)){
                    return false;
                }

                return Number(trade?.orderId || 0) === Number(order?.orderId || 0)
                    && String(trade?.side || '').trim().toUpperCase() === closeSide
                    && String(trade?.positionSide || '').trim().toUpperCase() === normalizedPositionSide;
            });

            return buildRecoveredOrderFillUnits({
                targetOrder: order,
                matchedTrades,
                side: closeSide,
                positionSide: normalizedPositionSide,
            });
        })
        .sort(compareRecoveredFillUnits);

    const qty = fillUnits.reduce((sum, item) => sum + Number(item?.qty || 0), 0);
    if(!(qty > 0)){
        return null;
    }

    const fee = fillUnits.reduce((sum, item) => sum + Number(item?.fee || 0), 0);
    const realizedPnl = fillUnits.reduce((sum, item) => sum + Number(item?.realizedPnl || 0), 0);
    const quoteQty = fillUnits.reduce((sum, item) => sum + (Number(item?.qty || 0) * Number(item?.price || 0)), 0);
    const avgPrice = Number(targetOrder?.avgPrice || 0);
    const price = avgPrice > 0
        ? avgPrice
        : qty > 0 && quoteQty > 0
            ? quoteQty / qty
            : Number(targetOrder?.price || 0);
    const tradeTime = fillUnits.length > 0
        ? Math.max(...fillUnits.map((item) => Number(item?.tradeTime || 0)))
        : Number(targetOrder?.updateTime || targetOrder?.time || 0);
    const tradeIds = Array.from(new Set(
        fillUnits
            .map((item) => item?.tradeId ?? null)
            .filter((value) => value != null && value !== '')
            .map((value) => String(value))
    ));

    return {
        clientOrderId: String(targetOrder?.clientOrderId || '').trim(),
        orderId: Number(targetOrder?.orderId || 0) || null,
        tradeId: tradeIds.length === 1 ? tradeIds[0] : null,
        qty,
        fee,
        realizedPnl,
        price,
        tradeTime: tradeTime > 0 ? tradeTime : Date.now(),
        side: closeSide,
        positionSide: normalizedPositionSide,
        rawOrder: targetOrder,
        rawOrders: candidates,
        rawTrades: relatedTrades,
        fills: fillUnits,
    };
}

const isSignalTimeExitClientOrderId = (clientOrderId, uid, pid) => {
    const parts = String(clientOrderId || '').trim().split('_');
    return parts.length >= 4
        && parts[0] === 'TIME'
        && Number(parts[1] || 0) === Number(uid || 0)
        && Number(parts[2] || 0) === Number(pid || 0);
}

const buildSignalTimeExitClientOrderIdCandidates = ({ uid, pid, row = null } = {}) => {
    const candidates = [];
    if(uid && pid && row?.r_tid){
        candidates.push(getCloseClientOrderId('TIME', uid, pid, row.r_tid));
    }

    return Array.from(new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean)));
}

const loadSignalTimeExitReservationClientOrderIds = async ({ uid, pid, positionSide }) => {
    if(!uid || !pid || !positionSide){
        return [];
    }

    const [rows] = await db.query(
        `SELECT clientOrderId
           FROM live_pid_exit_reservation
          WHERE uid = ?
            AND pid = ?
            AND strategyCategory = 'signal'
            AND positionSide = ?
            AND reservationKind = 'MARKET_TIME'
          ORDER BY updatedAt DESC, id DESC
          LIMIT 10`,
        [uid, pid, positionSide]
    );

    return (rows || [])
        .map((row) => String(row.clientOrderId || '').trim())
        .filter(Boolean);
}

const summarizeRecoveredFillUnits = (fills = []) => {
    const qty = fills.reduce((sum, item) => sum + Number(item?.qty || 0), 0);
    const fee = fills.reduce((sum, item) => sum + Number(item?.fee || 0), 0);
    const realizedPnl = fills.reduce((sum, item) => sum + Number(item?.realizedPnl || 0), 0);
    const quoteQty = fills.reduce((sum, item) => sum + (Number(item?.qty || 0) * Number(item?.price || 0)), 0);
    const tradeTime = fills.length > 0
        ? Math.max(...fills.map((item) => Number(item?.tradeTime || 0)))
        : Date.now();
    const tradeIds = Array.from(new Set(
        fills
            .map((item) => item?.tradeId ?? null)
            .filter((value) => value != null && value !== '')
            .map((value) => String(value))
    ));

    return {
        qty,
        fee,
        realizedPnl,
        price: qty > 0 && quoteQty > 0 ? quoteQty / qty : 0,
        tradeTime,
        tradeId: tradeIds.length === 1 ? tradeIds[0] : null,
    };
}

const filterSignalTimeExitFills = ({ fills = [], uid, pid } = {}) =>
    (fills || []).filter((fill) => isSignalTimeExitClientOrderId(fill?.clientOrderId, uid, pid));

const loadMissingSignalTimeExitExecutionFromExchange = async ({
    uid,
    row,
    symbol,
    positionSide,
    candidateClientOrderIds = [],
    notBeforeTradeTime = null,
}) => {
    if(!uid || !row?.id || !symbol || !positionSide){
        return null;
    }

    const timeReservationClientOrderIds = await loadSignalTimeExitReservationClientOrderIds({
        uid,
        pid: row.id,
        positionSide,
    });
    const timeClientOrderIds = Array.from(new Set(
        []
            .concat(candidateClientOrderIds || [])
            .concat(buildSignalTimeExitClientOrderIdCandidates({ uid, pid: row.id, row }))
            .concat(timeReservationClientOrderIds)
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));

    const execution = await loadRecentSignalCloseExecutionFromExchange({
        uid,
        pid: row.id,
        symbol,
        positionSide,
        candidateClientOrderIds: timeClientOrderIds,
        notBeforeTradeTime,
    });
    if(!execution){
        return null;
    }

    const timeFills = filterSignalTimeExitFills({
        fills: execution.fills || [],
        uid,
        pid: row.id,
    });
    if(timeFills.length === 0){
        return null;
    }

    for(const fill of timeFills){
        const existingFill = await pidPositionLedger.findRecordedFill({
            uid,
            pid: row.id,
            strategyCategory: 'signal',
            symbol,
            positionSide,
            sourceClientOrderId: fill.clientOrderId,
            sourceOrderId: fill.orderId,
            sourceTradeId: fill.tradeId,
            fillQty: fill.qty,
            fillPrice: fill.price,
            tradeTime: fill.tradeTime,
        });

        if(!existingFill){
            const summary = summarizeRecoveredFillUnits(timeFills);
            return {
                ...execution,
                ...summary,
                clientOrderId: timeFills[0]?.clientOrderId || execution.clientOrderId,
                orderId: timeFills[0]?.orderId || execution.orderId,
                fills: timeFills,
                rawOrders: (execution.rawOrders || []).filter((order) =>
                    isSignalTimeExitClientOrderId(order?.clientOrderId, uid, row.id)
                ),
                missingFillCount: timeFills.length,
            };
        }
    }

    return null;
}

const loadRecentSignalEntryExecutionFromExchange = async ({
    uid,
    pid,
    symbol,
    signalType,
    candidateClientOrderIds = [],
}) => {
    if(!uid || !pid || !symbol || !signalType || !(await ensureBinanceApiClient(uid))){
        return null;
    }

    const normalizedSignalType = String(signalType || '').trim().toUpperCase();
    const openSide = normalizedSignalType === 'BUY' ? 'BUY' : normalizedSignalType === 'SELL' ? 'SELL' : null;
    const positionSide = getSignalPositionSide(normalizedSignalType);
    if(!openSide || !positionSide){
        return null;
    }

    const clientOrderIdSet = new Set(
        [getEnterClientOrderId(uid, pid)]
            .concat(candidateClientOrderIds || [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    );
    const pidNeedle = `_${uid}_${pid}`;

    let exchangeOrders = [];
    try{
        exchangeOrders = await binance[uid].futuresAllOrders(symbol, { limit: 50 });
    }catch(error){
        return null;
    }

    const candidates = (exchangeOrders || [])
        .filter((order) => {
            const clientOrderId = String(order?.clientOrderId || '').trim();
            if(!clientOrderId){
                return false;
            }

            const status = String(order?.status || '').toUpperCase();
            if(!isRecoverableFillOrderStatus(status)){
                return false;
            }

            if(String(order?.side || '').trim().toUpperCase() !== openSide){
                return false;
            }

            const orderPositionSide = String(order?.positionSide || '').trim().toUpperCase();
            if(orderPositionSide && orderPositionSide !== positionSide){
                return false;
            }

            if(getBoundOrderPrefix(clientOrderId) !== 'NEW'){
                return false;
            }

            return clientOrderIdSet.has(clientOrderId) || clientOrderId.includes(pidNeedle);
        })
        .sort((left, right) =>
            Number(right?.updateTime || right?.time || 0) - Number(left?.updateTime || left?.time || 0)
        );

    if(candidates.length === 0){
        return null;
    }

    const targetOrder = candidates[0];

    let relatedTrades = [];
    try{
        relatedTrades = await binance[uid].futuresUserTrades(symbol, { limit: 100 });
    }catch(error){
        relatedTrades = [];
    }

    const matchedTrades = (relatedTrades || []).filter((trade) =>
        Number(trade?.orderId || 0) === Number(targetOrder?.orderId || 0)
        && String(trade?.side || '').trim().toUpperCase() === openSide
        && String(trade?.positionSide || '').trim().toUpperCase() === positionSide
    );

    const fillUnits = matchedTrades.length > 0
        ? matchedTrades
            .map((trade) => {
                const tradeQty = Number(trade?.qty || 0);
                const tradeQuoteQty = Number(trade?.quoteQty || 0);
                const tradePrice = Number(trade?.price || 0) > 0
                    ? Number(trade?.price || 0)
                    : tradeQty > 0 && tradeQuoteQty > 0
                        ? tradeQuoteQty / tradeQty
                        : Number(targetOrder?.avgPrice || targetOrder?.price || 0);
                const tradeTime = Number(trade?.time || targetOrder?.updateTime || targetOrder?.time || 0);
                if(!(tradeQty > 0) || !(tradePrice > 0)){
                    return null;
                }

                return {
                    clientOrderId: String(targetOrder?.clientOrderId || '').trim(),
                    orderId: Number(targetOrder?.orderId || 0) || null,
                    tradeId: trade?.id ?? trade?.tradeId ?? null,
                    qty: tradeQty,
                    fee: Number(trade?.commission || 0),
                    realizedPnl: 0,
                    price: tradePrice,
                    tradeTime: tradeTime > 0 ? tradeTime : Date.now(),
                    side: openSide,
                    positionSide,
                    rawOrder: targetOrder,
                    rawTrade: trade,
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                const timeDiff = Number(left?.tradeTime || 0) - Number(right?.tradeTime || 0);
                if(timeDiff !== 0){
                    return timeDiff;
                }

                return String(left?.tradeId || '').localeCompare(String(right?.tradeId || ''));
            })
        : [{
            clientOrderId: String(targetOrder?.clientOrderId || '').trim(),
            orderId: Number(targetOrder?.orderId || 0) || null,
            tradeId: null,
            qty: Number(targetOrder?.executedQty || targetOrder?.origQty || 0),
            fee: 0,
            realizedPnl: 0,
            price: Number(targetOrder?.avgPrice || 0) > 0
                ? Number(targetOrder?.avgPrice || 0)
                : Number(targetOrder?.price || 0),
            tradeTime: Number(targetOrder?.updateTime || targetOrder?.time || 0) || Date.now(),
            side: openSide,
            positionSide,
            rawOrder: targetOrder,
            rawTrade: null,
        }];

    const qty = fillUnits.reduce((sum, item) => sum + Number(item?.qty || 0), 0);
    if(!(qty > 0)){
        return null;
    }

    const fee = fillUnits.reduce((sum, item) => sum + Number(item?.fee || 0), 0);
    const quoteQty = fillUnits.reduce((sum, item) => sum + (Number(item?.qty || 0) * Number(item?.price || 0)), 0);
    const avgPrice = Number(targetOrder?.avgPrice || 0);
    const price = avgPrice > 0
        ? avgPrice
        : qty > 0 && quoteQty > 0
            ? quoteQty / qty
            : Number(targetOrder?.price || 0);
    const tradeTime = fillUnits.length > 0
        ? Math.max(...fillUnits.map((item) => Number(item?.tradeTime || 0)))
        : Number(targetOrder?.updateTime || targetOrder?.time || 0);
    const tradeIds = Array.from(new Set(
        fillUnits
            .map((item) => item?.tradeId ?? null)
            .filter((value) => value != null && value !== '')
            .map((value) => String(value))
    ));

    return {
        clientOrderId: String(targetOrder?.clientOrderId || '').trim(),
        orderId: Number(targetOrder?.orderId || 0) || null,
        tradeId: tradeIds.length === 1 ? tradeIds[0] : null,
        qty,
        fee,
        realizedPnl: 0,
        price,
        tradeTime: tradeTime > 0 ? tradeTime : Date.now(),
        side: openSide,
        positionSide,
        rawOrder: targetOrder,
        rawTrades: matchedTrades,
        fills: fillUnits,
    };
}

const loadRecentGridCloseExecutionFromExchange = async ({
    uid,
    pid,
    symbol,
    leg,
    candidateClientOrderIds = [],
}) => {
    if(!uid || !pid || !symbol || !leg || !(await ensureBinanceApiClient(uid))){
        return null;
    }

    const normalizedLeg = String(leg || '').trim().toUpperCase();
    const closeSide = normalizedLeg === 'LONG' ? 'SELL' : normalizedLeg === 'SHORT' ? 'BUY' : null;
    if(!closeSide){
        return null;
    }

    const clientOrderIdSet = new Set(
        []
            .concat(candidateClientOrderIds || [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    );
    const pidNeedle = `_${uid}_${pid}_`;

    let exchangeOrders = [];
    try{
        exchangeOrders = await binance[uid].futuresAllOrders(symbol, { limit: 100 });
    }catch(error){
        return null;
    }

    const candidates = (exchangeOrders || [])
        .filter((order) => {
            const clientOrderId = String(order?.clientOrderId || '').trim();
            if(!clientOrderId){
                return false;
            }

            const status = String(order?.status || '').toUpperCase();
            if(!isRecoverableFillOrderStatus(status)){
                return false;
            }

            if(String(order?.side || '').toUpperCase() !== closeSide){
                return false;
            }

            const orderPositionSide = String(order?.positionSide || '').trim().toUpperCase();
            if(orderPositionSide && orderPositionSide !== normalizedLeg){
                return false;
            }

            if(!/^(GTP|GSTOP|GMANUAL)_/.test(clientOrderId)){
                return false;
            }

            return clientOrderIdSet.has(clientOrderId) || clientOrderId.includes(pidNeedle);
        })
        .sort((left, right) =>
            Number(right?.updateTime || right?.time || 0) - Number(left?.updateTime || left?.time || 0)
        );

    if(candidates.length === 0){
        return null;
    }

    const targetOrder = candidates[0];

    let relatedTrades = [];
    try{
        relatedTrades = await binance[uid].futuresUserTrades(symbol, { limit: 100 });
    }catch(error){
        relatedTrades = [];
    }

    const matchedTrades = (relatedTrades || []).filter((trade) =>
        Number(trade?.orderId || 0) === Number(targetOrder?.orderId || 0)
        && String(trade?.side || '').trim().toUpperCase() === closeSide
        && String(trade?.positionSide || '').trim().toUpperCase() === normalizedLeg
    );
    const fillUnits = buildRecoveredOrderFillUnits({
        targetOrder,
        matchedTrades,
        side: closeSide,
        positionSide: normalizedLeg,
    });

    const qty = fillUnits.reduce((sum, item) => sum + Number(item?.qty || 0), 0);
    if(!(qty > 0)){
        return null;
    }

    const fee = fillUnits.reduce((sum, item) => sum + Number(item?.fee || 0), 0);
    const realizedPnl = fillUnits.reduce((sum, item) => sum + Number(item?.realizedPnl || 0), 0);
    const quoteQty = fillUnits.reduce((sum, item) => sum + (Number(item?.qty || 0) * Number(item?.price || 0)), 0);
    const avgPrice = Number(targetOrder?.avgPrice || 0);
    const price = avgPrice > 0
        ? avgPrice
        : qty > 0 && quoteQty > 0
            ? quoteQty / qty
            : Number(targetOrder?.price || 0);
    const tradeTime = fillUnits.length > 0
        ? Math.max(...fillUnits.map((item) => Number(item?.tradeTime || 0)))
        : Number(targetOrder?.updateTime || targetOrder?.time || 0);
    const tradeIds = Array.from(new Set(
        fillUnits
            .map((item) => item?.tradeId ?? null)
            .filter((value) => value != null && value !== '')
            .map((value) => String(value))
    ));

    return {
        clientOrderId: String(targetOrder?.clientOrderId || '').trim(),
        orderId: Number(targetOrder?.orderId || 0) || null,
        tradeId: tradeIds.length === 1 ? tradeIds[0] : null,
        qty,
        fee,
        realizedPnl,
        price,
        tradeTime: tradeTime > 0 ? tradeTime : Date.now(),
        side: closeSide,
        positionSide: normalizedLeg,
        rawOrder: targetOrder,
        rawOrders: candidates,
        rawTrades: relatedTrades,
        fills: fillUnits,
    };
}

const isGridExitReservationRecoveryCandidate = (reservation = null) => {
    if(!reservation){
        return false;
    }

    const reservationKind = String(reservation?.reservationKind || '').trim().toUpperCase();
    const clientOrderId = String(reservation?.clientOrderId || '').trim();
    return ['GRID_TP', 'GRID_STOP', 'GRID_MANUAL_OFF'].includes(reservationKind)
        || /^(GTP|GSTOP|GMANUAL)_/.test(clientOrderId);
}

const loadGridReservationOwnedExitExecutionsFromExchange = async ({
    uid,
    pid,
    symbol,
    leg,
    reservations = [],
}) => {
    if(!uid || !pid || !symbol || !leg || !(await ensureBinanceApiClient(uid))){
        return [];
    }

    const normalizedLeg = String(leg || '').trim().toUpperCase();
    const closeSide = normalizedLeg === 'LONG' ? 'SELL' : normalizedLeg === 'SHORT' ? 'BUY' : null;
    if(!closeSide){
        return [];
    }

    const normalizedReservations = []
        .concat(reservations || [])
        .filter((reservation) => isGridExitReservationRecoveryCandidate(reservation))
        .map((reservation) => {
            const clientOrderId = String(reservation?.clientOrderId || '').trim();
            const actualOrderId = reservation?.actualOrderId == null || reservation?.actualOrderId === ''
                ? null
                : String(reservation.actualOrderId).trim();
            const sourceOrderId = reservation?.sourceOrderId == null || reservation?.sourceOrderId === ''
                ? null
                : String(reservation.sourceOrderId).trim();

            return {
                ...reservation,
                clientOrderId,
                actualOrderId,
                sourceOrderId,
            };
        })
        .filter((reservation) => reservation.clientOrderId || reservation.actualOrderId || reservation.sourceOrderId);

    if(normalizedReservations.length === 0){
        return [];
    }

    let exchangeOrders = [];
    try{
        exchangeOrders = await binance[uid].futuresAllOrders(symbol, { limit: 200 });
    }catch(error){
        return [];
    }

    let relatedTrades = [];
    try{
        relatedTrades = await binance[uid].futuresUserTrades(symbol, { limit: 200 });
    }catch(error){
        relatedTrades = [];
    }

    const recoveries = [];
    for(const reservation of normalizedReservations){
        const candidates = (exchangeOrders || [])
            .filter((order) => {
                const clientOrderId = String(order?.clientOrderId || '').trim();
                const status = String(order?.status || '').trim().toUpperCase();
                const orderPositionSide = String(order?.positionSide || '').trim().toUpperCase();
                const orderSide = String(order?.side || '').trim().toUpperCase();
                const orderId = order?.orderId == null || order?.orderId === ''
                    ? null
                    : String(order.orderId).trim();

                if(!isRecoverableFillOrderStatus(status)){
                    return false;
                }
                if(orderSide !== closeSide){
                    return false;
                }
                if(orderPositionSide && orderPositionSide !== normalizedLeg){
                    return false;
                }

                const matchesReservation =
                    (reservation.clientOrderId && clientOrderId === reservation.clientOrderId)
                    || (reservation.actualOrderId && orderId === reservation.actualOrderId)
                    || (reservation.sourceOrderId && orderId === reservation.sourceOrderId);
                if(!matchesReservation){
                    return false;
                }

                return true;
            })
            .sort((left, right) =>
                Number(right?.updateTime || right?.time || 0) - Number(left?.updateTime || left?.time || 0)
            );

        if(candidates.length === 0){
            recoveries.push({
                reservation,
                status: 'NO_ORDER',
                execution: null,
            });
            continue;
        }

        const targetOrder = candidates.find((order) => getOrderExecutedQty(order) > 0) || candidates[0];
        const matchedTrades = (relatedTrades || []).filter((trade) =>
            Number(trade?.orderId || 0) === Number(targetOrder?.orderId || 0)
            && String(trade?.side || '').trim().toUpperCase() === closeSide
            && String(trade?.positionSide || '').trim().toUpperCase() === normalizedLeg
        );
        const fillUnits = buildRecoveredOrderFillUnits({
            targetOrder,
            matchedTrades,
            side: closeSide,
            positionSide: normalizedLeg,
        });
        const qty = fillUnits.reduce((sum, item) => sum + Number(item?.qty || 0), 0);
        const fee = fillUnits.reduce((sum, item) => sum + Number(item?.fee || 0), 0);
        const realizedPnl = fillUnits.reduce((sum, item) => sum + Number(item?.realizedPnl || 0), 0);
        const quoteQty = fillUnits.reduce((sum, item) => sum + (Number(item?.qty || 0) * Number(item?.price || 0)), 0);
        const avgPrice = Number(targetOrder?.avgPrice || 0);
        const price = avgPrice > 0
            ? avgPrice
            : qty > 0 && quoteQty > 0
                ? quoteQty / qty
                : Number(targetOrder?.price || 0);
        const tradeTime = fillUnits.length > 0
            ? Math.max(...fillUnits.map((item) => Number(item?.tradeTime || 0)))
            : Number(targetOrder?.updateTime || targetOrder?.time || 0);
        const tradeIds = Array.from(new Set(
            fillUnits
                .map((item) => item?.tradeId ?? null)
                .filter((value) => value != null && value !== '')
                .map((value) => String(value))
        ));

        recoveries.push({
            reservation,
            status: String(targetOrder?.status || '').trim().toUpperCase() || 'UNKNOWN',
            execution: qty > 0
                ? {
                    clientOrderId: String(targetOrder?.clientOrderId || reservation.clientOrderId || '').trim(),
                    orderId: Number(targetOrder?.orderId || 0) || null,
                    tradeId: tradeIds.length === 1 ? tradeIds[0] : null,
                    qty,
                    fee,
                    realizedPnl,
                    price,
                    tradeTime: tradeTime > 0 ? tradeTime : Date.now(),
                    side: closeSide,
                    positionSide: normalizedLeg,
                    rawOrder: targetOrder,
                    rawOrders: candidates,
                    rawTrades: matchedTrades,
                    fills: fillUnits,
                }
                : null,
        });
    }

    return recoveries;
}

const isExternalManualCloseClientOrderId = (clientOrderId = '') => {
    const normalized = String(clientOrderId || '').trim();
    if(!normalized){
        return false;
    }
    if(/^web_/i.test(normalized)){
        return true;
    }
    return !/^(GENTRY|GTP|GSTOP|GMANUAL|NEW|PROFIT|STOP|SPLITTP|TIME)_/i.test(normalized);
}

const recoverGridExternalManualCloseFromExchange = async ({
    uid,
    row,
    leg,
    issue = null,
}) => {
    if(!uid || !row?.id || !row?.symbol || !leg || !(await ensureBinanceApiClient(uid))){
        return null;
    }

    const normalizedLeg = String(leg || '').trim().toUpperCase();
    const closeSide = normalizedLeg === 'LONG' ? 'SELL' : normalizedLeg === 'SHORT' ? 'BUY' : null;
    if(!closeSide){
        return null;
    }

    const snapshot = await pidPositionLedger.loadSnapshot({
        uid,
        pid: row.id,
        strategyCategory: 'grid',
        positionSide: normalizedLeg,
    });
    const localOpenQty = Number(snapshot?.openQty || 0);
    if(!(localOpenQty > 0)){
        return null;
    }

    const activeReservations = await pidPositionLedger.loadActiveReservations({
        uid,
        pid: row.id,
        strategyCategory: 'grid',
        positionSide: normalizedLeg,
    });
    if((activeReservations || []).length > 0){
        logOrderRuntimeTrace('GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide: normalizedLeg,
            reason: 'ACTIVE_LOCAL_RESERVATION',
            activeReservationCount: activeReservations.length,
            issues: [].concat(issue?.issues || []),
        });
        return null;
    }

    const [ownerRows] = await db.query(
        `SELECT pid, strategyCategory, openQty
           FROM live_pid_position_snapshot
          WHERE uid = ?
            AND symbol = ?
            AND positionSide = ?
            AND status = 'OPEN'
            AND openQty > 0`,
        [uid, row.symbol, normalizedLeg]
    );
    const owners = (ownerRows || []).filter((owner) => Number(owner?.openQty || 0) > 0);
    if(owners.length !== 1 || Number(owners[0]?.pid || 0) !== Number(row.id)){
        logOrderRuntimeTrace('GRID_EXTERNAL_CLOSE_RECOVERY_AMBIGUOUS_OWNER', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide: normalizedLeg,
            localOpenQty,
            owners: owners.map((owner) => ({
                pid: Number(owner?.pid || 0),
                strategyCategory: owner?.strategyCategory || null,
                openQty: Number(owner?.openQty || 0),
            })),
            issues: [].concat(issue?.issues || []),
        });
        return null;
    }

    const exchangePosition = await exports.getGridLegExchangePosition({
        uid,
        symbol: row.symbol,
        leg: normalizedLeg,
    });
    if(Number(exchangePosition?.qty || 0) > 0){
        return null;
    }

    logOrderRuntimeTrace('GRID_EXTERNAL_CLOSE_RECOVERY_ATTEMPT', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide: normalizedLeg,
        localOpenQty,
        issues: [].concat(issue?.issues || []),
    });

    let exchangeOrders = [];
    try{
        exchangeOrders = await binance[uid].futuresAllOrders(row.symbol, { limit: 200 });
    }catch(error){
        return null;
    }

    let relatedTrades = [];
    try{
        relatedTrades = await binance[uid].futuresUserTrades(row.symbol, { limit: 200 });
    }catch(error){
        relatedTrades = [];
    }

    const manualCandidates = (exchangeOrders || [])
        .filter((order) => {
            const status = String(order?.status || '').trim().toUpperCase();
            const side = String(order?.side || '').trim().toUpperCase();
            const positionSide = String(order?.positionSide || '').trim().toUpperCase();
            const clientOrderId = String(order?.clientOrderId || '').trim();
            const type = String(order?.type || order?.origType || '').trim().toUpperCase();
            if(!isRecoverableFillOrderStatus(status)){
                return false;
            }
            if(side !== closeSide || (positionSide && positionSide !== normalizedLeg)){
                return false;
            }
            if(type !== 'MARKET'){
                return false;
            }
            if(String(order?.reduceOnly || '').toLowerCase() !== 'true' && order?.reduceOnly !== true){
                return false;
            }
            return isExternalManualCloseClientOrderId(clientOrderId);
        })
        .map((order) => {
            const matchedTrades = (relatedTrades || []).filter((trade) =>
                Number(trade?.orderId || 0) === Number(order?.orderId || 0)
                && String(trade?.side || '').trim().toUpperCase() === closeSide
                && String(trade?.positionSide || '').trim().toUpperCase() === normalizedLeg
            );
            const fills = buildRecoveredOrderFillUnits({
                targetOrder: order,
                matchedTrades,
                side: closeSide,
                positionSide: normalizedLeg,
            });
            const qty = fills.reduce((sum, fill) => sum + Number(fill?.qty || 0), 0);
            const realizedPnl = fills.reduce((sum, fill) => sum + Number(fill?.realizedPnl || 0), 0);
            const fee = fills.reduce((sum, fill) => sum + Number(fill?.fee || 0), 0);
            const quoteQty = fills.reduce((sum, fill) => sum + (Number(fill?.qty || 0) * Number(fill?.price || 0)), 0);
            const price = qty > 0 && quoteQty > 0
                ? quoteQty / qty
                : Number(order?.avgPrice || order?.price || 0);
            const tradeTime = fills.length > 0
                ? Math.max(...fills.map((fill) => Number(fill?.tradeTime || 0)))
                : Number(order?.updateTime || order?.time || 0);
            return {
                order,
                fills,
                qty,
                realizedPnl,
                fee,
                price,
                tradeTime,
            };
        })
        .filter((candidate) => candidate.qty > 0)
        .sort((left, right) => Number(right.tradeTime || 0) - Number(left.tradeTime || 0));

    const matchingCandidates = manualCandidates.filter((candidate) =>
        Math.abs(Number(candidate.qty || 0) - localOpenQty) <= Math.max(1e-9, localOpenQty * 0.000001)
    );
    if(matchingCandidates.length !== 1){
        logOrderRuntimeTrace(
            matchingCandidates.length > 1
                ? 'GRID_EXTERNAL_CLOSE_RECOVERY_AMBIGUOUS_OWNER'
                : 'GRID_EXTERNAL_CLOSE_RECOVERY_NO_TRADE',
            {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide: normalizedLeg,
                localOpenQty,
                candidateCount: manualCandidates.length,
                matchingCandidateCount: matchingCandidates.length,
                candidateOrders: manualCandidates.slice(0, 5).map((candidate) => ({
                    clientOrderId: candidate.order?.clientOrderId || null,
                    orderId: candidate.order?.orderId || null,
                    qty: Number(candidate.qty || 0),
                })),
                issues: [].concat(issue?.issues || []),
            }
        );
        return null;
    }

    const candidate = matchingCandidates[0];
    const order = candidate.order;
    logOrderRuntimeTrace('GRID_EXTERNAL_CLOSE_RECOVERY_FOUND_TRADE', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide: normalizedLeg,
        clientOrderId: order?.clientOrderId || null,
        orderId: order?.orderId || null,
        tradeIds: candidate.fills.map((fill) => fill?.tradeId || null).filter(Boolean),
        qty: Number(candidate.qty || 0),
        price: Number(candidate.price || 0),
        realizedPnl: Number(candidate.realizedPnl || 0),
        issues: [].concat(issue?.issues || []),
    });

    let appliedFillCount = 0;
    let duplicateFillCount = 0;
    for(const fill of candidate.fills){
        const existingFill = await pidPositionLedger.findRecordedFill({
            uid,
            pid: row.id,
            strategyCategory: 'grid',
            symbol: row.symbol,
            positionSide: normalizedLeg,
            sourceClientOrderId: fill.clientOrderId,
            sourceOrderId: fill.orderId,
            sourceTradeId: fill.tradeId,
            fillQty: fill.qty,
            fillPrice: fill.price,
            tradeTime: fill.tradeTime,
        });
        if(existingFill){
            duplicateFillCount += 1;
            logOrderRuntimeTrace('GRID_EXTERNAL_CLOSE_RECOVERY_DUPLICATE_IGNORED', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide: normalizedLeg,
                clientOrderId: fill.clientOrderId,
                orderId: fill.orderId,
                tradeId: fill.tradeId || null,
                existingEventType: existingFill.eventType || null,
            });
            continue;
        }

        await pidPositionLedger.applyExitFill({
            uid,
            pid: row.id,
            strategyCategory: 'grid',
            symbol: row.symbol,
            positionSide: normalizedLeg,
            sourceClientOrderId: fill.clientOrderId,
            sourceOrderId: fill.orderId,
            sourceTradeId: fill.tradeId,
            fillQty: fill.qty,
            fillPrice: fill.price,
            fee: fill.fee,
            realizedPnl: fill.realizedPnl,
            tradeTime: fill.tradeTime,
            eventType: 'GRID_EXTERNAL_MANUAL_CLOSE_FILL',
            note: 'external-manual-close-recovery',
        });
        appliedFillCount += 1;
        logOrderRuntimeTrace('GRID_EXTERNAL_CLOSE_RECOVERY_APPLY_FILL', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide: normalizedLeg,
            clientOrderId: fill.clientOrderId,
            orderId: fill.orderId,
            tradeId: fill.tradeId || null,
            qty: Number(fill.qty || 0),
            price: Number(fill.price || 0),
            realizedPnl: Number(fill.realizedPnl || 0),
            tradeTime: fill.tradeTime,
        });
    }

    await pidPositionLedger.syncGridLegSnapshot(row.id, normalizedLeg);
    logOrderRuntimeTrace('GRID_EXTERNAL_CLOSE_SNAPSHOT_SYNCED', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide: normalizedLeg,
        appliedFillCount,
        duplicateFillCount,
    });

    return {
        clientOrderId: String(order?.clientOrderId || '').trim(),
        orderId: Number(order?.orderId || 0) || null,
        tradeId: candidate.fills.length === 1 ? candidate.fills[0]?.tradeId || null : null,
        qty: candidate.qty,
        fee: candidate.fee,
        realizedPnl: candidate.realizedPnl,
        price: candidate.price,
        tradeTime: candidate.tradeTime || Date.now(),
        side: closeSide,
        positionSide: normalizedLeg,
        appliedFillCount,
        duplicateFillCount,
        externalManualClose: true,
    };
}

const loadRecentGridEntryExecutionFromExchange = async ({
    uid,
    pid,
    symbol,
    leg,
    candidateClientOrderIds = [],
}) => {
    if(!uid || !pid || !symbol || !leg || !(await ensureBinanceApiClient(uid))){
        return null;
    }

    const normalizedLeg = String(leg || '').trim().toUpperCase();
    const openSide = normalizedLeg === 'LONG' ? 'BUY' : normalizedLeg === 'SHORT' ? 'SELL' : null;
    if(!openSide){
        return null;
    }

    const clientOrderIdSet = new Set(
        []
            .concat(candidateClientOrderIds || [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    );
    const pidNeedle = `_${uid}_${pid}_`;

    let exchangeOrders = [];
    try{
        exchangeOrders = await binance[uid].futuresAllOrders(symbol, { limit: 100 });
    }catch(error){
        return null;
    }

    const candidates = (exchangeOrders || [])
        .filter((order) => {
            const clientOrderId = String(order?.clientOrderId || '').trim();
            if(!clientOrderId){
                return false;
            }

            const status = String(order?.status || '').toUpperCase();
            if(!isRecoverableFillOrderStatus(status)){
                return false;
            }

            if(String(order?.side || '').trim().toUpperCase() !== openSide){
                return false;
            }

            const orderPositionSide = String(order?.positionSide || '').trim().toUpperCase();
            if(orderPositionSide && orderPositionSide !== normalizedLeg){
                return false;
            }

            if(!/^(GENTRY)_/.test(clientOrderId)){
                return false;
            }

            return clientOrderIdSet.has(clientOrderId) || clientOrderId.includes(pidNeedle);
        })
        .sort((left, right) =>
            Number(right?.updateTime || right?.time || 0) - Number(left?.updateTime || left?.time || 0)
        );

    if(candidates.length === 0){
        return null;
    }

    const targetOrder = candidates[0];

    let relatedTrades = [];
    try{
        relatedTrades = await binance[uid].futuresUserTrades(symbol, { limit: 100 });
    }catch(error){
        relatedTrades = [];
    }

    const matchedTrades = (relatedTrades || []).filter((trade) =>
        Number(trade?.orderId || 0) === Number(targetOrder?.orderId || 0)
        && String(trade?.side || '').trim().toUpperCase() === openSide
        && String(trade?.positionSide || '').trim().toUpperCase() === normalizedLeg
    );
    const fillUnits = buildRecoveredOrderFillUnits({
        targetOrder,
        matchedTrades,
        side: openSide,
        positionSide: normalizedLeg,
    });

    const qty = fillUnits.reduce((sum, item) => sum + Number(item?.qty || 0), 0);
    if(!(qty > 0)){
        return null;
    }

    const fee = fillUnits.reduce((sum, item) => sum + Number(item?.fee || 0), 0);
    const quoteQty = fillUnits.reduce((sum, item) => sum + (Number(item?.qty || 0) * Number(item?.price || 0)), 0);
    const avgPrice = Number(targetOrder?.avgPrice || 0);
    const price = avgPrice > 0
        ? avgPrice
        : qty > 0 && quoteQty > 0
            ? quoteQty / qty
            : Number(targetOrder?.price || 0);
    const tradeTime = fillUnits.length > 0
        ? Math.max(...fillUnits.map((item) => Number(item?.tradeTime || 0)))
        : Number(targetOrder?.updateTime || targetOrder?.time || 0);
    const tradeIds = Array.from(new Set(
        fillUnits
            .map((item) => item?.tradeId ?? null)
            .filter((value) => value != null && value !== '')
            .map((value) => String(value))
    ));

    return {
        clientOrderId: String(targetOrder?.clientOrderId || '').trim(),
        orderId: Number(targetOrder?.orderId || 0) || null,
        tradeId: tradeIds.length === 1 ? tradeIds[0] : null,
        qty,
        fee,
        realizedPnl: 0,
        price,
        tradeTime: tradeTime > 0 ? tradeTime : Date.now(),
        side: openSide,
        positionSide: normalizedLeg,
        rawOrder: targetOrder,
        rawTrades: matchedTrades,
        fills: fillUnits,
    };
}

const recoverSignalExitFillFromExchange = async ({
    uid,
    row,
    issue = null,
}) => {
    if(!uid || !row?.id || !row?.symbol){
        return null;
    }

    const resolvedSignalType = getResolvedLiveSignalType(row);
    const positionSide = getSignalPositionSide(resolvedSignalType);
    if(!positionSide){
        return null;
    }

    const activeReservations = await pidPositionLedger.loadActiveReservations({
        uid,
        pid: row.id,
        strategyCategory: 'signal',
        positionSide,
    });
    const timeReservationClientOrderIds = await loadSignalTimeExitReservationClientOrderIds({
        uid,
        pid: row.id,
        positionSide,
    });
    const issueNames = new Set([].concat(issue?.issues || []));
    const timeExitClientOrderIds = buildSignalTimeExitClientOrderIdCandidates({
        uid,
        pid: row.id,
        row,
    });
    const execution = await loadRecentSignalCloseExecutionFromExchange({
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide,
        candidateClientOrderIds: []
            .concat(activeReservations.map((reservation) => reservation.clientOrderId))
            .concat(timeExitClientOrderIds)
            .concat(timeReservationClientOrderIds),
        notBeforeTradeTime: row.r_exactTime || row.r_signalTime || null,
    });
    if(!execution){
        if(issueNames.has('SIGNAL_TIME_EXIT_FILL_MISSED')){
            logOrderRuntimeTrace('SIGNAL_TIME_EXIT_RECOVERY_NO_TRADES', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide,
                candidateClientOrderIds: timeExitClientOrderIds.concat(timeReservationClientOrderIds),
                issues: [].concat(issue?.issues || []),
            });
        }
        return null;
    }

    let recoveredFills = Array.isArray(execution.fills) && execution.fills.length > 0
        ? execution.fills
        : [execution];
    const timeExitRecovery = issueNames.has('SIGNAL_TIME_EXIT_FILL_MISSED')
        || recoveredFills.some((fill) => isSignalTimeExitClientOrderId(fill?.clientOrderId, uid, row.id));
    if(issueNames.has('SIGNAL_TIME_EXIT_FILL_MISSED')){
        recoveredFills = filterSignalTimeExitFills({
            fills: recoveredFills,
            uid,
            pid: row.id,
        });
        if(recoveredFills.length === 0){
            logOrderRuntimeTrace('SIGNAL_TIME_EXIT_RECOVERY_NO_TRADES', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide,
                orderId: execution.orderId || null,
                clientOrderId: execution.clientOrderId || null,
                issues: [].concat(issue?.issues || []),
            });
            return null;
        }
    }
    if(timeExitRecovery){
        logOrderRuntimeTrace('SIGNAL_TIME_EXIT_RECOVERY_FOUND_TRADES', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide,
            clientOrderIds: Array.from(new Set(recoveredFills.map((fill) => fill?.clientOrderId || null).filter(Boolean))),
            orderIds: Array.from(new Set(recoveredFills.map((fill) => fill?.orderId || null).filter(Boolean))),
            tradeIds: recoveredFills.map((fill) => fill?.tradeId || null).filter(Boolean),
            fillCount: recoveredFills.length,
            totalQty: recoveredFills.reduce((sum, fill) => sum + Number(fill?.qty || 0), 0),
            issues: [].concat(issue?.issues || []),
        });
    }
    logOrderRuntimeTrace('EXIT_FILL_UNIT_RECOVERY_FOUND_TRADES', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide,
        clientOrderIds: Array.from(new Set(recoveredFills.map((fill) => fill?.clientOrderId || null).filter(Boolean))),
        orderIds: Array.from(new Set(recoveredFills.map((fill) => fill?.orderId || null).filter(Boolean))),
        tradeIds: recoveredFills.map((fill) => fill?.tradeId || null).filter(Boolean),
        fillCount: recoveredFills.length,
        totalQty: Number(execution.qty || 0),
        totalRealizedPnl: Number(execution.realizedPnl || 0),
        issues: [].concat(issue?.issues || []),
    });

    let appliedFillCount = 0;
    let duplicateFillCount = 0;
    for(const fill of recoveredFills){
        const existingFill = await pidPositionLedger.findRecordedFill({
            uid,
            pid: row.id,
            strategyCategory: 'signal',
            symbol: row.symbol,
            positionSide,
            sourceClientOrderId: fill.clientOrderId,
            sourceOrderId: fill.orderId,
            sourceTradeId: fill.tradeId,
            fillQty: fill.qty,
            fillPrice: fill.price,
            tradeTime: fill.tradeTime,
        });

        if(existingFill){
            duplicateFillCount += 1;
            logOrderRuntimeTrace('EXIT_FILL_UNIT_DUPLICATE_IGNORED', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide,
                clientOrderId: fill.clientOrderId,
                orderId: fill.orderId,
                tradeId: fill.tradeId || null,
                qty: Number(fill.qty || 0),
                price: Number(fill.price || 0),
                existingEventType: existingFill.eventType || null,
            });
            if(timeExitRecovery){
                logOrderRuntimeTrace('SIGNAL_TIME_EXIT_RECOVERY_DUPLICATE_IGNORED', {
                    uid,
                    pid: row.id,
                    symbol: row.symbol,
                    positionSide,
                    clientOrderId: fill.clientOrderId,
                    orderId: fill.orderId,
                    tradeId: fill.tradeId || null,
                    existingEventType: existingFill.eventType || null,
                });
            }
            continue;
        }

        if(timeExitRecovery){
            logOrderRuntimeTrace('SIGNAL_TIME_EXIT_RECOVERY_APPLY_FILL', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide,
                clientOrderId: fill.clientOrderId,
                orderId: fill.orderId,
                tradeId: fill.tradeId || null,
                qty: Number(fill.qty || 0),
                price: Number(fill.price || 0),
                realizedPnl: Number(fill.realizedPnl || 0),
                tradeTime: fill.tradeTime,
            });
        }
        await pidPositionLedger.applyExitFill({
            uid,
            pid: row.id,
            strategyCategory: 'signal',
            symbol: row.symbol,
            positionSide,
            sourceClientOrderId: fill.clientOrderId,
            sourceOrderId: fill.orderId,
            sourceTradeId: fill.tradeId,
            fillQty: fill.qty,
            fillPrice: fill.price,
            fee: fill.fee,
            realizedPnl: fill.realizedPnl,
            tradeTime: fill.tradeTime,
            eventType: 'EXCHANGE_RECONCILED_EXIT_FILL',
            note: 'exchange-close-reconcile',
        });
        appliedFillCount += 1;
        logOrderRuntimeTrace('EXIT_FILL_UNIT_APPLY', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide,
            clientOrderId: fill.clientOrderId,
            orderId: fill.orderId,
            tradeId: fill.tradeId || null,
            qty: Number(fill.qty || 0),
            price: Number(fill.price || 0),
            realizedPnl: Number(fill.realizedPnl || 0),
            tradeTime: fill.tradeTime,
        });
    }

    if(appliedFillCount > 0){
        if(!timeExitRecovery){
            await cancelBoundExitOrders(uid, row.symbol, row.id);
        }
        await pidPositionLedger.syncSignalPlaySnapshot(row.id, positionSide);

        const snapshot = await pidPositionLedger.loadSnapshot({
            uid,
            pid: row.id,
            strategyCategory: 'signal',
            positionSide,
        });
        const remainingQty = Number(snapshot?.openQty || 0);
        const remainingEntryPrice = Number(snapshot?.avgEntryPrice || row.r_exactPrice || 0);
        if(remainingQty > 0){
            if(timeExitRecovery){
                const siblingOrders = await listOpenBoundExitOrders(uid, row.symbol, row.id);
                if(siblingOrders.length > 0){
                    logOrderRuntimeTrace('SIGNAL_TIME_EXIT_SIBLING_PROTECTION_ACTIVE', {
                        uid,
                        pid: row.id,
                        symbol: row.symbol,
                        positionSide,
                        remainingQty,
                        siblingCount: siblingOrders.length,
                        siblingClientOrderIds: siblingOrders.map((order) => order.clientOrderId || null).filter(Boolean),
                        reason: 'USER_ACTION_REQUIRED_TIME_EXIT_ORPHAN_PROTECTION',
                    });
                    exports.msgAdd(
                        'signalTimeExit',
                        'USER_ACTION_REQUIRED',
                        `pid:${row.id}, symbol:${row.symbol}, remainingQty:${remainingQty}, activeSiblingProtection:${siblingOrders.length}`,
                        uid,
                        row.id,
                        execution.orderId,
                        row.symbol,
                        resolvedSignalType || null
                    );
                }
            }else{
                await syncLiveBoundExitOrders({
                    uid,
                    pid: row.id,
                    symbol: row.symbol,
                    entryOrderId: row.r_tid || execution.orderId,
                    entryPrice: remainingEntryPrice,
                    qty: remainingQty,
                });
            }
        }else{
            const siblingOrders = timeExitRecovery
                ? await listOpenBoundExitOrders(uid, row.symbol, row.id)
                : [];
            if(timeExitRecovery && siblingOrders.length > 0){
                await setLivePlayReadyModeIfCurrentWithoutRuntimeReset(
                    row,
                    row.status,
                    'SIGNAL_TIME_EXIT_READY_NO_RUNTIME_RESET'
                );
            }else{
                await setLivePlayReadyModeIfCurrent(row, row.status);
            }
            if(timeExitRecovery){
                logOrderRuntimeTrace('SIGNAL_TIME_EXIT_RECOVERY_SNAPSHOT_SYNCED', {
                    uid,
                    pid: row.id,
                    symbol: row.symbol,
                    positionSide,
                    snapshotStatus: snapshot?.status || null,
                    openQty: remainingQty,
                });
                logOrderRuntimeTrace('SIGNAL_TIME_EXIT_RECOVERY_SIGNAL_ROW_SYNCED', {
                    uid,
                    pid: row.id,
                    symbol: row.symbol,
                    positionSide,
                    status: 'READY',
                    r_qty: 0,
                });
                if(siblingOrders.length > 0){
                    logOrderRuntimeTrace('SIGNAL_TIME_EXIT_SIBLING_PROTECTION_ACTIVE', {
                        uid,
                        pid: row.id,
                        symbol: row.symbol,
                        positionSide,
                        remainingQty,
                        siblingCount: siblingOrders.length,
                        siblingClientOrderIds: siblingOrders.map((order) => order.clientOrderId || null).filter(Boolean),
                        reason: 'USER_ACTION_REQUIRED_TIME_EXIT_ORPHAN_PROTECTION',
                    });
                    exports.msgAdd(
                        'signalTimeExit',
                        'USER_ACTION_REQUIRED',
                        `pid:${row.id}, symbol:${row.symbol}, full TIME exit recovered but sibling protection remains active:${siblingOrders.length}`,
                        uid,
                        row.id,
                        execution.orderId,
                        row.symbol,
                        resolvedSignalType || null
                    );
                }
            }
        }
    }else{
        await pidPositionLedger.syncSignalPlaySnapshot(row.id, positionSide);
    }

    exports.msgAdd(
        'signalReconcile',
        'EXIT_FILL_RECOVERED',
        `pid:${row.id}, symbol:${row.symbol}, clientOrderId:${execution.clientOrderId}, orderId:${execution.orderId}, fillCount:${recoveredFills.length}, appliedFillCount:${appliedFillCount}, duplicateFillCount:${duplicateFillCount}, qty:${execution.qty}, price:${execution.price}, pnl:${execution.realizedPnl}`,
        uid,
        row.id,
        execution.orderId,
        row.symbol,
        resolvedSignalType || null
    );

    return execution;
}

const recoverSignalEntryFillFromExchange = async ({
    uid,
    row,
    issue = null,
}) => {
    if(!uid || !row?.id || !row?.symbol){
        return null;
    }

    const resolvedSignalType = getResolvedLiveSignalType(row);
    const positionSide = getSignalPositionSide(resolvedSignalType);
    if(!resolvedSignalType || !positionSide){
        return null;
    }

    logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_ATTEMPT', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide,
        signalType: resolvedSignalType,
        status: row.status || null,
        r_tid: row.r_tid || null,
        r_signalTime: row.r_signalTime || null,
        r_exactTime: row.r_exactTime || null,
        r_qty: Number(row.r_qty || 0),
        issues: [].concat(issue?.issues || []),
    });

    const execution = await loadRecentSignalEntryExecutionFromExchange({
        uid,
        pid: row.id,
        symbol: row.symbol,
        signalType: resolvedSignalType,
        candidateClientOrderIds: [getEnterClientOrderId(uid, row.id)],
    });
    if(!execution){
        logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_NO_TRADES', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide,
            signalType: resolvedSignalType,
            issues: [].concat(issue?.issues || []),
        });
        return null;
    }

    const recoveredFills = Array.isArray(execution.fills) && execution.fills.length > 0
        ? execution.fills
        : [execution];
    logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_FOUND_TRADES', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide,
        signalType: resolvedSignalType,
        clientOrderId: execution.clientOrderId,
        orderId: execution.orderId,
        fillCount: recoveredFills.length,
        tradeIds: recoveredFills.map((fill) => fill?.tradeId || null).filter(Boolean),
        totalQty: Number(execution.qty || 0),
        avgPrice: Number(execution.price || 0),
    });

    const orderRules = await loadSymbolOrderRules(uid, row.symbol);
    const minQty = Number(orderRules?.minQty || 0);

    if(execution.orderId){
        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_SET(?,?,?)`, [
            row.id,
            execution.orderId,
            minQty,
        ]);
    }

    let appliedFillCount = 0;
    let duplicateFillCount = 0;

    for(const fill of recoveredFills){
        const existingFill = await pidPositionLedger.findRecordedFill({
            uid,
            pid: row.id,
            strategyCategory: 'signal',
            symbol: row.symbol,
            positionSide,
            sourceClientOrderId: fill.clientOrderId,
            sourceOrderId: fill.orderId,
            sourceTradeId: fill.tradeId,
            fillQty: fill.qty,
            fillPrice: fill.price,
            tradeTime: fill.tradeTime,
        });

        if(existingFill){
            duplicateFillCount += 1;
            logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_APPLY_SKIPPED_DUPLICATE', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide,
                clientOrderId: fill.clientOrderId,
                orderId: fill.orderId,
                tradeId: fill.tradeId || null,
                qty: Number(fill.qty || 0),
                price: Number(fill.price || 0),
                tradeTime: fill.tradeTime,
                existingEventType: existingFill.eventType || null,
            });
            continue;
        }

        try{
            const applyResult = await pidPositionLedger.applyEntryFill({
                uid,
                pid: row.id,
                strategyCategory: 'signal',
                symbol: row.symbol,
                positionSide,
                sourceClientOrderId: fill.clientOrderId,
                sourceOrderId: fill.orderId,
                sourceTradeId: fill.tradeId,
                fillQty: fill.qty,
                fillPrice: fill.price,
                fee: fill.fee,
                tradeTime: fill.tradeTime,
                eventType: 'EXCHANGE_RECONCILED_ENTRY_FILL',
                note: 'exchange-entry-reconcile',
            });

            if(applyResult?.duplicate){
                duplicateFillCount += 1;
                logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_APPLY_SKIPPED_DUPLICATE', {
                    uid,
                    pid: row.id,
                    symbol: row.symbol,
                    positionSide,
                    clientOrderId: fill.clientOrderId,
                    orderId: fill.orderId,
                    tradeId: fill.tradeId || null,
                    qty: Number(fill.qty || 0),
                    price: Number(fill.price || 0),
                    tradeTime: fill.tradeTime,
                    existingEventType: applyResult?.existingFill?.eventType || null,
                });
                continue;
            }

            appliedFillCount += 1;
            logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_APPLY_FILL', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide,
                clientOrderId: fill.clientOrderId,
                orderId: fill.orderId,
                tradeId: fill.tradeId || null,
                qty: Number(fill.qty || 0),
                price: Number(fill.price || 0),
                tradeTime: fill.tradeTime,
            });
        }catch(error){
            logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_APPLY_FAILED', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide,
                clientOrderId: fill.clientOrderId,
                orderId: fill.orderId,
                tradeId: fill.tradeId || null,
                qty: Number(fill.qty || 0),
                price: Number(fill.price || 0),
                tradeTime: fill.tradeTime,
                errorMessage: error?.message || String(error),
            });
            throw error;
        }
    }

    await pidPositionLedger.syncSignalPlaySnapshot(row.id, positionSide);
    const snapshot = await pidPositionLedger.loadSnapshot({
        uid,
        pid: row.id,
        strategyCategory: 'signal',
        positionSide,
    });
    logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_SNAPSHOT_SYNCED', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide,
        appliedFillCount,
        duplicateFillCount,
        snapshotStatus: snapshot?.status || null,
        snapshotOpenQty: Number(snapshot?.openQty || 0),
        snapshotAvgEntryPrice: Number(snapshot?.avgEntryPrice || 0),
    });

    const resolvedExactPrice = Number(snapshot?.avgEntryPrice || execution.price || 0);
    const resolvedQty = Number(snapshot?.openQty || execution.qty || 0);

    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_EXACT_UPDATE(?,?,?,?,?,?)`, [
        row.id,
        uid,
        resolvedExactPrice,
        resolvedQty,
        Number(resolvedExactPrice || 0) * Number(resolvedQty || 0),
        0,
    ]);
    const recoveredExactTime = toMysqlDateTimeOrNull(execution.tradeTime);
    await db.query(
        `UPDATE live_play_list
            SET status = 'EXACT',
                st = NULL,
                autoST = NULL,
                r_exactTime = COALESCE(r_exactTime, ?)
          WHERE id = ?
          LIMIT 1`,
        [recoveredExactTime, row.id]
    );
    await touchSignalPositionOwnership({
        uid,
        pid: row.id,
        symbol: row.symbol,
        signalSide: resolvedSignalType,
        ownerState: 'OPEN',
        sourceClientOrderId: execution.clientOrderId,
        sourceOrderId: execution.orderId,
        note: 'exchange-entry-reconcile',
    });
    const protectionSynced = await syncLiveBoundExitOrders({
        uid,
        pid: row.id,
        symbol: row.symbol,
        entryOrderId: execution.orderId,
        entryPrice: resolvedExactPrice,
        qty: resolvedQty,
    });
    logOrderRuntimeTrace('SIGNAL_ENTRY_RECOVERY_PROTECTION_SYNCED', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide,
        clientOrderId: execution.clientOrderId,
        orderId: execution.orderId,
        appliedFillCount,
        duplicateFillCount,
        resolvedQty,
        resolvedExactPrice,
        synced: Boolean(protectionSynced),
    });

    exports.msgAdd(
        'signalReconcile',
        'ENTRY_FILL_RECOVERED',
        `pid:${row.id}, symbol:${row.symbol}, clientOrderId:${execution.clientOrderId}, orderId:${execution.orderId}, fillCount:${recoveredFills.length}, appliedFillCount:${appliedFillCount}, duplicateFillCount:${duplicateFillCount}, qty:${resolvedQty}, price:${resolvedExactPrice}, issues:${[].concat(issue?.issues || []).join(',')}`,
        uid,
        row.id,
        execution.orderId,
        row.symbol,
        resolvedSignalType || null
    );

    return execution;
}

exports.recoverGridExitFillFromExchange = async ({
    uid,
    row,
    leg,
    issue = null,
}) => {
    if(!uid || !row?.id || !row?.symbol || !leg){
        return null;
    }

    const normalizedLeg = String(leg || '').trim().toUpperCase();
    const activeReservations = await pidPositionLedger.loadActiveReservations({
        uid,
        pid: row.id,
        strategyCategory: 'grid',
        positionSide: normalizedLeg,
    });
    const recentReservations = await pidPositionLedger.loadRecentReservations({
        uid,
        pid: row.id,
        strategyCategory: 'grid',
        positionSide: normalizedLeg,
        limit: 10,
    });
    const reservationCandidates = Array.from(
        new Map(
            []
                .concat(activeReservations || [])
                .concat(recentReservations || [])
                .filter((reservation) => isGridExitReservationRecoveryCandidate(reservation))
                .map((reservation) => {
                    const key = String(
                        reservation?.clientOrderId
                        || reservation?.actualOrderId
                        || reservation?.sourceOrderId
                        || reservation?.id
                        || ''
                    ).trim();
                    return [key, reservation];
                })
                .filter(([key]) => Boolean(key))
        ).values()
    );
    if(reservationCandidates.length === 0){
        return await recoverGridExternalManualCloseFromExchange({
            uid,
            row,
            leg: normalizedLeg,
            issue,
        });
    }

    for(const reservation of reservationCandidates){
        logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_ATTEMPT', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide: normalizedLeg,
            reservationId: Number(reservation?.id || 0) || null,
            reservationKind: reservation?.reservationKind || null,
            clientOrderId: String(reservation?.clientOrderId || '').trim() || null,
            actualOrderId: reservation?.actualOrderId || null,
            sourceOrderId: reservation?.sourceOrderId || null,
            issues: [].concat(issue?.issues || []),
        });
    }

    const recoveries = await loadGridReservationOwnedExitExecutionsFromExchange({
        uid,
        pid: row.id,
        symbol: row.symbol,
        leg: normalizedLeg,
        reservations: reservationCandidates,
    });
    if(recoveries.length === 0){
        return null;
    }

    let appliedFillCount = 0;
    let duplicateFillCount = 0;
    let finalizedReservationCount = 0;
    let primaryExecution = null;
    const matchedReservationClientOrderIds = new Set();

    for(const recovery of recoveries){
        const reservation = recovery?.reservation || null;
        const reservationId = Number(reservation?.id || 0) || null;
        const reservationClientOrderId = String(reservation?.clientOrderId || '').trim();
        const execution = recovery?.execution || null;
        const targetOrder = execution?.rawOrder || null;
        const targetOrderId = Number(targetOrder?.orderId || execution?.orderId || 0) || null;
        const orderStatus = String(recovery?.status || targetOrder?.status || '').trim().toUpperCase();

        if(!targetOrder){
            logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_NO_ORDER', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide: normalizedLeg,
                reservationId,
                clientOrderId: reservationClientOrderId || null,
                actualOrderId: reservation?.actualOrderId || null,
                sourceOrderId: reservation?.sourceOrderId || null,
                issues: [].concat(issue?.issues || []),
            });
            if(orderStatus === 'CANCELED' && reservationClientOrderId){
                finalizedReservationCount += await pidPositionLedger.markReservationsCanceled([reservationClientOrderId]);
                logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_RESERVATION_FINALIZED', {
                    uid,
                    pid: row.id,
                    symbol: row.symbol,
                    positionSide: normalizedLeg,
                    reservationId,
                    clientOrderId: reservationClientOrderId,
                    orderId: targetOrderId,
                    status: 'CANCELED',
                });
            }
            continue;
        }

        logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_FOUND_ORDER', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide: normalizedLeg,
            reservationId,
            clientOrderId: reservationClientOrderId || null,
            orderId: targetOrderId,
            status: orderStatus,
            reservationKind: reservation?.reservationKind || null,
            qty: Number(targetOrder?.executedQty || execution?.qty || 0),
            price: Number(targetOrder?.avgPrice || targetOrder?.price || execution?.price || 0),
        });

        if(reservationClientOrderId && targetOrderId){
            await pidPositionLedger.bindReservationActualOrderId(reservationClientOrderId, targetOrderId);
        }

        if(!execution || !Array.isArray(execution.fills) || execution.fills.length === 0){
            logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_NO_TRADES', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide: normalizedLeg,
                reservationId,
                clientOrderId: reservationClientOrderId || null,
                orderId: targetOrderId,
                status: orderStatus,
            });
            if(orderStatus === 'CANCELED' && reservationClientOrderId){
                finalizedReservationCount += await pidPositionLedger.markReservationsCanceled([reservationClientOrderId]);
                logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_RESERVATION_FINALIZED', {
                    uid,
                    pid: row.id,
                    symbol: row.symbol,
                    positionSide: normalizedLeg,
                    reservationId,
                    clientOrderId: reservationClientOrderId,
                    orderId: targetOrderId,
                    status: 'CANCELED',
                });
            }
            continue;
        }

        const recoveredFills = execution.fills;
        logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_FOUND_TRADES', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide: normalizedLeg,
            reservationId,
            clientOrderId: reservationClientOrderId || execution.clientOrderId || null,
            orderId: targetOrderId,
            tradeIds: recoveredFills.map((fill) => fill?.tradeId || null).filter(Boolean),
            fillCount: recoveredFills.length,
            totalQty: Number(execution.qty || 0),
            totalRealizedPnl: Number(execution.realizedPnl || 0),
            issues: [].concat(issue?.issues || []),
        });

        let reservationRecovered = false;
        for(const fill of recoveredFills){
            const existingFill = await pidPositionLedger.findRecordedFill({
                uid,
                pid: row.id,
                strategyCategory: 'grid',
                symbol: row.symbol,
                positionSide: normalizedLeg,
                sourceClientOrderId: fill.clientOrderId,
                sourceOrderId: fill.orderId,
                sourceTradeId: fill.tradeId,
                fillQty: fill.qty,
                fillPrice: fill.price,
                tradeTime: fill.tradeTime,
            });
            if(existingFill){
                duplicateFillCount += 1;
                reservationRecovered = true;
                logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_DUPLICATE_IGNORED', {
                    uid,
                    pid: row.id,
                    symbol: row.symbol,
                    positionSide: normalizedLeg,
                    reservationId,
                    clientOrderId: fill.clientOrderId,
                    orderId: fill.orderId,
                    tradeId: fill.tradeId || null,
                    qty: Number(fill.qty || 0),
                    price: Number(fill.price || 0),
                    existingEventType: existingFill.eventType || null,
                });
                continue;
            }

            await pidPositionLedger.applyExitFill({
                uid,
                pid: row.id,
                strategyCategory: 'grid',
                symbol: row.symbol,
                positionSide: normalizedLeg,
                sourceClientOrderId: fill.clientOrderId,
                sourceOrderId: fill.orderId,
                sourceTradeId: fill.tradeId,
                fillQty: fill.qty,
                fillPrice: fill.price,
                fee: fill.fee,
                realizedPnl: fill.realizedPnl,
                tradeTime: fill.tradeTime,
                eventType: 'GRID_EXCHANGE_RECONCILED_EXIT_FILL',
                note: 'exchange-close-reconcile',
            });
            appliedFillCount += 1;
            reservationRecovered = true;
            logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_APPLY_FILL', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide: normalizedLeg,
                reservationId,
                clientOrderId: fill.clientOrderId,
                orderId: fill.orderId,
                tradeId: fill.tradeId || null,
                qty: Number(fill.qty || 0),
                price: Number(fill.price || 0),
                realizedPnl: Number(fill.realizedPnl || 0),
                tradeTime: fill.tradeTime,
            });
            logOrderRuntimeTrace('GRID_FILL_UNIT_APPLY', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide: normalizedLeg,
                clientOrderId: fill.clientOrderId,
                orderId: fill.orderId,
                tradeId: fill.tradeId || null,
                qty: Number(fill.qty || 0),
                price: Number(fill.price || 0),
                realizedPnl: Number(fill.realizedPnl || 0),
                tradeTime: fill.tradeTime,
            });
        }

        if(reservationRecovered){
            primaryExecution = primaryExecution || execution;
            if(reservationClientOrderId){
                matchedReservationClientOrderIds.add(reservationClientOrderId);
            }
        }
    }

    if(appliedFillCount > 0){
        const siblingReservationIds = activeReservations
            .map((reservation) => String(reservation?.clientOrderId || '').trim())
            .filter((clientOrderId) => Boolean(clientOrderId) && !matchedReservationClientOrderIds.has(clientOrderId));

        if(finalizedReservationCount > 0 || matchedReservationClientOrderIds.size > 0){
            logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_RESERVATION_FINALIZED', {
                uid,
                pid: row.id,
                symbol: row.symbol,
                positionSide: normalizedLeg,
                matchedReservationClientOrderIds: Array.from(matchedReservationClientOrderIds),
                siblingReservationClientOrderIds: siblingReservationIds,
                finalizedReservationCount,
            });
        }

        await exports.cancelGridOrders({
            uid,
            symbol: row.symbol,
            pid: row.id,
            leg: normalizedLeg,
            includeEntries: false,
            includeExits: true,
        });
    }else if(duplicateFillCount > 0){
        logOrderRuntimeTrace('GRID_RESERVATION_EXIT_RECOVERY_DUPLICATE_NO_SIBLING_CANCEL', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide: normalizedLeg,
            matchedReservationClientOrderIds: Array.from(matchedReservationClientOrderIds),
            duplicateFillCount,
            reason: 'duplicate-exit-fill-must-not-cancel-current-active-protection',
        });
    }
    await pidPositionLedger.syncGridLegSnapshot(row.id, normalizedLeg);

    if(!primaryExecution){
        return null;
    }

    exports.msgAdd(
        'gridReconcile',
        'EXIT_FILL_RECOVERED',
        `pid:${row.id}, symbol:${row.symbol}, leg:${normalizedLeg}, clientOrderId:${primaryExecution.clientOrderId}, orderId:${primaryExecution.orderId}, recoveredReservationCount:${matchedReservationClientOrderIds.size}, appliedFillCount:${appliedFillCount}, duplicateFillCount:${duplicateFillCount}, qty:${primaryExecution.qty}, price:${primaryExecution.price}, pnl:${primaryExecution.realizedPnl}, issues:${[].concat(issue?.issues || []).join(',')}`,
        uid,
        row.id,
        primaryExecution.orderId,
        row.symbol,
        normalizedLeg === 'LONG' ? 'BUY' : 'SELL'
    );

    return {
        ...primaryExecution,
        recoveredReservationClientOrderIds: Array.from(matchedReservationClientOrderIds),
        appliedFillCount,
        duplicateFillCount,
    };
}

exports.recoverGridEntryFillFromExchange = async ({
    uid,
    row,
    leg,
    issue = null,
}) => {
    if(!uid || !row?.id || !row?.symbol || !leg){
        return null;
    }

    const normalizedLeg = String(leg || '').trim().toUpperCase();
    const prefix = normalizedLeg === 'LONG' ? 'long' : normalizedLeg === 'SHORT' ? 'short' : null;
    if(!prefix){
        return null;
    }

    const execution = await loadRecentGridEntryExecutionFromExchange({
        uid,
        pid: row.id,
        symbol: row.symbol,
        leg: normalizedLeg,
        candidateClientOrderIds: [row?.[`${prefix}EntryOrderId`] || null],
    });
    if(!execution){
        return null;
    }

    const recoveredFills = Array.isArray(execution.fills) && execution.fills.length > 0
        ? execution.fills
        : [execution];
    logOrderRuntimeTrace('GRID_FILL_UNIT_RECOVERY_FOUND_TRADES', {
        uid,
        pid: row.id,
        symbol: row.symbol,
        positionSide: normalizedLeg,
        clientOrderIds: Array.from(new Set(recoveredFills.map((fill) => fill?.clientOrderId || null).filter(Boolean))),
        orderIds: Array.from(new Set(recoveredFills.map((fill) => fill?.orderId || null).filter(Boolean))),
        tradeIds: recoveredFills.map((fill) => fill?.tradeId || null).filter(Boolean),
        fillCount: recoveredFills.length,
        totalQty: Number(execution.qty || 0),
        issues: [].concat(issue?.issues || []),
    });

    let appliedFillCount = 0;
    let duplicateFillCount = 0;
    for(const fill of recoveredFills){
        const existingFill = await pidPositionLedger.findRecordedFill({
            uid,
            pid: row.id,
            strategyCategory: 'grid',
            symbol: row.symbol,
            positionSide: normalizedLeg,
            sourceClientOrderId: fill.clientOrderId,
            sourceOrderId: fill.orderId,
            sourceTradeId: fill.tradeId,
            fillQty: fill.qty,
            fillPrice: fill.price,
            tradeTime: fill.tradeTime,
        });
        if(existingFill){
            duplicateFillCount += 1;
            continue;
        }

        await pidPositionLedger.applyEntryFill({
            uid,
            pid: row.id,
            strategyCategory: 'grid',
            symbol: row.symbol,
            positionSide: normalizedLeg,
            sourceClientOrderId: fill.clientOrderId,
            sourceOrderId: fill.orderId,
            sourceTradeId: fill.tradeId,
            fillQty: fill.qty,
            fillPrice: fill.price,
            fee: fill.fee,
            tradeTime: fill.tradeTime,
            eventType: 'GRID_EXCHANGE_RECONCILED_ENTRY_FILL',
            note: 'exchange-entry-reconcile',
        });
        appliedFillCount += 1;
        logOrderRuntimeTrace('GRID_FILL_UNIT_APPLY', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            positionSide: normalizedLeg,
            clientOrderId: fill.clientOrderId,
            orderId: fill.orderId,
            tradeId: fill.tradeId || null,
            qty: Number(fill.qty || 0),
            price: Number(fill.price || 0),
            tradeTime: fill.tradeTime,
        });
    }
    await pidPositionLedger.syncGridLegSnapshot(row.id, normalizedLeg);

    exports.msgAdd(
        'gridReconcile',
        'ENTRY_FILL_RECOVERED',
        `pid:${row.id}, symbol:${row.symbol}, leg:${normalizedLeg}, clientOrderId:${execution.clientOrderId}, orderId:${execution.orderId}, fillCount:${recoveredFills.length}, appliedFillCount:${appliedFillCount}, duplicateFillCount:${duplicateFillCount}, qty:${execution.qty}, price:${execution.price}, issues:${[].concat(issue?.issues || []).join(',')}`,
        uid,
        row.id,
        execution.orderId,
        row.symbol,
        normalizedLeg === 'LONG' ? 'BUY' : 'SELL'
    );

    return execution;
}

const buildExpectedSignalBoundTargets = ({ play, exactPrice, resolvedQty, orderRules }) => {
    if(!play || !Number(exactPrice) || !Number(resolvedQty) || !orderRules){
        return [];
    }

    let profitPrice = resolveBoundProfitPrice(play, exactPrice, orderRules.tickSize);
    let stopPrice = resolveBoundStopPrice(play, exactPrice, orderRules.tickSize);
    let profitQty = resolvedQty;
    let profitPrefix = 'PROFIT';

    if(splitTakeProfit.isSplitTakeProfitEnabled(play)){
        const splitContext = resolveLiveSplitStageContext(play, exactPrice, orderRules);
        stopPrice = Number(splitContext?.stopPrice || 0);
        profitPrice = Number(splitContext?.profitPrice || 0);
        profitQty = Number(splitContext?.stageQty || 0);
        profitPrefix = 'SPLITTP';
    }

    const targets = [];
    if(profitPrice > 0){
        targets.push({
            prefix: profitPrefix,
            quantity: Number(profitQty || 0),
            triggerPrice: Number(profitPrice || 0),
        });
    }
    if(stopPrice > 0){
        targets.push({
            prefix: 'STOP',
            quantity: Number(resolvedQty || 0),
            triggerPrice: Number(stopPrice || 0),
        });
    }

    return targets;
}

const hasMatchingBoundOrderCoverage = (existingBoundOrders, expectedTargets, options = {}) => {
    const orders = Array.isArray(existingBoundOrders) ? existingBoundOrders : [];
    const targets = Array.isArray(expectedTargets) ? expectedTargets : [];
    const quantityTolerance = Math.max(Number(options.quantityTolerance || 0), 1e-9);
    const priceTolerance = Math.max(Number(options.priceTolerance || 0), 1e-9);

    if(orders.length !== targets.length){
        return false;
    }

    return targets.every((target) => orders.some((order) => {
        const prefix = getBoundOrderPrefix(order.clientOrderId);
        const orderQty = Number(order.quantity || order.raw?.origQty || order.raw?.quantity || 0);
        const orderTriggerPrice = Number(order.triggerPrice || order.price || order.raw?.triggerPrice || order.raw?.stopPrice || order.raw?.price || 0);
        return (
            prefix === target.prefix
            && Math.abs(orderQty - Number(target.quantity || 0)) <= quantityTolerance
            && Math.abs(orderTriggerPrice - Number(target.triggerPrice || 0)) <= priceTolerance
        );
    }));
}

const EXIT_RESERVATION_IDEMPOTENCY_WINDOW_MS = 120000;
const LOCAL_ACTIVE_EXIT_RESERVATION_STATUSES = new Set([
    'ACTIVE',
    'PARTIAL',
    'CANCEL_REQUESTED',
    'UNKNOWN_CANCEL_STATE',
]);
const LOCAL_RECENT_EXIT_RESERVATION_STATUSES = new Set([
    'ACTIVE',
    'PARTIAL',
    'CANCEL_REQUESTED',
    'CANCEL_PENDING',
    'UNKNOWN_CANCEL_STATE',
]);

const getReservationTimeMs = (reservation = {}) => {
    const raw = reservation.updatedAt || reservation.createdAt || reservation.updated_at || reservation.created_at || null;
    const parsed = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
}

const isRecentExitReservation = (reservation = {}, maxAgeMs = EXIT_RESERVATION_IDEMPOTENCY_WINDOW_MS) => {
    const timeMs = getReservationTimeMs(reservation);
    if(!(timeMs > 0)){
        return false;
    }
    return Date.now() - timeMs <= maxAgeMs;
}

const getReservationRemainingQty = (reservation = {}) => Math.max(
    0,
    Number(reservation.reservedQty || 0) - Number(reservation.filledQty || 0)
);

const normalizeRuntimeReservationSymbol = (value = '') => String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^BINANCE:/, '')
    .replace(/\.P$/, '');

const loadPidExitReservationsForRuntimeGuard = async ({
    uid,
    pid,
    strategyCategory,
    positionSide,
    symbol = null,
    includeRecentCancelPending = false,
} = {}) => {
    const rows = await pidPositionLedger.loadActiveReservations({
        uid,
        pid,
        strategyCategory,
        positionSide,
    });
    const normalizedSymbol = symbol ? normalizeRuntimeReservationSymbol(symbol) : null;
    const statusSet = includeRecentCancelPending
        ? LOCAL_RECENT_EXIT_RESERVATION_STATUSES
        : LOCAL_ACTIVE_EXIT_RESERVATION_STATUSES;

    return (rows || []).filter((reservation) => {
        const status = String(reservation.status || '').trim().toUpperCase();
        if(!statusSet.has(status)){
            return false;
        }
        if(status === 'CANCEL_PENDING' && !isRecentExitReservation(reservation)){
            return false;
        }
        if(normalizedSymbol && normalizeRuntimeReservationSymbol(reservation.symbol || '') !== normalizedSymbol){
            return false;
        }
        return getReservationRemainingQty(reservation) > 1e-9;
    });
}

const findInFlightGridManualCloseReservation = async ({
    uid,
    pid,
    symbol,
    leg,
} = {}) => {
    if(!uid || !pid || !symbol || !leg){
        return null;
    }
    const reservations = await loadPidExitReservationsForRuntimeGuard({
        uid,
        pid,
        strategyCategory: 'grid',
        positionSide: String(leg || '').trim().toUpperCase(),
        symbol,
        includeRecentCancelPending: true,
    });
    return reservations.find((reservation) =>
        String(reservation.reservationKind || '').trim().toUpperCase() === 'GRID_MANUAL_OFF'
    ) || null;
}

const hasRecentLocalBoundReservationCoverage = async ({
    uid,
    pid,
    symbol,
    positionSide,
    entryOrderId,
    expectedTargets,
    quantityTolerance = 1e-9,
} = {}) => {
    const targets = Array.isArray(expectedTargets) ? expectedTargets : [];
    if(!uid || !pid || !positionSide || !entryOrderId || targets.length === 0){
        return false;
    }
    const reservations = await loadPidExitReservationsForRuntimeGuard({
        uid,
        pid,
        strategyCategory: 'signal',
        positionSide,
        symbol,
        includeRecentCancelPending: false,
    });
    if(reservations.length === 0){
        return false;
    }
    const tolerance = Math.max(Number(quantityTolerance || 0), 1e-9);
    const covered = targets.every((target) => {
        const expectedClientOrderId = getCloseClientOrderId(target.prefix, uid, pid, entryOrderId);
        const expectedQty = Number(target.quantity || 0);
        return reservations.some((reservation) => {
            if(String(reservation.clientOrderId || '') !== expectedClientOrderId){
                return false;
            }
            const reservedQty = Number(reservation.reservedQty || 0);
            const remainingQty = getReservationRemainingQty(reservation);
            return (
                Math.abs(reservedQty - expectedQty) <= tolerance
                || Math.abs(remainingQty - expectedQty) <= tolerance
            );
        });
    });

    if(covered){
        logOrderRuntimeTrace('BOUND_LOCAL_IDEMPOTENT_OK', {
            uid,
            pid,
            strategyCategory: 'signal',
            symbol,
            positionSide,
            entryOrderId,
            expectedTargets: targets.map((target) => ({
                prefix: target.prefix,
                quantity: Number(target.quantity || 0),
            })),
            reservations: reservations.map((reservation) => ({
                id: reservation.id || null,
                clientOrderId: reservation.clientOrderId || null,
                reservationKind: reservation.reservationKind || null,
                status: reservation.status || null,
                reservedQty: Number(reservation.reservedQty || 0),
                filledQty: Number(reservation.filledQty || 0),
            })),
        });
    }
    return covered;
}

const hasExchangeOpenPosition = async (uid, symbol, signalSide) => {
    if(!symbol || !signalSide){
        return false;
    }

    if(!(await ensureBinanceApiClient(uid))){
        return false;
    }

    try{
        const positions = await binance[uid].futuresPositionRisk();
        const matched = (positions || []).filter((item) => item.symbol === symbol);
        if(matched.length === 0){
            return false;
        }

        return matched.some((item) => {
            const positionAmt = Number(item.positionAmt || 0);
            if(!positionAmt){
                return false;
            }

            if(item.positionSide === 'LONG'){
                return signalSide === 'BUY' && positionAmt > 0;
            }

            if(item.positionSide === 'SHORT'){
                return signalSide === 'SELL' && positionAmt < 0;
            }

            if(item.positionSide === 'BOTH' || !item.positionSide){
                return signalSide === 'BUY' ? positionAmt > 0 : positionAmt < 0;
            }

            return false;
        });
    }catch(error){
        return false;
    }
}

const waitForExchangeOpenPosition = async (uid, symbol, signalSide, attempts = 12, delayMs = 250) => {
    for(let attempt = 1; attempt <= attempts; attempt += 1){
        if(await hasExchangeOpenPosition(uid, symbol, signalSide)){
            return true;
        }

        if(attempt < attempts){
            await sleep(delayMs);
        }
    }

    return false;
}

const hasActiveLiveGridConflict = async (uid, symbol) => {
    if(!uid || !symbol){
        return false;
    }

    try{
        const [rows] = await db.query(
            `SELECT id
               FROM live_grid_strategy_list
              WHERE uid = ?
                AND enabled = 'Y'
                AND symbol = ?
                AND regimeStatus <> 'WAITING_WEBHOOK'
              LIMIT 1`,
            [uid, symbol]
        );

        return Array.isArray(rows) && rows.length > 0;
    }catch(error){
        return false;
    }
}

const getGridExchangePosition = async (uid, symbol, leg, options = {}) => {
    if(!symbol || !leg){
        return null;
    }

    const exchangeSnapshot = options.exchangeSnapshot || null;
    if(exchangeSnapshot){
        if(exchangeSnapshot.readOk === false){
            return {
                qty: null,
                readOk: false,
                readError: exchangeSnapshot.readError || null,
                raw: exchangeSnapshot,
            };
        }

        const qty = getExchangeQtyForPositionSide(exchangeSnapshot, leg);
        if(!(qty > 0)){
            return null;
        }

        return {
            qty,
            raw: exchangeSnapshot,
        };
    }

    if(!(await ensureBinanceApiClient(uid))){
        return {
            qty: null,
            readOk: false,
            readError: 'BINANCE_CLIENT_UNAVAILABLE',
        };
    }

    try{
        const positions = await binance[uid].futuresPositionRisk();
        const matched = (positions || []).find((item) => item.symbol === symbol && item.positionSide === leg);
        if(!matched){
            return null;
        }

        const positionAmt = Math.abs(Number(matched.positionAmt || 0));
        if(!(positionAmt > 0)){
            return null;
        }

        return {
            qty: positionAmt,
            raw: matched,
        };
    }catch(error){
        return {
            qty: null,
            readOk: false,
            readError: error?.response?.status
                ? `BINANCE_READ_FAILED_${error.response.status}`
                : (error?.message || 'BINANCE_READ_FAILED'),
        };
    }
}

exports.getGridLegExchangePosition = async ({
    uid,
    symbol,
    leg,
    exchangeSnapshot = null,
} = {}) => {
    return await getGridExchangePosition(uid, symbol, leg, {
        exchangeSnapshot,
    });
}

const resolvePidOwnedCloseQtyGuard = async ({
    uid,
    pid,
    strategyCategory,
    symbol,
    positionSide,
    requestedQty = 0,
    exchangeAggregateQty = null,
    clientOrderId = null,
    reason = null,
}) => {
    const normalizedCategory = String(strategyCategory || '').trim().toLowerCase();
    const normalizedPositionSide = String(positionSide || '').trim().toUpperCase();
    const pidOwnedQty = Number(await pidPositionLedger.getOpenQty({
        uid,
        pid,
        strategyCategory: normalizedCategory,
        positionSide: normalizedPositionSide,
    }) || 0);
    const requestedCloseQty = Number(requestedQty || 0);
    const resolvedExchangeAggregateQty = Number(exchangeAggregateQty);
    const hasExchangeAggregateQty = Number.isFinite(resolvedExchangeAggregateQty) && resolvedExchangeAggregateQty >= 0;

    if(!(pidOwnedQty > 0)){
        logOrderRuntimeTrace('PID_CLOSE_QTY_GUARD_BLOCKED', {
            uid,
            pid,
            strategyCategory: normalizedCategory,
            symbol,
            positionSide: normalizedPositionSide,
            clientOrderId,
            reason: reason || 'pid-owned-zero',
            pidOwnedQty,
            requestedCloseQty,
            exchangeAggregateQty: hasExchangeAggregateQty ? resolvedExchangeAggregateQty : null,
        });
        return {
            allowed: false,
            reason: 'PID_OWNED_QTY_ZERO',
            pidOwnedQty,
            requestedCloseQty,
            exchangeAggregateQty: hasExchangeAggregateQty ? resolvedExchangeAggregateQty : null,
            finalCloseQty: 0,
        };
    }

    const [ownerRows] = await db.query(
        `SELECT pid, strategyCategory, openQty
           FROM live_pid_position_snapshot
          WHERE uid = ?
            AND symbol = ?
            AND positionSide = ?
            AND ABS(openQty) > 0.000000001`,
        [uid, symbol, normalizedPositionSide]
    );
    const openOwners = (ownerRows || []).map((owner) => ({
        pid: Number(owner?.pid || 0),
        strategyCategory: String(owner?.strategyCategory || '').trim().toLowerCase(),
        openQty: Number(owner?.openQty || 0),
    }));
    const targetOwnerPresent = openOwners.some((owner) =>
        Number(owner?.pid || 0) === Number(pid || 0)
        && String(owner?.strategyCategory || '') === normalizedCategory
    );
    if(openOwners.length > 0 && !targetOwnerPresent){
        logOrderRuntimeTrace('PID_CLOSE_QTY_GUARD_BLOCKED', {
            uid,
            pid,
            strategyCategory: normalizedCategory,
            symbol,
            positionSide: normalizedPositionSide,
            clientOrderId,
            reason: reason || 'target-owner-missing',
            pidOwnedQty,
            requestedCloseQty,
            exchangeAggregateQty: hasExchangeAggregateQty ? resolvedExchangeAggregateQty : null,
            owners: openOwners,
        });
        return {
            allowed: false,
            reason: 'PID_OWNER_NOT_IN_SYMBOL_SIDE_SNAPSHOT',
            pidOwnedQty,
            requestedCloseQty,
            exchangeAggregateQty: hasExchangeAggregateQty ? resolvedExchangeAggregateQty : null,
            finalCloseQty: 0,
            owners: openOwners,
        };
    }

    if(hasExchangeAggregateQty && resolvedExchangeAggregateQty + 1e-9 < pidOwnedQty){
        logOrderRuntimeTrace('CROSS_PID_AGGREGATE_MISMATCH_DETECTED', {
            uid,
            pid,
            strategyCategory: normalizedCategory,
            symbol,
            positionSide: normalizedPositionSide,
            clientOrderId,
            reason: reason || 'aggregate-mismatch',
            pidOwnedQty,
            requestedCloseQty,
            exchangeAggregateQty: resolvedExchangeAggregateQty,
        });
        logOrderRuntimeTrace('PID_CLOSE_QTY_GUARD_BLOCKED', {
            uid,
            pid,
            strategyCategory: normalizedCategory,
            symbol,
            positionSide: normalizedPositionSide,
            clientOrderId,
            reason: reason || 'aggregate-mismatch',
            pidOwnedQty,
            requestedCloseQty,
            exchangeAggregateQty: resolvedExchangeAggregateQty,
        });
        return {
            allowed: false,
            reason: 'EXCHANGE_AGGREGATE_LT_PID_OWNED',
            pidOwnedQty,
            requestedCloseQty,
            exchangeAggregateQty: resolvedExchangeAggregateQty,
            finalCloseQty: 0,
        };
    }

    const targetQty = requestedCloseQty > 0 ? requestedCloseQty : pidOwnedQty;
    const finalCloseQty = Math.min(targetQty, pidOwnedQty);
    logOrderRuntimeTrace('PID_CLOSE_QTY_GUARD', {
        uid,
        pid,
        strategyCategory: normalizedCategory,
        symbol,
        positionSide: normalizedPositionSide,
        clientOrderId,
        reason: reason || 'close-qty-guard',
        pidOwnedQty,
        requestedCloseQty,
        exchangeAggregateQty: hasExchangeAggregateQty ? resolvedExchangeAggregateQty : null,
        finalCloseQty,
        ownerClear: true,
        ownerCountForSymbolSide: openOwners.length,
        otherOwners: openOwners.filter((owner) =>
            Number(owner?.pid || 0) !== Number(pid || 0)
            || String(owner?.strategyCategory || '') !== normalizedCategory
        ),
    });

    return {
        allowed: finalCloseQty > 0,
        reason: finalCloseQty > 0 ? 'OK' : 'FINAL_CLOSE_QTY_ZERO',
        pidOwnedQty,
        requestedCloseQty,
        exchangeAggregateQty: hasExchangeAggregateQty ? resolvedExchangeAggregateQty : null,
        finalCloseQty,
        ownerClear: true,
        ownerCountForSymbolSide: openOwners.length,
        owners: openOwners,
    };
}

exports.closeGridLegMarketOrder = async ({
    uid,
    pid,
    symbol,
    leg,
    qty = 0,
} = {}) => {
    if(!symbol || !leg){
        return null;
    }

    const writeGuard = await shouldBlockGridCloseBinanceWrite({ uid, pid, symbol });
    if(writeGuard.blocked){
        await logBlockedGridCloseBinanceWrite({
            uid,
            pid,
            symbol,
            leg,
            qty,
            reason: writeGuard.reason,
            row: writeGuard.row,
        });
        return null;
    }

    if(!(await ensureBinanceApiClient(uid))){
        return null;
    }

    const inFlightManualClose = await findInFlightGridManualCloseReservation({
        uid,
        pid,
        symbol,
        leg,
    });
    if(inFlightManualClose){
        const remainingQty = getReservationRemainingQty(inFlightManualClose);
        logOrderRuntimeTrace('GRID_MANUAL_CLOSE_IN_FLIGHT_BLOCKED', {
            uid,
            pid,
            strategyCategory: 'grid',
            symbol,
            positionSide: leg,
            requestedQty: Number(qty || 0),
            reservationId: inFlightManualClose.id || null,
            clientOrderId: inFlightManualClose.clientOrderId || null,
            status: inFlightManualClose.status || null,
            remainingQty,
            reason: 'PID_OWNED_MANUAL_CLOSE_ALREADY_IN_FLIGHT',
        });
        exports.msgAdd(
            'closeGridLegMarketOrder',
            'GRID_MANUAL_CLOSE_IN_FLIGHT_BLOCKED',
            `pid:${pid}, symbol:${symbol}, leg:${leg}, remainingQty:${remainingQty}`,
            uid,
            pid,
            inFlightManualClose.clientOrderId || null,
            symbol,
            leg
        );
        return null;
    }

    const exchangePosition = await getGridExchangePosition(uid, symbol, leg);
    const requestedQty = Number(qty || 0);
    const positionQty = Number(exchangePosition?.qty || 0);
    const closeQtyGuard = await resolvePidOwnedCloseQtyGuard({
        uid,
        pid,
        strategyCategory: 'grid',
        symbol,
        positionSide: leg,
        requestedQty,
        exchangeAggregateQty: positionQty,
        reason: `grid-close:${leg}`,
    });
    const closeQty = Number(closeQtyGuard?.finalCloseQty || 0);
    if(!(closeQty > 0)){
        return null;
    }

    const orderRules = await loadSymbolOrderRules(uid, symbol);
    if(!orderRules){
        return null;
    }

    const normalizedQty = roundToStep(closeQty, orderRules.stepSize || 0.001, 'down');
    if(!(normalizedQty >= Number(orderRules.minQty || 0))){
        return null;
    }

    const side = leg === 'LONG' ? 'SELL' : 'BUY';
    const clientOrderId = `GMANUAL_${leg === 'LONG' ? 'L' : 'S'}_${uid}_${pid}_${Date.now().toString().slice(-8)}`;
    await insertBinanceRuntimeEventLog({
        uid,
        pid,
        strategyCategory: 'grid',
        eventType: 'BINANCE_WRITE_ATTEMPT',
        eventCode: 'GRID_MARKET_CLOSE_ATTEMPT',
        severity: 'high',
        symbol,
        side,
        positionSide: leg,
        clientOrderId,
        orderType: 'MARKET',
        quantity: normalizedQty,
        note: 'about to submit grid market reduce-only close',
        payload: {
            callsite: 'coin.closeGridLegMarketOrder',
            requestedQty,
            positionQty,
            finalCloseQty: closeQty,
        },
    });
    const order = await submitFuturesOrder(
        {
            uid,
            pid,
            strategyCategory: 'grid',
            action: 'WRITE_CLOSE_MARKET',
            caller: 'coin.closeGridLegMarketOrder',
        },
        'MARKET',
        side,
        symbol,
        normalizedQty,
        false,
        {
            positionSide: leg,
            newClientOrderId: clientOrderId,
        }
    );

    await insertBinanceRuntimeEventLog({
        uid,
        pid,
        strategyCategory: 'grid',
        eventType: 'BINANCE_WRITE_RESULT',
        eventCode: 'GRID_MARKET_CLOSE_SUBMITTED',
        severity: 'high',
        symbol,
        side,
        positionSide: leg,
        clientOrderId,
        orderId: order?.orderId || null,
        orderType: 'MARKET',
        quantity: normalizedQty,
        note: 'submitted grid market reduce-only close',
        payload: {
            callsite: 'coin.closeGridLegMarketOrder',
            order,
        },
    });

    await pidPositionLedger.replaceExitReservations({
        uid,
        pid,
        strategyCategory: 'grid',
        symbol,
        positionSide: leg,
        reservations: [
            {
                clientOrderId,
                sourceOrderId: order?.orderId || null,
                reservationKind: 'GRID_MANUAL_OFF',
                reservedQty: normalizedQty,
                note: `grid-manual-close pid:${pid}, leg:${leg}`,
            },
        ],
    });

    return {
        orderId: order?.orderId || null,
        clientOrderId,
        qty: normalizedQty,
    };
}

const cancelBoundExitOrders = async (uid, symbol, pid, excludeType = null) => {
    const openOrders = await listOpenBoundExitOrders(uid, symbol, pid);
    if(openOrders.length === 0){
        return 0;
    }

    let canceledCount = 0;
    const canceledClientOrderIds = [];
    for(const order of openOrders){
        const clientOrderId = String(order.clientOrderId || order.origClientOrderId || '');
        const orderType = clientOrderId.split('_')[0];
        if(excludeType && orderType === excludeType){
            continue;
        }

        try{
            logOrderRuntimeTrace('RESERVATION_CANCEL_REQUESTED', {
                uid,
                pid,
                symbol,
                orderId: order.orderId || null,
                clientOrderId: clientOrderId || null,
                orderType,
            });
            if(order.__isAlgo){
                await privateFuturesAlgoRequest(uid, '/fapi/v1/algoOrder', {
                    algoId: order.orderId,
                }, 'DELETE');
            }else{
                await cancelFuturesOrder({
                    uid,
                    pid,
                    strategyCategory: 'signal',
                    action: 'WRITE_CANCEL_ORDER',
                    caller: 'coin.cancelBoundExitOrders',
                    clientOrderId: clientOrderId || null,
                    orderType,
                }, symbol, order.orderId);
            }
            canceledCount += 1;
            if(clientOrderId){
                canceledClientOrderIds.push(clientOrderId);
            }
            logOrderRuntimeTrace('RESERVATION_CANCEL_CONFIRMED', {
                uid,
                pid,
                symbol,
                orderId: order.orderId || null,
                clientOrderId: clientOrderId || null,
                orderType,
            });
        }catch(error){
            const info = extractBinanceError(error);
            const action = classifyBinanceError(info.code);
            logOrderRuntimeTrace('RESERVATION_CANCEL_FAILED', {
                uid,
                pid,
                symbol,
                orderId: order.orderId || null,
                clientOrderId: clientOrderId || null,
                orderType,
                code: info.code || null,
                reason: info.msg || error?.message || String(error),
            });
            exports.msgAdd(
                'cancelBoundExitOrders',
                String(info.code),
                toRuntimeMessage(
                    formatBinanceErrorGuideClean(info.msg, info.code, action),
                    `pid:${pid}, orderId:${order.orderId}, clientOrderId:${clientOrderId}`
                ),
                uid,
                pid,
                order.orderId,
                symbol,
                null
            );
        }
    }

    if(canceledCount > 0){
        exports.msgAdd(
            'cancelBoundExitOrders',
            'BOUND_CANCELED',
            `pid:${pid}, symbol:${symbol}, count:${canceledCount}, excludeType:${excludeType || 'NONE'}`,
            uid,
            pid,
            null,
            symbol,
            null
        );
    }

    if(canceledClientOrderIds.length > 0){
        await pidPositionLedger.markReservationsCanceled(canceledClientOrderIds);
    }

    return canceledCount;
}

const GRID_CLIENT_ORDER_PREFIXES = ["GENTRY", "GTP", "GSTOP", "GMANUAL"];

const isGridClientOrderId = (clientOrderId) =>
    GRID_CLIENT_ORDER_PREFIXES.some((prefix) => String(clientOrderId || '').startsWith(`${prefix}_`));

const buildGridClientOrderId = (prefix, leg, uid, pid) =>
    `${prefix}_${leg === 'LONG' ? 'L' : 'S'}_${uid}_${pid}_${Date.now().toString().slice(-8)}`;

const listOpenGridOrders = async (uid, symbol, pid, leg = null) => {
    if(!symbol || !pid){
        return [];
    }

    if(!(await ensureBinanceApiClient(uid))){
        return [];
    }

    const legCode = leg === 'LONG' ? 'L' : leg === 'SHORT' ? 'S' : null;
    const matchesGridOrder = (clientOrderId = '') => {
        const normalized = String(clientOrderId || '');
        if(!isGridClientOrderId(normalized)){
            return false;
        }

        const parts = normalized.split('_');
        if(parts.length < 4 || Number(parts[3]) !== Number(pid)){
            return false;
        }

        if(legCode && parts[1] !== legCode){
            return false;
        }

        return true;
    };

    const regularOrders = await binance[uid].futuresOpenOrders(symbol).catch(() => []);
    const openOrders = (regularOrders || [])
        .filter((order) => matchesGridOrder(order.clientOrderId))
        .map((order) => ({
            type: 'regular',
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
            raw: order,
        }));

    const algoOrders = await privateFuturesAlgoRequest(uid, '/fapi/v1/openAlgoOrders', { symbol }, 'GET').catch(() => []);
    const openAlgoOrders = (Array.isArray(algoOrders) ? algoOrders : [])
        .filter((order) => matchesGridOrder(order.clientAlgoId || order.clientOrderId))
        .map((order) => ({
            type: 'algo',
            orderId: order.strategyId || order.algoId || null,
            clientOrderId: order.clientAlgoId || order.clientOrderId,
            raw: order,
        }));

    return openOrders.concat(openAlgoOrders);
}

const getExchangePositionSnapshot = async (uid, symbol) => {
    const snapshot = {
        symbol,
        longQty: 0,
        shortQty: 0,
        bothQty: 0,
        netQty: 0,
        readOk: true,
        readError: null,
    };

    if(!symbol){
        return snapshot;
    }

    if(!(await ensureBinanceApiClient(uid))){
        snapshot.readOk = false;
        snapshot.readError = 'BINANCE_CLIENT_UNAVAILABLE';
        return snapshot;
    }

    try{
        const positions = await binance[uid].futuresPositionRisk();
        for(const item of (positions || [])){
            if(item.symbol !== symbol){
                continue;
            }

            const qty = Number(item.positionAmt || 0);
            if(item.positionSide === 'LONG'){
                snapshot.longQty = Math.abs(qty);
            }else if(item.positionSide === 'SHORT'){
                snapshot.shortQty = Math.abs(qty);
            }else{
                snapshot.bothQty = Math.abs(qty);
                snapshot.netQty = qty;
            }
        }
    }catch(error){
        snapshot.readOk = false;
        snapshot.readError = error?.response?.status
            ? `BINANCE_READ_FAILED_${error.response.status}`
            : (error?.message || 'BINANCE_READ_FAILED');
    }

    return snapshot;
}

exports.getExchangePositionSnapshot = getExchangePositionSnapshot;

const getExchangeQtyForPositionSide = (exchangeSnapshot = {}, positionSide = null) => {
    const normalizedPositionSide = String(positionSide || '').trim().toUpperCase();
    if(normalizedPositionSide === 'LONG'){
        return Number(exchangeSnapshot?.longQty || exchangeSnapshot?.bothQty || 0);
    }

    if(normalizedPositionSide === 'SHORT'){
        return Number(exchangeSnapshot?.shortQty || Math.abs(Number(exchangeSnapshot?.netQty || 0)) || 0);
    }

    return 0;
}

const clampTruthSyncLimit = (limit, fallback = 12, max = 24) => {
    const normalized = Number(limit || fallback);
    if(!(normalized > 0)){
        return fallback;
    }

    return Math.min(Math.max(1, Math.floor(normalized)), max);
}

const loadLiveSignalTruthSyncRows = async (uid, options = {}) => {
    const limit = clampTruthSyncLimit(options.limit, 12, 24);
    if(!uid){
        return [];
    }

    const pidSet = new Set();
    const pushPid = (value) => {
        const pid = Number(value || 0);
        if(pid > 0){
            pidSet.add(pid);
        }
    };

    const [runtimeRows] = await db.query(
        `SELECT id
           FROM live_play_list
          WHERE uid = ?
            AND live_ST = 'Y'
            AND enabled = 'Y'
            AND status IN ('EXACT_WAIT', 'EXACT')
          ${buildSignalTruthSyncOrderBy('STATUS')}
          LIMIT ?`,
        [uid, limit]
    );
    (runtimeRows || []).forEach((row) => pushPid(row?.id));

    const [snapshotRows] = await db.query(
        `SELECT DISTINCT pid
           FROM live_pid_position_snapshot
          WHERE uid = ?
            AND strategyCategory = 'signal'
            AND (status = 'OPEN' OR COALESCE(openQty, 0) > 0)
          ORDER BY pid ASC
          LIMIT ?`,
        [uid, limit]
    );
    (snapshotRows || []).forEach((row) => pushPid(row?.pid));

    const [reservationRows] = await db.query(
        `SELECT DISTINCT pid
           FROM live_pid_exit_reservation
          WHERE uid = ?
            AND strategyCategory = 'signal'
            AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')
          ORDER BY pid ASC
          LIMIT ?`,
        [uid, limit]
    );
    (reservationRows || []).forEach((row) => pushPid(row?.pid));

    const [runtimeValueRows] = await db.query(
        `SELECT id
           FROM live_play_list
          WHERE uid = ?
            AND live_ST = 'Y'
            AND (COALESCE(r_qty, 0) > 0 OR r_exactPrice IS NOT NULL)
          ${buildSignalTruthSyncOrderBy('RUNTIME_VALUE')}
          LIMIT ?`,
        [uid, limit]
    );
    (runtimeValueRows || []).forEach((row) => pushPid(row?.id));

    const pids = Array.from(pidSet).slice(0, limit);
    if(pids.length === 0){
        return [];
    }

    const [rows] = await db.query(
        `SELECT *
           FROM live_play_list
          WHERE uid = ?
            AND id IN (${pids.map(() => '?').join(',')})
          ORDER BY FIELD(id, ${pids.map(() => '?').join(',')})`,
        [uid, ...pids, ...pids]
    );

    return rows || [];
}

const loadLiveGridTruthSyncRows = async (uid, options = {}) => {
    const limit = clampTruthSyncLimit(options.limit, 12, 24);
    if(!uid){
        return [];
    }

    const pidSet = new Set();
    const pushPid = (value) => {
        const pid = Number(value || 0);
        if(pid > 0){
            pidSet.add(pid);
        }
    };

    const [runtimeRows] = await db.query(
        `SELECT id
           FROM live_grid_strategy_list
          WHERE uid = ?
            AND (
                enabled = 'Y'
                OR regimeStatus <> 'WAITING_WEBHOOK'
                OR COALESCE(longQty, 0) > 0
                OR COALESCE(shortQty, 0) > 0
                OR longLegStatus IN ('ENTRY_ARMED', 'OPEN')
                OR shortLegStatus IN ('ENTRY_ARMED', 'OPEN')
            )
          ORDER BY updatedAt DESC, id ASC
          LIMIT ?`,
        [uid, limit]
    );
    (runtimeRows || []).forEach((row) => pushPid(row?.id));

    const [snapshotRows] = await db.query(
        `SELECT DISTINCT pid
           FROM live_pid_position_snapshot
          WHERE uid = ?
            AND strategyCategory = 'grid'
            AND (status = 'OPEN' OR COALESCE(openQty, 0) > 0)
          ORDER BY pid ASC
          LIMIT ?`,
        [uid, limit]
    );
    (snapshotRows || []).forEach((row) => pushPid(row?.pid));

    const [reservationRows] = await db.query(
        `SELECT DISTINCT pid
           FROM live_pid_exit_reservation
          WHERE uid = ?
            AND strategyCategory = 'grid'
            AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')
          ORDER BY pid ASC
          LIMIT ?`,
        [uid, limit]
    );
    (reservationRows || []).forEach((row) => pushPid(row?.pid));

    const pids = Array.from(pidSet).slice(0, limit);
    if(pids.length === 0){
        return [];
    }

    const [rows] = await db.query(
        `SELECT *
           FROM live_grid_strategy_list
          WHERE uid = ?
            AND id IN (${pids.map(() => '?').join(',')})
          ORDER BY id ASC`,
        [uid, ...pids]
    );

    return rows || [];
}

const loadCachedExchangePositionSnapshot = async (uid, symbol, cache = null) => {
    const cacheKey = `${uid}:${String(symbol || '').trim().toUpperCase()}`;
    if(cache && cache.has(cacheKey)){
        return cache.get(cacheKey);
    }

    const snapshot = await getExchangePositionSnapshot(uid, symbol);
    if(cache){
        cache.set(cacheKey, snapshot);
    }
    return snapshot;
}

const convergeLiveSignalPositionToExchangeFlat = async (play, {
    logCode,
    message,
    recoveredExecution = null,
    allowLocalFlatten = false,
    exchangeSnapshotCache = null,
} = {}) => {
    if(!play?.uid || !play?.id || !play?.symbol){
        return false;
    }

    const current = await loadLivePlaySnapshot(play.id) || play;
    const resolvedSignalType = getResolvedLiveSignalType(current);
    const positionSide = getSignalPositionSide(resolvedSignalType);
    if(!resolvedSignalType || !positionSide){
        return false;
    }

    const exchangeSnapshot = await loadCachedExchangePositionSnapshot(current.uid, current.symbol, exchangeSnapshotCache);
    if(exchangeSnapshot?.readOk === false){
        logOrderRuntimeTrace('SIGNAL_EXCHANGE_FLAT_CONVERGENCE_BLOCKED_READ_FAILED', {
            uid: current.uid,
            pid: current.id,
            symbol: current.symbol,
            positionSide,
            readError: exchangeSnapshot.readError || null,
        });
        return false;
    }
    const exchangeQty = getExchangeQtyForPositionSide(exchangeSnapshot, positionSide);
    if(exchangeQty > 0){
        return false;
    }

    const snapshotBefore = await pidPositionLedger.loadSnapshot({
        uid: current.uid,
        pid: current.id,
        strategyCategory: 'signal',
        positionSide,
    });
    const reservationsBefore = await pidPositionLedger.loadActiveReservations({
        uid: current.uid,
        pid: current.id,
        strategyCategory: 'signal',
        positionSide,
    });
    const reservationIds = reservationsBefore
        .map((item) => String(item?.clientOrderId || '').trim())
        .filter(Boolean);
    if(reservationIds.length > 0){
        await pidPositionLedger.markReservationsCanceled(reservationIds);
    }

    await cancelBoundExitOrders(current.uid, current.symbol, current.id);

    const reservationsAfter = await pidPositionLedger.loadActiveReservations({
        uid: current.uid,
        pid: current.id,
        strategyCategory: 'signal',
        positionSide,
    });
    const openExitOrdersAfter = await listOpenBoundExitOrders(current.uid, current.symbol, current.id);
    const shouldFlatten = Boolean(recoveredExecution)
        || (
            allowLocalFlatten
            && reservationsAfter.length === 0
            && openExitOrdersAfter.length === 0
        );

    if(!shouldFlatten){
        return false;
    }

    let correctionResult = null;
    const correctionEventType = recoveredExecution
        ? 'SIGNAL_EXCHANGE_FLAT_RECONCILE_CLOSE'
        : 'SIGNAL_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN';
    if(Number(snapshotBefore?.openQty || 0) > 0){
        correctionResult = await pidPositionLedger.closeSnapshotAsOrphan({
            uid: current.uid,
            pid: current.id,
            strategyCategory: 'signal',
            symbol: current.symbol,
            positionSide,
            eventType: correctionEventType,
            note: `${logCode || correctionEventType}: ${message || ''}`,
            tradeTime: recoveredExecution?.tradeTime || new Date(),
        });
    }

    await pidPositionLedger.syncSignalPlaySnapshot(current.id, positionSide);

    const latest = await loadLivePlaySnapshot(current.id) || current;
    if(latest.status !== 'READY'){
        await setLivePlayReadyModeIfCurrent(latest, latest.status);
    }

    const snapshotAfter = await pidPositionLedger.loadSnapshot({
        uid: current.uid,
        pid: current.id,
        strategyCategory: 'signal',
        positionSide,
    });

    logOrderRuntimeTrace('SIGNAL_EXCHANGE_FLAT_RECONCILE', {
        uid: current.uid,
        pid: current.id,
        symbol: current.symbol,
        positionSide,
        statusBefore: current.status || null,
        statusAfter: (await loadLivePlaySnapshot(current.id))?.status || null,
        snapshotOpenQtyBefore: Number(snapshotBefore?.openQty || 0),
        snapshotOpenQtyAfter: Number(snapshotAfter?.openQty || 0),
        exchangePositionQty: exchangeQty,
        activeProtectionCountBefore: reservationsBefore.length,
        activeProtectionCountAfter: reservationsAfter.length,
        openExitOrderCountAfter: openExitOrdersAfter.length,
        recoveredCloseClientOrderId: recoveredExecution?.clientOrderId || null,
        recoveredOrderId: recoveredExecution?.orderId || null,
        correctionLedgerId: correctionResult?.ledgerId || null,
        reason: recoveredExecution
            ? 'EXCHANGE_FLAT_RECONCILE_CLOSE'
            : 'EXCHANGE_FLAT_LOCAL_STALE_FLATTEN',
    });

    exports.msgAdd(
        'signalTruthSync',
        recoveredExecution
            ? 'EXCHANGE_FLAT_RECONCILE_CLOSE'
            : 'EXCHANGE_FLAT_LOCAL_STALE_FLATTEN',
        `pid:${current.id}, symbol:${current.symbol}, positionSide:${positionSide}, openQtyBefore:${Number(snapshotBefore?.openQty || 0)}, openQtyAfter:${Number(snapshotAfter?.openQty || 0)}, exchangeQty:${exchangeQty}, activeProtectionBefore:${reservationsBefore.length}, activeProtectionAfter:${reservationsAfter.length}, recoveredCloseClientOrderId:${recoveredExecution?.clientOrderId || 'NONE'}, recoveredOrderId:${recoveredExecution?.orderId || 'NONE'}, correctionLedgerId:${correctionResult?.ledgerId || 'NONE'}`,
        current.uid,
        current.id,
        recoveredExecution?.orderId || null,
        current.symbol,
        resolvedSignalType || null
    );

    if(recoveredExecution){
        await evaluateLiveStrategyPoliciesAfterClose(current.uid, current.id);
    }

    return true;
}

const truthSyncLiveSignalPlay = async ({ row, exchangeSnapshotCache = null } = {}) => {
    if(!row?.id || !row?.uid || !row?.symbol){
        return null;
    }

    let refreshed = await loadLivePlaySnapshot(row.id) || row;
    const resolvedSignalType = getResolvedLiveSignalType(refreshed);
    const positionSide = getSignalPositionSide(resolvedSignalType);
    if(!resolvedSignalType || !positionSide){
        return null;
    }

    const repaired = [];
    const exchangeSnapshot = await loadCachedExchangePositionSnapshot(refreshed.uid, refreshed.symbol, exchangeSnapshotCache);
    if(exchangeSnapshot?.readOk === false){
        logOrderRuntimeTrace('SIGNAL_TRUTH_SYNC_SKIPPED_EXCHANGE_READ_FAILED', {
            uid: refreshed.uid,
            pid: refreshed.id,
            symbol: refreshed.symbol,
            positionSide,
            readError: exchangeSnapshot.readError || null,
        });
        return null;
    }
    const exchangeQty = getExchangeQtyForPositionSide(exchangeSnapshot, positionSide);
    const snapshotState = await pidPositionLedger.loadSnapshot({
        uid: refreshed.uid,
        pid: refreshed.id,
        strategyCategory: 'signal',
        positionSide,
    });
    const localSnapshotQty = Number(snapshotState?.openQty || 0);
    const runtimeQty = Number(refreshed.r_qty || 0);
    const activeReservations = await pidPositionLedger.loadActiveReservations({
        uid: refreshed.uid,
        pid: refreshed.id,
        strategyCategory: 'signal',
        positionSide,
    });
    const openExitOrders = await listOpenBoundExitOrders(refreshed.uid, refreshed.symbol, refreshed.id);
    const hasLocalOpen = localSnapshotQty > 0 || runtimeQty > 0 || refreshed.status === 'EXACT';

    if(exchangeQty > 0){
        if(!(localSnapshotQty > 0)){
            const recoveredEntry = await recoverSignalEntryFillFromExchange({
                uid: refreshed.uid,
                row: refreshed,
                issue: {
                    issues: ['TRUTH_SYNC_WITH_EXCHANGE_POSITION'],
                },
            });
            if(recoveredEntry){
                repaired.push({
                    action: 'RECOVER_ENTRY_FILL',
                    clientOrderId: recoveredEntry.clientOrderId,
                    orderId: recoveredEntry.orderId,
                });
                refreshed = await loadLivePlaySnapshot(refreshed.id) || refreshed;
            }
        }

        const latestSnapshot = await pidPositionLedger.loadSnapshot({
            uid: refreshed.uid,
            pid: refreshed.id,
            strategyCategory: 'signal',
            positionSide,
        });
        const latestQty = Number(latestSnapshot?.openQty || refreshed.r_qty || 0);
        if(latestQty > 0){
            const orderRules = await loadSymbolOrderRules(refreshed.uid, refreshed.symbol);
            const resolvedQty = orderRules
                ? roundToStep(latestQty, orderRules.stepSize || 0.001, 'down')
                : 0;
            const expectedTargets = orderRules && resolvedQty > 0 && Number(latestSnapshot?.avgEntryPrice || refreshed.r_exactPrice || 0) > 0
                ? buildExpectedSignalBoundTargets({
                    play: {
                        ...refreshed,
                        r_signalType: resolvedSignalType,
                    },
                    exactPrice: Number(latestSnapshot?.avgEntryPrice || refreshed.r_exactPrice || 0),
                    resolvedQty,
                    orderRules,
                })
                : [];
            const hasMatchingCoverage = expectedTargets.length > 0 && orderRules
                ? hasMatchingBoundOrderCoverage(openExitOrders, expectedTargets, {
                    quantityTolerance: Math.max(Number(orderRules?.stepSize || 0), 1e-9) / 2,
                    priceTolerance: Math.max(Number(orderRules?.tickSize || 0), 1e-9) / 2,
                })
                : openExitOrders.length > 0;

            if(activeReservations.length === 0 || !hasMatchingCoverage || refreshed.status !== 'EXACT'){
                const synced = await syncLiveBoundExitOrders({
                    uid: refreshed.uid,
                    pid: refreshed.id,
                    symbol: refreshed.symbol,
                    entryOrderId: refreshed.r_tid || null,
                    entryPrice: Number(latestSnapshot?.avgEntryPrice || refreshed.r_exactPrice || 0),
                    qty: latestQty,
                });
                if(synced){
                    repaired.push({
                        action: 'RESTORE_EXIT_ORDERS',
                    });
                }
            }
        }
    }else{
        if(hasLocalOpen || activeReservations.length > 0 || openExitOrders.length > 0 || refreshed.status === 'EXACT_WAIT'){
            const recoveredExecution = await recoverSignalExitFillFromExchange({
                uid: refreshed.uid,
                row: refreshed,
                issue: {
                    issues: ['TRUTH_SYNC_EXCHANGE_FLAT'],
                },
            });
            const flattened = await convergeLiveSignalPositionToExchangeFlat(refreshed, {
                logCode: recoveredExecution ? 'TRUTH_SYNC_EXIT_RECOVERED' : 'TRUTH_SYNC_EXCHANGE_FLAT',
                message: recoveredExecution
                    ? `clientOrderId:${recoveredExecution.clientOrderId}, orderId:${recoveredExecution.orderId}, qty:${recoveredExecution.qty}, price:${recoveredExecution.price}`
                    : 'exchange flat while local signal state remained open',
                recoveredExecution,
                allowLocalFlatten: true,
                exchangeSnapshotCache,
            });
            if(flattened){
                repaired.push({
                    action: recoveredExecution
                        ? 'RECOVER_EXIT_FILL_FLATTENED'
                        : 'LOCAL_STALE_FLATTENED',
                    clientOrderId: recoveredExecution?.clientOrderId || null,
                    orderId: recoveredExecution?.orderId || null,
                });
            }
        }
    }

    if(repaired.length === 0){
        return null;
    }

    return {
        pid: refreshed.id,
        symbol: refreshed.symbol || null,
        repairs: repaired,
    };
}

const hasMeaningfulQtyMismatch = (dbQty, exchangeQty) => {
    const left = Number(dbQty || 0);
    const right = Number(exchangeQty || 0);
    const diff = Math.abs(left - right);
    const tolerance = Math.max(0.001, left * 0.02, right * 0.02);
    return diff > tolerance;
}

const buildSignalRuntimeIssues = async (uid) => {
      const [rows] = await db.query(
        `SELECT * FROM live_play_list
          WHERE uid = ?
            AND live_ST = 'Y'
            AND enabled = 'Y'
            AND (
              status IN ('EXACT_WAIT', 'EXACT')
              OR COALESCE(r_qty, 0) > 0
              OR r_exactPrice IS NOT NULL
            )
          ORDER BY id ASC`,
          [uid]
      );
      const [snapshotRows] = await db.query(
          `SELECT pid, positionSide, openQty
             FROM live_pid_position_snapshot
            WHERE uid = ?
              AND strategyCategory = 'signal'
              AND status = 'OPEN'`,
          [uid]
      );

      const exchangeSnapshots = new Map();
      const bucketExchangeQty = new Map();
      const bucketInternalQty = new Map();
      const signalSnapshotQtyByPid = new Map();

      for(const snapshotRow of snapshotRows){
          const key = `${snapshotRow.pid}:${String(snapshotRow.positionSide || '').toUpperCase()}`;
          signalSnapshotQtyByPid.set(key, Number(snapshotRow.openQty || 0));
      }

    const getBucketExchangeQty = async (symbol, signalType) => {
        const bucketKey = `${symbol}:${signalType}`;
        if(bucketExchangeQty.has(bucketKey)){
            return bucketExchangeQty.get(bucketKey);
        }

        let snapshot = exchangeSnapshots.get(symbol);
        if(!snapshot){
            snapshot = await getExchangePositionSnapshot(uid, symbol);
            exchangeSnapshots.set(symbol, snapshot);
        }
        if(snapshot?.readOk === false){
            bucketExchangeQty.set(bucketKey, null);
            return null;
        }

        const exchangeQty = signalType === 'BUY'
            ? Number(snapshot.longQty || snapshot.bothQty || 0)
            : signalType === 'SELL'
                ? Number(snapshot.shortQty || Math.abs(snapshot.netQty || 0) || 0)
                : 0;
        bucketExchangeQty.set(bucketKey, exchangeQty);
        return exchangeQty;
    };

      for(const row of rows){
          const symbol = String(row.symbol || '').trim().toUpperCase();
          const signalType = getResolvedLiveSignalType(row);
          if(!symbol || !signalType){
              continue;
          }

          const bucketKey = `${symbol}:${signalType}`;
          const positionSide = getSignalPositionSide(signalType);
          const snapshotQty = Number(signalSnapshotQtyByPid.get(`${row.id}:${positionSide}`) || 0);
          const rowQty = Math.max(Number(row.r_qty || 0), snapshotQty);
          if(!bucketInternalQty.has(bucketKey)){
              bucketInternalQty.set(bucketKey, 0);
          }
          if(row.status === 'EXACT'){
              bucketInternalQty.set(bucketKey, bucketInternalQty.get(bucketKey) + Math.max(0, rowQty));
        }
    }

    const items = [];
      for(const row of rows){
          const symbol = String(row.symbol || '').trim().toUpperCase();
          const signalType = getResolvedLiveSignalType(row);
          const runtimeQty = Number(row.r_qty || 0);
          const bucketKey = `${symbol}:${signalType}`;
          const expectedQty = await getBucketExchangeQty(symbol, signalType);
          const internalBucketQty = Number(bucketInternalQty.get(bucketKey) || 0);
          const openExitOrders = await listOpenBoundExitOrders(uid, symbol, row.id);
          const issues = [];
          const positionSide = getSignalPositionSide(signalType);
          const snapshotQty = Number(signalSnapshotQtyByPid.get(`${row.id}:${positionSide}`) || 0);
          const effectiveDbQty = row.status === 'EXACT'
              ? Math.max(internalBucketQty, runtimeQty, snapshotQty)
              : Math.max(runtimeQty, snapshotQty);
          const orderRules = (signalType && Number(row.r_exactPrice || 0) > 0 && effectiveDbQty > 0)
              ? await loadSymbolOrderRules(uid, symbol)
              : null;
          const resolvedQty = orderRules
              ? roundToStep(effectiveDbQty, orderRules.stepSize || 0.001, 'down')
              : 0;
          const expectedBoundTargets = orderRules
              ? buildExpectedSignalBoundTargets({
                    play: {
                        ...row,
                        r_signalType: signalType,
                    },
                    exactPrice: Number(row.r_exactPrice || 0),
                    resolvedQty,
                    orderRules,
                })
              : [];

          if(expectedQty === null){
              issues.push('BINANCE_POSITION_READ_FAILED');
          }
          if(expectedQty !== null && row.status === 'READY' && effectiveDbQty > 0 && expectedQty > 0){
              issues.push('READY_WITH_OPEN_POSITION');
          }
          if(expectedQty !== null && row.status === 'EXACT_WAIT' && expectedQty > 0){
              issues.push('ENTRY_PENDING_BUT_POSITION_OPEN');
          }
          if(expectedQty !== null && row.status === 'EXACT' && effectiveDbQty <= 0 && expectedQty > 0){
              issues.push('ENTRY_FILL_MISSED');
          }
          if(!row.r_signalType && signalType){
            issues.push('MISSING_RUNTIME_SIGNAL_TYPE');
        }
        if(expectedQty !== null && effectiveDbQty > 0 && expectedQty <= 0){
            issues.push('DB_OPEN_NO_POSITION');
          }
          if(expectedQty !== null && effectiveDbQty > 0 && expectedQty > 0 && hasMeaningfulQtyMismatch(effectiveDbQty, expectedQty)){
              issues.push('POSITION_BUCKET_QTY_MISMATCH');
          }
          if(effectiveDbQty > 0 && positionSide){
              const missingTimeExit = await loadMissingSignalTimeExitExecutionFromExchange({
                  uid,
                  row,
                  symbol,
                  positionSide,
                  notBeforeTradeTime: row.r_exactTime || row.r_signalTime || null,
              });
              if(missingTimeExit){
                  issues.push('SIGNAL_TIME_EXIT_FILL_MISSED');
              }
          }
          if(snapshotQty > 0 && Math.abs(snapshotQty - runtimeQty) > 1e-9){
              issues.push('SNAPSHOT_RUNTIME_QTY_MISMATCH');
          }
          if(effectiveDbQty > 0 && openExitOrders.length === 0){
              issues.push('OPEN_WITHOUT_EXIT_ORDERS');
          }else if(
              effectiveDbQty > 0
              && expectedBoundTargets.length > 0
              && !hasMatchingBoundOrderCoverage(openExitOrders, expectedBoundTargets, {
                  quantityTolerance: Math.max(Number(orderRules?.stepSize || 0), 1e-9) / 2,
                  priceTolerance: Math.max(Number(orderRules?.tickSize || 0), 1e-9) / 2,
              })
          ){
              issues.push('OPEN_WITH_INVALID_EXIT_ORDERS');
          }

          if(issues.length){
            items.push({
                category: 'signal',
                pid: row.id,
                a_name: row.a_name,
                symbol,
                bunbong: row.bunbong,
                signalType,
                legacyStatus: row.status,
                runtimeState: runtimeState.getRuntimeState(row.status),
                  dbQty: effectiveDbQty,
                  runtimeQty,
                  snapshotQty,
                  exchangeQty: expectedQty === null ? null : expectedQty,
                bucketDbQty: internalBucketQty,
                openExitOrderCount: openExitOrders.length,
                issues,
            });
        }
    }

    return items;
}

const buildGridRuntimeIssues = async (uid) => {
    const [rows] = await db.query(
        `SELECT * FROM live_grid_strategy_list
          WHERE uid = ?
            AND (enabled = 'Y' OR regimeStatus <> 'WAITING_WEBHOOK')
          ORDER BY id ASC`,
        [uid]
    );
    const [snapshotRows] = await db.query(
        `SELECT pid, positionSide, openQty
           FROM live_pid_position_snapshot
          WHERE uid = ?
            AND strategyCategory = 'grid'
            AND status = 'OPEN'`,
        [uid]
    );

    const snapshotQtyByPidLeg = new Map();
    for(const snapshotRow of snapshotRows){
        const key = `${snapshotRow.pid}:${String(snapshotRow.positionSide || '').toUpperCase()}`;
        snapshotQtyByPidLeg.set(key, Number(snapshotRow.openQty || 0));
    }

    const items = [];
    for(const row of rows){
        const symbol = String(row.symbol || '').trim().toUpperCase();
        const openOrders = await listOpenGridOrders(uid, symbol, row.id);
        const exchangeSnapshot = await getExchangePositionSnapshot(uid, symbol);
        const longEntryOrders = openOrders.filter((item) => String(item.clientOrderId || '').startsWith('GENTRY_L_'));
        const shortEntryOrders = openOrders.filter((item) => String(item.clientOrderId || '').startsWith('GENTRY_S_'));
        const longExitOrders = openOrders.filter((item) => /^(GTP_L_|GSTOP_L_)/.test(String(item.clientOrderId || '')));
        const shortExitOrders = openOrders.filter((item) => /^(GTP_S_|GSTOP_S_)/.test(String(item.clientOrderId || '')));
        const issues = [];
        const exchangeReadOk = exchangeSnapshot?.readOk !== false;
        const snapshotLongQty = Number(snapshotQtyByPidLeg.get(`${row.id}:LONG`) || 0);
        const snapshotShortQty = Number(snapshotQtyByPidLeg.get(`${row.id}:SHORT`) || 0);
        const longQty = Math.max(Number(row.longQty || 0), snapshotLongQty);
        const shortQty = Math.max(Number(row.shortQty || 0), snapshotShortQty);
        const exchangeLongQty = Number(
            exchangeSnapshot?.longQty
            || (Number(exchangeSnapshot?.netQty || 0) > 0 ? Number(exchangeSnapshot?.netQty || 0) : 0)
            || exchangeSnapshot?.bothQty
            || 0
        );
        const exchangeShortQty = Number(
            exchangeSnapshot?.shortQty
            || (Number(exchangeSnapshot?.netQty || 0) < 0 ? Math.abs(Number(exchangeSnapshot?.netQty || 0)) : 0)
            || 0
        );

        if(!exchangeReadOk){
            issues.push('BINANCE_POSITION_READ_FAILED');
        }
        if(exchangeReadOk && row.regimeStatus === 'WAITING_WEBHOOK' && (openOrders.length > 0 || exchangeLongQty > 0 || exchangeShortQty > 0)){
            issues.push('WAITING_WITH_EXCHANGE_ACTIVITY');
        }
        if(row.longLegStatus === 'ENTRY_ARMED' && longEntryOrders.length === 0){
            issues.push('LONG_ARMED_WITHOUT_ENTRY_ORDER');
        }
        if(row.shortLegStatus === 'ENTRY_ARMED' && shortEntryOrders.length === 0){
            issues.push('SHORT_ARMED_WITHOUT_ENTRY_ORDER');
        }
        if(exchangeReadOk && row.longLegStatus === 'ENTRY_ARMED' && exchangeLongQty > 0){
            issues.push('LONG_ENTRY_PENDING_WITH_OPEN_POSITION');
        }
        if(exchangeReadOk && row.shortLegStatus === 'ENTRY_ARMED' && exchangeShortQty > 0){
            issues.push('SHORT_ENTRY_PENDING_WITH_OPEN_POSITION');
        }
        if(exchangeReadOk && (row.longLegStatus === 'OPEN' || snapshotLongQty > 0) && exchangeLongQty <= 0){
            issues.push('LONG_OPEN_NO_POSITION');
        }
        if(exchangeReadOk && (row.shortLegStatus === 'OPEN' || snapshotShortQty > 0) && exchangeShortQty <= 0){
            issues.push('SHORT_OPEN_NO_POSITION');
        }
        if(row.longLegStatus === 'OPEN' && longExitOrders.length < 2){
            issues.push('LONG_OPEN_INCOMPLETE_EXIT_ORDERS');
        }
        if(row.shortLegStatus === 'OPEN' && shortExitOrders.length < 2){
            issues.push('SHORT_OPEN_INCOMPLETE_EXIT_ORDERS');
        }
        if(exchangeReadOk && row.regimeStatus === 'ENDED' && (openOrders.length > 0 || exchangeLongQty > 0 || exchangeShortQty > 0)){
            issues.push('ENDED_WITH_EXCHANGE_ACTIVITY');
        }

        if(issues.length){
            items.push({
                category: 'grid',
                pid: row.id,
                a_name: row.a_name,
                symbol,
                bunbong: row.bunbong,
                regimeStatus: row.regimeStatus,
                regimeEndReason: row.regimeEndReason || null,
                longLegStatus: row.longLegStatus,
                shortLegStatus: row.shortLegStatus,
                longQty,
                shortQty,
                snapshotLongQty,
                snapshotShortQty,
                exchangeLongQty,
                exchangeShortQty,
                openOrderCount: openOrders.length,
                issues,
            });
        }
    }

    return items;
}

exports.getBinanceRuntimeHealth = async (uid) => {
    const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [uid]);
    const runtime = getMemberApiRuntime(uid);
    const meta = ensureBinanceRuntimeMeta(uid) || {};
    const excluded = isExcludedRuntimeUid(uid);

    return {
        uid,
        excluded,
        hasCredentials: Boolean(member?.appKey && member?.appSecret),
        appKeyMasked: meta.appKeyMasked || maskApiKey(member?.appKey),
        connected: excluded ? false : Boolean(runtime && meta.connected),
        status: excluded ? 'EXCLUDED' : (meta.status || (runtime ? 'CONNECTED' : 'DISCONNECTED')),
        listenKey: meta.listenKey || runtime?.listenKey || null,
        wsReadyState: runtime?.ws ? runtime.ws.readyState : null,
        disabledUntil: meta.disabledUntil || null,
        retryAt: meta.retryAt || (binanceInitRetryAt[uid] ? new Date(binanceInitRetryAt[uid]).toISOString() : null),
        lastInitAt: meta.lastInitAt || null,
        lastReadyAt: meta.lastReadyAt || null,
        lastMessageAt: meta.lastMessageAt || null,
        lastKeepAliveAt: meta.lastKeepAliveAt || null,
        lastCloseAt: meta.lastCloseAt || null,
        lastErrorAt: meta.lastErrorAt || null,
        lastAlgoUpdateAt: meta.lastAlgoUpdateAt || null,
        lastConditionalRejectAt: meta.lastConditionalRejectAt || null,
        lastAccountRiskAt: meta.lastAccountRiskAt || null,
        lastRiskSnapshotAt: meta.lastRiskSnapshotAt || null,
        lastRiskLevel: meta.lastRiskLevel || null,
        lastHedgeMode: meta.lastHedgeMode,
        lastAccountMarginRatio: meta.lastAccountMarginRatio,
        lastAccountEquity: meta.lastAccountEquity,
        lastAccountMaintMargin: meta.lastAccountMaintMargin,
        lastErrorCode: meta.lastErrorCode || null,
        lastErrorMessage: meta.lastErrorMessage || null,
    };
}

exports.getBinanceAccountRiskCurrent = async (uid, options = {}) => {
    const {
        persist = true,
        maxAgeMs = 0,
        force = false,
    } = options;

    const cache = ensureAccountRiskSnapshotCache(uid);
    const meta = ensureBinanceRuntimeMeta(uid);
    const cachedSnapshot = cache?.latest || null;
    const now = Date.now();
    const lastFetchedAt = cache?.lastFetchedAt ? new Date(cache.lastFetchedAt).getTime() : 0;

    if(!force && cachedSnapshot && maxAgeMs > 0 && lastFetchedAt > 0 && (now - lastFetchedAt) < maxAgeMs){
        return cachedSnapshot;
    }

    const member = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [uid]);
    const hasCredentials = Boolean(member?.appKey && member?.appSecret);
    const excluded = isExcludedRuntimeUid(uid);
    if(excluded){
        markBinanceRuntimeExcluded(uid);
        return {
            uid,
            excluded: true,
            hasCredentials,
            connected: false,
            runtimeStatus: 'EXCLUDED',
            accountMode: null,
            hedgeMode: false,
            positionMode: 'UNKNOWN',
            riskLevel: 'UNKNOWN',
            positionCount: 0,
            totalWalletBalance: 0,
            totalUnrealizedProfit: 0,
            totalMarginBalance: 0,
            totalMaintMargin: 0,
            totalInitialMargin: 0,
            totalPositionInitialMargin: 0,
            totalOpenOrderInitialMargin: 0,
            totalCrossWalletBalance: 0,
            totalCrossUnPnl: 0,
            availableBalance: 0,
            maxWithdrawAmount: 0,
            accountEquity: 0,
            accountMaintMargin: 0,
            accountMarginRatio: 0,
            accountInitialMarginRatio: 0,
            accountOpenOrderMarginRatio: 0,
            accountMarginBuffer: 0,
            capturedAt: new Date().toISOString(),
        };
    }
    if(!hasCredentials){
        return {
            uid,
            hasCredentials: false,
            connected: Boolean(meta?.connected),
            runtimeStatus: meta?.status || 'DISCONNECTED',
            accountMode: null,
            hedgeMode: false,
            positionMode: 'UNKNOWN',
            riskLevel: 'UNKNOWN',
            positionCount: 0,
            totalWalletBalance: 0,
            totalUnrealizedProfit: 0,
            totalMarginBalance: 0,
            totalMaintMargin: 0,
            totalInitialMargin: 0,
            totalPositionInitialMargin: 0,
            totalOpenOrderInitialMargin: 0,
            totalCrossWalletBalance: 0,
            totalCrossUnPnl: 0,
            availableBalance: 0,
            maxWithdrawAmount: 0,
            accountEquity: 0,
            accountMaintMargin: 0,
            accountMarginRatio: 0,
            accountInitialMarginRatio: 0,
            accountOpenOrderMarginRatio: 0,
            accountMarginBuffer: 0,
            capturedAt: new Date().toISOString(),
        };
    }

    let accountInfo = null;
    let hedgeMode = false;
    try{
        accountInfo = await privateFuturesSignedRequest(uid, '/fapi/v3/account', {}, 'GET');
        hedgeMode = await getBinancePositionMode(uid).catch(() => false);
    }catch(primaryError){
        if(String(primaryError?.code || '') === 'BINANCE_PRIVATE_READ_CIRCUIT_OPEN'
            || String(primaryError?.code || '') === 'BINANCE_UID_PRIVATE_READ_BACKOFF'
            || Number(primaryError?.response?.status || 0) === 418
            || Number(primaryError?.response?.status || 0) === 429){
            throw primaryError;
        }
        accountInfo = await privateFuturesSignedRequest(uid, '/fapi/v2/account', {}, 'GET');
        hedgeMode = await getBinancePositionMode(uid).catch(() => false);
    }

    const snapshot = {
        ...buildAccountRiskSnapshot(uid, accountInfo, { hedgeMode }),
        hasCredentials: true,
        connected: Boolean(meta?.connected),
        runtimeStatus: meta?.status || 'DISCONNECTED',
    };

    if(cache){
        cache.latest = snapshot;
        cache.lastFetchedAt = snapshot.capturedAt;
    }

    updateBinanceRuntimeMeta(uid, {
        lastAccountRiskAt: snapshot.capturedAt,
        lastRiskLevel: snapshot.riskLevel,
        lastHedgeMode: snapshot.hedgeMode,
        lastAccountMarginRatio: snapshot.accountMarginRatio,
        lastAccountEquity: snapshot.accountEquity,
        lastAccountMaintMargin: snapshot.accountMaintMargin,
    });

    if(persist){
        const lastPersistedAt = cache?.lastPersistedAt ? new Date(cache.lastPersistedAt).getTime() : 0;
        if(force || !lastPersistedAt || (now - lastPersistedAt) >= 60000){
            await persistAccountRiskSnapshot(snapshot);
            if(cache){
                cache.lastPersistedAt = snapshot.capturedAt;
            }
            updateBinanceRuntimeMeta(uid, {
                lastRiskSnapshotAt: snapshot.capturedAt,
            });
        }
    }

    try{
        await getPolicyEngine().evaluateUserAccountPolicies({
            uid,
            snapshot,
            persist: true,
            executeActions: true,
        });
    }catch(policyError){
        console.log('[POLICY EVAL] account risk evaluation failed');
        console.log(policyError);
    }

    return snapshot;
}

const signalRuntimeRepairAt = new Map();
const gridRuntimeRepairAt = new Map();
const signalTruthSyncAt = new Map();
const gridTruthSyncAt = new Map();

const canRunSignalRuntimeRepair = (uid, minIntervalMs = 15000, force = false) => {
    if(force){
        return true;
    }

    const lastAt = Number(signalRuntimeRepairAt.get(uid) || 0);
    const now = Date.now();
    if(lastAt > 0 && (now - lastAt) < minIntervalMs){
        return false;
    }

    signalRuntimeRepairAt.set(uid, now);
    return true;
}

const canRunGridRuntimeRepair = (uid, minIntervalMs = 15000, force = false) => {
    if(force){
        return true;
    }

    const lastAt = Number(gridRuntimeRepairAt.get(uid) || 0);
    const now = Date.now();
    if(lastAt > 0 && (now - lastAt) < minIntervalMs){
        return false;
    }

    gridRuntimeRepairAt.set(uid, now);
    return true;
}

const canRunSignalTruthSync = (uid, minIntervalMs = 12000, force = false) => {
    if(force){
        return true;
    }

    const lastAt = Number(signalTruthSyncAt.get(uid) || 0);
    const now = Date.now();
    if(lastAt > 0 && (now - lastAt) < minIntervalMs){
        return false;
    }

    signalTruthSyncAt.set(uid, now);
    return true;
}

const canRunGridTruthSync = (uid, minIntervalMs = 12000, force = false) => {
    if(force){
        return true;
    }

    const lastAt = Number(gridTruthSyncAt.get(uid) || 0);
    const now = Date.now();
    if(lastAt > 0 && (now - lastAt) < minIntervalMs){
        return false;
    }

    gridTruthSyncAt.set(uid, now);
    return true;
}

const loadLiveGridRuntimeSnapshot = async (pid) => {
    if(!pid){
        return null;
    }

    const [rows] = await db.query(
        `SELECT *
           FROM live_grid_strategy_list
          WHERE id = ?
          LIMIT 1`,
        [pid]
    );
    return rows?.[0] || null;
}

exports.reconcileLiveSignalRuntimeIssues = async (uid, options = {}) => {
    const {
        minIntervalMs = 15000,
        force = false,
    } = options;

    if(!uid || !canRunSignalRuntimeRepair(uid, minIntervalMs, force)){
        return {
            checkedAt: new Date().toISOString(),
            uid,
            issues: [],
            repaired: [],
            skipped: true,
        };
    }

    const issues = await buildSignalRuntimeIssues(uid);
    const repaired = [];

    for(const issue of issues){
        const issueSet = new Set(issue.issues || []);
        const row = await loadLivePlaySnapshot(issue.pid);
        if(!row){
            continue;
        }
        const resolvedSignalType = getResolvedLiveSignalType(row);

        if(
            issueSet.has('ENTRY_PENDING_BUT_POSITION_OPEN')
            || issueSet.has('READY_WITH_OPEN_POSITION')
            || issueSet.has('ENTRY_FILL_MISSED')
        ){
            const recoveredExecution = await recoverSignalEntryFillFromExchange({
                uid,
                row,
                issue,
            });
            if(recoveredExecution){
                repaired.push({
                    pid: issue.pid,
                    symbol: issue.symbol,
                    action: 'RECOVER_ENTRY_FILL',
                    issues: issue.issues,
                    clientOrderId: recoveredExecution.clientOrderId,
                    orderId: recoveredExecution.orderId,
                });
                continue;
            }
        }

        if(issueSet.has('READY_WITH_OPEN_POSITION') || issueSet.has('MISSING_RUNTIME_SIGNAL_TYPE')){
            if(!row.r_signalType && resolvedSignalType){
                await db.query(
                    `UPDATE live_play_list
                        SET r_signalType = COALESCE(NULLIF(r_signalType, ''), ?)
                      WHERE id = ?`,
                    [resolvedSignalType, row.id]
                );
                row.r_signalType = resolvedSignalType;
            }

            if(issueSet.has('READY_WITH_OPEN_POSITION') && Number(row.r_qty || 0) > 0){
                await strategyControlState.applyPlayControlState({
                    mode: 'LIVE',
                    pid: row.id,
                    enabled: String(row.enabled || 'N').toUpperCase() === 'Y' ? 'Y' : 'N',
                    status: 'EXACT',
                    resetRuntime: false,
                    audit: buildSignalSystemAuditPayload(
                        row,
                        'SYSTEM_RESTORE_EXACT',
                        'coin:reconcile-open-position',
                        {
                            issues: issue.issues,
                            callerHint: 'reconcileLiveSignalRuntimeIssues',
                        }
                    ),
                });
                row.status = 'EXACT';
            }
        }

        if(issueSet.has('SIGNAL_TIME_EXIT_FILL_MISSED')){
            const recoveredExecution = await recoverSignalExitFillFromExchange({
                uid,
                row,
                issue,
            });

            if(recoveredExecution){
                const latestSnapshot = await pidPositionLedger.loadSnapshot({
                    uid,
                    pid: issue.pid,
                    strategyCategory: 'signal',
                    positionSide: getSignalPositionSide(resolvedSignalType),
                });
                if(Number(latestSnapshot?.openQty || 0) <= 0){
                    const siblingOrders = await listOpenBoundExitOrders(uid, row.symbol, row.id);
                    if(siblingOrders.length > 0){
                        await setLivePlayReadyModeIfCurrentWithoutRuntimeReset(
                            row,
                            row.status,
                            'SIGNAL_TIME_EXIT_READY_NO_RUNTIME_RESET'
                        );
                        logOrderRuntimeTrace('SIGNAL_TIME_EXIT_SIBLING_PROTECTION_ACTIVE', {
                            uid,
                            pid: row.id,
                            symbol: row.symbol,
                            positionSide: getSignalPositionSide(resolvedSignalType),
                            remainingQty: 0,
                            siblingCount: siblingOrders.length,
                            siblingClientOrderIds: siblingOrders.map((order) => order.clientOrderId || null).filter(Boolean),
                            reason: 'USER_ACTION_REQUIRED_TIME_EXIT_ORPHAN_PROTECTION',
                        });
                    }else{
                        await setLivePlayReadyModeIfCurrent(row, row.status);
                    }
                    await evaluateLiveStrategyPoliciesAfterClose(uid, issue.pid);
                }

                repaired.push({
                    pid: issue.pid,
                    symbol: issue.symbol,
                    action: 'RECOVER_TIME_EXIT_FILL',
                    issues: issue.issues,
                    clientOrderId: recoveredExecution.clientOrderId,
                    orderId: recoveredExecution.orderId,
                });

                continue;
            }
        }

        if(issueSet.has('DB_OPEN_NO_POSITION')){
            const recoveredExecution = await recoverSignalExitFillFromExchange({
                uid,
                row,
                issue,
            });

            if(recoveredExecution){
                await setLivePlayReadyModeIfCurrent(row, row.status);
                await evaluateLiveStrategyPoliciesAfterClose(uid, issue.pid);

                repaired.push({
                    pid: issue.pid,
                    symbol: issue.symbol,
                    action: 'RECOVER_EXIT_FILL',
                    issues: issue.issues,
                    clientOrderId: recoveredExecution.clientOrderId,
                    orderId: recoveredExecution.orderId,
                });

                continue;
            }

            await cancelBoundExitOrders(uid, issue.symbol, issue.pid);
            const reset = await setLivePlayReadyModeIfCurrent(row, row.status);

            if(reset){
                repaired.push({
                    pid: issue.pid,
                    symbol: issue.symbol,
                    action: 'RESET_READY',
                    issues: issue.issues,
                });

                exports.msgAdd(
                    'signalReconcile',
                    'NO_POSITION_RESET',
                    `pid:${issue.pid}, symbol:${issue.symbol}, status:${row.status}, issues:${issue.issues.join(',')}`,
                    uid,
                    issue.pid,
                    null,
                    issue.symbol,
                    issue.signalType || null
                );
            }
            continue;
        }

        if((issueSet.has('OPEN_WITHOUT_EXIT_ORDERS') || issueSet.has('OPEN_WITH_INVALID_EXIT_ORDERS')) && Number(row.r_qty || 0) > 0){
            const synced = await syncLiveBoundExitOrders({
                uid,
                pid: row.id,
                symbol: row.symbol,
                entryOrderId: row.r_tid || null,
                entryPrice: row.r_exactPrice,
                qty: Number(row.r_qty || 0),
            });

            if(synced){
                repaired.push({
                    pid: issue.pid,
                    symbol: issue.symbol,
                    action: 'RESTORE_EXIT_ORDERS',
                    issues: issue.issues,
                });

                exports.msgAdd(
                    'signalReconcile',
                    'EXIT_ORDERS_RESTORED',
                    `pid:${issue.pid}, symbol:${issue.symbol}, rowQty:${row.r_qty}, issues:${issue.issues.join(',')}`,
                    uid,
                    issue.pid,
                    null,
                    issue.symbol,
                    issue.signalType || null
                );
            }
        }
    }

    return {
        checkedAt: new Date().toISOString(),
        uid,
        issues,
        repaired,
        skipped: false,
    };
}

exports.reconcileLiveGridRuntimeIssues = async (uid, options = {}) => {
    const {
        minIntervalMs = 15000,
        force = false,
    } = options;

    if(!uid || !canRunGridRuntimeRepair(uid, minIntervalMs, force)){
        return {
            checkedAt: new Date().toISOString(),
            uid,
            issues: [],
            repaired: [],
            skipped: true,
        };
    }

    const issues = await buildGridRuntimeIssues(uid);
    const repaired = [];

    for(const issue of issues){
        const row = await loadLiveGridRuntimeSnapshot(issue.pid);
        if(!row){
            continue;
        }

        const repairedIssue = await getGridEngine().reconcileLiveGridRuntimeIssue({
            row,
            issue,
        });
        if(repairedIssue){
            repaired.push(repairedIssue);
        }
    }

    return {
        checkedAt: new Date().toISOString(),
        uid,
        issues,
        repaired,
        skipped: false,
    };
}

exports.truthSyncLiveSignalRuntime = async (uid, options = {}) => {
    const {
        minIntervalMs = 12000,
        force = false,
        limit = 12,
    } = options;

    if(!uid || !canRunSignalTruthSync(uid, minIntervalMs, force)){
        return {
            checkedAt: new Date().toISOString(),
            uid,
            rows: [],
            repaired: [],
            skipped: true,
        };
    }

    const rows = await loadLiveSignalTruthSyncRows(uid, { limit });
    const repaired = [];
    const exchangeSnapshotCache = new Map();

    for(const row of rows){
        logOrderRuntimeTrace('SIGNAL_TRUTH_SYNC_CANDIDATE', {
            uid,
            pid: row.id,
            symbol: row.symbol,
            status: row.status || null,
            enabled: row.enabled || null,
            r_signalTime: row.r_signalTime || null,
            r_exactTime: row.r_exactTime || null,
            r_qty: Number(row.r_qty || 0),
            r_exactPrice: Number(row.r_exactPrice || 0),
        });
        const repairedRow = await truthSyncLiveSignalPlay({
            row,
            exchangeSnapshotCache,
        });
        if(repairedRow){
            repaired.push(repairedRow);
        }
    }

    return {
        checkedAt: new Date().toISOString(),
        uid,
        rows: rows.map((row) => ({
            pid: row.id,
            symbol: row.symbol,
            status: row.status,
        })),
        repaired,
        skipped: false,
    };
}

exports.truthSyncLiveGridRuntime = async (uid, options = {}) => {
    const {
        minIntervalMs = 12000,
        force = false,
        limit = 12,
    } = options;

    if(!uid || !canRunGridTruthSync(uid, minIntervalMs, force)){
        return {
            checkedAt: new Date().toISOString(),
            uid,
            rows: [],
            repaired: [],
            skipped: true,
        };
    }

    const rows = await loadLiveGridTruthSyncRows(uid, { limit });
    const repaired = [];
    const exchangeSnapshotCache = new Map();

    for(const row of rows){
        const repairedRow = await getGridEngine().truthSyncLiveGridRow({
            row,
            exchangeSnapshotCache,
        });
        if(repairedRow){
            repaired.push(repairedRow);
        }
    }

    return {
        checkedAt: new Date().toISOString(),
        uid,
        rows: rows.map((row) => ({
            pid: row.id,
            symbol: row.symbol,
            regimeStatus: row.regimeStatus,
        })),
        repaired,
        skipped: false,
    };
}

exports.getBinanceRuntimeReconciliation = async (uid) => {
    const health = await exports.getBinanceRuntimeHealth(uid);
    const [signalIssues, gridIssues] = await Promise.all([
        buildSignalRuntimeIssues(uid),
        buildGridRuntimeIssues(uid),
    ]);

    return {
        checkedAt: new Date().toISOString(),
        uid,
        health,
        signalIssues,
        gridIssues,
        summary: {
            signalIssueCount: signalIssues.length,
            gridIssueCount: gridIssues.length,
            totalIssueCount: signalIssues.length + gridIssues.length,
        },
    };
}

exports.cancelGridOrders = async ({
    uid,
    symbol,
    pid,
    leg = null,
    includeEntries = true,
    includeExits = true,
} = {}) => {
    if(!uid || !symbol || !pid){
        return 0;
    }

    const openOrders = await listOpenGridOrders(uid, symbol, pid, leg);
    if(openOrders.length === 0){
        return 0;
    }

    let canceledCount = 0;
    const canceledClientOrderIds = [];
    for(const order of openOrders){
        const prefix = String(order.clientOrderId || '').split('_')[0];
        const isEntry = prefix === 'GENTRY';
        const isExit = prefix === 'GTP' || prefix === 'GSTOP';

        if((isEntry && !includeEntries) || (isExit && !includeExits)){
            continue;
        }

      try{
          logOrderRuntimeTrace('RESERVATION_CANCEL_REQUESTED', {
              uid,
              pid,
              symbol,
              leg,
              orderId: order.orderId || null,
              clientOrderId: order.clientOrderId || null,
              prefix,
          });
          if(order.type === 'algo'){
              await privateFuturesAlgoRequest(uid, '/fapi/v1/algoOrder', {
                  symbol,
                  clientAlgoId: order.clientOrderId,
                }, 'DELETE');
            }else{
                await cancelFuturesOrder({
                    uid,
                    pid,
                    strategyCategory: 'grid',
                    action: 'WRITE_CANCEL_ORDER',
                    caller: 'coin.cancelGridOrders',
                    clientOrderId: order.clientOrderId || null,
                    positionSide: leg || null,
                    orderType: prefix,
                }, symbol, order.orderId);
          }
          canceledCount += 1;
          if(order.clientOrderId){
              canceledClientOrderIds.push(order.clientOrderId);
          }
          logOrderRuntimeTrace('RESERVATION_CANCEL_CONFIRMED', {
              uid,
              pid,
              symbol,
              leg,
              orderId: order.orderId || null,
              clientOrderId: order.clientOrderId || null,
              prefix,
          });
      }catch(error){
          const info = extractBinanceError(error);
          logOrderRuntimeTrace('RESERVATION_CANCEL_FAILED', {
              uid,
              pid,
              symbol,
              leg,
              orderId: order.orderId || null,
              clientOrderId: order.clientOrderId || null,
              prefix,
              code: info.code || null,
              reason: info.msg || error?.message || String(error),
          });
          if(info.code === -2011 || info.code === -2013){
              continue;
          }
          exports.msgAdd(
              'cancelGridOrders',
              String(info.code || 'GRID_CANCEL_ERR'),
              toRuntimeMessage(
                  formatBinanceErrorGuideClean(info.msg, info.code, classifyBinanceError(info.code)),
                  `pid:${pid}, orderId:${order.orderId || 'N/A'}, clientOrderId:${order.clientOrderId || 'N/A'}`
              ),
              uid,
              pid,
              order.orderId || null,
              symbol,
              null
          );
      }
  }

    if(canceledClientOrderIds.length > 0){
        await pidPositionLedger.markReservationsCanceled(canceledClientOrderIds);
    }

    return canceledCount;
}

exports.placeGridEntryOrder = async ({
    uid,
    pid,
    symbol,
    leg,
    triggerPrice,
    qty,
    marginType = null,
    leverage = null,
}) => {
    if(!pid || !symbol || !leg){
        return null;
    }

    if(!(await ensureBinanceApiClient(uid))){
        return null;
    }

    const orderRules = await loadSymbolOrderRules(uid, symbol);
    if(!orderRules){
        return null;
    }

    const normalizedPrice = roundToStep(triggerPrice, orderRules.tickSize || 0.01, 'nearest');
    const normalizedQty = roundToStep(qty, orderRules.stepSize || 0.001, 'down');
    if(!(normalizedPrice > 0) || !(normalizedQty >= Number(orderRules.minQty || 0))){
        return null;
    }

    try{
        await ensureMarginAndLeverage(uid, symbol, marginType, leverage);

        const orderSide = leg === 'LONG' ? 'BUY' : 'SELL';
        const clientOrderId = buildGridClientOrderId('GENTRY', leg, uid, pid);
        const order = await submitFuturesOrder(
            {
                uid,
                pid,
                strategyCategory: 'grid',
                action: 'WRITE_CREATE_ORDER',
                caller: 'coin.placeGridEntryOrder',
            },
            'LIMIT',
            orderSide,
            symbol,
            normalizedQty,
            normalizedPrice,
            {
                timeInForce: 'GTC',
                positionSide: leg,
                newClientOrderId: clientOrderId,
            }
        );

        return {
            orderId: order?.orderId || null,
            clientOrderId,
            qty: normalizedQty,
            price: normalizedPrice,
        };
    }catch(error){
        const info = extractBinanceError(error);
        const action = classifyBinanceError(info.code);
        exports.msgAdd(
            'placeGridEntryOrder',
            String(info.code || 'GRID_ENTRY_ERROR'),
            toRuntimeMessage(
                formatBinanceErrorGuideClean(info.msg || error?.message || 'grid entry order failed', info.code, action),
                `pid:${pid}, symbol:${symbol}, leg:${leg}, qty:${normalizedQty}, triggerPrice:${normalizedPrice}, marginType:${marginType || '-'}, leverage:${leverage || '-'}`
            ),
            uid,
            pid,
            null,
            symbol,
            leg
        );
        return null;
    }
}

const placeGridConditionalExitOrder = async ({
    uid,
    pid,
    symbol,
    leg,
    qty,
    triggerPrice,
    boundType,
}) => {
    if(!pid || !symbol || !leg){
        return null;
    }

    if(!(await ensureBinanceApiClient(uid))){
        return null;
    }

    const orderRules = await loadSymbolOrderRules(uid, symbol);
    if(!orderRules){
        return null;
    }

    const normalizedPrice = roundToStep(triggerPrice, orderRules.tickSize || 0.01, 'nearest');
    const normalizedQty = roundToStep(qty, orderRules.stepSize || 0.001, 'down');
    if(!(normalizedPrice > 0) || !(normalizedQty >= Number(orderRules.minQty || 0))){
        return null;
    }

    const prefix = boundType === 'GTP' ? 'GTP' : 'GSTOP';
    const type = boundType === 'GTP' ? 'TAKE_PROFIT' : 'STOP';
    const side = leg === 'LONG' ? 'SELL' : 'BUY';
    const clientOrderId = buildGridClientOrderId(prefix, leg, uid, pid);

    try{
        const algoOrder = await privateFuturesAlgoRequest(uid, '/fapi/v1/algoOrder', {
            algoType: 'CONDITIONAL',
            symbol,
            side,
            positionSide: leg,
            type,
            triggerPrice: normalizedPrice,
            price: normalizedPrice,
            quantity: normalizedQty,
            timeInForce: 'GTC',
            workingType: 'MARK_PRICE',
            clientAlgoId: clientOrderId,
        }, 'POST');

        return {
            orderId: algoOrder?.strategyId || algoOrder?.algoId || null,
            clientOrderId,
            qty: normalizedQty,
            price: normalizedPrice,
        };
    }catch(error){
        const info = extractBinanceError(error);
        const action = classifyBinanceError(info.code);
        exports.msgAdd(
            'placeGridExitOrder',
            String(info.code || 'GRID_EXIT_ERROR'),
            toRuntimeMessage(
                formatBinanceErrorGuideClean(info.msg || error?.message || 'grid exit order failed', info.code, action),
                `pid:${pid}, symbol:${symbol}, leg:${leg}, boundType:${boundType}, qty:${normalizedQty}, triggerPrice:${normalizedPrice}`
            ),
            uid,
            pid,
            null,
            symbol,
            leg
        );
        return null;
    }
}

exports.placeGridTakeProfitOrder = async (params = {}) =>
    placeGridConditionalExitOrder({ ...params, boundType: 'GTP' });

exports.placeGridStopOrder = async (params = {}) =>
    placeGridConditionalExitOrder({ ...params, boundType: 'GSTOP' });

const placeBoundExitOrder = async ({
    uid,
    pid,
    symbol,
    side,
    qty,
    entryOrderId,
    boundType,
    triggerPrice,
    tickSize,
}) => {
    if(!symbol || !side || !entryOrderId || !BOUND_EXIT_TYPES.has(boundType)){
        return null;
    }

    if(!(await ensureBinanceApiClient(uid))){
        return null;
    }

    const normalizedTriggerPrice = roundToStep(triggerPrice, tickSize || 0.01, 'nearest');
    if(!Number.isFinite(normalizedTriggerPrice) || normalizedTriggerPrice <= 0){
        return null;
    }

    const normalizedQty = Number(qty || 0);
    if(boundType === 'SPLITTP' && (!Number.isFinite(normalizedQty) || normalizedQty <= 0)){
        return null;
    }

    const orderSide = side === 'BUY' ? 'SELL' : 'BUY';
    const clientOrderId = getCloseClientOrderId(boundType, uid, pid, entryOrderId);
    const orderType = (boundType === 'PROFIT' || boundType === 'SPLITTP') ? 'TAKE_PROFIT' : 'STOP';
    const timeInForce = 'GTC';

    try{
        if(DEBUG_RUNTIME_TRACE){
            console.log(
                `[BOUND_PLACE] pid:${pid}, uid:${uid}, symbol:${symbol}, boundType:${boundType}, entryOrderId:${entryOrderId}, signalSide:${side}, orderSide:${orderSide}, triggerPrice:${normalizedTriggerPrice}, orderType:${orderType}`
            );
        }
        const orderParams = {
            algoType: 'CONDITIONAL',
            symbol,
            side: orderSide,
            positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
            type: orderType,
            triggerPrice: normalizedTriggerPrice,
            price: normalizedTriggerPrice,
            timeInForce,
            workingType: 'MARK_PRICE',
            clientAlgoId: clientOrderId,
        };
        if(boundType === 'SPLITTP'){
            orderParams.quantity = normalizedQty;
        }else{
            orderParams.quantity = normalizedQty;
        }

        const algoOrder = await privateFuturesAlgoRequest(uid, '/fapi/v1/algoOrder', orderParams, 'POST');

        return {
            orderId: algoOrder?.strategyId || algoOrder?.algoId || null,
            clientOrderId,
            __isAlgo: true,
            raw: algoOrder,
        };
    }catch(error){
        throw error;
    }
}

const syncLiveBoundExitOrders = async ({ uid, pid, symbol, entryOrderId = null, entryPrice = 0, qty = 0 }) => {
    if(!uid || !pid || !symbol){
        return false;
    }

    const lockKey = `${uid}:${pid}:bound`;
    return await withLiveBoundSyncLock(lockKey, async () => {
    try{
        const play = await loadLivePlaySnapshot(pid);
        if(!play){
            exports.msgAdd('syncLiveBoundExitOrd', 'BOUND_SKIPPED', `reason:no-play, pid:${pid}, symbol:${symbol}`, uid, pid, entryOrderId, symbol, null);
            return false;
        }
        const resolvedSignalType = getResolvedLiveSignalType(play);
        if(!play.r_signalType && resolvedSignalType){
            await db.query(
                `UPDATE live_play_list
                    SET r_signalType = COALESCE(NULLIF(r_signalType, ''), ?)
                  WHERE id = ?`,
                [resolvedSignalType, pid]
            );
            play.r_signalType = resolvedSignalType;
        }

        const orderRules = await loadSymbolOrderRules(uid, symbol);
        if(!orderRules){
            exports.msgAdd('syncLiveBoundExitOrd', 'BOUND_SKIPPED', `reason:no-order-rules, pid:${pid}, symbol:${symbol}`, uid, pid, entryOrderId, symbol, resolvedSignalType || null);
            return false;
        }

        const positionSide = getSignalPositionSide(resolvedSignalType);
        const ledgerTotals = positionSide
            ? await pidPositionLedger.getCycleTotals({
                uid,
                pid,
                strategyCategory: 'signal',
                positionSide,
            })
            : null;

        const ledgerOpenQty = Number(ledgerTotals?.openQty || 0);
        const ledgerAvgEntryPrice = Number(ledgerTotals?.avgEntryPrice || 0);
        const fallbackQty = Number(qty || play.r_qty || 0);
        const fallbackEntryPrice = Number(entryPrice || play.r_exactPrice || 0);
        const qtyBasis = ledgerOpenQty > 0 ? 'ledger' : (fallbackQty > 0 ? (qty ? 'runtime' : 'play') : 'missing');
        const entryPriceBasis = ledgerAvgEntryPrice > 0 ? 'ledger' : (fallbackEntryPrice > 0 ? (entryPrice ? 'runtime' : 'play') : 'missing');
        const resolvedQty = roundToStep(ledgerOpenQty > 0 ? ledgerOpenQty : fallbackQty, orderRules.stepSize || 0.001, 'down');
        if(!resolvedQty || resolvedQty < Number(orderRules.minQty || 0)){
            exports.msgAdd('syncLiveBoundExitOrd', 'BOUND_SKIPPED', `reason:qty-too-small, pid:${pid}, symbol:${symbol}, qty:${ledgerOpenQty > 0 ? ledgerOpenQty : fallbackQty}, resolvedQty:${resolvedQty}, minQty:${orderRules.minQty}, qtyBasis:${qtyBasis}`, uid, pid, entryOrderId, symbol, resolvedSignalType || null);
            return false;
        }

        const exactPrice = Number(ledgerAvgEntryPrice > 0 ? ledgerAvgEntryPrice : fallbackEntryPrice);
        if(!exactPrice){
            exports.msgAdd('syncLiveBoundExitOrd', 'BOUND_SKIPPED', `reason:no-entry-price, pid:${pid}, symbol:${symbol}, priceBasis:${entryPriceBasis}`, uid, pid, entryOrderId, symbol, resolvedSignalType || null);
            return false;
        }

        if(play.status === 'READY' && positionSide && resolvedQty > 0){
            await strategyControlState.applyPlayControlState({
                mode: 'LIVE',
                pid: play.id,
                enabled: String(play.enabled || 'N').toUpperCase() === 'Y' ? 'Y' : 'N',
                status: 'EXACT',
                resetRuntime: false,
                audit: buildSignalSystemAuditPayload(
                    play,
                    'SYSTEM_RESTORE_EXACT',
                    'coin:sync-bound-open-position',
                    {
                        callerHint: getRuntimeCallerHint(),
                        qtyBasis,
                        priceBasis: entryPriceBasis,
                    }
                ),
            });
            play.status = 'EXACT';
        }

        if(positionSide && ledgerTotals?.snapshot){
            play.r_qty = resolvedQty;
            play.r_exactPrice = exactPrice;
            await pidPositionLedger.syncSignalPlaySnapshot(pid, positionSide);
        }

        let profitPrice = resolveBoundProfitPrice(play, exactPrice, orderRules.tickSize);
        let stopPrice = resolveBoundStopPrice(play, exactPrice, orderRules.tickSize);
        let splitContext = null;
        let splitStageQty = resolvedQty;
        let nextBoundType = 'PROFIT';

        if(splitTakeProfit.isSplitTakeProfitEnabled(play)){
            splitContext = resolveLiveSplitStageContext(play, exactPrice, orderRules);
            stopPrice = Number(splitContext?.stopPrice || 0);
            profitPrice = Number(splitContext?.profitPrice || 0);
            splitStageQty = Number(splitContext?.stageQty || 0);
            nextBoundType = 'SPLITTP';

            if(Number(play.r_splitEntryQty || 0) <= 0){
                await persistLiveSplitRuntime(pid, {
                    r_splitEntryQty: resolvedQty,
                    r_splitStageIndex: Number(splitContext?.stageIndex || 0),
                    r_splitRealizedQty: Number(play.r_splitRealizedQty || 0),
                    r_splitRealizedPnl: Number(play.r_splitRealizedPnl || 0),
                    r_splitRealizedCharge: Number(play.r_splitRealizedCharge || 0),
                });
                play.r_splitEntryQty = resolvedQty;
            }

            if(splitContext?.stage && splitStageQty <= 0){
                exports.msgAdd(
                    'syncLiveBoundExitOrd',
                    'SPLITTP_STAGE_SKIPPED',
                    `pid:${pid}, symbol:${symbol}, stageIndex:${splitContext.stageIndex}, entryQty:${splitContext.entryQty}, remainingQty:${splitContext.remainingQty}, minQty:${orderRules.minQty}`,
                    uid,
                    pid,
                    entryOrderId,
                    symbol,
                    resolvedSignalType || null
                );
                profitPrice = 0;
            }
        }

        const expectedBoundCount = (profitPrice > 0 ? 1 : 0) + (stopPrice > 0 ? 1 : 0);
        if(expectedBoundCount === 0){
            await persistLiveBoundPrices(pid, 0, 0);
            exports.msgAdd('syncLiveBoundExitOrd', 'BOUND_SKIPPED', `reason:no-bound-target, pid:${pid}, symbol:${symbol}, profitPrice:${profitPrice}, stopPrice:${stopPrice}, qtyBasis:${qtyBasis}, priceBasis:${entryPriceBasis}`, uid, pid, entryOrderId, symbol, resolvedSignalType || null);
            return true;
        }
        pruneRecentBoundRegistrationTargets();
        pruneCompletedBoundRegistrationEntries();
        const registrationKey = [
            pid,
            Number(profitPrice || 0).toFixed(8),
            Number(stopPrice || 0).toFixed(8),
            nextBoundType,
            Number(splitContext?.stageIndex || 0),
            Number(splitStageQty || 0).toFixed(8),
        ].join(':');
        const completedEntryKey = `${registrationKey}:${entryOrderId || play.r_tid || 'bound'}`;
        if(recentBoundRegistrationTargets.has(registrationKey)){
            exports.msgAdd(
                'syncLiveBoundExitOrd',
                'BOUND_RECENT_OK',
                `pid:${pid}, symbol:${symbol}, profitPrice:${profitPrice}, stopPrice:${stopPrice}`,
                uid,
                pid,
                entryOrderId,
                symbol,
                resolvedSignalType || null
            );
            return true;
        }
        if(completedBoundRegistrationEntries.has(completedEntryKey)){
            exports.msgAdd(
                'syncLiveBoundExitOrd',
                'BOUND_ENTRY_OK',
                `pid:${pid}, symbol:${symbol}, profitPrice:${profitPrice}, stopPrice:${stopPrice}, entryTid:${entryOrderId || play.r_tid || 'bound'}`,
                uid,
                pid,
                entryOrderId,
                symbol,
                resolvedSignalType || null
            );
            return true;
        }
        const entryTid = entryOrderId || play.r_tid;
        const expectedBoundTargets = buildExpectedSignalBoundTargets({
            play: {
                ...play,
                r_signalType: resolvedSignalType,
            },
            exactPrice,
            resolvedQty,
            orderRules,
        });
        const quantityTolerance = Math.max(Number(orderRules.stepSize || 0), 1e-9) / 2;
        const priceTolerance = Math.max(Number(orderRules.tickSize || 0), 1e-9) / 2;
        const hasRecentLocalBoundCoverage = await hasRecentLocalBoundReservationCoverage({
            uid,
            pid,
            symbol,
            positionSide,
            entryOrderId: entryTid,
            expectedTargets: expectedBoundTargets,
            quantityTolerance,
        });
        if(hasRecentLocalBoundCoverage){
            exports.msgAdd(
                'syncLiveBoundExitOrd',
                'BOUND_LOCAL_IDEMPOTENT_OK',
                `pid:${pid}, symbol:${symbol}, entryTid:${entryTid}, boundTargets:${expectedBoundTargets.length}`,
                uid,
                pid,
                entryTid,
                symbol,
                resolvedSignalType || null
            );
            return true;
        }

        const existingBoundOrders = await listOpenBoundExitOrders(uid, symbol, pid);
        const hasMatchingExistingBounds = hasMatchingBoundOrderCoverage(existingBoundOrders, expectedBoundTargets, {
            quantityTolerance,
            priceTolerance,
        });

        if(
            expectedBoundCount > 0
            && hasMatchingExistingBounds
            && Number(play.r_profitPrice || 0) === Number(profitPrice || 0)
            && Number(play.r_stopPrice || 0) === Number(stopPrice || 0)
        ){
            return true;
        }

        let createdReservations = [];
        let lastBindError = null;
        for(let attempt = 1; attempt <= 5; attempt += 1){
            try{
                const positionReady = await waitForExchangeOpenPosition(uid, symbol, resolvedSignalType, 8, 250);
                if(!positionReady){
                    exports.msgAdd(
                        'syncLiveBoundExitOrd',
                        'BOUND_WAIT_POSITION',
                        `pid:${pid}, symbol:${symbol}, signalType:${resolvedSignalType}, attempt:${attempt}`,
                        uid,
                        pid,
                        entryTid,
                        symbol,
                        resolvedSignalType || null
                    );
                    if(attempt < 5){
                        await sleep(250 * attempt);
                        continue;
                    }
                    return false;
                }

                await cancelBoundExitOrders(uid, symbol, pid);
                createdReservations = [];

                if(profitPrice > 0){
                    const profitOrder = await placeBoundExitOrder({
                        uid,
                        pid,
                        symbol,
                        side: resolvedSignalType,
                        qty: nextBoundType === 'SPLITTP' ? splitStageQty : resolvedQty,
                        entryOrderId: entryTid,
                        boundType: nextBoundType,
                        triggerPrice: profitPrice,
                        tickSize: orderRules.tickSize,
                    });
                    if(profitOrder?.clientOrderId){
                        createdReservations.push({
                            clientOrderId: profitOrder.clientOrderId,
                            sourceOrderId: profitOrder.orderId,
                            reservationKind: nextBoundType === 'SPLITTP' ? 'BOUND_SPLIT_TP' : 'BOUND_PROFIT',
                            reservedQty: nextBoundType === 'SPLITTP' ? splitStageQty : resolvedQty,
                            note: `pid:${pid}, symbol:${symbol}, boundType:${nextBoundType}`,
                        });
                    }
                }

                if(stopPrice > 0){
                    const stopOrder = await placeBoundExitOrder({
                        uid,
                        pid,
                        symbol,
                        side: resolvedSignalType,
                        qty: resolvedQty,
                        entryOrderId: entryTid,
                        boundType: 'STOP',
                        triggerPrice: stopPrice,
                        tickSize: orderRules.tickSize,
                    });
                    if(stopOrder?.clientOrderId){
                        createdReservations.push({
                            clientOrderId: stopOrder.clientOrderId,
                            sourceOrderId: stopOrder.orderId,
                            reservationKind: 'BOUND_STOP',
                            reservedQty: resolvedQty,
                            note: `pid:${pid}, symbol:${symbol}, boundType:STOP`,
                        });
                    }
                }

                lastBindError = null;
                break;
            }catch(bindError){
                const bindInfo = extractBinanceError(bindError);
                lastBindError = bindError;

                if(bindInfo.code === -4509 && attempt < 5){
                    await sleep(250 * attempt);
                    continue;
                }

                if(bindInfo.code === -4116){
                    exports.msgAdd(
                        'syncLiveBoundExitOrd',
                        'BOUND_DUPLICATE_OK',
                        `pid:${pid}, symbol:${symbol}, profitPrice:${profitPrice}, stopPrice:${stopPrice}`,
                        uid,
                        pid,
                        entryTid,
                        symbol,
                        resolvedSignalType || null
                    );
                    lastBindError = null;
                    break;
                }

                throw bindError;
            }
        }

        if(lastBindError){
            throw lastBindError;
        }

        if(positionSide){
            await pidPositionLedger.replaceExitReservations({
                uid,
                pid,
                strategyCategory: 'signal',
                symbol,
                positionSide,
                reservations: createdReservations,
            });
        }

        await persistLiveSplitRuntime(pid, {
            r_qty: resolvedQty,
            r_profitPrice: Number(profitPrice || 0),
            r_stopPrice: Number(stopPrice || 0),
            r_splitEntryQty: Number(play.r_splitEntryQty || resolvedQty),
            r_splitStageIndex: Number(splitContext?.stageIndex || play.r_splitStageIndex || 0),
        });
        recentBoundRegistrationTargets.set(registrationKey, Date.now() + 5000);
        completedBoundRegistrationEntries.set(completedEntryKey, Date.now() + 120000);
        exports.msgAdd(
            'syncLiveBoundExitOrd',
            'BOUND_REGISTERED',
            `pid:${pid}, symbol:${symbol}, profitPrice:${profitPrice}, stopPrice:${stopPrice}, boundType:${nextBoundType}, stageIndex:${Number(splitContext?.stageIndex || 0)}, stageQty:${Number(splitStageQty || 0).toFixed(8)}, qtyBasis:${qtyBasis}, priceBasis:${entryPriceBasis}, ledgerQty:${Number(ledgerOpenQty || 0).toFixed(8)}, ledgerEntry:${Number(ledgerAvgEntryPrice || 0).toFixed(8)}`,
            uid,
            pid,
            entryTid,
            symbol,
            resolvedSignalType || null
        );
        return true;
    }catch(error){
        const info = extractBinanceError(error);
        const action = classifyBinanceError(info.code);
        if(DEBUG_RUNTIME_TRACE){
            console.log(
                `[BOUND_PLACE_ERROR] pid:${pid}, uid:${uid}, symbol:${symbol}, boundType:${boundType}, code:${info.code}, msg:${info.msg}`
            );
        }
        exports.msgAdd(
            'syncLiveBoundExitOrd',
            String(info.code),
            toRuntimeMessage(
                formatBinanceErrorGuideClean(info.msg, info.code, action),
                `pid:${pid}, symbol:${symbol}`
            ),
            uid,
            pid,
            entryOrderId,
            symbol,
            null
        );
        return false;
    }
    });
}

const findExchangeOrder = async (uid, symbol, { orderId = null, clientOrderId = null } = {}) => {
    if(!(await ensureBinanceApiClient(uid))){
        return null;
    }

    const params = {};

    if(orderId){
        params.orderId = orderId;
    }else if(clientOrderId){
        params.origClientOrderId = clientOrderId;
    }

    if(!params.orderId && !params.origClientOrderId){
        return null;
    }

    try{
        return await binance[uid].futuresOrderStatus(symbol, params);
    }catch(error){
        const info = extractBinanceError(error);
        if(info.code === -2013 || info.code === -2011){
            return null;
        }

        throw error;
    }
}

const syncEnterOrderFromQuery = async (uid, pid, minQty, queriedOrder) => {
    if(!queriedOrder || !pid){
        return false;
    }

    if(queriedOrder.orderId){
        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_SET(?,?,?)`, [
            pid,
            queriedOrder.orderId,
            minQty,
        ]);
    }

    const status = String(queriedOrder.status || '').trim().toUpperCase();
    const executedQty = getRecoveredFallbackFillQty(queriedOrder);
    if(isRecoverableFillOrderStatus(status) && executedQty > 0){
        const play = await loadLivePlaySnapshot(pid);
        let resolvedOpenQty = 0;
        let resolvedAvgEntryPrice = 0;
        await touchSignalPositionOwnership({
            uid,
            pid,
            symbol: queriedOrder.symbol,
            signalSide: play?.r_signalType || play?.signalType || null,
            ownerState: 'OPEN',
            sourceClientOrderId: queriedOrder.clientOrderId || queriedOrder.origClientOrderId || null,
            sourceOrderId: queriedOrder.orderId || null,
            note: `sync-enter-query:${status}`,
        });
        const positionSide = getSignalPositionSide(play?.r_signalType || play?.signalType || null);
        if(positionSide){
            const ledgerEntry = await pidPositionLedger.applyEntryFill({
                uid,
                pid,
                strategyCategory: 'signal',
                symbol: queriedOrder.symbol,
                positionSide,
                sourceClientOrderId: queriedOrder.clientOrderId || queriedOrder.origClientOrderId || null,
                sourceOrderId: queriedOrder.orderId || null,
                fillQty: executedQty,
                fillPrice: queriedOrder.avgPrice || queriedOrder.price || 0,
                fee: 0,
                tradeTime: queriedOrder.updateTime || queriedOrder.time || null,
                eventType: `ENTRY_SYNC_QUERY_${status}`,
                note: `sync-enter-query:${status}`,
            });
            await pidPositionLedger.syncSignalPlaySnapshot(pid, positionSide);
            const snapshot = ledgerEntry?.snapshot || await pidPositionLedger.loadSnapshot({
                uid,
                pid,
                strategyCategory: 'signal',
                positionSide,
            });
            resolvedOpenQty = Number(snapshot?.openQty || executedQty || 0);
            resolvedAvgEntryPrice = Number(snapshot?.avgEntryPrice || queriedOrder.avgPrice || queriedOrder.price || 0);
            await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_EXACT_UPDATE(?,?,?,?,?,?)`, [
                pid,
                uid,
                resolvedAvgEntryPrice,
                resolvedOpenQty,
                resolvedAvgEntryPrice * resolvedOpenQty,
                0,
            ]);
        }

        if(positionSide && resolvedOpenQty > 0){
            await syncLiveBoundExitOrders({
                uid,
                pid,
                symbol: queriedOrder.symbol,
                entryOrderId: queriedOrder.orderId,
                entryPrice: resolvedAvgEntryPrice,
                qty: resolvedOpenQty,
            });
            logOrderRuntimeTrace('PROTECTION_SYNC_FOR_PARTIAL_EXPOSURE', {
                uid,
                pid,
                symbol: queriedOrder.symbol,
                status,
                executedQty,
                protectedQty: resolvedOpenQty,
                source: 'syncEnterOrderFromQuery',
            });
        }
    }else if(isTerminalOrderStatus(status)){
        logOrderRuntimeTrace(getTerminalOrderAuditLabel(status, false), {
            uid,
            pid,
            symbol: queriedOrder.symbol || null,
            orderId: queriedOrder.orderId || null,
            clientOrderId: queriedOrder.clientOrderId || queriedOrder.origClientOrderId || null,
            status,
            executedQty: Number(queriedOrder.executedQty || 0),
            source: 'syncEnterOrderFromQuery',
        });
    }

    return true;
}

const describeOrderForLog = (order) => {
    if(!order){
        return 'query:no-order';
    }

    return `queryStatus:${order.status}, orderId:${order.orderId}, executedQty:${order.executedQty}, avgPrice:${order.avgPrice}`;
}

const isRecoverableExchangeOrder = (order) => {
    return Boolean(order && (
        String(order.status || '').toUpperCase() === 'NEW'
        || isRecoverableFillOrderStatus(order.status)
    ));
}

const recoverOrderAfterRetryError = async ({ uid, symbol, orderId = null, clientOrderId = null }) => {
    await sleep(RETRY_DELAY_MS);
    return await findExchangeOrder(uid, symbol, {
        orderId,
        clientOrderId,
    });
}

const isBinanceClientRetryBlocked = (uid) => {
    return Boolean(binanceInitRetryAt[uid] && binanceInitRetryAt[uid] > Date.now());
}

const disableBinanceClient = (uid, cooldownMs = 30000, status = 'DISABLED') => {
    binance[uid] = null;
    binanceInitRetryAt[uid] = Date.now() + cooldownMs;
    updateBinanceRuntimeMeta(uid, {
        connected: false,
        status,
        retryAt: new Date(binanceInitRetryAt[uid]).toISOString(),
        disabledUntil: new Date(binanceInitRetryAt[uid]).toISOString(),
    });
}

const cleanupBinanceClientRuntime = async (uid) => {
    const runtime = binanceClientRuntime[uid];

    if(!runtime){
        return;
    }

    try{
        if(runtime.keepAliveTimer){
            clearInterval(runtime.keepAliveTimer);
        }
    }catch(e){}

    try{
        if(runtime.ws){
            runtime.ws.removeAllListeners();
            runtime.ws.close();
        }
    }catch(e){}

    try{
        if(binance[uid] && runtime.listenKey){
            await binance[uid].futuresCloseDataStream({listenKey: runtime.listenKey}).catch(() => {});
        }
    }catch(e){}

    delete binanceClientRuntime[uid];
    updateBinanceRuntimeMeta(uid, {
        connected: false,
        status: 'DISCONNECTED',
        listenKey: null,
        lastCloseAt: new Date().toISOString(),
    });
}

const handleBinanceClientError = (scope, uid, error, extra = null) => {
    const runtimeError = logBinanceRuntimeError(scope, uid, error, extra);
    updateBinanceRuntimeMeta(uid, {
        connected: false,
        status: 'ERROR',
        lastErrorAt: new Date().toISOString(),
        lastErrorCode: runtimeError.code,
        lastErrorMessage: runtimeError.runtimeMessage,
    });

    if(runtimeError.code === -2014 || runtimeError.code === -2015){
        cleanupBinanceClientRuntime(uid).catch(() => {});
        disableBinanceClient(uid, INVALID_CREDENTIAL_RETRY_MS, 'INVALID_CREDENTIALS');
    }

    return {
        code: runtimeError.code,
        msg: runtimeError.msg,
        action: runtimeError.action,
    };
}

const initAPI = async (uid, APP_KEY, APP_SECRET, options = {}) => {
    const enableUserStream = options.enableUserStream !== false;
    // console.log(`START initAPI ID:${uid} !!`);
    if(isExcludedRuntimeUid(uid)){
        markBinanceRuntimeExcluded(uid);
        delete binance[uid];
        delete binanceInitRetryAt[uid];
        await cleanupBinanceClientRuntime(uid).catch(() => {});
        return false;
    }
    if(initializingBinanceClients.has(uid)){
        return false;
    }

    if(isBinanceClientRetryBlocked(uid)){
        return false;
    }

    initializingBinanceClients.add(uid);
    try{
        updateBinanceRuntimeMeta(uid, {
            connected: false,
            status: enableUserStream ? 'CONNECTING' : REST_ONLY_RUNTIME_STATUS,
            lastInitAt: new Date().toISOString(),
            retryAt: null,
            disabledUntil: null,
            listenKey: null,
            appKeyMasked: maskApiKey(APP_KEY),
            lastErrorCode: null,
            lastErrorMessage: null,
        });
        if(enableUserStream){
            await cleanupBinanceClientRuntime(uid);
        }
        binance[uid] = createBinanceApiClient(APP_KEY, APP_SECRET);

        if(!enableUserStream){
            binanceClientRuntime[uid] = {
                appKey: APP_KEY,
                appSecret: APP_SECRET,
                listenKey: null,
                ws: null,
                keepAliveTimer: null,
                userStreamEnabled: false,
            };
            updateBinanceRuntimeMeta(uid, {
                connected: false,
                status: REST_ONLY_RUNTIME_STATUS,
                lastReadyAt: new Date().toISOString(),
                listenKey: null,
                retryAt: null,
                disabledUntil: null,
                appKeyMasked: maskApiKey(APP_KEY),
            });
            delete binanceInitRetryAt[uid];
            return true;
        }

        let { listenKey } = await binance[uid].futuresGetDataStream();
        logOrderRuntimeTrace('USER_STREAM_LISTEN_KEY', {
            uid,
            listenKey,
            appKeyMasked: maskApiKey(APP_KEY),
        });
        
        const ws = new WebSocket(`wss://fstream.binance.com/ws/${listenKey}`);
        ws.on('open', () => {
            logOrderRuntimeTrace('USER_STREAM_CONNECT', {
                uid,
                listenKey,
            });
        });
        ws.on('error', (error) => {
            logOrderRuntimeTrace('USER_STREAM_ERROR', {
                uid,
                listenKey,
                message: error?.message || String(error),
                stack: error?.stack || null,
            });
            logBinanceRuntimeError('userStream', uid, error);
            updateBinanceRuntimeMeta(uid, {
                connected: false,
                status: 'ERROR',
                lastErrorAt: new Date().toISOString(),
            });
            cleanupBinanceClientRuntime(uid).catch(() => {});
            disableBinanceClient(uid, 30000);
        });
        ws.on('close', () => {
            logOrderRuntimeTrace('USER_STREAM_CLOSE', {
                uid,
                listenKey,
            });
            console.log(`userStream CLOSE uid:${uid}`);
            exports.msgAdd('userStream', 'CLOSE', '?ъ슜???곗씠???ㅽ듃由??곌껐??醫낅즺?섏뿀?듬땲??', uid, null, null, null, null);
            updateBinanceRuntimeMeta(uid, {
                connected: false,
                status: 'DISCONNECTED',
                lastCloseAt: new Date().toISOString(),
            });
            cleanupBinanceClientRuntime(uid).catch(() => {});
            disableBinanceClient(uid, 30000);
        });
        ws.on('message', (msg) => {
            updateBinanceRuntimeMeta(uid, {
                connected: true,
                status: 'CONNECTED',
                lastMessageAt: new Date().toISOString(),
            });
            const data = JSON.parse(msg);
            if (data.e === 'ORDER_TRADE_UPDATE') {
                logOrderRuntimeTrace('USER_STREAM_INGRESS', {
                    uid,
                    eventType: data.e,
                    symbol: data?.o?.s || null,
                    side: data?.o?.S || null,
                    positionSide: data?.o?.ps || null,
                    orderId: data?.o?.i || null,
                    clientOrderId: data?.o?.c || null,
                    eventTime: data?.E || data?.T || null,
                    tradeTime: data?.o?.T || null,
                });
                if(shouldSkipDuplicateOrderRuntimeEvent(uid, data)){
                    return;
                }
                logOrderTradeRuntimeEvent(uid, data);
                handleOrderRuntimeUpdate(uid, data);
                reOrderGet(uid, data);
                return;
            }

            if(data.e === 'ALGO_UPDATE'){
                const detail = getAlgoEventDetail(data);
                const context = buildAlgoRuntimeEventContext(detail, uid);
                logOrderRuntimeTrace('USER_STREAM_INGRESS', {
                    uid,
                    eventType: data.e,
                    symbol: getFirstDefinedValue(detail.symbol, detail.s),
                    side: getFirstDefinedValue(detail.side, detail.S),
                    positionSide: getFirstDefinedValue(detail.positionSide, detail.ps),
                    orderId: getFirstDefinedValue(detail.orderId, detail.i),
                    clientOrderId: null,
                    clientAlgoId: context.clientAlgoId,
                    algoId: context.algoId,
                    eventTime: data?.E || data?.T || null,
                    tradeTime: getFirstDefinedValue(detail.tradeTime, detail.T),
                });
                logAlgoUpdateRuntimeEvent(uid, data);
                handleAlgoReservationRuntimeUpdate(uid, data).catch(() => {});
                return;
            }

            if(data.e === 'CONDITIONAL_ORDER_TRIGGER_REJECT'){
                const detail = getAlgoEventDetail(data);
                const context = buildAlgoRuntimeEventContext(detail, uid);
                logOrderRuntimeTrace('USER_STREAM_INGRESS', {
                    uid,
                    eventType: data.e,
                    symbol: getFirstDefinedValue(detail.symbol, detail.s),
                    side: getFirstDefinedValue(detail.side, detail.S),
                    positionSide: getFirstDefinedValue(detail.positionSide, detail.ps),
                    orderId: getFirstDefinedValue(detail.orderId, detail.i),
                    clientOrderId: null,
                    clientAlgoId: context.clientAlgoId,
                    algoId: context.algoId,
                    eventTime: data?.E || data?.T || null,
                    tradeTime: getFirstDefinedValue(detail.tradeTime, detail.T),
                });
                logConditionalTriggerRejectRuntimeEvent(uid, data);
                handleConditionalTriggerRejectReservationUpdate(uid, data).catch(() => {});
            }
        });
    
        const keepAliveTimer = setInterval(async () => {
            try{
                if(binance[uid]){
                    await binance[uid].futuresKeepDataStream({listenKey});
                    logOrderRuntimeTrace('USER_STREAM_KEEPALIVE_SUCCESS', {
                        uid,
                        listenKey,
                    });
                    updateBinanceRuntimeMeta(uid, {
                        connected: true,
                        status: 'CONNECTED',
                        lastKeepAliveAt: new Date().toISOString(),
                    });
                }
            }catch(error){
                logOrderRuntimeTrace('USER_STREAM_KEEPALIVE_FAILURE', {
                    uid,
                    listenKey,
                    message: error?.message || String(error),
                    stack: error?.stack || null,
                });
                logBinanceRuntimeError('keepDataStream', uid, error);
                updateBinanceRuntimeMeta(uid, {
                    connected: false,
                    status: 'ERROR',
                    lastErrorAt: new Date().toISOString(),
                });
                cleanupBinanceClientRuntime(uid).catch(() => {});
                disableBinanceClient(uid, 30000);
            }
        }, 30 * 60 * 1000); // 30분
        binanceClientRuntime[uid] = {
            appKey: APP_KEY,
            appSecret: APP_SECRET,
            listenKey,
            ws,
            keepAliveTimer,
            userStreamEnabled: true,
        };
        updateBinanceRuntimeMeta(uid, {
            connected: true,
            status: 'CONNECTED',
            lastReadyAt: new Date().toISOString(),
            listenKey,
            retryAt: null,
            disabledUntil: null,
            appKeyMasked: maskApiKey(APP_KEY),
        });

        binance[uid].futuresPositionSideDual().then((re)=>{
            updateBinanceRuntimeMeta(uid, {
                lastHedgeMode: Boolean(re?.dualSidePosition),
            });
            if(!re?.dualSidePosition){
                logOrderRuntimeTrace('POSITION_MODE_REQUIRES_USER_APPROVED_CHANGE', {
                    uid,
                    action: 'WRITE_POSITION_MODE_CHANGE_DEFERRED',
                });
            }
        }).catch((error)=>{
            handleBinanceClientError('positionSideDual', uid, error);
        });

        console.log(`END initAPI ID:${uid} ::: ${listenKey}`);
        delete binanceInitRetryAt[uid];
        return true;
    }catch(e){
        logBinanceRuntimeError('initAPI', uid, e);
        updateBinanceRuntimeMeta(uid, {
            connected: false,
            status: 'ERROR',
            lastErrorAt: new Date().toISOString(),
        });
        await cleanupBinanceClientRuntime(uid);
        binance[uid] = null;
        binanceInitRetryAt[uid] = Date.now() + 30000;
        updateBinanceRuntimeMeta(uid, {
            retryAt: new Date(binanceInitRetryAt[uid]).toISOString(),
        });
        return false;
    } finally{
        initializingBinanceClients.delete(uid);
    }
    

    // const positions = await binance[uid].futuresPositionRisk();
    // console.log(positions);

    // const extData = await binance[uid].futuresOrder(
    //     'MARKET',
    //     'SELL',
    //     'BTCUSDT',
    //     0.005,
    //     null,
    //     {
    //         positionSide: 'LONG',
    //         // newClientOrderId: 
    //     }
    // )
    // cancelOrderAll2(uid, 'BTCUSDT', '829424012345');

}

const getTick = async () => {
    const binance = new Binance();

    binance.futuresBookTickerStream(false, (re)=>{
        if(symbolList.includes(re.symbol)){
            const slot = ensurePriceSlot(re.symbol);
            dt.price[re.symbol] = {
                ...slot,
                ...re,
            };
        }
    });

    symbolList.forEach((symbol)=>{
        binance.futuresAggTradeStream(symbol, (re)=>{
            const slot = ensurePriceSlot(re.symbol);
            dt.price[re.symbol] = {
                ...slot,
                lastPrice: re.price,
                lastQty: re.quantity,
                lastTradeTime: re.tradeTime || re.eventTime || Date.now(),
            };
        });
    });

    getCandle('1h');
    getCandle('4h');
    getCandle('1d');

    
} 

// const API_KEY = '6ua6KBZ4FCOpRMUhi2WObt29ddJI7t6qwLLWbPKiV5KIbCzy5KDiy8WAONhW2JJ7';
// const SECRET_KEY = 'TsR0fwKzePaNaoFDnSZ7IVkCmtxxyQPW9GxbKYMLP0cipmDv2uBY8JiGQ7LPGrsV';
// const BASE_URL = "https://fapi.binance.com";

const getUserBalance = async () => {
    setInterval(async () => {
        try{
            dbcon.DBCall(`CALL SP_A_MEMBER_KEY_ALL_GET()`).then((keyList)=>{
                keyList.forEach((k)=>{
                    const uid = k.id;
                    if(isExcludedRuntimeUid(uid)){
                        markBinanceRuntimeExcluded(uid);
                        return;
                    }
                    if(isBinanceClientRetryBlocked(uid)){
                        return;
                    }
                    if(!binance[uid]){
                        initAPI(uid, k.appKey, k.appSecret, {
                            enableUserStream: false,
                        });
                        return;
                    }

                    privateFuturesSignedRequest(uid, '/fapi/v3/balance', {}, 'GET').then((reData)=>{
                        reData.forEach((i)=>{
                            if(i.asset == 'USDT'){
                                dbcon.DBCall(`CALL SP_LIVE_PLAY_PRICE_SET(?,?)`,[uid, i.availableBalance]);
                            }
                        })
                    }).catch((e)=>{
                        handleBinanceClientError('getUserBalance', uid, e, 'accountBalance');
                    });

                    exports.getBinanceAccountRiskCurrent(uid, {
                        persist: true,
                        maxAgeMs: 60000,
                    }).catch((error) => {
                        handleBinanceClientError('getAccountRisk', uid, error, 'accountInfo');
                    });

                    exports.truthSyncLiveSignalRuntime(uid, {
                        minIntervalMs: 12000,
                        limit: 12,
                    }).catch((error) => {
                        console.log('ERR :: truthSyncLiveSignalRuntime');
                        console.log(error);
                    });

                    exports.truthSyncLiveGridRuntime(uid, {
                        minIntervalMs: 12000,
                        limit: 12,
                    }).catch((error) => {
                        console.log('ERR :: truthSyncLiveGridRuntime');
                        console.log(error);
                    });
                });
            }).catch((eee)=>{
                console.log('ERR :: getUserBalance member keys');
                console.log(eee);
            });
    
            
        }catch(e){
            console.log('ERR :: getUserBalance loop');
            console.log(e);
        }
    }, 5000); // 30遺?
}

const handleOrderRuntimeUpdate = (uid, data) => {
    let tracePayload = {
        uid,
        eventType: data?.e || null,
    };
    let outcome = 'IGNORED';
    try{
        if(data?.e !== 'ORDER_TRADE_UPDATE' || !data?.o){
            return false;
        }

        const reData = data.o;
        const endStatus = reData.X;
        const status = reData.x;
        const oid = reData.i;
        const runtimeOrderMeta = parseRuntimeClientOrderMeta(reData.c, uid);
        const ownerUserId = runtimeOrderMeta.ownerUserId ?? uid ?? null;
        const pid = runtimeOrderMeta.pid ?? null;
        const symbol = reData.s;
        const side = reData.S;
        const price = reData.ap;
        const qty = reData.z;
        tracePayload = {
            ...tracePayload,
            pid,
            orderId: oid || null,
            clientOrderId: reData.c || null,
            symbol,
            side,
            positionSide: reData.ps || null,
            status,
            endStatus,
            qty,
            price,
        };
        logOrderRuntimeTrace('ORDER_RUNTIME_HANDLER_START', {
            handler: 'handleOrderRuntimeUpdate',
            ...tracePayload,
        });
        const runtimeMessage = `status:${status}, endStatus:${endStatus}, symbol:${symbol}, side:${side}, qty:${qty}, price:${price}`;

        if(endStatus === 'PARTIALLY_FILLED'){
            exports.msgAdd('orderUpdate', 'PARTIALLY_FILLED', runtimeMessage, ownerUserId, pid, oid, symbol, side);
            outcome = 'PARTIALLY_FILLED_LOGGED';
            return true;
        }

        if(endStatus === 'NEW' || isTerminalOrderStatus(endStatus)){
            exports.msgAdd('orderUpdate', endStatus, runtimeMessage, ownerUserId, pid, oid, symbol, side);
            outcome = endStatus;
            return true;
        }

        return false;
    }catch(e){
        outcome = 'ERROR';
        logOrderRuntimeTrace('ORDER_RUNTIME_HANDLER_ERROR', {
            handler: 'handleOrderRuntimeUpdate',
            ...tracePayload,
            message: e?.message || String(e),
            stack: e?.stack || null,
        });
        console.log('handleOrderRuntimeUpdate ERROR :: ', e);
        return false;
    }finally{
        logOrderRuntimeTrace('ORDER_RUNTIME_HANDLER_END', {
            handler: 'handleOrderRuntimeUpdate',
            ...tracePayload,
            outcome,
        });
    }
}


const reOrderGet = async (uid, data) => {
    // {
    //     "e": "ORDER_TRADE_UPDATE",       // ?대깽?????
    //     "T": 1624188164123,              // ?대깽??諛쒖깮 ?쒓컙
    //     "E": 1624188164123,              // ?대깽???섏떊 ?쒓컙
    //     "o": {
    //         "s": "BTCUSDT",                // 醫낅ぉ
    //         "c": "myOrder123",             // ?대씪?댁뼵?멸? 吏?뺥븳 二쇰Ц ID
    //         "S": "BUY",                    // 二쇰Ц 諛⑺뼢 (BUY or SELL)
    //         "o": "MARKET",                 // 二쇰Ц 醫낅쪟 (LIMIT, MARKET, etc.)
    //         "f": "GTC",                    // 二쇰Ц ?좏슚?쒓컙
    //         "q": "0.001",                  // 二쇰Ц ?섎웾
    //         "p": "0",                      // 二쇰Ц 媛寃?(?쒖옣媛??0)
    //         "ap": "29450.12",             // ?됯퇏 泥닿껐 媛寃?
    //         "sp": "0",                     // stopPrice (?ㅽ깙 二쇰Ц ??
    //         "x": "TRADE",                  // ?ㅽ뻾 ???(TRADE = 泥닿껐, NEW = ?좉퇋 ?깅줉 ??
    //         "X": "FILLED",                 // ?꾩옱 二쇰Ц ?곹깭
    //         "i": 1234567890,              // 二쇰Ц ID
    //         "l": "0.001",                  // 吏곸쟾 泥닿껐 ?섎웾
    //         "z": "0.001",                  // ?꾩쟻 泥닿껐 ?섎웾
    //         "L": "29450.12",              // 吏곸쟾 泥닿껐 媛寃?
    //         "n": "0.01",                   // ?섏닔猷?
    //         "N": "USDT",                   // ?섏닔猷??먯궛
    //         "T": 1624188164000,            // 泥닿껐 ?쒓컙
    //         "rp": "0.00",                  // ?ㅽ쁽 ?먯씡 (Realized PnL)
    //         "b": "0",                      // 嫄곕옒 ???ъ???留덉쭊
    //         "a": "0",                      // 嫄곕옒 ???ъ???留덉쭊
    //         "m": false,                    // maker ?щ?
    //         "R": false,                    // reduceOnly ?щ?
    //         "wt": "CONTRACT_PRICE",        // ?몃━嫄?媛寃?湲곗?
    //         "ot": "MARKET",                // ?ㅻ━吏??二쇰Ц ???
    //         "ps": "BOTH",                  // ?ъ????ъ씠??(BOTH, LONG, SHORT)
    //         "cp": false,                   // 議곌굔遺 二쇰Ц ?щ?
    //         "pP": false,                   // 媛寃?蹂댄샇 ?щ?
    //         "si": 0,                       // ?꾩씠?ㅻ쾭洹??섎웾
    //         "ss": 0                        // ?먮옒 ?④? ?섎웾
    //     }
    // }

    const type = data?.e;
    let runtimeTraceOutcome = 'IGNORED';
    let runtimeTracePayload = {
        uid,
        eventType: type || null,
        orderId: data?.o?.i || null,
        clientOrderId: data?.o?.c || null,
        symbol: data?.o?.s || null,
        side: data?.o?.S || null,
        positionSide: data?.o?.ps || null,
        status: data?.o?.x || null,
        endStatus: data?.o?.X || null,
        tradeTime: data?.o?.T || null,
    };
    logOrderRuntimeTrace('REORDER_GET_START', runtimeTracePayload);

    try{

    // console.log(data);
    
    if(type != 'ORDER_TRADE_UPDATE'){
        runtimeTraceOutcome = 'IGNORED_EVENT_TYPE';
        return false;
    }

    
    

    

    const reData = data.o;
    const status = reData.x;        // ?ㅽ뻾 ???(TRADE = 泥닿껐, NEW = ?좉퇋 ?깅줉 ??
    const endStatus = reData.X;        // FILLED
    const oid = reData.i; 
    const rawClientOrderId = String(reData.c || '');
    runtimeTracePayload = {
        uid,
        eventType: type,
        orderId: oid || null,
        clientOrderId: rawClientOrderId || null,
        symbol: reData.s || null,
        side: reData.S || null,
        positionSide: reData.ps || null,
        status,
        endStatus,
        tradeTime: reData.T || null,
    };
    const cData = rawClientOrderId.split('_');
    const runtimeOrderMeta = parseRuntimeClientOrderMeta(rawClientOrderId, uid);
    const symbol = reData.s;
    const side = reData.S;          //BUY or SELL
    const tradeType = reData.o;     //MARKET, LIMIT
    const price = reData.ap;
    const qty = reData.z;         //?섎웾
    const lastQty = reData.l;
    const charge = reData.n;        //?섏닔猷?
    const pnl = reData.rp;        //?ㅽ쁽 ?먯씡 (Realized PnL)
    const updateTime = reData.T;        //泥닿껐 ?쒓컙
    if(rawClientOrderId && oid){
        await pidPositionLedger.bindReservationActualOrderId(rawClientOrderId, oid);
    }
    if(DEBUG_RUNTIME_TRACE && side === 'SELL' && status === 'TRADE'){
        console.log(
            `[ORDER_TRADE_TRACE] clientOrderId:${reData.c}, orderId:${oid}, execType:${status}, endStatus:${endStatus}, orderType:${tradeType}, side:${side}, qty:${qty}, avgPrice:${price}, lastPrice:${reData.L}, stopPrice:${reData.sp}, positionSide:${reData.ps}, closePosition:${reData.cp}, workingType:${reData.wt}`
        );
        try{
            console.log(`[ORDER_TRADE_RAW] ${JSON.stringify({
                c: reData.c,
                i: reData.i,
                x: reData.x,
                X: reData.X,
                o: reData.o,
                ot: reData.ot,
                S: reData.S,
                s: reData.s,
                ap: reData.ap,
                z: reData.z,
                L: reData.L,
                sp: reData.sp,
                ps: reData.ps,
                cp: reData.cp,
                wt: reData.wt,
                R: reData.R,
                rp: reData.rp,
                T: reData.T,
            })}`);
        }catch(traceError){
        }
    }

    if(isGridClientOrderId(rawClientOrderId)){
        try{
            const gridHandled = await getGridEngine().handleLiveOrderTradeUpdate(uid, data);
            runtimeTraceOutcome = gridHandled ? 'GRID_HANDLER_HANDLED' : 'GRID_HANDLER_IGNORED';
            return gridHandled;
        }catch(gridError){
            runtimeTraceOutcome = 'GRID_HANDLER_ERROR';
            logOrderRuntimeTrace('REORDER_GET_ERROR', {
                ...runtimeTracePayload,
                message: gridError?.message || String(gridError),
                stack: gridError?.stack || null,
            });
            console.log('handleGridOrderRuntimeUpdate ERROR :: ', gridError);
            return false;
        }
    }

    if(cData[0] == 'NEW' && isTerminalOrderStatus(endStatus)){
        runtimeTraceOutcome = `ENTRY_${endStatus}`;
        const terminalExecutedQty = getOrderExecutedQty(reData);
        const play = await loadLivePlaySnapshot(runtimeOrderMeta.pid);
        const recoveredExecution = (terminalExecutedQty > 0 || ['EXPIRED_IN_MATCH', 'REJECTED'].includes(String(endStatus || '').toUpperCase()))
            ? await recoverSignalEntryFillFromExchange({
                uid: runtimeOrderMeta.ownerUserId,
                row: play,
                issue: { issues: [`SIGNAL_ENTRY_TERMINAL_${endStatus}`] },
            })
            : null;
        logOrderRuntimeTrace(getTerminalOrderAuditLabel(endStatus, Boolean(recoveredExecution || terminalExecutedQty > 0)), {
            uid: runtimeOrderMeta.ownerUserId,
            pid: runtimeOrderMeta.pid,
            symbol,
            positionSide: getSignalPositionSide(side),
            clientOrderId: rawClientOrderId,
            orderId: oid,
            status: endStatus,
            executedQty: terminalExecutedQty,
            recovered: Boolean(recoveredExecution),
            source: 'reOrderGet:signal-entry-terminal',
        });
        if(!recoveredExecution){
            await resetLivePlayToReady(runtimeOrderMeta.pid, ['EXACT_WAIT']);
        }
        return true;
    }

    if((runtimeState.isConditionalExitOrderType(cData[0]) || runtimeState.isMarketExitOrderType(cData[0]))
        && isTerminalOrderStatus(endStatus)){
        runtimeTraceOutcome = `EXIT_${endStatus}`;
        const terminalExecutedQty = getOrderExecutedQty(reData);
        let recoveredExecution = null;
        if(terminalExecutedQty > 0 || ['EXPIRED_IN_MATCH', 'REJECTED'].includes(String(endStatus || '').toUpperCase())){
            const play = await loadLivePlaySnapshot(runtimeOrderMeta.pid);
            recoveredExecution = await recoverSignalExitFillFromExchange({
                uid: runtimeOrderMeta.ownerUserId,
                row: play,
                issue: { issues: [`SIGNAL_EXIT_TERMINAL_${endStatus}`] },
            });
        }
        logOrderRuntimeTrace(getTerminalOrderAuditLabel(endStatus, Boolean(recoveredExecution || terminalExecutedQty > 0)), {
            uid: runtimeOrderMeta.ownerUserId,
            pid: runtimeOrderMeta.pid,
            symbol,
            positionSide: getSignalPositionSide(resolveEntrySignalTypeFromCloseSide(null, side)),
            clientOrderId: rawClientOrderId,
            orderId: oid,
            status: endStatus,
            executedQty: terminalExecutedQty,
            recovered: Boolean(recoveredExecution),
            source: 'reOrderGet:signal-exit-terminal',
        });
        await pidPositionLedger.markReservationsCanceled([rawClientOrderId]);
        await restoreLivePlayStatus(
            runtimeOrderMeta.pid,
            runtimeState.isMarketExitOrderType(cData[0])
                ? runtimeState.getLegacyExitPendingStatus()
                : 'EXACT'
        );
        return true;
    }

    if(endStatus != 'FILLED' && endStatus != 'PARTIALLY_FILLED'){
        runtimeTraceOutcome = 'IGNORED_NON_FILL';
        return false;
    }

    return await withQueuedSignalOrderRuntimeLock(`signal-runtime-order:${uid}:${rawClientOrderId}`, async () => {
        try{
        // signal entry fill
        if(cData[0] == 'NEW' && status == 'TRADE'){
            const uid = runtimeOrderMeta.ownerUserId;
            const pid = runtimeOrderMeta.pid;
            const positionSide = getSignalPositionSide(side);
            const entryFillQty = Number(lastQty || qty || 0);
            const entryFillPrice = Number(reData.L || price || 0);

            console.log(`NEW -------------`);
            console.log(`oid: ${oid}, uid: ${uid}, pid: ${pid}, price: ${price}, qty: ${qty}, charge: ${charge}, time: ${getKorTime(updateTime)}`);

            const ledgerEntry = positionSide
                ? await pidPositionLedger.applyEntryFill({
                    uid,
                    pid,
                    strategyCategory: 'signal',
                    symbol,
                    positionSide,
                    sourceClientOrderId: rawClientOrderId,
                    sourceOrderId: oid,
                    sourceTradeId: reData.t || null,
                    fillQty: entryFillQty,
                    fillPrice: entryFillPrice,
                    fee: charge,
                    tradeTime: updateTime,
                    eventType: 'ENTRY_FILL',
                    note: `signal-entry:${endStatus}`,
                })
                : null;
            if(positionSide){
                await pidPositionLedger.syncSignalPlaySnapshot(pid, positionSide);
            }
            const snapshot = ledgerEntry?.snapshot || (positionSide
                ? await pidPositionLedger.loadSnapshot({
                    uid,
                    pid,
                    strategyCategory: 'signal',
                    positionSide,
                })
                : null);
            const resolvedOpenQty = Number(snapshot?.openQty || qty || 0);
            const resolvedAvgEntryPrice = Number(snapshot?.avgEntryPrice || price || 0);
            const positionSize = resolvedAvgEntryPrice * resolvedOpenQty;

            await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_EXACT_UPDATE(?,?,?,?,?,?)`,[
                pid,
                uid,
                resolvedAvgEntryPrice,
                resolvedOpenQty,
                positionSize,
                charge
            ]);
            await touchSignalPositionOwnership({
                uid,
                pid,
                symbol,
                signalSide: side,
                ownerState: 'OPEN',
                sourceClientOrderId: rawClientOrderId,
                sourceOrderId: oid,
                note: `entry-filled:${endStatus}`,
            });
            await syncLiveBoundExitOrders({
                uid,
                pid,
                symbol,
                entryOrderId: oid,
                entryPrice: resolvedAvgEntryPrice,
                qty: resolvedOpenQty,
            });

            runtimeTraceOutcome = endStatus === 'PARTIALLY_FILLED'
                ? 'SIGNAL_ENTRY_PARTIAL'
                : 'SIGNAL_ENTRY_FILLED';
            return true;

        }else if(runtimeState.isConditionalExitOrderType(cData[0]) && status == 'TRADE'){
            const uid = runtimeOrderMeta.ownerUserId;
            const pid = runtimeOrderMeta.pid;
            const cid = runtimeOrderMeta.suffix;
            const splitFillPnl = Number(pnl || 0);
            const splitFillCharge = Number(charge || 0);
            const signalPositionSide = getSignalPositionSide(resolveEntrySignalTypeFromCloseSide(null, side));
            const exitEventType = cData[0] === 'SPLITTP'
                ? 'SPLIT_TAKE_PROFIT_FILL'
                : cData[0] === 'STOP'
                    ? 'BOUND_STOP_FILL'
                    : 'BOUND_PROFIT_FILL';

            if(signalPositionSide){
                await pidPositionLedger.applyExitFill({
                    uid,
                    pid,
                    strategyCategory: 'signal',
                    symbol,
                    positionSide: signalPositionSide,
                    sourceClientOrderId: rawClientOrderId,
                    sourceOrderId: oid,
                    sourceTradeId: reData.t || null,
                    fillQty: Number(lastQty || qty || 0),
                    fillPrice: Number(reData.L || price || 0),
                    fee: charge,
                    realizedPnl: pnl,
                    tradeTime: updateTime,
                    eventType: exitEventType,
                    note: `signal-exit:${cData[0]}:${endStatus}`,
                });
                await pidPositionLedger.syncSignalPlaySnapshot(pid, signalPositionSide);
            }

            if(cData[0] == 'SPLITTP'){
                appendSplitTradeAccumulator({
                    uid,
                    pid,
                    oid,
                    clientOrderId: rawClientOrderId,
                    qty: lastQty,
                    pnl: splitFillPnl,
                    charge: splitFillCharge,
                });
            }

            if(endStatus == 'PARTIALLY_FILLED'){
                logClosePartialFill(cData[0], uid, pid, oid, symbol, side, qty, price, endStatus);
                return true;
            }

            
            
            console.log(`CLOSE ------------- ${cData[0]}`);
            console.log(`oid: ${oid}, cid: ${cid}, uid: ${uid}, pid: ${pid}, price: ${price}, qty: ${qty}, charge: ${charge}, pnl: ${pnl}, time: ${getKorTime(updateTime)}`);

            await cancelBoundExitOrders(uid, symbol, pid, cData[0]);

            if(cData[0] == 'SPLITTP'){
                const re = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_NEW_GET(?)`,[pid]);
                if(!re){
                    return true;
                }

                const splitProgress = consumeSplitTradeAccumulator({
                    uid,
                    pid,
                    oid,
                    clientOrderId: rawClientOrderId,
                });
                const splitConfig = getLiveSplitTakeProfitConfig(re);
                const currentStageIndex = Math.max(0, Number(re.r_splitStageIndex || 0));
                const currentStage = splitConfig.stages[currentStageIndex] || null;
                const nextStageIndex = currentStageIndex + 1;
                const ledgerTotals = signalPositionSide
                    ? await pidPositionLedger.getCycleTotals({
                        uid,
                        pid,
                        strategyCategory: 'signal',
                        positionSide: signalPositionSide,
                    })
                    : { openQty: Math.max(0, Number(re.r_qty || 0) - Number(splitProgress.qty || 0)), realizedPnl: Number(re.r_splitRealizedPnl || 0) + Number(splitProgress.pnl || 0), fees: Number(re.r_splitRealizedCharge || 0) + Number(splitProgress.charge || 0) };
                const nextRemainingQty = Math.max(0, Number(ledgerTotals.openQty || 0));
                const nextRealizedQty = Number(re.r_splitRealizedQty || 0) + Number(splitProgress.qty || 0);
                const nextRealizedPnl = Number(ledgerTotals.realizedPnl || 0);
                const nextRealizedCharge = Number(ledgerTotals.fees || 0);
                const hasNextStage = nextStageIndex < splitConfig.stages.length && nextRemainingQty > 0;

                await persistLiveSplitRuntime(pid, {
                    r_qty: nextRemainingQty,
                    r_splitEntryQty: Number(re.r_splitEntryQty || re.r_qty || 0),
                    r_splitStageIndex: hasNextStage ? nextStageIndex : currentStageIndex,
                    r_splitRealizedQty: nextRealizedQty,
                    r_splitRealizedPnl: nextRealizedPnl,
                    r_splitRealizedCharge: nextRealizedCharge,
                });

                if(hasNextStage){
                    await syncLiveBoundExitOrders({
                        uid,
                        pid,
                        symbol,
                        entryOrderId: re.r_tid || cid,
                        entryPrice: re.r_exactPrice,
                        qty: nextRemainingQty,
                    });

                    exports.msgAdd(
                        'splitTakeProfitAdvance',
                        'SPLITTP_STAGE_FILLED',
                        `pid:${pid}, symbol:${symbol}, filledStageIndex:${currentStageIndex}, nextStageIndex:${nextStageIndex}, realizedQty:${Number(splitProgress.qty || 0).toFixed(8)}, remainingQty:${Number(nextRemainingQty || 0).toFixed(8)}, tpPercent:${Number(currentStage?.tpPercent || 0).toFixed(4)}`,
                        uid,
                        pid,
                        oid,
                        symbol,
                        side
                    );
                    return true;
                }

                const resolvedSignalType = resolveEntrySignalTypeFromCloseSide(re.r_signalType, side);
                const resolvedSignalTime = re.r_signalTime || re.r_exactTime || null;
                const positionSize = re.leverage * re.margin;
                const exitReasonCode = runtimeState.getExitReasonCode('bound-profit');
                const exitMode = runtimeState.getExitMode('bound-profit', 'PROFIT');
                await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
                    uid,
                    pid,
                    cid,
                    oid,
                    'PROFIT',
                    re.symbol,
                    re.leverage,
                    re.margin,
                    positionSize,
                    re.type,
                    re.bunbong,
                    resolvedSignalType,
                    re.r_signalPrice,
                    resolvedSignalTime,
                    re.r_exactPrice,
                    price,
                    nextRealizedPnl,
                    nextRealizedPnl,
                    nextRealizedPnl > 0 ? true : false,
                    nextRealizedPnl < 0 ? true : false,
                    nextRealizedCharge,
                    parseFloat(nextRealizedCharge)+parseFloat(re.r_t_charge),
                    re.r_exactTime,
                    getKorTime(updateTime),
                    exitReasonCode,
                    exitMode,
                ]);

                await setLivePlayReadyModeIfCurrent(re, re.status);

                await evaluateLiveStrategyPoliciesAfterClose(uid, pid);

                return true;
            }


            // const re = exports.resultPrice(play.r_exactPrice, price, play.r_signalType);

            const re = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_NEW_GET(?)`,[pid]);
            if(!re){
                return true;
            }

                let endType = cData[0] == 'TS' ? 'PROFIT' : cData[0];
                const resolvedSignalType = resolveEntrySignalTypeFromCloseSide(re.r_signalType, side);
                const resolvedSignalTime = re.r_signalTime || re.r_exactTime || null;
                const ledgerTotals = signalPositionSide
                    ? await pidPositionLedger.getCycleTotals({
                        uid,
                        pid,
                        strategyCategory: 'signal',
                        positionSide: signalPositionSide,
                    })
                    : { realizedPnl: Number(pnl || 0) + Number(re.r_splitRealizedPnl || 0), fees: Number(charge || 0) + Number(re.r_splitRealizedCharge || 0) };
                
                
                const positionSize = re.leverage * re.margin;
                const closeReason = cData[0] == 'STOP' ? 'bound-stop' : 'bound-profit';
                const exitReasonCode = runtimeState.getExitReasonCode(closeReason);
                const exitMode = runtimeState.getExitMode(closeReason, endType);
                const totalPnl = Number(ledgerTotals.realizedPnl || 0);
                const totalCharge = Number(ledgerTotals.fees || 0);
                await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
                    uid,
                    pid,
                    cid,
                    oid,   

                    endType,

                    re.symbol,
                    re.leverage,
                    re.margin,
                    positionSize,

                    re.type,
                    re.bunbong,

                    resolvedSignalType,
                    re.r_signalPrice,
                    resolvedSignalTime,

                    re.r_exactPrice,
                    price,

                    // re.r_signalType == 'BUY' ? (re.r_exactPrice - price) * re.r_minQty : (price - re.r_exactPrice) * re.r_minQty,
                    // re.r_signalType == 'BUY' ? (re.r_exactPrice - price) * re.r_minQty : (price - re.r_exactPrice) * re.r_minQty,
                    totalPnl,
                    totalPnl,

                    totalPnl > 0 ? true : false,
                    totalPnl < 0 ? true : false,

                    totalCharge,
                    parseFloat(totalCharge)+parseFloat(re.r_t_charge),
                    re.r_exactTime,
                    getKorTime(updateTime),
                    exitReasonCode,
                    exitMode,
                ]);

                await setLivePlayReadyModeIfCurrent(re, re.status);

                await evaluateLiveStrategyPoliciesAfterClose(uid, pid);
                runtimeTraceOutcome = exitEventType;
                return true;
        }else if(runtimeState.isMarketExitOrderType(cData[0]) && status == 'TRADE'){
            const signalPositionSide = getSignalPositionSide(resolveEntrySignalTypeFromCloseSide(null, side));
            if(signalPositionSide){
                await pidPositionLedger.applyExitFill({
                    uid: runtimeOrderMeta.ownerUserId,
                    pid: runtimeOrderMeta.pid,
                    strategyCategory: 'signal',
                    symbol,
                    positionSide: signalPositionSide,
                    sourceClientOrderId: rawClientOrderId,
                    sourceOrderId: oid,
                    sourceTradeId: reData.t || null,
                    fillQty: Number(lastQty || qty || 0),
                    fillPrice: Number(reData.L || price || 0),
                    fee: charge,
                    realizedPnl: pnl,
                    tradeTime: updateTime,
                    eventType: `MARKET_${String(cData[0] || 'CLOSE').toUpperCase()}_FILL`,
                    note: `signal-market-exit:${cData[0]}:${endStatus}`,
                });
                await pidPositionLedger.syncSignalPlaySnapshot(runtimeOrderMeta.pid, signalPositionSide);
            }
            if(endStatus == 'PARTIALLY_FILLED'){
                runtimeTraceOutcome = `MARKET_${String(cData[0] || 'CLOSE').toUpperCase()}_PARTIAL`;
                logClosePartialFill(cData[0], runtimeOrderMeta.ownerUserId, runtimeOrderMeta.pid, oid, symbol, side, qty, price, endStatus);
                return true;
            }

            const uid = runtimeOrderMeta.ownerUserId;
            const pid = runtimeOrderMeta.pid;
            const cid = runtimeOrderMeta.suffix;

            const re = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_NEW_GET(?)`,[pid]);
            if(!re){
                runtimeTraceOutcome = `MARKET_${String(cData[0] || 'CLOSE').toUpperCase()}_NO_PLAY`;
                return true;
            }
                let endType = null;
                const resolvedSignalType = resolveEntrySignalTypeFromCloseSide(re.r_signalType, side);
                const resolvedSignalTime = re.r_signalTime || re.r_exactTime || null;
                const ledgerTotals = signalPositionSide
                    ? await pidPositionLedger.getCycleTotals({
                        uid,
                        pid,
                        strategyCategory: 'signal',
                        positionSide: signalPositionSide,
                    })
                    : { realizedPnl: Number(pnl || 0) + Number(re.r_splitRealizedPnl || 0), fees: Number(charge || 0) + Number(re.r_splitRealizedCharge || 0) };
                const totalPnl = Number(ledgerTotals.realizedPnl || 0);
                const totalCharge = Number(ledgerTotals.fees || 0);
                if(cData[0] == 'TIME' || cData[0] == 'REVERSE'){
                    endType = 'STOP'
                }else if(totalPnl > 0){
                    endType = 'PROFIT'
                }else{
                    endType = 'STOP'
                }

                // cancelOrderAll2(symbol, re.r_pid, re.r_sid);

                console.log(`吏꾩엯: ${re.r_exactPrice},  ?⑷퀎: ${totalPnl}, ??? ${endType}`);

                const positionSize = re.leverage * re.margin;
                const closeReason = runtimeState.getExitReasonFromCloseOrderType(cData[0]) || 'manual-off';
                const exitReasonCode = runtimeState.getExitReasonCode(closeReason);
                const exitMode = runtimeState.getExitMode(closeReason, endType);
                await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
                    uid,
                    pid,
                    cid,
                    oid,    //2媛쒕줈 諛붽퓭?쇳븿

                    endType,

                    re.symbol,
                    re.leverage,
                    re.margin,
                    positionSize,

                    re.type,
                    re.bunbong,
                    
                    resolvedSignalType,
                    re.r_signalPrice,
                    resolvedSignalTime,

                    re.r_exactPrice,
                    price,

                    // re.r_signalType == 'BUY' ? (re.r_exactPrice - price) * re.r_minQty : (price - re.r_exactPrice) * re.r_minQty,
                    // re.r_signalType == 'BUY' ? (re.r_exactPrice - price) * re.r_minQty : (price - re.r_exactPrice) * re.r_minQty,
                    totalPnl,
                    totalPnl,

                    totalPnl > 0 ? true : false,
                    totalPnl < 0 ? true : false,

                    totalCharge,
                    parseFloat(totalCharge)+parseFloat(re.r_t_charge),

                    re.r_exactTime,
                    getKorTime(updateTime),
                    exitReasonCode,
                    exitMode,
                ]);
                await resetLivePlayToReady(re.id, ['EXACT']);
                await evaluateLiveStrategyPoliciesAfterClose(uid, pid);
                return true;
        }else if(status == 'TRADE' && !hasKnownRuntimeClientOrderPrefix(rawClientOrderId)){
            return await finalizeExternalClose({
                uid,
                symbol,
                side,
                oid,
                clientOrderId: rawClientOrderId,
                price,
                qty,
                charge,
                pnl,
                updateTime,
            });
        }else{
            return false;
        }
    }catch(e){
        runtimeTraceOutcome = runtimeTraceOutcome === 'IGNORED' ? 'ERROR' : runtimeTraceOutcome;
        logOrderRuntimeTrace('REORDER_GET_ERROR', {
            ...runtimeTracePayload,
            outcome: runtimeTraceOutcome,
            message: e?.message || String(e),
            stack: e?.stack || null,
        });
        console.log(e);
        return false;
    }

    return true;
    });
    }catch(e){
        runtimeTraceOutcome = runtimeTraceOutcome === 'IGNORED' ? 'ERROR' : runtimeTraceOutcome;
        logOrderRuntimeTrace('REORDER_GET_ERROR', {
            ...runtimeTracePayload,
            outcome: runtimeTraceOutcome,
            message: e?.message || String(e),
            stack: e?.stack || null,
        });
        console.log(e);
        return false;
    }finally{
        logOrderRuntimeTrace('REORDER_GET_END', {
            ...runtimeTracePayload,
            outcome: runtimeTraceOutcome,
        });
    }
}

const cancelOrder = async (symbol, type, leftId, rigthId) => {
    await assertBinanceWriteAllowedOrLog({
        action: 'WRITE_CANCEL_ORDER',
        symbol,
        orderId: type == 'PROFIT' ? rigthId : leftId,
        caller: 'coin.cancelOrder.legacy',
    });
    throw new Error('LEGACY_CANCEL_WRITE_DISABLED');
}
const cancelOrderAll2 = async (uid, symbol, leftId = null, rigthId = null) => {
    if(leftId){
        await cancelFuturesOrder({ uid, action: 'WRITE_CANCEL_ORDER', symbol, orderId: leftId, caller: 'coin.cancelOrderAll2.left' }, symbol, leftId).catch((err)=>{});
    }
    if(rigthId){
        await cancelFuturesOrder({ uid, action: 'WRITE_CANCEL_ORDER', symbol, orderId: rigthId, caller: 'coin.cancelOrderAll2.right' }, symbol, rigthId).catch((err)=>{});
    }
}

const cancelOrderAll = async (symbol, leftId = null, rigthId = null) => {
    try{
        await assertBinanceWriteAllowedOrLog({
            action: 'WRITE_CANCEL_ORDER',
            symbol,
            orderId: leftId,
            caller: 'coin.cancelOrderAll.left.legacy',
        });
        throw new Error('LEGACY_CANCEL_WRITE_DISABLED');
    }catch(e){        

    }

    try{
        await assertBinanceWriteAllowedOrLog({
            action: 'WRITE_CANCEL_ORDER',
            symbol,
            orderId: rigthId,
            caller: 'coin.cancelOrderAll.right.legacy',
        });
        throw new Error('LEGACY_CANCEL_WRITE_DISABLED');
    }catch(e){        
        
    }
}

const socketInit = async () => {
    if(!io){
        console.log('socketInit !!!')
        io = require('./routes/socket');
        
        // io.wsOneSend(1,'test', {msg: '123132132'});

        // console.log(io.users);
        // wsOneSend(1,'test', {data: '123132132'})
    }
}


const getCandle = async (interval) => {
    const binance = new Binance();

    const candleData = {
        'BTCUSDT':[],
        'ETHUSDT':[],
        'XRPUSDT':[],
        'SOLUSDT':[],
        'DOGEUSDT':[],
    }

    for(let i=0;i<symbolList.length;i++){
        const s = symbolList[i];
        const itemList = await binance.futuresCandles(symbol = s, interval = interval, {limit: 50});

        candleData[s] = itemList;
    }

    for(let i=0;i<symbolList.length;i++){
        const s = symbolList[i];

        // const itemList = await binance.futuresCandles(symbol = s, interval = interval, {limit: 50});
        const itemList = candleData[s];

        const BBW = GET_BBW(binance, s, interval, itemList, 20);
        const STD = GET_STDDEV(binance, s, interval, itemList, 20);
        const VOL_Z = GET_Vol_Z(binance, s, interval, itemList, 20);
        const RSI = GET_RSI(binance, s, interval, itemList, 20);
        const ATR = GET_ATR(binance, s, interval, itemList, 20);
        const F = GET_F_UP_DOWN(binance, s, interval, itemList, 20);
        const CC_BTC = GET_CALC('BTCUSDT', s, candleData['BTCUSDT'], itemList, 20);
        const CC_ETH = GET_CALC('ETHUSDT', s, candleData['ETHUSDT'], itemList, 20);


        dbcon.DBCall(`CALL SP_C_CANDLE_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
            s,
            interval,

            itemList[itemList.length-1].close,
            itemList[itemList.length-21].close,

            BBW.bbwNow,
            BBW.bbwPrev,

            VOL_Z,
            RSI.RSI,
            RSI.slope,
            ATR,
            STD.dev,
            F.F_UP_LV1,
            F.F_UP_LV2,
            F.F_DN_LV1,
            F.F_DN_LV2,
            CC_BTC,
            CC_ETH,
        ])

        
        // if(s == 'BTCUSDT' && interval == '4h'){
        //     const _close = itemList[itemList.length-1].close;
        //     // 利앷컧瑜?%) = (?꾩옱媛?- 怨쇨굅媛? / 怨쇨굅媛?횞 100
        //     console.log(`[${interval}]${s} :: close: ${_close}    ${_close-87,187.50/_close*100}`);
        // }

    }
}

const GET_F_UP_DOWN = (binance, symbol, interval, itemList, period = 20) => {
    // highest_close = max(closes) : 20媛?罹붾뱾 醫낃???理쒕? 媛?
    // lowest_close = min(closes) : 20媛?罹붾뱾 醫낃???理쒖? 媛?
    // range_close = highest_close - lowest_close : 20媛?罹붾뱾 醫낃? 理쒕?媛믨낵 理쒖? 媛믪쓽 李?
    const closeValues = itemList.slice(-period).map(c => parseFloat(c.close));

    

    const highest_close = Math.max(...closeValues);
    const lowest_close = Math.min(...closeValues);
    const range_close = highest_close - lowest_close;

    // 4.	?쇰낫?섏튂 UP LV 1, LV2 怨꾩궛??
    // UP LV1 = highest_close - range_close * 0.382
    // UP LV2 = highest_close - range_close * 0.618
    // 5.	?쇰낫?섏튂 DN LV1,LV2 怨꾩궛??
    // DN LV1 = lowest_close + range_close * 0.382
    // DN LV2 = lowest_close + range_close * 0.618

    const F_UP_LV1 = highest_close - range_close * 0.382
    const F_UP_LV2 = highest_close - range_close * 0.618
    const F_DN_LV1 = lowest_close + range_close * 0.382
    const F_DN_LV2 = lowest_close + range_close * 0.618

    return {
        F_UP_LV1, F_UP_LV2, F_DN_LV1, F_DN_LV2
    }
}
const GET_ATR = (binance, symbol, interval, itemList, period=20) => {
    // 1.	20媛?罹붾뱾 (醫낃? 湲곗?) 
    // 2.	??꾪봽?덉엫? ?ъ슜?먭? ?좏깮 媛??1?쒓컙, 4?쒓컙, ?섎（ 以??좏깮) 
    // 3.	ATR? TR???됯퇏 (20媛?罹붾뱾?먯꽌) 
    // 4.	TR? 罹붾뱾留덈떎 怨꾩궛??
    // 5.	TR? ?꾩옱 罹붾뱾??怨좉? ???꾩옱 罹붾뱾???媛 
    // ?먯튃?곸쑝濡쒕뒗 [?꾩옱 罹붾뱾??怨좉?-?꾩옱 罹붾뱾???媛, ?꾩옱 罹붾뱾??怨좉? ??吏곸쟾 罹붾뱾??醫낃?, ?꾩옱 罹붾뱾???媛 ??吏곸쟾 罹붾뱾??醫낃?] 以?理쒕?媛믪씤??
    // 怨꾩냽?댁꽌 嫄곕옒媛 ?섎뒗 肄붿씤 ?쒖옣???몃젅?대뵫?대?濡?(媛?씠 ?녿뒗 ?몃젅?대뵫)?대?濡?, TR=?꾩옱 罹붾뱾??怨좉?-?꾩옱 罹붾뱾???媛濡??쒕떎.
    // 6.	20媛?罹붾뱾 湲곗???ATR? 20媛?罹붾뱾??TR???됯퇏 
    const closeValues = itemList.slice(-period);

    // TR = high - low
    const TRs = closeValues.map(candle => 
        parseFloat(candle.high) - parseFloat(candle.low)
    );

    // ATR = TR ?됯퇏
    const ATR =
        TRs.reduce((sum, value) => sum + value, 0) / period;

    return ATR;
}
const GET_BBW = (binance, symbol, interval, itemList, period=20) => {
    const k = 2;

    const bbwList = [];
    for (let i = itemList.length - period - 1; i < itemList.length; i++) {
        const sub = itemList.slice(i - period, i);
        if (sub.length < period) continue;

        const closeValues = sub.map(c => parseFloat(c.close));
        const sma = closeValues.reduce((sum, v) => sum + v, 0) / period;

        const variance = closeValues
            .map(v => Math.pow(v - sma, 2))
            .reduce((sum, v) => sum + v, 0) / period;
        const stdDev = Math.sqrt(variance);

        const upperBand = sma + k * stdDev;
        const lowerBand = sma - k * stdDev;
        const bbw = ((upperBand - lowerBand) / sma) * 100;

        bbwList.push(bbw);
    }

    // ?꾩옱 BBW? ?댁쟾 BBW
    const bbwPrev = bbwList[bbwList.length - 2];
    const bbwNow = bbwList[bbwList.length - 1];

    return {
        bbwNow,
        bbwPrev,
    };
}
const GET_RSI = (binance, symbol, interval, itemList, period=20) => {
    // const closeValues = itemList.slice(-period);
    const changes = [];
    for (let i = 1; i < itemList.length; i++) {
      changes.push(itemList[i].close - itemList[i - 1].close);
    }
  
    const gains = changes.map(v => (v > 0 ? v : 0));
    const losses = changes.map(v => (v < 0 ? Math.abs(v) : 0));
  
    // ??珥덇린 ?됯퇏媛?怨꾩궛 (20媛쒖쓽 ?⑥닚 ?됯퇏)
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
    const rsi = Array(period).fill(null);
  
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsiValue = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
        rsi.push(rsiValue);
    }

    const reRsi = rsi[rsi.length - 1];


    const recentRSI = rsi[rsi.length - 1];          // 理쒖떊 RSI
    const oldRSI = rsi[rsi.length - 1 - period];    // 20媛???RSI


    const slope = (recentRSI - oldRSI) / period;

    // console.log(`RSI(20) for ${symbol} on ${interval} timeframe ->`, reRsi, slope);

    // reRsi
    // slope

    return {
        RSI: reRsi,
        slope: slope,
    }
}
const GET_Vol_Z = (binance, symbol, interval, itemList, period=20) => {
    const closeValues = itemList.slice(-period).map(c => parseFloat(c.volume));
    // ?됯퇏
    const mean = closeValues.reduce((sum, val) => sum + val, 0) / period;

    // ?쒖??몄감
    const variance = closeValues
        .map(v => (v - mean) ** 2)
        .reduce((sum, val) => sum + val, 0) / period;
    const stdDev = Math.sqrt(variance);

    // 理쒖떊 嫄곕옒??
    const latestVolume = parseFloat(itemList[itemList.length - 1].volume);

    // Z-Score 怨꾩궛
    const zScore = stdDev === 0 ? 0 : (latestVolume - mean) / stdDev;

    return zScore;
}

const GET_CALC = (l_symbol, r_symbol, candle_l, candle_r, period) => {
    if(l_symbol == r_symbol){
        return 1;
    }

    const candle_l_ = candle_l.slice(-period);
    const candle_r_ = candle_r.slice(-period);

    const arr1 = candle_l_.map(c => parseFloat(c.close));
    const arr2 = candle_r_.map(c => parseFloat(c.close));

    if (arr1.length !== arr2.length) {
      throw new Error("??諛곗뿴??湲몄씠媛 媛숈븘???⑸땲??");
    }
    if (arr1.length < 2) {
      throw new Error("?곗씠?곌? 2媛??댁긽 ?꾩슂?⑸땲??");
    }
  
    const n = arr1.length;
  
    // ?됯퇏 怨꾩궛
    const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
    const mean2 = arr2.reduce((a, b) => a + b, 0) / n;
  
    // 遺꾩옄? 遺꾨え 怨꾩궛
    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;
  
    for (let i = 0; i < n; i++) {
      const diff1 = arr1[i] - mean1;
      const diff2 = arr2[i] - mean2;
      numerator += diff1 * diff2;
      denom1 += diff1 ** 2;
      denom2 += diff2 ** 2;
    }
  
    const denominator = Math.sqrt(denom1 * denom2);
    const correlation = denominator === 0 ? 0 : numerator / denominator;
  
    return correlation;
}

const GET_STDDEV = (binance, symbol, interval, itemList, period = 20) => {
    // 理쒓렐 20媛?罹붾뱾??醫낃? 異붿텧
    const closes = itemList.slice(-period).map(c => parseFloat(c.close));

    // ?됯퇏 怨꾩궛
    const mean = closes.reduce((sum, v) => sum + v, 0) / period;

    // 遺꾩궛 怨꾩궛
    const variance = closes
        .map(v => Math.pow(v - mean, 2))
        .reduce((sum, v) => sum + v, 0) / period;

    // ?쒖??몄감 怨꾩궛
    const dev = Math.sqrt(variance);

    return {
        dev,
        mean
    };
};

const adjustToTickSize = (price, tickSize) => {
    const precision = tickSize.toString().split('.')[1]?.length || 0;
    return Number(price).toFixed(precision);
};

const sign = (query) => {
    return crypto
      .createHmac("sha256", SECRET_KEY)
      .update(query)
      .digest("hex");
  }

const legacySetMarginType = async (symbol, marginType) => {
    const timestamp = Date.now();
    const query = `symbol=${symbol}&marginType=${marginType}&timestamp=${timestamp}`;
    const signature = sign(query);
  
    const url = `${BASE_URL}/fapi/v1/marginType?${query}&signature=${signature}`;
  
    try {
      await assertBinanceWriteAllowedOrLog({
        action: 'WRITE_MARGIN_TYPE',
        symbol,
        caller: 'coin.legacySetMarginType',
      });
      throw new Error('LEGACY_MARGIN_TYPE_WRITE_DISABLED');
      console.log("留덉쭊 ????ㅼ젙 ?꾨즺:", res.data);
    } catch (e) {
      if (e.response) {
        console.error("?먮윭:", e.response.data);
      } else {
        console.error("?ㅽ듃?뚰겕 ?먮윭:", e.message);
      }
    }
}

const normalizeMarginType = (marginType) => {
    const raw = String(marginType || '').trim().toUpperCase();

    if(!raw){
        return 'CROSSED';
    }

    if(raw === '寃⑸━' || raw === 'ISOLATED'){
        return 'CROSSED';
    }

    if(raw === '援먯감' || raw === 'CROSS' || raw === 'CROSSED'){
        return 'CROSSED';
    }

    return 'CROSSED';
}

const setMarginType = async (uid, symbol, marginType) => {
    const normalized = normalizeMarginType(marginType);
    if(!uid || !symbol || !normalized){
        return { status: false, skipped: true, marginType: normalized };
    }

    if(!(await ensureBinanceApiClient(uid))){
        return { status: false, skipped: true, marginType: normalized };
    }

    try{
        const res = await privateFuturesClientWrite({
            uid,
            action: 'WRITE_MARGIN_TYPE',
            symbol,
            caller: 'coin.setMarginType',
        }, 'v1/marginType', {
            symbol,
            marginType: normalized,
        }, 'POST');
        console.log(`margin type set :: uid:${uid}, symbol:${symbol}, marginType:${normalized}`, res);
        return { status: true, marginType: normalized, noChange: false };
    }catch(error){
        const info = extractBinanceError(error);
        const rawMessage = String(info.msg || '');
        if(
            info.code === -4046 ||
            rawMessage.includes('No need to change margin type')
        ){
            return { status: true, marginType: normalized, noChange: true };
        }

        if(
            info.code === -4048 ||
            rawMessage.includes('Margin type cannot be changed if there exists position')
        ){
            return {
                status: true,
                marginType: normalized,
                noChange: true,
                lockedByPosition: true,
            };
        }

        if(
            info.code === -4047 ||
            rawMessage.includes('Margin type cannot be changed if there exists open orders')
        ){
            return {
                status: false,
                marginType: normalized,
                noChange: true,
                lockedByOpenOrders: true,
                errorCode: info.code,
                errorMessage: info.msg,
            };
        }

        if(
            info.code === -4168 ||
            rawMessage.includes('Unable to adjust to isolated-margin mode under the Multi-Assets mode')
        ){
            return {
                status: false,
                marginType: normalized,
                noChange: true,
                blockedByAccountMode: true,
                errorCode: info.code,
                errorMessage: info.msg,
            };
        }

        const logKey = `setMarginType:${uid}:${symbol}:${normalized}:${info.code || 'unknown'}`;
        if(shouldEmitThrottledLog(logKey)){
            console.log(`setMarginType failed :: uid:${uid}, symbol:${symbol}, marginType:${normalized}, code:${info.code}, msg:${info.msg}`);
        }
        return {
            status: false,
            marginType: normalized,
            errorCode: info.code,
            errorMessage: info.msg,
        };
    }
}

const ensureMarginAndLeverage = async (uid, symbol, marginType, leverage) => {
    if(!uid || !symbol){
        return { status: false, skipped: true };
    }

    if(!(await ensureBinanceApiClient(uid))){
        return { status: false, skipped: true };
    }

    const marginResult = {
        status: true,
        skipped: true,
        marginType: normalizeMarginType(marginType),
        forcedCrossOnly: true,
    };

    const normalizedLeverage = Math.trunc(Number(leverage || 0));
    let leverageResult = { status: false, skipped: true, leverage: normalizedLeverage };
    if(normalizedLeverage > 0){
        try{
            await privateFuturesClientWrite({
                uid,
                action: 'WRITE_LEVERAGE',
                symbol,
                caller: 'coin.ensureMarginAndLeverage',
            }, 'v1/leverage', {
                symbol,
                leverage: normalizedLeverage,
            }, 'POST');
            leverageResult = { status: true, leverage: normalizedLeverage };
        }catch(error){
            const info = extractBinanceError(error);
            console.log(`setLeverage failed :: uid:${uid}, symbol:${symbol}, leverage:${normalizedLeverage}, code:${info.code}, msg:${info.msg}`);
            leverageResult = {
                status: false,
                leverage: normalizedLeverage,
                errorCode: info.code,
                errorMessage: info.msg,
            };
        }
    }

    return {
        status: Boolean(marginResult?.status || leverageResult?.status),
        marginType: marginResult,
        leverage: leverageResult,
    };
}

const getAssetMode = async () => {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = sign(query);

    const url = `${BASE_URL}/fapi/v2/account?${query}&signature=${signature}`;

    const res = await axios.get(url, {
        headers: { "X-MBX-APIKEY": API_KEY }
    });

    return res.data.multiAssetsMargin;
}

  
exports.init = async (options = {}) => {
    const enablePublicFeeds = options.enablePublicFeeds !== false;
    const enableUserStreams = options.enableUserStreams !== false;
    const enableAccountPolling = options.enableAccountPolling !== false;
    const enableSocket = options.enableSocket !== false;
    const enableCandleSchedules = options.enableCandleSchedules !== false;

    if(enablePublicFeeds){
        getTick();
    }

    if(enableAccountPolling){
        getUserBalance();
    }

    if(enableUserStreams){
        dbcon.DBCall(`CALL SP_A_MEMBER_KEY_ALL_GET()`).then((keyList)=>{
            keyList.forEach((k)=>{
                if(isExcludedRuntimeUid(k.id)){
                    markBinanceRuntimeExcluded(k.id);
                    return;
                }
                initAPI(k.id, k.appKey, k.appSecret, {
                    enableUserStream: true,
                });
            });
        }).catch((eee)=>{
            console.log('zzzzzzzzzzzzz');
            console.log(eee);
        });
    }

    if(enableSocket){
        socketInit();
    }

    if(enableCandleSchedules){
        schedule.scheduleJob("30 0 */1 * * *", ()=>{
            getCandle('1h');
        });
        schedule.scheduleJob("30 0 */4 * * *", ()=>{
            getCandle('4h');
        });
        schedule.scheduleJob("0 0 0 * * *", ()=>{
            getCandle('1d');
        });
    }

    // await sleep(1000);
    // setInterval(() => {
    //     io.wsOneSend(1,'live-error', {st: true});
    // }, 5000);




    

    // console.log('# sendReq START');
    // exports.sendReq('BTCUSDT', 'BUY', 10, 10000, 10000, 1, 1, 1);

    // const result = await binance.Options;
    // const positions = await binance.futuresPositionRisk();
    // console.log(positions);

    // const profitData = await binance.futuresOrder(
    //     'TAKE_PROFIT_MARKET',
    //     'SELL',
    //     'BTCUSDT',
    //     '0.003',
    //     null,
    //     {
    //         type: 'TAKE_PROFIT_MARKET',
    //         stopPrice: 119203,
    //         // reduceOnly: true,
    //         positionSide: 'SELL',
    //         newClientOrderId: 'PROFIT_1_1_731265221617',
    //     }
    // )

    // exports.sendEnter('BTCUSDT', 'BUY', 20, 20, 1, 1)
    
}


exports.getUserPrice = async () => {

    setInterval(async () => {
        try{
            dbcon.DBCall(`CALL SP_A_MEMBER_KEY_ALL_GET()`).then((keyList)=>{
                keyList.forEach((k)=>{
                    const uid = k.id;
                    if(isExcludedRuntimeUid(uid)){
                        markBinanceRuntimeExcluded(uid);
                        return;
                    }
                    if(isBinanceClientRetryBlocked(uid)){
                        return;
                    }

                    if(!binance[uid]){
                        initAPI(uid, k.appKey, k.appSecret, {
                            enableUserStream: false,
                        });
                        return;
                    }

                    privateFuturesSignedRequest(uid, '/fapi/v3/balance', {}, 'GET').then((reData)=>{
    
                        reData.forEach((i)=>{
                            if(i.asset == 'USDT'){
                                console.log(`USER PRICE BALANCE uid:${uid} availableBalance:${i.availableBalance}`);
                            }
                        })
                    }).catch((err)=>{
                        handleBinanceClientError('getUserPrice', uid, err, 'accountBalance');
                    });;
                });
            }).catch((eee)=>{
                console.log('ERR :: getUserPrice member keys');
                console.log(eee);
            });
    
            
        }catch(e){
            console.log('ERR :: getUserPrice loop');
            console.log(e);
        }
    }, 1000); // 30遺?

    
    

}

// exports.getAccount = async () => {
//     try{

//         // console.info(await binance.futuresAccount());

//         const reData = await binance.futuresAccount();

//         for(let i=0;i<reData.assets.length;i++){
//             if(reData.assets[i].asset == 'USDT'){
//                 // {
//                 //     accountAlias: 'SgTifWuXXqmYTi',
//                 //     asset: 'USDC',
//                 //     balance: '0.00000000',
//                 //     crossWalletBalance: '0.00000000',
//                 //     crossUnPnl: '0.00000000',
//                 //     availableBalance: '213.86337179',
//                 //     maxWithdrawAmount: '0.00000000',
//                 //     marginAvailable: true,
//                 //     updateTime: 0
//                 // }

//                 reData.asset = reData.assets[i];
//                 break;
//             }
//         }

//         return reData;


//     }catch(e){
//         console.log('ERR :: getAccount !! -------------');
//         console.log(e);
//     }
// }

exports.sendForcing = async (type = null, symbol = null, side = null, userQty = null, uid = null, pid = null, r_tid = null, limitST = 'N') => {
    // type :: MANUAL / TIME / REVERSE (legacy FORCING still accepted for compatibility)

    const sendData = {
        status: false,
        errCode: null,
        errMsg: null,
        errAction: null,
    }

    if(!(await ensureBinanceApiClient(uid))){
        sendData.errCode = -90001;
        sendData.errMsg = 'binance client not initialized';
        sendData.errAction = 'manual';
        exports.msgAdd('sendForcing', String(sendData.errCode), sendData.errMsg, uid, pid, r_tid, symbol, side);
        return sendData;
    }
    
    const clientOrderId = getCloseClientOrderId(type, uid, pid, r_tid);
    let submittedCloseOrderId = null;
    let positionSide = null;
    let closeQty = 0;

    try{
        const itemInfo = await loadLivePlaySnapshot(pid);
        if(!itemInfo){
            const mismatchData = buildStateMismatchResponse(-90003, 'live play not found before close order');
            exports.msgAdd('sendForcing', String(mismatchData.errCode), mismatchData.errMsg, uid, pid, r_tid, symbol, side);
            return mismatchData;
        }

        if(!LIVE_CLOSE_ALLOWED_STATES.has(itemInfo.status)){
            const mismatchData = buildStateMismatchResponse(
                -90004,
                `live play state mismatch before close order:${itemInfo.status}`
            );
            exports.msgAdd('sendForcing', String(mismatchData.errCode), mismatchData.errMsg, uid, pid, r_tid, symbol, side);
            return mismatchData;
        }

        positionSide = getSignalPositionSide(side);
        const exchangeSnapshot = positionSide
            ? await getExchangePositionSnapshot(uid, symbol)
            : null;
        if(exchangeSnapshot?.readOk === false){
            const mismatchData = buildStateMismatchResponse(
                -90006,
                `signal close blocked because exchange position read failed:${exchangeSnapshot.readError || 'UNKNOWN'}`
            );
            exports.msgAdd('sendForcing', String(mismatchData.errCode), mismatchData.errMsg, uid, pid, r_tid, symbol, side);
            return mismatchData;
        }
        const exchangeAggregateQty = positionSide
            ? getExchangeQtyForPositionSide(exchangeSnapshot, positionSide)
            : 0;
        const closeQtyGuard = await resolvePidOwnedCloseQtyGuard({
            uid,
            pid,
            strategyCategory: 'signal',
            symbol,
            positionSide,
            requestedQty: Number(userQty || 0),
            exchangeAggregateQty,
            clientOrderId,
            reason: `signal-close:${type || 'UNKNOWN'}`,
        });
        closeQty = Number(closeQtyGuard?.finalCloseQty || 0);
        if(!(closeQty > 0)){
            const mismatchData = buildStateMismatchResponse(
                -90005,
                `signal close qty blocked before close order:${pid}, reason:${closeQtyGuard?.reason || 'UNKNOWN'}`
            );
            exports.msgAdd('sendForcing', String(mismatchData.errCode), mismatchData.errMsg, uid, pid, r_tid, symbol, side);
            return mismatchData;
        }

        exports.msgAdd(
            'sendForcingDispatch',
            String(type || 'UNKNOWN'),
            `caller:${getRuntimeCallerHint()}, status:${itemInfo.status}, qty:${closeQty}, side:${side}, symbol:${symbol}`,
            uid,
            pid,
            r_tid,
            symbol,
            side
        );
        console.log(
            `[SEND_FORCING_DISPATCH] type:${type}, caller:${getRuntimeCallerHint()}, status:${itemInfo.status}, qty:${closeQty}, side:${side}, symbol:${symbol}, pid:${pid}`
        );

        if(pid){
            await cancelBoundExitOrders(uid, symbol, pid);
        }

        const closeOrder = await submitFuturesOrder(
            {
                uid,
                pid,
                strategyCategory: 'signal',
                action: 'WRITE_CLOSE_MARKET',
                caller: 'coin.sendForcing',
                clientOrderId,
            },
            'MARKET',
            side == 'BUY' ? 'SELL' : 'BUY',
            symbol,
            closeQty,
            null,
            {
                positionSide: side == 'BUY' ? 'LONG' : 'SHORT',
                newClientOrderId: clientOrderId
            }
        )

        submittedCloseOrderId = closeOrder.orderId;
        dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_OID_UPDATE(?,?)`,[pid, closeOrder.orderId]);
        await touchSignalPositionOwnership({
            uid,
            pid,
            symbol,
            signalSide: side,
            ownerState: 'EXIT_PENDING',
            sourceClientOrderId: clientOrderId,
            sourceOrderId: closeOrder.orderId,
            note: `close-dispatch:${type || 'UNKNOWN'}`,
        });
        if(positionSide){
            await pidPositionLedger.replaceExitReservations({
                uid,
                pid,
                strategyCategory: 'signal',
                symbol,
                positionSide,
                reservations: [
                    {
                        clientOrderId,
                        sourceOrderId: closeOrder.orderId,
                        actualOrderId: closeOrder.orderId,
                        reservationKind: `MARKET_${String(type || 'UNKNOWN').toUpperCase()}`,
                        reservedQty: closeQty,
                        note: `pid:${pid}, symbol:${symbol}, market-close:${type || 'UNKNOWN'}`,
                    },
                ],
            });
        }
        sendData.status = true;
        return sendData;
    }catch(e){
        const errorInfo = extractBinanceError(e);
        sendData.errCode = errorInfo.code;
        sendData.errMsg = formatBinanceErrorGuideClean(errorInfo.msg, errorInfo.code, classifyBinanceError(errorInfo.code));
        sendData.errAction = classifyBinanceError(errorInfo.code);

        if(sendData.errAction === 'retry'){
            try{
                const recoveredOrder = await recoverOrderAfterRetryError({
                    uid,
                    symbol,
                    orderId: submittedCloseOrderId || r_tid,
                    clientOrderId,
                });

                if(isRecoverableExchangeOrder(recoveredOrder)){
                    sendData.status = true;
                    sendData.errMsg = toRuntimeMessage(sendData.errMsg, describeOrderForLog(recoveredOrder));
                    return sendData;
                }

                if(closeQty > 0){
                    const retriedOrder = await submitFuturesOrder(
                        {
                            uid,
                            pid,
                            strategyCategory: 'signal',
                            action: 'WRITE_CLOSE_MARKET',
                            caller: 'coin.sendForcing.retry',
                            clientOrderId,
                        },
                        'MARKET',
                        side == 'BUY' ? 'SELL' : 'BUY',
                        symbol,
                        closeQty,
                        null,
                        {
                            positionSide: side == 'BUY' ? 'LONG' : 'SHORT',
                            newClientOrderId: clientOrderId
                        }
                    );

                    submittedCloseOrderId = retriedOrder.orderId;
                    dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_OID_UPDATE(?,?)`, [pid, retriedOrder.orderId]);
                    await touchSignalPositionOwnership({
                        uid,
                        pid,
                        symbol,
                        signalSide: side,
                        ownerState: 'EXIT_PENDING',
                        sourceClientOrderId: clientOrderId,
                        sourceOrderId: retriedOrder.orderId,
                        note: `close-retry:${type || 'UNKNOWN'}`,
                    });
                    if(positionSide){
                        await pidPositionLedger.replaceExitReservations({
                            uid,
                            pid,
                            strategyCategory: 'signal',
                            symbol,
                            positionSide,
                            reservations: [
                                {
                                    clientOrderId,
                                    sourceOrderId: retriedOrder.orderId,
                                    actualOrderId: retriedOrder.orderId,
                                    reservationKind: `MARKET_${String(type || 'UNKNOWN').toUpperCase()}`,
                                    reservedQty: closeQty,
                                    note: `pid:${pid}, symbol:${symbol}, market-close-retry:${type || 'UNKNOWN'}`,
                                },
                            ],
                        });
                    }
                    sendData.status = true;
                    sendData.errMsg = toRuntimeMessage(sendData.errMsg, `retryOrderId:${retriedOrder.orderId}`);
                    return sendData;
                }

                sendData.errMsg = toRuntimeMessage(sendData.errMsg, describeOrderForLog(recoveredOrder));
            }catch(retryError){
                const retryInfo = extractBinanceError(retryError);
                sendData.errMsg = toRuntimeMessage(
                    sendData.errMsg,
                    `retryFailed:${retryInfo.code}:${retryInfo.msg}`
                );
            }
        }

        if(sendData.errAction === 'requery'){
            try{
                const queriedOrder = await findExchangeOrder(uid, symbol, {
                    orderId: submittedCloseOrderId || r_tid,
                    clientOrderId,
                });

                if(isRecoverableExchangeOrder(queriedOrder)){
                    if(positionSide && closeQty > 0){
                        await pidPositionLedger.replaceExitReservations({
                            uid,
                            pid,
                            strategyCategory: 'signal',
                            symbol,
                            positionSide,
                            reservations: [
                                {
                                    clientOrderId,
                                    sourceOrderId: queriedOrder.orderId,
                                    actualOrderId: queriedOrder.orderId,
                                    reservationKind: `MARKET_${String(type || 'UNKNOWN').toUpperCase()}`,
                                    reservedQty: closeQty,
                                    note: `pid:${pid}, symbol:${symbol}, market-close-requery:${type || 'UNKNOWN'}`,
                                },
                            ],
                        });
                    }
                    sendData.status = true;
                    sendData.errMsg = toRuntimeMessage(sendData.errMsg, describeOrderForLog(queriedOrder));
                    return sendData;
                }

                sendData.errMsg = toRuntimeMessage(sendData.errMsg, describeOrderForLog(queriedOrder));
            }catch(queryError){
                const queryInfo = extractBinanceError(queryError);
                sendData.errMsg = toRuntimeMessage(
                    sendData.errMsg,
                    `requeryFailed:${queryInfo.code}:${queryInfo.msg}`
                );
            }
        }

        console.log(`ERR :: sendForcing : ${sendData.errMsg}`);
        exports.msgAdd(
            'sendForcing',
            String(sendData.errCode),
            toRuntimeMessage(`[${sendData.errAction}] ${sendData.errMsg}`, `pid:${pid}, tid:${r_tid}`),
            uid,
            pid,
            r_tid,
            symbol,
            side
        );

        return sendData;

    }
}





exports.sendEnter = async (symbol = null, side = null, lv = null, userMargin = null, uid = null, pid = null, limitST = 'N', enterPrice = null) => {
    if(!symbol){
        return false;
    }

    const sendData = {
        status: false,
        errCode: null,
        errMsg: null,
        errAction: null,
    }

    if(!(await ensureBinanceApiClient(uid))){
        sendData.errCode = -90001;
        sendData.errMsg = 'binance client not initialized';
        sendData.errAction = 'manual';
        exports.msgAdd('sendEnter', String(sendData.errCode), sendData.errMsg, uid, pid, null, symbol, side);
        await resetLivePlayToReadyIfStatus(pid, ['EXACT_WAIT']);
        return sendData;
    }

    let extData = null;
    let minQty = 0;
    let finalQty = null;
    const clientOrderId = getEnterClientOrderId(uid, pid);
    const enterLockKey = pid ? `live:enter:${pid}` : null;
    const enterLockConnection = enterLockKey ? await acquireDbNamedLock(enterLockKey, 0) : null;
    let signalPositionOwnershipReserved = false;
    let keepSignalPositionOwnership = false;

    if(enterLockKey && !enterLockConnection){
        sendData.errCode = -90007;
        sendData.errMsg = 'live enter dispatch lock busy';
        sendData.errAction = 'manual';
        exports.msgAdd('sendEnter', String(sendData.errCode), sendData.errMsg, uid, pid, null, symbol, side);
        return sendData;
    }

    try{
        const itemInfo = await loadLivePlaySnapshot(pid);
        if(!itemInfo){
            const mismatchData = buildStateMismatchResponse(-90005, 'live play not found before enter order');
            exports.msgAdd('sendEnter', String(mismatchData.errCode), mismatchData.errMsg, uid, pid, null, symbol, side);
            return mismatchData;
        }

        if(!LIVE_ENTER_ALLOWED_STATES.has(itemInfo.status)){
            const mismatchData = buildStateMismatchResponse(
                -90006,
                `live play state mismatch before enter order:${itemInfo.status}`
            );
            exports.msgAdd('sendEnter', String(mismatchData.errCode), mismatchData.errMsg, uid, pid, null, symbol, side);
            return mismatchData;
        }

        const ownershipReservation = await acquireSignalPositionOwnership({
            uid,
            pid,
            symbol,
            signalSide: side,
            strategyName: itemInfo.a_name || itemInfo.signalName || null,
            sourceClientOrderId: clientOrderId,
            ownerState: 'ENTRY_PENDING',
            note: 'sendEnter dispatch',
        });
        if(!ownershipReservation.ok){
            const conflictData = buildStateMismatchResponse(
                -90009,
                ownershipReservation.conflict
                    ? `position bucket owned by pid:${ownershipReservation.owner?.ownerPid || 'UNKNOWN'} category:${ownershipReservation.owner?.ownerStrategyCategory || 'UNKNOWN'}`
                    : `position bucket reservation failed:${ownershipReservation.reason || 'UNKNOWN'}`
            );
            exports.msgAdd('sendEnter', String(conflictData.errCode), conflictData.errMsg, uid, pid, null, symbol, side);
            await resetLivePlayToReadyIfStatus(pid, ['EXACT_WAIT']);
            return conflictData;
        }
        signalPositionOwnershipReserved = true;

        // 1. 최소 주문 규칙 조회
        const orderRules = await loadSymbolOrderRules(uid, symbol);
        if(!orderRules){
            throw new Error(`symbol rule not found:${symbol}`);
        }
        minQty = Number(orderRules.minQty || 0);
        const stepSize = Number(orderRules.stepSize || 0);

        // 2. ?꾩옱 媛寃?媛?몄삤湲?
        const priceData = await binance[uid].futuresMarkPrice(symbol);
        const price = parseFloat(priceData.markPrice);

        // 3. ?섎웾 怨꾩궛
        // const notionalMin = 5; // 理쒖냼 二쇰Ц 湲덉븸
        // let rawQty = notionalMin / price;
        let rawQty = (userMargin * lv) / price;

        // 4. stepSize??留욎떠 ?섎웾 議곗젙
        const adjustToStepSize = (qty, step, minQty) => {
            const precision = step.toString().split('.')[1]?.length || 0;
            const floored = Math.floor(qty / step) * step;
            return Math.max(minQty, floored).toFixed(precision);
        };

        await ensureMarginAndLeverage(uid, symbol, itemInfo.marginType, lv);


        finalQty = adjustToStepSize(rawQty, stepSize, minQty);
        console.log(`?뱦id:${uid} ?꾩옱媛: ${price}, 怨꾩궛???섎웾: ${rawQty}, 理쒖쥌 ?섎웾: ${finalQty}, 諛⑺뼢: ${side}`);
        // 二쇰Ц ?ㅽ뻾

        extData = await submitFuturesOrder(
            {
                uid,
                pid,
                strategyCategory: 'signal',
                action: 'WRITE_CREATE_ORDER',
                caller: 'coin.sendEnter',
                clientOrderId,
            },
            'MARKET',
            side == 'BUY' ? 'BUY' : 'SELL',
            symbol,
            finalQty,
            null,
            {
                positionSide: side == 'BUY' ? 'LONG' : 'SHORT',
                newClientOrderId: clientOrderId,
            }
        )
        
        // const profitData = await binance.futuresOrder(
        //     'TAKE_PROFIT_MARKET',
        //     'SELL',
        //     'BTCUSDT',
        //     '0.003',
        //     null,
        //     {
        //         type: 'TAKE_PROFIT_MARKET',
        //         stopPrice: 119203,
        //         // reduceOnly: true,
        //         positionSide: 'SELL',
        //         newClientOrderId: 'PROFIT_1_1_731265221617',
        //     }
        // )


        // origQty 二쇰Ц ?섎웾
        // cumQty ?꾩쟻 泥닿껐 ?섎웾

        // const positionSize = parseFloat(extData.avgPrice) * parseFloat(extData.executedQty);

        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_SET(?,?,?)`, [
            pid,
            extData.orderId,
            minQty,
            // positionSize,
        ]);
        await touchSignalPositionOwnership({
            uid,
            pid,
            symbol,
            signalSide: side,
            ownerState: 'ENTRY_PENDING',
            sourceClientOrderId: clientOrderId,
            sourceOrderId: extData.orderId,
            note: 'exchange order accepted',
        });

        if(extData){
            sendData.status = true;
            keepSignalPositionOwnership = true;
        }

        return sendData;
    }catch(e){
        const errorInfo = extractBinanceError(e);
        sendData.errCode = errorInfo.code;
        sendData.errMsg = formatBinanceErrorGuideClean(errorInfo.msg, errorInfo.code, classifyBinanceError(errorInfo.code));
        sendData.errAction = classifyBinanceError(errorInfo.code);

        let r_tid_legacy = null;
        if(extData && extData?.orderId){
            r_tid_legacy = extData?.orderId; 
        }

        if(sendData.errAction === 'retry'){
            try{
                const recoveredOrder = await recoverOrderAfterRetryError({
                    uid,
                    symbol,
                    orderId: extData?.orderId || null,
                    clientOrderId,
                });

                if(isRecoverableExchangeOrder(recoveredOrder)){
                    await syncEnterOrderFromQuery(uid, pid, minQty, recoveredOrder);
                    sendData.status = true;
                    keepSignalPositionOwnership = true;
                    sendData.errMsg = toRuntimeMessage(sendData.errMsg, describeOrderForLog(recoveredOrder));
                    return sendData;
                }

                if(finalQty){
                    const retryOrderOptions = {
                        positionSide: side == 'BUY' ? 'LONG' : 'SHORT',
                        newClientOrderId: clientOrderId,
                    };

                    const retriedOrder = await submitFuturesOrder(
                        {
                            uid,
                            pid,
                            strategyCategory: 'signal',
                            action: 'WRITE_CREATE_ORDER',
                            caller: 'coin.sendEnter.retry',
                            clientOrderId,
                        },
                        'MARKET',
                        side == 'BUY' ? 'BUY' : 'SELL',
                        symbol,
                        finalQty,
                        null,
                        retryOrderOptions
                    );

                    extData = retriedOrder;
                    r_tid_legacy = retriedOrder?.orderId || r_tid_legacy;

                    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_SET(?,?,?)`, [
                        pid,
                        retriedOrder.orderId,
                        minQty,
                    ]);
                    await touchSignalPositionOwnership({
                        uid,
                        pid,
                        symbol,
                        signalSide: side,
                        ownerState: 'ENTRY_PENDING',
                        sourceClientOrderId: clientOrderId,
                        sourceOrderId: retriedOrder.orderId,
                        note: 'retry order accepted',
                    });

                    sendData.status = true;
                    keepSignalPositionOwnership = true;
                    sendData.errMsg = toRuntimeMessage(sendData.errMsg, `retryOrderId:${retriedOrder.orderId}`);
                    return sendData;
                }

                sendData.errMsg = toRuntimeMessage(sendData.errMsg, describeOrderForLog(recoveredOrder));
            }catch(retryError){
                const retryInfo = extractBinanceError(retryError);
                sendData.errMsg = toRuntimeMessage(
                    sendData.errMsg,
                    `retryFailed:${retryInfo.code}:${retryInfo.msg}`
                );
            }
        }

        if(sendData.errAction === 'requery'){
            try{
                const queriedOrder = await findExchangeOrder(uid, symbol, {
                    orderId: extData?.orderId || null,
                    clientOrderId,
                });

                if(isRecoverableExchangeOrder(queriedOrder)){
                    await syncEnterOrderFromQuery(uid, pid, minQty, queriedOrder);
                    sendData.status = true;
                    keepSignalPositionOwnership = true;
                    sendData.errMsg = toRuntimeMessage(sendData.errMsg, describeOrderForLog(queriedOrder));
                    return sendData;
                }

                sendData.errMsg = toRuntimeMessage(sendData.errMsg, describeOrderForLog(queriedOrder));
            }catch(queryError){
                const queryInfo = extractBinanceError(queryError);
                sendData.errMsg = toRuntimeMessage(
                    sendData.errMsg,
                    `requeryFailed:${queryInfo.code}:${queryInfo.msg}`
                );
            }
        }

        console.log(`ERR :: sendEnter : ${sendData.errMsg}`);

        if(extData && extData?.orderId && Number(extData?.executedQty || 0) > 0){
            let recoveredOrder = null;
            try{
                recoveredOrder = await findExchangeOrder(uid, symbol, {
                    orderId: extData.orderId,
                    clientOrderId,
                });
            }catch(recoveryQueryError){
            }

            const fallbackRecoveredOrder = {
                orderId: extData.orderId,
                symbol,
                status: Number(extData.executedQty || 0) >= Number(extData.origQty || extData.executedQty || 0)
                    ? 'FILLED'
                    : 'PARTIALLY_FILLED',
                executedQty: extData.executedQty || extData.origQty || 0,
                origQty: extData.origQty || extData.executedQty || 0,
                avgPrice: extData.avgPrice || extData.price || 0,
                price: extData.price || extData.avgPrice || 0,
            };

            try{
                await syncEnterOrderFromQuery(
                    uid,
                    pid,
                    minQty,
                    isRecoverableExchangeOrder(recoveredOrder) ? recoveredOrder : fallbackRecoveredOrder
                );
            }catch(recoverySyncError){
            }

            exports.msgAdd(
                'sendEnterRecovery',
                'ENTRY_RECOVERED',
                `pid:${pid}, symbol:${symbol}, reason:${sendData.errAction}, orderId:${extData.orderId}`,
                uid,
                pid,
                extData.orderId,
                symbol,
                side
            );
            sendData.status = true;
            keepSignalPositionOwnership = true;
            sendData.errMsg = toRuntimeMessage(sendData.errMsg, `entryRecovered:${extData.orderId}`);
            return sendData;
        }

        exports.msgAdd(
            'sendEnter',
            String(sendData.errCode),
            toRuntimeMessage(`[${sendData.errAction}] ${sendData.errMsg}`, `pid:${pid}, tid:${r_tid_legacy}`),
            uid,
            pid,
            r_tid_legacy,
            symbol,
            side
        );

        await resetLivePlayToReadyIfStatus(pid, ['EXACT_WAIT']);

        return sendData;

    }finally{
        if(signalPositionOwnershipReserved && !keepSignalPositionOwnership){
            await positionOwnership.releaseAllPositionBucketOwnersByPid({
                ownerPid: pid,
                ownerStrategyCategory: 'signal',
            });
        }
        await releaseDbNamedLock(enterLockConnection, enterLockKey);
    }
}

exports.ensurePublicMarketPrice = async (symbol) => {
    try{
        const current = dt.getPrice(symbol);
        if(current?.st){
            return current;
        }

        return await hydratePriceSlotFromBookTicker(symbol);
    }catch(error){
        return dt.getPrice(symbol);
    }
}


exports.msgAdd = async (
    fun = null,
    code = null,
    msg = null,
    uid = null,
    pid = null,
    tid = null,
    symbol = null,
    side = null
) => {
    const normalizedFun = fun == null ? null : String(fun).slice(0, 20);
    const normalizedCode = code == null ? null : String(code).slice(0, 20);
    const normalizedTid = tid == null ? null : String(tid).slice(0, 12);
    const normalizedMsg = msg == null ? null : String(msg);
    const dedupeKey = buildMsgDedupeKey({
        fun: normalizedFun,
        code: normalizedCode,
        msg: normalizedMsg,
        uid,
        pid,
        tid: normalizedTid,
        symbol,
        side,
    });
    const now = Date.now();

    pruneRecentMsgCache();

    if(recentMsgCache.has(dedupeKey) && (now - recentMsgCache.get(dedupeKey)) < MSG_DEDUPE_WINDOW_MS){
        return;
    }

    recentMsgCache.set(dedupeKey, now);

    if(DEBUG_RUNTIME_TRACE && ['timeExpiryClose', 'sendForcingDispatch', 'closeDispatchLive'].includes(normalizedFun)){
        const stack = new Error().stack
            ?.split('\n')
            .slice(2, 6)
            .map((line) => line.trim())
            .join(' | ');
        console.log(`[MSG_TRACE] fun:${normalizedFun}, code:${normalizedCode}, pid:${pid}, tid:${normalizedTid}, msg:${normalizedMsg}, stack:${stack}`);
    }
    dbcon.DBCall(`CALL SP_MSG_ADD(?,?,?,?,?,?,?,?)`, [
        normalizedFun,
        normalizedCode,
        normalizedMsg,
        uid,
        pid,
        normalizedTid,
        symbol,
        side,
    ]).then((re)=>{
        //?뚯폆 ?꾨떖 肄붾뱶
        if(io && uid){
            io.wsOneSend(uid,'live-error', {st: true});
        }
    }).catch((e)=>{
        console.log('ERR :: msgAdd', e);
    })
}

const getApiValidationMessageKo = (info = {}, action = null) => {
    const code = String(info.code || '').trim();
    const rawMessage = String(info.msg || info.message || '').trim();
    const combined = `${code} ${rawMessage} ${action || ''}`.toUpperCase();

    if(code === 'API_KEY_MISSING' || code === 'EMPTY_KEYS' || code === '-90021'){
        return 'API 키를 먼저 등록해 주세요.';
    }
    if(code === 'REQUEST_TIMEOUT' || combined.includes('TIMEOUT') || combined.includes('ECONNABORTED')){
        return '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
    }
    if(code === '-1021'){
        return 'Binance 서버 시간과 로컬 시간이 맞지 않습니다. 잠시 후 다시 시도해 주세요.';
    }
    if(code === '-2015' || combined.includes('INVALID API-KEY') || combined.includes('IP')){
        return 'Binance API 연결 검증에 실패했습니다. API 권한, IP 제한, Secret Key를 확인해 주세요.';
    }
    if(combined.includes('PERMISSION') || combined.includes('FUTURES')){
        return '선물 계정 정보를 읽을 수 없습니다. Futures 권한을 확인해 주세요.';
    }
    return 'Binance API 연결 검증에 실패했습니다. API 권한, IP 제한, Secret Key를 확인해 주세요.';
};

const getCleanApiValidationMessageKo = (info = {}, action = null) => {
    const code = String(info.code || '').trim();
    const rawMessage = String(info.msg || info.message || '').trim();
    const combined = `${code} ${rawMessage} ${action || ''}`.toUpperCase();
    if(code === 'API_KEY_MISSING' || code === 'EMPTY_KEYS' || code === '-90021'){
        return 'API 키를 먼저 등록해 주세요.';
    }
    if(code === 'REQUEST_TIMEOUT' || combined.includes('TIMEOUT') || combined.includes('ECONNABORTED')){
        return '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
    }
    if(code === 'BINANCE_PRIVATE_READ_CIRCUIT_OPEN' || code === 'BINANCE_UID_PRIVATE_READ_BACKOFF'){
        return 'Binance API 요청 제한 상태입니다. 제한 시간이 끝난 뒤 다시 검증해 주세요.';
    }
    if(code === '-1021'){
        return 'Binance 서버 시간과 로컬 시간이 맞지 않습니다. 잠시 후 다시 시도해 주세요.';
    }
    if(code === '-2015' || combined.includes('INVALID API-KEY') || combined.includes('IP')){
        return 'Binance API 연결 검증에 실패했습니다. API 권한, IP 제한, Secret Key를 확인해 주세요.';
    }
    if(combined.includes('PERMISSION') || combined.includes('FUTURES')){
        return '선물 계정 정보를 읽을 수 없습니다. Futures 권한을 확인해 주세요.';
    }
    return 'Binance API 연결 검증에 실패했습니다. API 권한, IP 제한, Secret Key를 확인해 주세요.';
};

const getApiValidationMessageKoSafe = (info = {}, action = null) => {
    const code = String(info.code || '').trim();
    const rawMessage = String(info.msg || info.message || '').trim();
    const combined = `${code} ${rawMessage} ${action || ''}`.toUpperCase();
    if(code === 'OK'){
        return '\u0042\u0069\u006e\u0061\u006e\u0063\u0065 \u0041\u0050\u0049 \uc5f0\uacb0 \uac80\uc99d\uc5d0 \uc131\uacf5\ud588\uc2b5\ub2c8\ub2e4.';
    }
    if(code === 'API_KEY_MISSING' || code === 'EMPTY_KEYS' || code === '-90021'){
        return '\u0041\u0050\u0049 \ud0a4\ub97c \uba3c\uc800 \ub4f1\ub85d\ud574 \uc8fc\uc138\uc694.';
    }
    if(code === 'REQUEST_TIMEOUT' || combined.includes('TIMEOUT') || combined.includes('ECONNABORTED')){
        return '\uc694\uccad \uc2dc\uac04\uc774 \ucd08\uacfc\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.';
    }
    if(code === 'BINANCE_PRIVATE_READ_CIRCUIT_OPEN' || code === 'BINANCE_UID_PRIVATE_READ_BACKOFF'){
        return '\u0042\u0069\u006e\u0061\u006e\u0063\u0065 \u0041\u0050\u0049 \uc694\uccad \uc81c\ud55c \uc0c1\ud0dc\uc785\ub2c8\ub2e4. \uc81c\ud55c \uc2dc\uac04\uc774 \uc9c0\ub09c \ub4a4 \ub2e4\uc2dc \uac80\uc99d\ud574 \uc8fc\uc138\uc694.';
    }
    if(code === '-1021'){
        return '\u0042\u0069\u006e\u0061\u006e\u0063\u0065 \uc11c\ubc84 \uc2dc\uac04\uacfc \ub85c\uceec \uc2dc\uac04\uc774 \ub9de\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4. \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.';
    }
    if(code === '-2015' || combined.includes('INVALID API-KEY') || combined.includes('IP')){
        return '\u0042\u0069\u006e\u0061\u006e\u0063\u0065 \u0041\u0050\u0049 \uc5f0\uacb0 \uac80\uc99d\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4. \u0041\u0050\u0049 \uad8c\ud55c, \u0049\u0050 \uc81c\ud55c, \u0053\u0065\u0063\u0072\u0065\u0074 \u004b\u0065\u0079\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.';
    }
    if(combined.includes('PERMISSION') || combined.includes('FUTURES')){
        return '\uc120\ubb3c \uacc4\uc815 \uc815\ubcf4\ub97c \uc77d\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \u0046\u0075\u0074\u0075\u0072\u0065\u0073 \uad8c\ud55c\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.';
    }
    return '\u0042\u0069\u006e\u0061\u006e\u0063\u0065 \u0041\u0050\u0049 \uc5f0\uacb0 \uac80\uc99d\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4. \u0041\u0050\u0049 \uad8c\ud55c, \u0049\u0050 \uc81c\ud55c, \u0053\u0065\u0063\u0072\u0065\u0074 \u004b\u0065\u0079\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.';
};

const validateProvidedBinanceKeysReadOnly = async (appKey, appSecret) => {
    if(!appKey || !appSecret){
        const messageKo = getApiValidationMessageKoSafe({ code: 'API_KEY_MISSING' });
        return {
            ok: false,
            code: 'API_KEY_MISSING',
            status: 'API_KEY_MISSING',
            action: 'register_credentials',
            messageKo,
            message: messageKo,
            secretReturned: false,
        };
    }
    if(!appKey || !appSecret){
        return {
            ok: false,
            code: 'API_KEY_MISSING',
            status: 'API_KEY_MISSING',
            action: 'register_credentials',
            messageKo: 'API 키를 먼저 등록해 주세요.',
            message: 'API 키를 먼저 등록해 주세요.',
            secretReturned: false,
        };
    }

    try{
        binanceReadGuard.assertPrivateRequestAllowed({
            uid: 'validation',
            endpoint: '/fapi/v3/account',
            method: 'GET',
        });
        const revealedSecret = credentialSecrets.revealSecret(appSecret);
        await syncFuturesServerTime(false).catch(() => {});
        const signedQuery = buildSignedQuery(revealedSecret, {
            recvWindow: 10000,
            timestamp: getFuturesTimestamp(),
        });
        const response = await axios({
            method: 'GET',
            url: `${FUTURES_BASE_URL}/fapi/v3/account?${signedQuery}`,
            timeout: 10000,
            headers: {
                'X-MBX-APIKEY': appKey,
            },
        });

        binanceReadGuard.recordPrivateRequestSuccess({
            uid: 'validation',
            endpoint: '/fapi/v3/account',
            method: 'GET',
        });
        const successMessageKo = getApiValidationMessageKoSafe({ code: 'OK', message: 'connected' });
        return {
            ok: true,
            code: 'OK',
            status: 'CONNECTED',
            messageKo: successMessageKo,
            message: successMessageKo,
            futuresAccountRead: Boolean(response?.data),
            secretReturned: false,
        };
        const messageKo = 'Binance API 연결 검증에 성공했습니다.';
        return {
            ok: true,
            code: 'OK',
            status: 'CONNECTED',
            messageKo: 'Binance API 연결 검증에 성공했습니다.',
            message: 'Binance API 연결 검증에 성공했습니다.',
            futuresAccountRead: Boolean(response?.data),
            secretReturned: false,
        };
    }catch(error){
        binanceReadGuard.recordPrivateRequestFailure({
            uid: 'validation',
            endpoint: '/fapi/v3/account',
            method: 'GET',
            error,
        });
        const info = extractBinanceError(error);
        const guardCode = error?.code === 'BINANCE_PRIVATE_READ_CIRCUIT_OPEN'
            || error?.code === 'BINANCE_UID_PRIVATE_READ_BACKOFF'
            ? error.code
            : null;
        const action = classifyBinanceError(guardCode || info.code);
        const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''));
        const code = guardCode || (isTimeout ? 'REQUEST_TIMEOUT' : info.code);
        const messageKo = getApiValidationMessageKoSafe({ ...info, code }, action);
        return {
            ok: false,
            code,
            status: code === 'REQUEST_TIMEOUT' ? 'TIMEOUT' : 'VALIDATION_FAILED',
            action,
            messageKo,
            message: messageKo,
            binanceCode: info.code || null,
            binanceMessage: info.msg || null,
            secretReturned: false,
        };
    }
};

exports.validateMemberApiKeys = async (appKey, appSecret) => {
    return validateProvidedBinanceKeysReadOnly(appKey, appSecret);
    if(!appKey || !appSecret){
        return {
            ok: false,
            code: 'EMPTY_KEYS',
            message: 'API Key? Secret Key瑜?紐⑤몢 ?낅젰??二쇱꽭??',
        };
    }

    try{
        const revealedSecret = credentialSecrets.revealSecret(appSecret);
        const client = new Binance().options({
            APIKEY: appKey,
            APISECRET: revealedSecret,
            test: TEST_MODE,
            reconnect: true,
            verbose: false,
        });

        await client.futuresBalance();

        return {
            ok: true,
            code: 'OK',
            message: '諛붿씠?몄뒪 ?좊Ъ API 寃利앹씠 ?꾨즺?섏뿀?듬땲??',
        };
    }catch(error){
        const info = extractBinanceError(error);
        const action = classifyBinanceError(info.code);
        return {
            ok: false,
            code: info.code,
            action,
            message: formatBinanceErrorGuideClean(
                info.msg || '諛붿씠?몄뒪 API 寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎.',
                info.code,
                action
            ),
        };
    }
}

exports.getBinanceReadGuardSnapshot = () => binanceReadGuard.getStateSnapshot();

exports.refreshMemberApi = async (uid, appKey, appSecret) => {
    if(!uid || !appKey || !appSecret){
        return false;
    }

    if(isExcludedRuntimeUid(uid)){
        markBinanceRuntimeExcluded(uid);
        return false;
    }

    await cleanupBinanceClientRuntime(uid);
    delete binanceInitRetryAt[uid];

    return initAPI(uid, appKey, appSecret, {
        enableUserStream: isRuntimeOwnerProcess(),
    });
}

