const WebSocket = require('ws');
const { SMA, RSI } = require('technicalindicators');

const schedule = require("node-schedule");
const axios = require('axios');
const convert = require('xml-js');
var exports = module.exports = {};
const requestIp = require('request-ip');

const dbcon = require("./dbcon");

const meta = require("./meta");
const ls = require("./ls");
const coin = require("./coin");
const dt = require("./data");

let ws = null;
const {users} = require('./routes/socket');

// const app = require('./bin/www'); 

const multer = require("multer");
const fs = require("fs");
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
require('dayjs/locale/ko');
dayjs.locale('ko');
dayjs.extend(utc);
dayjs.extend(timezone);
// dayjs.tz.setDefault('Asia/Seoul');

let ST = false;
// let driver = null;
let serverInfo = null;

let runST = false;
let runTestST = false;
let runMainST = false;

const TRADE_MODE_LIVE = 0;
const TRADE_MODE_TEST = 1;

const randomSleep = async (min=100, max=250) => { 
    const num = Math.floor(Math.random() * (max - min)) + min;
    await sleep(num);
}

const sleep = (ms) => {
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

exports.lsPrice = 0;
exports.symbol = 'NQM25';
exports.candlesTick = [];

dt.offerho = 0;
dt.bidho = 0;
exports.LS_offerho = 0;
exports.LS_bidho = 0;

exports.price = { offerho: 0, bidho: 0};

// exports.charge = 4300;
exports.charge = 0;
exports.cool = 0;
exports.coolSec = 30;

exports.marketST = true;

exports.ATF_NEW = {
    'BTCUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'ETHUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'XRPUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'SOLUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
}
exports.ATF_OLD = {
    'BTCUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'ETHUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'XRPUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'SOLUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    
}
exports.UT_NEW = {
    'BTCUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'ETHUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'XRPUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'SOLUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
}
exports.UT_OLD = {
    'BTCUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'ETHUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'XRPUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
    'SOLUSDT': {
        '1m': null,
        '2m': null,
        '3m': null,
        '4m': null,
        '5m': null,
        '6m': null,
        '10m': null,
        '15m': null,
        '30m': null,
        '60m': null,
    },
}

const runMain = async (st_ = false) => {
    if(!exports.marketST && !st_){
        return
    }

    if(runMainST){
        return
    }

    runMainST = true


    await sleep(300);
    await runPlayLive();

    // await sleep(300);
    // await runPrice();

    await runPlayTest();

    runMainST = false
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
        const playList = await dbcon.DBCall(`CALL SP_LIVE_PLAY_START_GET()`);

        for(let i=0;i<playList.length;i++){
            const play = playList[i];

            if(!play){
                continue
            }


            const cPrice = dt.getPrice(play.symbol);

            if(!cPrice.st){
                continue;
            }

            
            if(play.status == 'READY' && play.autoST == 'Y'){
                const signalPrice = play.signalType == "BUY" ? cPrice.bestBid : cPrice.bestAsk;
                let enterST = false
                // console.log(play.type);
                if(play.type == 'mid'){
                    // 해당 종목의 “지지선＂과 “저항선＂의 중앙값 [ “지지선“ + “저항선” / 2]
                    const midValue = (play.resLine + play.subLine) / 2

                    // console.log(`중앙값:${play.resLine}+${play.subLine} = ${midValue}`);
                    // console.log(`신호가격:${signalPrice}`);

                    if(play.signalType == 'BUY'){
                        if(signalPrice <= midValue){
                            enterST = true;
                        }
                    }else{
                        if(midValue <= signalPrice){
                            enterST = true;
                        }
                    }
                }else if(play.type == 'abs'){
                    if(play.signalType == 'BUY'){
                        if(signalPrice <= play.absValue){
                            enterST = true;
                        }
                    }else{
                        if(play.absValue <= signalPrice){
                            enterST = true;
                        }
                    }
                }

                if(enterST){
                    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                        play.id,
                        null,
                        signalPrice,
                        play.signalType,
                    ]);
                }
                

            }else if(play.status == 'EXACT_WAIT'){
                const newPrice = play.r_signalType == 'BUY' ? cPrice.bestBid : cPrice.bestAsk

                //진입
                

                let profitPrice = null;
                let stopPrice = null;

                const profitTick = play.profit * newPrice * 0.01
                const stopTick = play.stopLoss * newPrice * 0.01

                if(play.r_signalType == 'BUY'){
                    profitPrice = newPrice + profitTick
                    stopPrice = newPrice - stopTick
                }else if(play.r_signalType == 'SELL'){
                    profitPrice = newPrice - profitTick
                    stopPrice = newPrice + stopTick
                }
                
                // console.log(`------- newPrice:${cPrice.bestBid}, ${cPrice.bestAsk}, profit: ${play.profit}, profitTick: ${play.profit * newPrice * 0.01}, profitPrice:${profitPrice}`);

                // if(exports.ckExact(play.enter, play.r_signalPrice, newPrice, play.r_signalType) || play.limitST == 'N'){
                    // await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EXACT(?,?,?,?,?,?)`,[play.id, play.uid, newPrice, null, 0, qty]);
                
                console.log(`시작:${newPrice}`);
                await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EDIT(?,?)`,[play.id, 'EXACT']);
                const enterPrice = exports.getEnterPrice(play.enter, play.r_signalPrice, play.r_signalType);
                // console.log(enterPrice);
                const sendData = await coin.sendEnter(
                    play.symbol,        //symbol
                    play.r_signalType,  //side
                    play.leverage,
                    play.margin,     //qty
                    play.uid,           //uid
                    play.id,             //pid
                    play.limitST,
                    enterPrice
                );
                
                // }

                
            }else if(play.status == 'EXACT' && play.r_exactPrice || play.status == 'FORCING'){
                const price = play.r_signalType == 'BUY' ? cPrice.bestBid : cPrice.bestAsk
                let endType = null;


                if(play.r_exactPrice){
                    if(play.r_signalType == 'BUY'){
                        // [{(현재가격-진입가격)/진입가격}X거래금액]-진입수수료
                        // const real_tick = (price - play.r_exactPrice) * 0.001
                        const real_tick = (((price - play.r_exactPrice) / play.r_exactPrice) * (play.leverage * play.margin)) - play.r_charge;

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_TICK(?,?)`,[
                            play.id,
                            real_tick
                        ]);
                    }else{
                        // const real_tick = (play.r_exactPrice - price) * 0.001
                        const real_tick = (((play.r_exactPrice - price) / play.r_exactPrice) * (play.leverage * play.margin)) - play.r_charge;

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_TICK(?,?)`,[
                            play.id,
                            real_tick
                        ]);
                    }
                }

                let t_cs = null;
                //TS
                if(play.trendOrderST == 'Y' ){
                    if(!play.r_t_cnt){
                        t_cs = play.t_cancelStopLoss;
                    }else{
                        t_cs = play.t_cancelStopLoss * (play.r_t_cnt+1);
                    }

                    // t_cancelStopLoss    //ts조건
                    // t_chase             //ts설정
                    if (exports.ckProfit(t_cs, play.r_exactPrice, price, play.r_signalType)){
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_T_ST(?,?)`,[play.id, 'Y']);
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_T_CNT(?,?)`,[play.id, play.r_t_cnt+1]); 
                        // st = 'Y'
                        play.r_t_cnt = play.r_t_cnt+1
                        play.r_t_st = 'Y'

                        console.log(`트레이딩 스탑 활성화! t_cancelStopLoss:${play.t_cancelStopLoss}, t_cs:${t_cs}, r_t_cnt:${play.r_t_cnt}, t_chase:${play.t_chase}`);
                    }

                    // if(st == 'Y'){
                    //     let stopPrice = null;
                    //     const stopTick = play.t_chase * play.r_exactPrice * 0.01 * play.r_t_cnt;

                    //     if(play.r_signalType == 'BUY'){
                    //         stopPrice = play.r_exactPrice + stopTick
                    //     }else if(play.r_signalType == 'SELL'){
                    //         stopPrice = play.r_exactPrice - stopTick
                    //     }
                    //     // const stopLoss = (play.t_chase * play.r_exactPrice * 0.01) * (play.r_t_cnt+1)

                    //     console.log(`트레이딩 스탑 활성화! t_cancelStopLoss:${play.t_cancelStopLoss}, t_cs:${t_cs}, r_t_cnt:${play.r_t_cnt}, t_chase:${play.t_chase}, r_exactPrice:${play.r_exactPrice}, r_stopPrice:${play.r_stopPrice}, stopTick:${stopTick}, stopPrice:${stopPrice}`);

                    //     await coin.tradingStopReq(
                    //         play.symbol,
                    //         play.r_signalType,
                    //         stopPrice,
                    //         play.r_tid,
                    //         play.r_pid,
                    //         play.r_sid,
                    //         play.r_qty,
                    //         play.uid,
                    //         play.id,
                    //     );
                        
                    // }
                }


                // profitTradeType //per, fix, abs
                // profitFixValue   //지지:res, 저항:sub
                // profitAbsValue   //abs 값
                // lossTradeType
                // lossFixValue
                // lossAbsValue


                if(play.status == 'FORCING'){
                    endType = 'FORCING';
                }
                
                if(!endType){
                    if(t_cs && exports.ckExStop(t_cs, play.r_exactPrice, price, play.r_signalType) && (play.r_t_st == 'Y')){
                        endType = 'PROFIT';

                        console.log('트레이딩 스탑 청산!');
                    }else if(play.profitTradeType == 'per' && exports.ckProfit(play.profit, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'PROFIT';
                    }else if(play.profitTradeType == 'fix'){
                        // console.log('PROFIT', play.lossFixValue, play.resLine, play.subLine);
                        // console.log(exports.ckProfit2(play.subLine, play.r_exactPrice, price, play.r_signalType));
                        if(play.profitFixValue == 'res' && exports.ckProfit2(play.resLine, play.r_exactPrice, price, play.r_signalType)){
                            endType = 'PROFIT';
                        }else if(play.profitFixValue == 'sub' && exports.ckProfit2(play.subLine, play.r_exactPrice, price, play.r_signalType)){
                            endType = 'PROFIT';
                        }
                    }else if(play.profitTradeType == 'abs' && exports.ckProfit2(play.profitAbsValue, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'PROFIT';
                    }
                }

                if(!endType){
                    if(play.lossTradeType == 'per' && exports.ckStop(play.stopLoss, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'STOP';
                    }else if(play.lossTradeType == 'fix'){
                        // console.log('LOSS', play.lossFixValue, play.resLine, play.subLine);
                        if(play.lossFixValue == 'res' && exports.ckStop2(play.resLine, play.r_exactPrice, price, play.r_signalType)){
                            endType = 'STOP';
                        }else if(play.lossFixValue == 'sub' && exports.ckStop2(play.subLine, play.r_exactPrice, price, play.r_signalType)){
                            endType = 'STOP';
                        }
                    }else if(play.lossTradeType == 'abs' && exports.ckStop2(play.lossAbsValue, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'STOP';
                    }
                }

                if(endType){
                    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EDIT(?,?)`,[play.id, 'CLOSE']);

                    const sendData = await coin.sendForcing(
                        endType,
                        play.symbol,        //symbol
                        play.r_signalType,  //side
                        play.r_qty,     //qty
                        play.uid,           //uid
                        play.id,             //pid
                        play.r_tid,
                        play.limitST,
                    );
                }

            }
        }

    }catch(e){
        console.log('runPlayLive ERROR :: ', e);
    }

    runST = false
}

