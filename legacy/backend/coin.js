const WebSocket = require('ws');
const axios = require('axios');
const dbcon = require("./dbcon");
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const dt = require("./data");
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

let io = null;

const symbolList = [
    'BTCUSDT',  //1
    'ETHUSDT',  //2
    'XRPUSDT',
    'SOLUSDT',
    'DOGEUSDT',
]

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

const sleep = (ms) => {
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

const initAPI = async (uid, APP_KEY, APP_SECRET) => {
    // console.log(`START initAPI ID:${uid} !!`);
    try{
        binance[uid] = new Binance().options({
            APIKEY: APP_KEY,
            APISECRET: APP_SECRET,
            useServerTime: true,
            recvWindow : 60000,
            test: TEST_MODE, // if you want to use the sandbox/testnet
            
            futures: true,
            hedgeMode: true,
        });
    
        let { listenKey } = await binance[uid].futuresGetDataStream();
        
        const ws = new WebSocket(`wss://fstream.binance.com/ws/${listenKey}`);
        ws.on('message', (msg) => {
            const data = JSON.parse(msg);
            if (data.e === 'ORDER_TRADE_UPDATE') {
                reOrderGet(uid, data);
            }
        });
    
        setInterval(async () => {
            await binance[uid].futuresKeepDataStream({listenKey});
        }, 30 * 60 * 1000); // 30분
    
    
        binance[uid].futuresPositionSideDual().then((re)=>{
            if(!re.dualSidePosition){
                binance[uid].futuresChangePositionSideDual(true);
            }
        });

        console.log(`END initAPI ID:${uid} ::: ${listenKey}`);
    }catch(e){
        binance[uid] = null;
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
        if(
            re.symbol == 'BTCUSDT' || 
            re.symbol == 'ETHUSDT' || 
            re.symbol == 'XRPUSDT' || 
            re.symbol == 'SOLUSDT' ||
            re.symbol == 'DOGEUSDT'
        ){
            dt.price[re.symbol] = re;

            // if(re.symbol == 'BTCUSDT'){
            //     console.log(re.bestBid, re.bestAsk);
            // }
        }
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
                    if(!binance[uid]){
                        initAPI(uid, k.appKey, k.appSecret);
                        return;
                    }
                    
                    binance[uid].futuresBalance().then((reData)=>{
                        reData.forEach((i)=>{
                            if(i.asset == 'USDT'){
                                dbcon.DBCall(`CALL SP_LIVE_PLAY_PRICE_SET(?,?)`,[uid, i.availableBalance]);
                            }
                        })
                    }).catch((e)=>{
                               

                        const match = e.message.match(/\{.*\}/);

                        if (match) {
                            const json = JSON.parse(match[0]);
                            const code = json.code;
                            const msg = json.msg;

                            if(code == -1007){
                                ///
                            }else{
                                console.log('ERR :: getPrice  333 !! -------------');
                                console.log(e);     
                            }
                
                        } else {
                            console.log('ERR :: getPrice  222 !! -------------');
                            console.log(e); 
                        }
                
                    });
                });
            }).catch((eee)=>{
                console.log('ERR :: getPrice  111 !! -------------');
                console.log(eee);
            });
    
            
        }catch(e){
            console.log('ERR :: getPrice !! -------------');
            console.log(e);
        }
    }, 5000); // 30분
}


const reOrderGet = (uid, data) => {
    // {
    //     "e": "ORDER_TRADE_UPDATE",       // 이벤트 타입
    //     "T": 1624188164123,              // 이벤트 발생 시간
    //     "E": 1624188164123,              // 이벤트 수신 시간
    //     "o": {
    //         "s": "BTCUSDT",                // 종목
    //         "c": "myOrder123",             // 클라이언트가 지정한 주문 ID
    //         "S": "BUY",                    // 주문 방향 (BUY or SELL)
    //         "o": "MARKET",                 // 주문 종류 (LIMIT, MARKET, etc.)
    //         "f": "GTC",                    // 주문 유효시간
    //         "q": "0.001",                  // 주문 수량
    //         "p": "0",                      // 주문 가격 (시장가는 0)
    //         "ap": "29450.12",             // 평균 체결 가격
    //         "sp": "0",                     // stopPrice (스탑 주문 시)
    //         "x": "TRADE",                  // 실행 타입 (TRADE = 체결, NEW = 신규 등록 등)
    //         "X": "FILLED",                 // 현재 주문 상태
    //         "i": 1234567890,              // 주문 ID
    //         "l": "0.001",                  // 직전 체결 수량
    //         "z": "0.001",                  // 누적 체결 수량
    //         "L": "29450.12",              // 직전 체결 가격
    //         "n": "0.01",                   // 수수료
    //         "N": "USDT",                   // 수수료 자산
    //         "T": 1624188164000,            // 체결 시간
    //         "rp": "0.00",                  // 실현 손익 (Realized PnL)
    //         "b": "0",                      // 거래 전 포지션 마진
    //         "a": "0",                      // 거래 후 포지션 마진
    //         "m": false,                    // maker 여부
    //         "R": false,                    // reduceOnly 여부
    //         "wt": "CONTRACT_PRICE",        // 트리거 가격 기준
    //         "ot": "MARKET",                // 오리지널 주문 타입
    //         "ps": "BOTH",                  // 포지션 사이드 (BOTH, LONG, SHORT)
    //         "cp": false,                   // 조건부 주문 여부
    //         "pP": false,                   // 가격 보호 여부
    //         "si": 0,                       // 아이스버그 수량
    //         "ss": 0                        // 원래 숨김 수량
    //     }
    // }

    const type = data.e;

    // console.log(data);
    
    if(type != 'ORDER_TRADE_UPDATE'){
        return false;
    }

    
    

    

    const reData = data.o;
    const status = reData.x;        // 실행 타입 (TRADE = 체결, NEW = 신규 등록 등)
    const endStatus = reData.X;        // FILLED
    const oid = reData.i; 
    const cData = reData.c.split('_');
    const symbol = reData.s;
    const side = reData.S;          //BUY or SELL
    const tradeType = reData.o;     //MARKET, LIMIT
    const price = reData.ap;
    const qty = reData.z;         //수량
    const charge = reData.n;        //수수료
    const pnl = reData.rp;        //실현 손익 (Realized PnL)
    const updateTime = reData.T;        //체결 시간
    
    if(endStatus != 'FILLED'){
        return;
    }

    try{
        //첫주문
        if(cData[0] == 'NEW' && status == 'TRADE'){
            const uid = cData[1];
            const pid = cData[2];

            console.log(`NEW -------------`);
            console.log(`oid: ${oid}, uid: ${uid}, pid: ${pid}, price: ${price}, qty: ${qty}, charge: ${charge}, time: ${getKorTime(updateTime)}`);

            const positionSize = parseFloat(price) * parseFloat(qty);

            dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_EXACT_UPDATE(?,?,?,?,?,?)`,[pid, uid, price, qty, positionSize, charge]);

        }else if((cData[0] == 'PROFIT' || cData[0] == 'STOP' || cData[0] == 'TS') && status == 'TRADE'){
            const uid = cData[1];
            const pid = cData[2];
            const cid = cData[3];

            
            
            console.log(`CLOSE ------------- ${cData[0]}`);
            console.log(`oid: ${oid}, cid: ${cid}, uid: ${uid}, pid: ${pid}, price: ${price}, qty: ${qty}, charge: ${charge}, pnl: ${pnl}, time: ${getKorTime(updateTime)}`);


            // const re = exports.resultPrice(play.r_exactPrice, price, play.r_signalType);

            dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_NEW_GET(?)`,[pid]).then((re)=>{
                // cancelOrderAll2(symbol, re.r_pid, re.r_sid);

                let rePrice = re.r_exactPrice - price;
                let endType = cData[0] == 'TS' ? 'PROFIT' : cData[0];
                
                
                const positionSize = re.leverage * re.margin;
                dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
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

                    re.r_signalType,
                    re.r_signalPrice,
                    re.r_signalTime,

                    re.r_exactPrice,
                    price,

                    // re.r_signalType == 'BUY' ? (re.r_exactPrice - price) * re.r_minQty : (price - re.r_exactPrice) * re.r_minQty,
                    // re.r_signalType == 'BUY' ? (re.r_exactPrice - price) * re.r_minQty : (price - re.r_exactPrice) * re.r_minQty,
                    pnl,
                    pnl,

                    pnl > 0 ? true : false,
                    pnl < 0 ? true : false,

                    charge,  //수수료
                    parseFloat(charge)+parseFloat(re.r_t_charge),
                    re.r_exactTime,
                    getKorTime(updateTime),
                ]);


                // repeatConfig
                // repeat: 자동반복, stopLoss: 손절 시 반복 멈춤, once: 1회만 진입
                if(re.autoST == 'Y'){
                    if(re.repeatConfig == 'repeat'){
                        dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST2(?,?,?,?)`, [re.id, 'START','READY','Y']);
                    }else if(re.repeatConfig == 'stopLoss' && cData[0] == 'PROFIT'){
                        dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST2(?,?,?,?)`, [re.id, 'START','READY','Y']);
                    }else{
                        dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST2(?,?,?,?)`, [re.id, 'STOP','READY','N']);
                    }
                }else{
                    dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST2(?,?,?,?)`, [re.id, 'STOP','READY','N']);
                }

                
                dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [re.id]);
            });
        }else if(cData[0] == 'FORCING' && status == 'TRADE'){
            const uid = cData[1];
            const pid = cData[2];
            const cid = cData[3];

            dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_NEW_GET(?)`,[pid]).then((re)=>{
                let rePrice = re.r_exactPrice - price;
                let endType = null;
                if(0 < rePrice){
                    endType = 'PROFIT'
                }else{
                    endType = 'STOP'
                }

                // cancelOrderAll2(symbol, re.r_pid, re.r_sid);

                console.log(`진입: ${re.r_exactPrice},  합계: ${rePrice}, 타입: ${endType}`);

                const positionSize = re.leverage * re.margin;
                dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
                    uid,
                    pid,
                    cid,
                    oid,    //2개로 바꿔야함

                    endType,

                    re.symbol,
                    re.leverage,
                    re.margin,
                    positionSize,

                    re.type,
                    re.bunbong,
                    
                    re.r_signalType,
                    re.r_signalPrice,
                    re.r_signalTime,

                    re.r_exactPrice,
                    price,

                    // re.r_signalType == 'BUY' ? (re.r_exactPrice - price) * re.r_minQty : (price - re.r_exactPrice) * re.r_minQty,
                    // re.r_signalType == 'BUY' ? (re.r_exactPrice - price) * re.r_minQty : (price - re.r_exactPrice) * re.r_minQty,
                    pnl,
                    pnl,

                    pnl > 0 ? true : false,
                    pnl < 0 ? true : false,

                    charge,  //수수료
                    parseFloat(charge)+parseFloat(re.r_t_charge),

                    re.r_exactTime,
                    getKorTime(updateTime),
                ]);


                dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [re.id, re.autoST == 'Y' ? 'START' : 'STOP','READY',]);
                dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [re.id]);
            })
        }else{
            return false;
        }
    }catch(e){
        console.log(e);
    }

    

    return true;
}

const cancelOrder = async (symbol, type, leftId, rigthId) => {
    if(type == 'PROFIT'){
        binance.futuresCancel(symbol, rigthId);
    }else{
        binance.futuresCancel(symbol, leftId);
    }
}
const cancelOrderAll2 = async (uid, symbol, leftId = null, rigthId = null) => {
    binance[uid].futuresCancel(symbol, leftId).then((re)=>{}).catch((err)=>{});
    binance[uid].futuresCancel(symbol, rigthId).then((re)=>{}).catch((err)=>{});
}

const cancelOrderAll = async (symbol, leftId = null, rigthId = null) => {
    try{
        await binance.futuresCancel(symbol, leftId);
    }catch(e){        

    }

    try{
        await binance.futuresCancel(symbol, rigthId);
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
        //     // 증감률(%) = (현재값 - 과거값) / 과거값 × 100
        //     console.log(`[${interval}]${s} :: close: ${_close}    ${_close-87,187.50/_close*100}`);
        // }

    }
}

const GET_F_UP_DOWN = (binance, symbol, interval, itemList, period = 20) => {
    // highest_close = max(closes) : 20개 캔들 종가의 최대 값 
    // lowest_close = min(closes) : 20개 캔들 종가의 최저 값 
    // range_close = highest_close - lowest_close : 20개 캔들 종가 최대값과 최저 값의 차
    const closeValues = itemList.slice(-period).map(c => parseFloat(c.close));

    

    const highest_close = Math.max(...closeValues);
    const lowest_close = Math.min(...closeValues);
    const range_close = highest_close - lowest_close;

    // 4.	피보나치 UP LV 1, LV2 계산식 
    // UP LV1 = highest_close - range_close * 0.382
    // UP LV2 = highest_close - range_close * 0.618
    // 5.	피보나치 DN LV1,LV2 계산식	
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
    // 1.	20개 캔들 (종가 기준) 
    // 2.	타임프레임은 사용자가 선택 가능(1시간, 4시간, 하루 중 선택) 
    // 3.	ATR은 TR의 평균 (20개 캔들에서) 
    // 4.	TR은 캔들마다 계산함 
    // 5.	TR은 현재 캔들의 고가 – 현재 캔들의 저가 
    // 원칙적으로는 [현재 캔들의 고가-현재 캔들의 저가, 현재 캔들의 고가 – 직전 캔들의 종가, 현재 캔들의 저가 – 직전 캔들의 종가] 중 최대값인데 
    // 계속해서 거래가 되는 코인 시장의 트레이딩이므로 (갭이 없는 트레이딩)이므로 , TR=현재 캔들의 고가-현재 캔들의 저가로 한다.
    // 6.	20개 캔들 기준의 ATR은 20개 캔들의 TR의 평균 
    const closeValues = itemList.slice(-period);

    // TR = high - low
    const TRs = closeValues.map(candle => 
        parseFloat(candle.high) - parseFloat(candle.low)
    );

    // ATR = TR 평균
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

    // 현재 BBW와 이전 BBW
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
  
    // ✅ 초기 평균값 계산 (20개의 단순 평균)
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


    const recentRSI = rsi[rsi.length - 1];          // 최신 RSI
    const oldRSI = rsi[rsi.length - 1 - period];    // 20개 전 RSI


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
    // 평균
    const mean = closeValues.reduce((sum, val) => sum + val, 0) / period;

    // 표준편차
    const variance = closeValues
        .map(v => (v - mean) ** 2)
        .reduce((sum, val) => sum + val, 0) / period;
    const stdDev = Math.sqrt(variance);

    // 최신 거래량
    const latestVolume = parseFloat(itemList[itemList.length - 1].volume);

    // Z-Score 계산
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
      throw new Error("두 배열의 길이가 같아야 합니다.");
    }
    if (arr1.length < 2) {
      throw new Error("데이터가 2개 이상 필요합니다.");
    }
  
    const n = arr1.length;
  
    // 평균 계산
    const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
    const mean2 = arr2.reduce((a, b) => a + b, 0) / n;
  
    // 분자와 분모 계산
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
    // 최근 20개 캔들의 종가 추출
    const closes = itemList.slice(-period).map(c => parseFloat(c.close));

    // 평균 계산
    const mean = closes.reduce((sum, v) => sum + v, 0) / period;

    // 분산 계산
    const variance = closes
        .map(v => Math.pow(v - mean, 2))
        .reduce((sum, v) => sum + v, 0) / period;

    // 표준편차 계산
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

const setMarginType = async (symbol, marginType) => {
    const timestamp = Date.now();
    const query = `symbol=${symbol}&marginType=${marginType}&timestamp=${timestamp}`;
    const signature = sign(query);
  
    const url = `${BASE_URL}/fapi/v1/marginType?${query}&signature=${signature}`;
  
    try {
      const res = await axios.post(url, null, {
        headers: {
          "X-MBX-APIKEY": API_KEY
        }
      });
      console.log("마진 타입 설정 완료:", res.data);
    } catch (e) {
      if (e.response) {
        console.error("에러:", e.response.data);
      } else {
        console.error("네트워크 에러:", e.message);
      }
    }
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

  
exports.init = async () => {
    getTick();
    getUserBalance();

    
    // await initAPI2();

    dbcon.DBCall(`CALL SP_A_MEMBER_KEY_ALL_GET()`).then((keyList)=>{
        keyList.forEach((k)=>{
            initAPI(k.id, k.appKey, k.appSecret);
        });

        // initAPI();
    }).catch((eee)=>{
        console.log('zzzzzzzzzzzzz');
        console.log(eee);
    });
    
    socketInit();
    schedule.scheduleJob("30 0 */1 * * *", ()=>{
        getCandle('1h');
    });
    schedule.scheduleJob("30 0 */4 * * *", ()=>{
        getCandle('4h');
    });
    schedule.scheduleJob("0 0 0 * * *", ()=>{
        getCandle('1d');
    });

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
    
                    binance[uid].futuresBalance().then((reData)=>{
    
                        reData.forEach((i)=>{
                            if(i.asset == 'USDT'){
                                console.log(i.availableBalance);
                            }
                        })
                    }).catch((err)=>{
                        console.error(`ERR :: uid ${uid} futuresBalance`, err);
                    });;
                });
            }).catch((eee)=>{
                console.log('ERR :: getPrice  111 !! -------------');
                console.log(eee);
            });
    
            
        }catch(e){
            console.log('ERR :: getPrice !! -------------');
            console.log(e);
        }
    }, 1000); // 30분

    
    

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
    // type :: FORCING   PROFIT     STOP

    const sendData = {
        status: false,
        errCode: null,
        errMsg: null,
    }
    
    try{
        const itemInfo = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_ST_NEW_GET(?)`,[pid]);
        if(limitST == 'Y' && itemInfo.r_oid == null){
            cancelOrderAll2(uid, symbol, r_tid);
            dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [itemInfo.id, itemInfo.autoST == 'Y' ? 'START' : 'STOP','READY',]);
            dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [itemInfo.id]);
            
        }else{
            const extData = await binance[uid].futuresOrder(
                'MARKET',
                side == 'BUY' ? 'SELL' : 'BUY',
                symbol,
                userQty,
                null,
                {
                    positionSide: side == 'BUY' ? 'LONG' : 'SHORT',
                    newClientOrderId: type+'_'+uid+'_'+pid+'_'+r_tid
                }
            )
    
            dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_OID_UPDATE(?,?)`,[pid, extData.orderId]);
        }
        return true;
    }catch(e){
        const match = e.message.match(/\{.*\}/);

        if (match) {
            const json = JSON.parse(match[0]);
            sendData.errCode = json.code;
            sendData.errMsg = json.msg;

            console.log(`ERR :: sendForcing : ${sendData.errMsg}`);
            exports.msgAdd('sendForcing',json.code, json.msg, uid, pid, r_tid, symbol, side);

        } else {
            console.error("에러 메시지에서 JSON을 찾을 수 없음:", e.message);
            sendData.errCode = 404;
            sendData.errMsg = e.message;

            exports.msgAdd('sendForcing','404', e.message, uid, pid, r_tid, symbol, side);
        }

        return false;
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
    }

    let extData = null;

    try{
        // 1. 최소 수량 정보 가져오기
        const info = await binance[uid].futuresExchangeInfo();
        const symbolInfo = info.symbols.find(s => s.symbol === symbol);
        const lotSize = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        const tickSize = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
        const minQty = parseFloat(lotSize.minQty);
        const stepSize = parseFloat(lotSize.stepSize);

        // 2. 현재 가격 가져오기
        const priceData = await binance[uid].futuresMarkPrice(symbol);
        const price = parseFloat(priceData.markPrice);

        // 3. 수량 계산
        // const notionalMin = 5; // 최소 주문 금액
        // let rawQty = notionalMin / price;
        let rawQty = (userMargin * lv) / price;

        // 4. stepSize에 맞춰 수량 조정
        const adjustToStepSize = (qty, step, minQty) => {
            const precision = step.toString().split('.')[1]?.length || 0;
            const floored = Math.floor(qty / step) * step;
            return Math.max(minQty, floored).toFixed(precision);
        };

        //leverage
        await binance[uid].privateFuturesRequest('v1/leverage', {
            symbol: symbol,
            leverage: lv,
        }, 'POST');


        const finalQty = adjustToStepSize(rawQty, stepSize, minQty);
        console.log(`📌id:${uid} 현재가: ${price}, 계산된 수량: ${rawQty}, 최종 수량: ${finalQty}, 방향: ${side}`);
        // 주문 실행

        if(limitST == 'Y'){
            const tickSizeValue = parseFloat(tickSize.tickSize);
            const fixedStopPrice = adjustToTickSize(enterPrice, tickSizeValue);
            console.log(`끝:${fixedStopPrice}`);
            extData = await binance[uid].futuresOrder(
                side == 'BUY' ?  'TAKE_PROFIT_MARKET' : 'TAKE_PROFIT_MARKET',
                side == 'BUY' ? 'BUY' : 'SELL',
                symbol,
                finalQty,
                null,
                {
                    stopPrice: fixedStopPrice,
                    timeInForce: 'GTC',
                    positionSide: side == 'BUY' ? 'LONG' : 'SHORT',
                    newClientOrderId: 'NEW_'+uid+'_'+pid,
                }
            )
        }else{
            extData = await binance[uid].futuresOrder(
                'MARKET', //BUY::STOP_LOSS_LIMIT SELL::TAKE_PROFIT_LIMIT
                side == 'BUY' ? 'BUY' : 'SELL',
                symbol,
                finalQty,
                null,
                {
                    // stopPrice: 119203,
                    // newOrderRespType: 'RESULT',
                    positionSide: side == 'BUY' ? 'LONG' : 'SHORT',
                    newClientOrderId: 'NEW_'+uid+'_'+pid,
                }
            )
        }
        
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


        // origQty 주문 수량
        // cumQty 누적 체결 수량

        // const positionSize = parseFloat(extData.avgPrice) * parseFloat(extData.executedQty);

        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_NEW_SET(?,?,?)`, [
            pid,
            extData.orderId,
            minQty,
            // positionSize,
        ]);

        if(extData){
            sendData.status = true;
        }

        return sendData;
    }catch(e){
        const match = e.message.match(/\{.*\}/);

        let r_tid = null;
        if(extData && extData?.orderId){
            r_tid = extData?.orderId; 
        }

        if (match) {
            const json = JSON.parse(match[0]);
            sendData.errCode = json.code;
            sendData.errMsg = json.msg;

            console.log(`ERR :: sendEnter : ${sendData.errMsg}`);

            if(extData && extData?.orderId){
                //청산
                exports.sendForcing('FORCING', symbol, side, extData.executedQty, uid, pid, extData.orderId, limitST = 'N');
            }

            exports.msgAdd('sendEnter',json.code, json.msg, uid, pid, r_tid, symbol, side);
        } else {
            console.error("에러 메시지에서 JSON을 찾을 수 없음:", e.message);
            sendData.errCode = 404;
            sendData.errMsg = e.message;

            exports.msgAdd('sendEnter','404', e.message, uid, pid, r_tid, symbol, side);
        }

        await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [pid]);
        await dbcon.DBCall(`CALL SP_LIVE_PLAY_STOP(?)`, [pid]);

        return sendData;
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
    dbcon.DBCall(`CALL SP_MSG_ADD(?,?,?,?,?,?,?,?)`, [
        fun,
        code,
        msg,
        uid,
        pid,
        tid,
        symbol,
        side,
    ]).then((re)=>{
        //소켓 전달 코드
        io.wsOneSend(uid,'live-error', {st: true});
    }).catch((e)=>{
        console.log('EEEEEEEEE :: msgAdd : ',e);
    })
}