const runPlayTest = async (st_ = false) => {
    if(!exports.marketST && !st_){
        return
    }

    if(runTestST){
        return
    }

    runTestST = true

    try{
        const playList = await dbcon.DBCall(`CALL SP_TEST_PLAY_START_GET()`);
        // console.log(playList);
        for(let i=0;i<playList.length;i++){
            const play = playList[i];

            if(!play){
                continue
            }


            const cPrice = dt.getPrice(play.symbol);

            if(!cPrice.st){
                continue;
            }


            if(play.status == 'READY' && play.autoST == 'Y'){
                const signalPrice = play.signalType == "BUY" ? cPrice.bestBid : cPrice.bestAsk;
                let enterST = false
                // console.log(play.type);
                if(play.type == 'mid'){
                    // 해당 종목의 “지지선＂과 “저항선＂의 중앙값 [ “지지선“ + “저항선” / 2]
                    const midValue = (play.resLine + play.subLine) / 2
                    if(play.signalType == 'BUY'){
                        if(signalPrice <= midValue){
                            enterST = true;
                        }
                    }else{
                        if(midValue <= signalPrice){
                            enterST = true;
                        }
                    }
                }else if(play.type == 'abs'){
                    if(play.signalType == 'BUY'){
                        if(signalPrice <= play.absValue){
                            enterST = true;
                        }
                    }else{
                        if(play.absValue <= signalPrice){
                            enterST = true;
                        }
                    }
                }

                if(enterST){
                    await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                        play.id,
                        null,
                        signalPrice,
                        play.signalType,
                    ]);
                }
                

            }else if(play.status == 'EXACT_WAIT'){
                const newPrice = play.r_signalType == 'BUY' ? cPrice.bestAsk : cPrice.bestBid

                //진입
                // await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EDIT(?,?)`,[play.id, 'EXACT']);

                let profitPrice = null;
                let stopPrice = null;

                const profitTick = play.profit * newPrice * 0.01
                const stopTick = play.stopLoss * newPrice * 0.01

                if(play.r_signalType == 'BUY'){
                    profitPrice = newPrice + profitTick
                    stopPrice = newPrice - stopTick
                }else if(play.r_signalType == 'SELL'){
                    profitPrice = newPrice - profitTick
                    stopPrice = newPrice + stopTick
                }

                // const sendData = await coin.sendEnter(
                //     play.symbol,        //symbol
                //     play.r_signalType,  //side
                //     play.leverage,
                //     play.margin,     //qty
                //     play.uid,           //uid
                //     play.id             //pid
                // );

                const positionSize = play.leverage * play.margin;
                const qty = positionSize / newPrice;

                if(exports.ckExact(play.enter, play.r_signalPrice, newPrice, play.r_signalType) || play.limitST == 'N'){
                    await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EXACT(?,?,?,?,?,?)`,[play.id, play.uid, newPrice, null, 0, qty]);
                }
            }
            else if(play.status == 'EXACT' && play.r_exactPrice || play.status == 'FORCING'){
                const price = play.r_signalType == 'BUY' ? cPrice.bestBid : cPrice.bestAsk
                let endType = null;
                let real_tick = 0;
                if(play.r_exactPrice){
                    if(play.r_signalType == 'BUY'){
                        // const real_tick = (price - play.r_exactPrice) * 0.001
                        real_tick = (((price - play.r_exactPrice) / play.r_exactPrice) * (play.leverage * play.margin));
                        await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_TICK(?,?)`,[
                            play.id,
                            real_tick
                        ]);
                    }else{
                        // const real_tick = (play.r_exactPrice - price) * 0.001
                        real_tick = (((play.r_exactPrice - price) / play.r_exactPrice) * (play.leverage * play.margin));

                        await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_TICK(?,?)`,[
                            play.id,
                            real_tick
                        ]);
                    }
                }

                let t_cs = null;
                //TS
                if(play.trendOrderST == 'Y' ){
                    if(!play.r_t_cnt){
                        t_cs = play.t_cancelStopLoss;
                    }else{
                        t_cs = play.t_cancelStopLoss * (play.r_t_cnt+1);
                    }

                    // t_cancelStopLoss    //ts조건
                    // t_chase             //ts설정
                    if (exports.ckProfit(t_cs, play.r_exactPrice, price, play.r_signalType)){
                        await dbcon.DBCall(`CALL SP_TEST_PLAY_T_ST(?,?)`,[play.id, 'Y']);
                        await dbcon.DBCall(`CALL SP_TEST_PLAY_T_CNT(?,?)`,[play.id, play.r_t_cnt+1]); 
                        // st = 'Y'
                        play.r_t_cnt = play.r_t_cnt+1
                        play.r_t_st = 'Y'

                        // console.log(`트레이딩 스탑 활성화! t_cancelStopLoss:${play.t_cancelStopLoss}, t_cs:${t_cs}, r_t_cnt:${play.r_t_cnt}, t_chase:${play.t_chase}`);
                    }

                    // if(st == 'Y'){
                    //     let stopPrice = null;
                    //     const stopTick = play.t_chase * play.r_exactPrice * 0.01 * play.r_t_cnt;

                    //     if(play.r_signalType == 'BUY'){
                    //         stopPrice = play.r_exactPrice + stopTick
                    //     }else if(play.r_signalType == 'SELL'){
                    //         stopPrice = play.r_exactPrice - stopTick
                    //     }
                    //     // const stopLoss = (play.t_chase * play.r_exactPrice * 0.01) * (play.r_t_cnt+1)

                    //     console.log(`트레이딩 스탑 활성화! t_cancelStopLoss:${play.t_cancelStopLoss}, t_cs:${t_cs}, r_t_cnt:${play.r_t_cnt}, t_chase:${play.t_chase}, r_exactPrice:${play.r_exactPrice}, r_stopPrice:${play.r_stopPrice}, stopTick:${stopTick}, stopPrice:${stopPrice}`);

                    //     await coin.tradingStopReq(
                    //         play.symbol,
                    //         play.r_signalType,
                    //         stopPrice,
                    //         play.r_tid,
                    //         play.r_pid,
                    //         play.r_sid,
                    //         play.r_qty,
                    //         play.uid,
                    //         play.id,
                    //     );
                        
                    // }
                }

                if(play.status == 'FORCING'){
                    if(play.r_signalType == 'BUY'){
                        if(play.r_exactPrice < price){
                            endType = 'PROFIT';
                        }else{
                            endType = 'STOP';
                        }
                    }else{
                        if(play.r_exactPrice < price){
                            endType = 'STOP';
                        }else{
                            endType = 'PROFIT';
                        }
                    }
                    // endType = 'FORCING';
                }
                
                if(!endType){
                    if(t_cs && exports.ckExStop(t_cs, play.r_exactPrice, price, play.r_signalType) && (play.r_t_st == 'Y')){
                        endType = 'PROFIT';
                    }else if(play.profitTradeType == 'per' && exports.ckProfit(play.profit, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'PROFIT';
                    }else if(play.profitTradeType == 'fix'){
                        if(play.profitFixValue == 'res' && exports.ckProfit2(play.resLine, play.r_exactPrice, price, play.r_signalType)){
                            endType = 'PROFIT';
                        }else if(play.profitFixValue == 'sub' && exports.ckProfit2(play.subLine, play.r_exactPrice, price, play.r_signalType)){
                            endType = 'PROFIT';
                        }
                    }else if(play.profitTradeType == 'abs' && exports.ckProfit2(play.profitAbsValue, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'PROFIT';
                    }
                }

                if(!endType){
                    if(play.lossTradeType == 'per' && exports.ckStop(play.stopLoss, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'STOP';
                    }else if(play.lossTradeType == 'fix'){
                        // console.log('LOSS', play.lossFixValue, play.resLine, play.subLine);
                        if(play.lossFixValue == 'res' && exports.ckStop2(play.resLine, play.r_exactPrice, price, play.r_signalType)){
                            endType = 'STOP';
                        }else if(play.lossFixValue == 'sub' && exports.ckStop2(play.subLine, play.r_exactPrice, price, play.r_signalType)){
                            endType = 'STOP';
                        }
                    }else if(play.lossTradeType == 'abs' && exports.ckStop2(play.lossAbsValue, play.r_exactPrice, price, play.r_signalType)){
                        endType = 'STOP';
                    }
                }
                
                // else if(exports.ckProfit(play.profit, play.r_exactPrice, price, play.r_signalType)){
                //     endType = 'PROFIT';
                // }else if(exports.ckStop(play.stopLoss, play.r_exactPrice, price, play.r_signalType)){
                //     endType = 'STOP';
                // }


                if(endType){
                    // const re = exports.resultPrice(play.r_exactPrice, price, play.r_signalType);
                    const closeTime = new Date();

                    let pol_price = 0;
                    if(play.r_signalType == 'BUY'){
                        pol_price = (price - play.r_exactPrice) * play.r_qty
                    }else{
                        pol_price = (play.r_exactPrice - price) * play.r_qty
                    }

                    // PnL = 증거금 × ( (현재가 / 진입가 - 1) × 레버리지 )
                    const positionSize = play.leverage * play.margin;

                    positionSize * (price / play.r_exactPrice - 1) * 

                    await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
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
    
                        // pol_price,
                        // pol_price,
                        // pol_price > 0 ? true : false,
                        // pol_price < 0 ? true : false,
                        pol_price,
                        real_tick,
                        real_tick > 0 ? true : false,
                        real_tick < 0 ? true : false,
                        
                        0,  //수수료
                        play.r_exactTime,
                        closeTime,
                    ]);
    
                    // await dbcon.DBCall(`CALL SP_TEST_PLAY_SET_ST(?,?,?)`, [play.id, play.autoST == 'Y' ? 'START' : 'STOP','READY',]);

                    if(play.autoST == 'Y'){
                        if(play.repeatConfig == 'repeat'){
                            dbcon.DBCall(`CALL SP_TEST_PLAY_SET_ST2(?,?,?,?)`, [play.id, 'START','READY','Y']);
                        }else if(play.repeatConfig == 'stopLoss' && endType == 'PROFIT'){
                            dbcon.DBCall(`CALL SP_TEST_PLAY_SET_ST2(?,?,?,?)`, [play.id, 'START','READY','Y']);
                        }else{
                            dbcon.DBCall(`CALL SP_TEST_PLAY_SET_ST2(?,?,?,?)`, [play.id, 'STOP','READY','N']);
                        }
                    }else{
                        dbcon.DBCall(`CALL SP_TEST_PLAY_SET_ST2(?,?,?,?)`, [play.id, 'STOP','READY','N']);
                    }
                    
                    await dbcon.DBCall(`CALL SP_TEST_PLAY_INIT(?)`, [play.id]);
                }
            }
        }

    }catch(e){
        console.log('runPlayTest ERROR :: ', e);
    }

    runTestST = false
}


// runPrice();

exports.ckExact = (enter, oldPrice, curPrice, side) => {
    const enterPrice = oldPrice * enter * 0.01

    // console.log('ckPrice ! '+enterPrice);
    // console.log(curPrice, oldPrice - enterPrice);

    if(side == 'BUY'){
        if(curPrice <= oldPrice - enterPrice){
            // console.log(`BUY :: ${oldPrice - enterPrice}, ${curPrice} 진입`)
            return true;
        }
    }else if(side == 'SELL'){
        if(oldPrice + enterPrice <= curPrice){
            // console.log(`SELL :: ${oldPrice + enterPrice}, ${curPrice} 진입`)
            return true;
        }
    }

    return false;
}

exports.getEnterPrice = (enter, oldPrice, side) => {
    const enterPrice = oldPrice * enter * 0.01
    if(side == 'BUY'){
        return oldPrice - enterPrice;
    }else{
        return oldPrice + enterPrice;
    }
}

exports.ckCancel = (cancel, oldPrice, curPrice, side) => {
    const enterPrice = cancel * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);
    if(side == 'BUY'){
        if(oldPrice + enterPrice <= curPrice){
            return true;
        }
    }else if(side == 'SELL'){
        if(curPrice <= oldPrice - enterPrice){
            // console.log(`SELL :: ${oldPrice + enterPrice}, ${curPrice} 취소`)
            return true;
        }
    }

    return false;
}

exports.ckProfit = (profit, oldPrice, curPrice, side) => {
    const enterPrice = profit * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);

    // console.log('-----------------------------------------------');
    // console.log(`현재가 ${curPrice} 진입금액:${oldPrice}, 조건틱:${profit} 합:${oldPrice+enterPrice}`);
    // console.log('-----------------------------------------------');

    if(side == 'BUY'){
        if(oldPrice + enterPrice <= curPrice){
            // console.log(`BUY :: ${oldPrice + enterPrice}, ${curPrice} 익절`)
            return true;
        }
    }else if(side == 'SELL'){
        if(curPrice <= oldPrice - enterPrice){
            // console.log(`SELL :: ${oldPrice - enterPrice}, ${curPrice} 익절`)
            return true;
        }
    }

    return false;
}


exports.ckProfit2 = (profit, oldPrice, curPrice, side) => {
    // const enterPrice = profit * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);

    // console.log('-----------------------------------------------');
    // console.log(`현재가 ${curPrice} 진입금액:${oldPrice}, 조건틱:${profit} 합:${oldPrice+enterPrice}`);
    // console.log('-----------------------------------------------');

    if(side == 'BUY'){
        if(profit <= curPrice){
            // console.log(`BUY :: ${oldPrice + enterPrice}, ${curPrice} 익절`)
            return true;
        }
    }else if(side == 'SELL'){
        if(curPrice <= profit){
            // console.log(`SELL :: ${oldPrice - enterPrice}, ${curPrice} 익절`)
            return true;
        }
    }

    return false;
}

exports.ckStop = (stopLoss, oldPrice, curPrice, side) => {
    const enterPrice = stopLoss * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);

    // console.log('-----------------------------------------------');
    // console.log(`손절 ${side} 진입금액:${oldPrice}, 조건틱:${stopLoss} 합:${oldPrice+enterPrice}`);
    // console.log('-----------------------------------------------');

    if(side == 'BUY'){
        if(curPrice <= oldPrice - enterPrice){
            // console.log(`BUY :: ${oldPrice - enterPrice}, ${curPrice} 손절`)
            return true;
        }
    }else if(side == 'SELL'){
        if(oldPrice + enterPrice <= curPrice){
            // console.log(`SELL :: ${oldPrice + enterPrice}, ${curPrice} 손절`)
            return true;
        }
    }

    return false;
}

exports.ckStop2 = (stopLoss, oldPrice, curPrice, side) => {
    // const enterPrice = stopLoss * oldPrice * 0.01
    // console.log('ckPrice ! '+enterPrice);

    // console.log('-----------------------------------------------');
    // console.log(`손절 ${side} 진입금액:${oldPrice}, 조건틱:${stopLoss} 합:${oldPrice+enterPrice}`);
    // console.log('-----------------------------------------------');

    if(side == 'BUY'){
        if(curPrice <= stopLoss){
            // console.log(`BUY :: ${oldPrice - enterPrice}, ${curPrice} 손절`)
            return true;
        }
    }else if(side == 'SELL'){
        if(stopLoss <= curPrice){
            // console.log(`SELL :: ${oldPrice + enterPrice}, ${curPrice} 손절`)
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
    const ustToKr = 1440    //환율
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

exports.enterCoin_ = async function(reqData){
    try{
        let side = null;

        if(reqData.type == 'gold'){
            side = 'BUY'
        }else{
            side = 'SELL'
        }

        // if(reqData.uuid == '5B3F2A9C8D7E4F1'){
        //     console.log(reqData);
        // }

        // console.log(reqData.symbol);

        const cPrice = dt.getPrice(reqData.symbol);


        if(!cPrice.st){
            return false;
        }

        const tgDataList = await dbcon.DBCall(`CALL SP_LIVE_PLAY_UUID_GET(?,?)`, [reqData.uuid, reqData.symbol]);

        for(let i=0;i<tgDataList.length;i++){
            try{
                const tgData = tgDataList[i];
                const bunbong = tgData.bunbong.split('_')[1]

                if(side == 'BUY' && (tgData.signalType == 'BUY' || tgData.signalType == 'TWO')){
                    const signalPrice = cPrice.bestBid;
                    // const price = tmepPrice - tgData.enter * 0.1

                    let enterST = false


                    // ATF_NEW != ATF_OLD == 'BUY' 즉시 진입 시켜버리기
                    // ATF == UT 같은 신호가 나오면 진입 대기
                    // ATF != UT 진입 취소
                    // ATF_NEW != ATF_OLD 청산

                    if(tgData.type == 'A'){
                        enterST = true;
                    }

                    if(enterST){
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            'BUY',
                        ]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            tgData.status == 'READY' ? '진입대기' : '재진입대기',
                            tgData.st,
                            'START',
                            tgData.status,
                            'EXACT_WAIT',
                            'BUY',
                            signalPrice,
                            null,
                        ]);
                    }

                }
                else if(side == 'SELL' && (tgData.signalType == 'SELL' || tgData.signalType == 'TWO')){
                    const signalPrice = cPrice.bestAsk;
                    // const price = tmepPrice + tgData.enter * 0.1

                    let enterST = false

                    if(tgData.type == 'A'){
                        enterST = true;
                    }
                    
                    if(enterST){
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            'SELL',
                        ]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            tgData.status == 'READY' ? '진입대기' : '재진입대기',
                            tgData.st,
                            'START',
                            tgData.status,
                            'EXACT_WAIT',
                            'SELL',
                            signalPrice,
                            null,
                        ]);
                    }

                }
            }catch(e){
                console.log('runEnter ERROR :: ', e);
            }
            
        }






        const tgDataList2 = await dbcon.DBCall(`CALL SP_TEST_PLAY_UUID_GET(?,?)`, [reqData.uuid, reqData.symbol]);
        for(let i=0;i<tgDataList2.length;i++){
            try{
                const tgData = tgDataList2[i];
                const bunbong = tgData.bunbong.split('_')[1]

                if(side == 'BUY' && (tgData.signalType == 'BUY' || tgData.signalType == 'TWO')){
                    const signalPrice = cPrice.bestBid;
                    // const price = tmepPrice - tgData.enter * 0.1

                    let enterST = false


                    // ATF_NEW != ATF_OLD == 'BUY' 즉시 진입 시켜버리기
                    // ATF == UT 같은 신호가 나오면 진입 대기
                    // ATF != UT 진입 취소
                    // ATF_NEW != ATF_OLD 청산

                    if(tgData.type == 'A'){
                        enterST = true;
                    }

                    if(enterST){
                        await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            'BUY',
                        ]);
                    }

                }
                else if(side == 'SELL' && (tgData.signalType == 'SELL' || tgData.signalType == 'TWO')){
                    const signalPrice = cPrice.bestAsk;
                    // const price = tmepPrice + tgData.enter * 0.1

                    let enterST = false

                    if(tgData.type == 'A'){
                        enterST = true;
                    }
                    
                    if(enterST){
                        await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            'SELL',
                        ]);
                    }

                }
            }catch(e){
                console.log('runEnter ERROR :: ', e);
            }
            
        }
        
        
        return true;
    }catch(e){
        console.log('!!!',e);
        return false;
    }
};

exports.enterCoin = async function(reqData){
    try{
        let side = null;

        if(reqData.type == 'gold'){
            side = 'BUY'
        }else{
            side = 'SELL'
        }

        const cPrice = dt.getPrice(reqData.symbol);


        if(!cPrice.st){
            return false;
        }
        
        const tgDataList = await dbcon.DBCall(`CALL SP_LIVE_PLAY_UUID_GET(?,?)`, [reqData.uuid, reqData.symbol]);
        const tgDataList2 = await dbcon.DBCall(`CALL SP_TEST_PLAY_UUID_GET(?,?)`, [reqData.uuid, reqData.symbol]);
        const itemList = tgDataList.concat(tgDataList2)

        for(let i=0;i<itemList.length;i++){
            try{
                const signalPrice = side == "BUY" ? cPrice.bestBid : cPrice.bestAsk;
                const tgData = itemList[i];
                
                let tgSide = null;
                if(side == 'BUY' && (tgData.signalType == 'BUY' || tgData.signalType == 'TWO')){
                    tgSide = 'BUY';
                }else if(side == 'SELL' && (tgData.signalType == 'SELL' || tgData.signalType == 'TWO')){
                    tgSide = 'SELL';
                }else{
                    continue;
                }
                
                // stoch, RSI, UT, mid, abs
                let enterST = false
                if(tgData.type == "stoch" || tgData.type == "scalping" || tgData.type == "greenlight" || tgData.type == "trend" || tgData.type == "RSI" || tgData.type == "UT"){
                    enterST = true;
                }


                if(enterST){
                    // console.log(tgSide);
                    if(tgData.live_ST == 'Y'){
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            tgSide,
                        ]);
                    }else{
                        await dbcon.DBCall(`CALL SP_TEST_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            tgSide,
                        ]);
                    }

                    
                }

            }catch(e){
                console.log('runEnter ERROR :: ', e);
            }
            
        }
        
        
        return true;
    }catch(e){
        console.log('!!!',e);
        return false;
    }
};


exports.enterATF_UT = async function(reqData){
    try{
        const reg_ex = /[^0-9]/g;

        if(reqData.type){
            await dbcon.DBCall(`CALL SP_LOG_ALERT_ADD3(?,?,?,?,?)`, [
                reqData.symbol,
                reqData.db_type,
                reqData.type,
                reqData.bunbong.replace(reg_ex, ""),
                new Date(parseInt(reqData.time)),
            ]);
    
    
            if(reqData.db_type == 'ATF'){
                exports.ATF_OLD[reqData.symbol][reqData.bunbong] = exports.ATF_NEW[reqData.symbol][reqData.bunbong];
                exports.ATF_NEW[reqData.symbol][reqData.bunbong] = reqData.type;
            }else if(reqData.db_type == 'UT'){
                exports.UT_OLD[reqData.symbol][reqData.bunbong] = exports.UT_NEW[reqData.symbol][reqData.bunbong];
                exports.UT_NEW[reqData.symbol][reqData.bunbong] = reqData.type;
            }
        }else{
            return false;
        }

        

        // console.log('----------');
        // console.log(`ATF_OLD:${exports.ATF_OLD[reqData.bunbong]}, ATF_NEW:${exports.ATF_NEW[reqData.bunbong]}\nUT_OLD:${exports.UT_OLD[reqData.bunbong]}, UT_NEW:${exports.UT_NEW[reqData.bunbong]}`);
        // console.log('----------');


        const cPrice = dt.getPrice(reqData.symbol);

        if(!cPrice.st){
            return false;
        }

        
        const tgDataList = await dbcon.DBCall(`CALL SP_LIVE_PLAY_Y_GET(?,?)`, [reqData.symbol, reqData.bunbong.replace(/\D/g, '')]);
        
        for(let i=0;i<tgDataList.length;i++){
            try{
                const tgData = tgDataList[i];
                // const bunbong = tgData.bunbong.split('_')[1]

                if(tgData.signalType == 'BUY' || tgData.signalType == 'TWO'){
                    const signalPrice = cPrice.bestBid;

                    // 1. ATF == UT 같은 신호가 나오면 진입 대기
                    // 2. 2 ATF_NEW != ATF_OLD == 'BUY' 즉시 진입 시켜버리기
                    // 3. ATF != UT 진입대기 취소
                    // 4. ATF_NEW != ATF_OLD 청산

                    // console.log(`BUN:${reqData.bunbong}, ATF_NEW:${exports.ATF_NEW[reqData.bunbong]}, UT_NEW:${exports.UT_NEW[reqData.bunbong]}`);

                    // 1. ATF == UT 같은 신호가 나오면 진입 대기
                    if(tgData.status == 'READY' && exports.ATF_NEW[reqData.bunbong] == 'LONG' && exports.UT_NEW[reqData.bunbong] == 'LONG'){
                        // console.log('1. ATF == UT 같은 신호가 나오면 진입 대기');
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            'BUY',
                        ]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            tgData.status == 'READY' ? '진입대기C' : '재진입대기C',
                            tgData.st,
                            'START',
                            tgData.status,
                            'EXACT_WAIT',
                            'BUY',
                            signalPrice,
                            null,
                        ]);
                    }
                    // 2. ATF_NEW != ATF_OLD == 'BUY' 즉시 진입 시켜버리기
                    else if(tgData.status == 'READY' && exports.ATF_OLD[reqData.bunbong] == 'SHORT' && exports.ATF_NEW[reqData.bunbong] == 'LONG'){
                        // console.log("2. ATF_NEW != ATF_OLD == 'BUY' 즉시 진입 시켜버리기");

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            'BUY',
                        ]);

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT(?,?,?,?,?)`,[tgData.id, tgData.uid, signalPrice, null, 0]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            '즉시진입C',
                            tgData.st,
                            'START',
                            tgData.status,
                            'EXACT',
                            'BUY',
                            signalPrice,
                            null,
                        ]);
                    }
                    // 3. ATF != UT 진입대기 취소
                    else if(tgData.status == 'EXACT_WAIT' && exports.ATF_NEW[reqData.bunbong] != exports.UT_NEW[reqData.bunbong]){
                        // console.log("3. ATF != UT 진입대기 취소");

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [tgData.id, tgData.autoST == 'Y' ? 'START' : 'STOP','READY']);
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [tgData.id]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            '진입취소C',
                            tgData.st,
                            tgData.autoST == 'Y' ? 'START' : 'STOP',
                            tgData.status,
                            'READY',
                            tgData.r_signalType,
                            signalPrice,
                            null,
                        ]);
                    }
                    // 4. ATF_NEW != ATF_OLD 청산
                    else if(tgData.status == 'EXACT' && exports.ATF_OLD[reqData.bunbong] == 'LONG' && exports.ATF_NEW[reqData.bunbong] == 'SHORT'){
                        // console.log("4. ATF_NEW != ATF_OLD 청산");

                        let endType = 'FORCING';
                        const re = exports.resultPrice(tgData.r_exactPrice, signalPrice, tgData.r_signalType);
                        
                        // if(re.pol_sum < 0){
                        //     endType = 
                        // }

                        const closeTime = new Date();

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            endType,
                            tgData.r_signalType,
                            tgData.r_signalPrice,
                            tgData.r_signalTime,
        
                            tgData.r_exactPrice,
                            signalPrice,
        
                            re.pol_tick,
                            re.pol_sum,
                            0,  //수수료
                            tgData.r_exactTime,
                            closeTime,
                        ]);
        
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [tgData.id, tgData.autoST == 'Y' ? 'START' : 'STOP','READY',]);
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [tgData.id]);
        
                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            '완료C_'+endType,
                            tgData.st,
                            tgData.autoST == 'Y' ? 'START' : 'STOP',
                            tgData.status,
                            'READY',
                            tgData.r_signalType,
                            signalPrice,
                            closeTime,
                        ]);
                    }

                }
                else if(tgData.signalType == 'SELL' || tgData.signalType == 'TWO'){
                    const signalPrice = cPrice.bestAsk;

                    // 1. ATF == UT 같은 신호가 나오면 진입 대기
                    if(tgData.status == 'READY' && exports.ATF_NEW[reqData.bunbong] == 'SHORT' && exports.UT_NEW[reqData.bunbong] == 'SHORT'){
                        // console.log('1. ATF == UT 같은 신호가 나오면 진입 대기');
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            'SELL',
                        ]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            tgData.status == 'READY' ? '진입대기C' : '재진입대기C',
                            tgData.st,
                            'START',
                            tgData.status,
                            'EXACT_WAIT',
                            'SELL',
                            signalPrice,
                            null,
                        ]);
                    }
                    // 2. ATF_NEW != ATF_OLD == 'BUY' 즉시 진입 시켜버리기
                    else if(tgData.status == 'READY' && exports.ATF_OLD[reqData.bunbong] == 'LONG' && exports.ATF_NEW[reqData.bunbong] == 'SHORT'){
                        // console.log("2. ATF_NEW != ATF_OLD == 'SELL' 즉시 진입 시켜버리기");

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT_WAIT(?,?,?,?)`, [
                            tgData.id,
                            null,
                            signalPrice,
                            'SELL',
                        ]);

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_EXACT(?,?,?,?,?)`,[tgData.id, tgData.uid, signalPrice, null, 0]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            '즉시진입C',
                            tgData.st,
                            'START',
                            tgData.status,
                            'EXACT',
                            'SELL',
                            signalPrice,
                            null,
                        ]);
                    }
                    // 3. ATF != UT 진입대기 취소
                    else if(tgData.status == 'EXACT_WAIT' && exports.ATF_NEW[reqData.bunbong] != exports.UT_NEW[reqData.bunbong]){
                        // console.log("3. ATF != UT 진입대기 취소");

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [tgData.id, tgData.autoST == 'Y' ? 'START' : 'STOP','READY']);
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [tgData.id]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            '진입취소C',
                            tgData.st,
                            tgData.autoST == 'Y' ? 'START' : 'STOP',
                            tgData.status,
                            'READY',
                            tgData.r_signalType,
                            signalPrice,
                            null,
                        ]);
                    }
                    // 4. ATF_NEW != ATF_OLD 청산
                    else if(tgData.status == 'EXACT' && exports.ATF_OLD[reqData.bunbong] == 'SHORT' && exports.ATF_NEW[reqData.bunbong] == 'LONG'){
                        // console.log("4. ATF_NEW != ATF_OLD 청산");

                        let endType = 'FORCING';
                        const re = exports.resultPrice(tgData.r_exactPrice, signalPrice, tgData.r_signalType);
                        
                        // if(re.pol_sum < 0){
                        //     endType = 
                        // }

                        const closeTime = new Date();

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_ST_CLOSE(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            endType,
                            tgData.r_signalType,
                            tgData.r_signalPrice,
                            tgData.r_signalTime,

                            tgData.r_exactPrice,
                            signalPrice,

                            re.pol_tick,
                            re.pol_sum,
                            0,  //수수료
                            tgData.r_exactTime,
                            closeTime,
                        ]);

                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [tgData.id, tgData.autoST == 'Y' ? 'START' : 'STOP','READY',]);
                        await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [tgData.id]);

                        await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
                            tgData.uid,
                            tgData.id,
                            null,
                            null,
                            '완료C_'+endType,
                            tgData.st,
                            tgData.autoST == 'Y' ? 'START' : 'STOP',
                            tgData.status,
                            'READY',
                            tgData.r_signalType,
                            signalPrice,
                            closeTime,
                        ]);
                    }

                }
            }catch(e){
                console.log('runEnter ERROR :: ', e);
            }
            
        }
        
        
        return true;
    }catch(e){
        console.log('!!!',e);
        return false;
    }
};

const onPlay = async () => {
    console.log('ON PLAY --------');

    //초기화
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ALL_INIT()`);
    await dbcon.DBCall(`CALL SP_TEST_PLAY_ALL_INIT()`);
}


const initLoadATF = async () => {
    const reg_ex = /[^0-9]/g;
    
    for(const key in exports.ATF_NEW){
        
        // // console.log(key.replace(reg_ex, ""))
        for(const k in exports.ATF_NEW[key]){
            const reData = await dbcon.DBOneCall(`CALL SP_A_LOAD_LOG(?,?)`,[key, k.replace(reg_ex, "")]);

            if(reData){
                exports.ATF_NEW[key][k] = reData.type;
            }
        }
    }

    // UT_NEW
    for(const key in exports.UT_NEW){
        
        // // console.log(key.replace(reg_ex, ""))
        for(const k in exports.UT_NEW[key]){
            const reData = await dbcon.DBOneCall(`CALL SP_A_LOAD_LOG2(?,?)`,[key, k.replace(reg_ex, "")]);

            if(reData){
                exports.UT_NEW[key][k] = reData.type;
            }
        }
    }




    // console.log(exports.ATF_NEW);
    // console.log(exports.UT_NEW);
}


initLoadATF();






coin.init();


setInterval(runMain, 1 * 300);
schedule.scheduleJob("0 0 * * *", onPlay);







