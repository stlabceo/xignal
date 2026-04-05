var express = require("express");
var router = express.Router();
const redisClient = require("../util/redis.util");
const db = require("../database/connect/config");
const crypto = require("crypto");
// const { check, validationResult } = require("express-validator");
const axios = require("axios");
const seon = require("../seon");
const dbcon = require("../dbcon");

const dt = require("../data");
const meta = require("../meta");
const dayjs = require("dayjs");
const fs = require("fs");
const iconv = require("iconv-lite");
const _ = require("lodash")
const {validateItemAdd, validateStart} = require('./validation');

const isEmpty = function (value) {
  if (
    value == "" ||
    value == null ||
    value == undefined ||
    (value != null && typeof value == "object" && !Object.keys(value).length)
  ) {
    return null;
  } else {
    return value;
  }
};

const isEmpty2 = function (value) {
  if (
    value == "" ||
    value == null ||
    value == undefined ||
    (value != null && typeof value == "object" && !Object.keys(value).length)
  ) {
    return 0;
  } else {
    return value;
  }
};

const isEmpty3 = function (value) {
  if (
    value == "" ||
    value == null ||
    value == undefined ||
    (value != null && typeof value == "object" && !Object.keys(value).length)
  ) {
    return "";
  } else {
    return value;
  }
};

const PY_M2_EX = 3.3058;
const M2_PY_EX = 0.3025;

/* GET home page. */
router.get("/", async function (req, res, next) {
  res.render("index", { title: "Express" });
});

router.post("/logout", async (req, res) => {
  const userId = req.decoded.userId;

  const n = await redisClient.v4.exists(userId);

  if (n) await redisClient.v4.del(userId);

  return res.status(200).json({
    status: 200,
  });
});

router.get("/myinfo", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_A_PER_MY_GET(?)`, [userId]);

  return res.send(reData);
});

router.get("/member", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_A_MEMBER_GET(?)`, [userId]);

  return res.send(reData);
});

router.get("/price", async (req, res) => {
  const userId = req.decoded.userId;

  // let reData = await dbcon.DBOneCall(`CALL SP_API_PRICE_GET()`);

  // return res.send({cur_price: seon.lsPrice});
  
  return res.send(dt.price);

  // if(req.query.type == 'META'){
  //   return res.send({
  //     offerho: seon.offerho,
  //     bidho: seon.bidho,
  //   });
  // }else if(req.query.type == 'LS'){
  //   return res.send({
  //     offerho: seon.LS_offerho,
  //     bidho: seon.LS_bidho,
  //   });
  // }else{
  //   return res.send(false);
  // }
  
});

router.get("/play", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBPageCall(`CALL SP_A_PLAY_GET(?,?,?)`, [
    userId,
    req.query.page,
    req.query.size
  ]);

  return res.send(reData);
});

router.get("/play/list", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_A_PLAY_LOG_LIST(?)`, [
    userId
  ]);

  return res.send(reData);
});

router.post("/play/auto", async (req, res) => {
  const userId = req.decoded.userId;
  const item = await dbcon.DBOneCall(`CALL SP_A_PLAY_DETAIL_ITEM(?)`, [req.body.id]);

  if(((!item.enter || !item.cancel) && item.direct1ST == 'N') || !item.profit || !item.stopLoss){
    return res.status(500).json({ errors: [{
        location: "body",
        msg: "계좌 설정 후 시도해주세요.",
        param: "body",
        value: "body",
      }] 
    });
  }

  if(!seon.marketST){
    return res.status(500).json({ errors: [{
        location: "body",
        msg: "06:00~09:00 트레이딩은 불가합니다.",
        param: "body",
        value: "body",
      }] 
    });
  }


  let allST = '';

  if (req.body.st == 'N'){
    allST = 'N';

    const logList = await dbcon.DBCall(`CALL SP_A_PLAY_LOG_GET(?,?)`, [
      userId,
      req.body.id,
    ]);

    
    for(let i=0;i<logList.length;i++){
      const log = logList[i];

      if(log.st == 'EXACT'){
        //강제 청산 시키기
        await dbcon.DBCall(`CALL SP_A_PLAY_SET_ST(?,?)`, [
          log.id,
          'FORCING',
        ]);


      }else if(log.st == 'PROFIT' || log.st == 'STOP' || log.st == 'FORCING' || log.st == 'FORCING_WAIT'){
        //PASS
        await dbcon.DBCall(`CALL SP_A_PLAY_SET_READY(?)`, [
          req.body.id
        ]);
      }else{
        //나머지는 다 삭제 하면 될듯?
        // await dbcon.DBCall(`CALL SP_A_PLAY_SET_DEL(?)`, [
        //   log.id
        // ]);
        // await dbcon.DBCall(`CALL SP_A_PLAY_SET_READY(?)`, [
        //   req.body.id
        // ]);

        await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[log.id, req.body.id, log.idx-1]);
      }
    }


    const p_list = await dbcon.DBCall(`CALL SP_A_PLAY_ALL(?,?)`, [userId, req.body.id]);

    let st = false;

    for(let i=0;i<p_list.length;i++){
      if(p_list[i].autoST == 'Y'){
        st = true;
        allST = 'Y';
        break;
      }
    }

    if(!st){
      await dbcon.DBCall(`CALL SP_U_USER_AUTO_EDIT(?,?)`, [userId, 'N']);
    }
  }else{
    allST = 'Y';
    await dbcon.DBCall(`CALL SP_U_USER_AUTO_EDIT(?,?)`, [userId, 'Y']);
  }

  await dbcon.DBCall(`CALL SP_A_PLAY_AUTO_SET(?,?)`, [
    req.body.id,
    req.body.st,
  ]);

  return res.send({allST: allST});
});

router.post("/play/auto/all", async (req, res) => {
  const userId = req.decoded.userId;
  const idList = req.body.idList;
  const st = req.body.st;

  for(let i=0;i<idList.length;i++){
    const isId = idList[i];
    const item = await dbcon.DBOneCall(`CALL SP_A_PLAY_DETAIL_ITEM(?)`, [isId]);

    if(((!item.enter || !item.cancel) && item.direct1ST == 'N') || !item.profit || !item.stopLoss){
      return res.status(500).json({ errors: [{
          location: "body",
          msg: "계좌 설정 후 시도해주세요.",
          param: "body",
          value: "body",
        }] 
      });
    }
  }

  if(!seon.marketST){
    return res.status(500).json({ errors: [{
        location: "body",
        msg: "06:00~09:00 트레이딩은 불가합니다.",
        param: "body",
        value: "body",
      }] 
    });
  }


  for(let i=0;i<idList.length;i++){
    const isId = idList[i];

    if (st == 'N'){
      const logList = await dbcon.DBCall(`CALL SP_A_PLAY_LOG_GET(?,?)`, [
        userId,
        isId,
      ]);
      
      for(let i=0;i<logList.length;i++){
        const log = logList[i];
  
        if(log.st == 'EXACT'){
          //강제 청산 시키기
          // console.log('청산시키기');
          await dbcon.DBCall(`CALL SP_A_PLAY_SET_ST(?,?)`, [
            log.id,
            'FORCING',
          ]);
        }else if(log.st == 'PROFIT' || log.st == 'STOP' || log.st == 'FORCING' || log.st == 'FORCING_WAIT'){
          //PASS
          await dbcon.DBCall(`CALL SP_A_PLAY_SET_READY(?)`, [
            isId
          ]);
        }else{
          //나머지는 다 삭제 하면 될듯?
          // await dbcon.DBCall(`CALL SP_A_PLAY_SET_DEL(?)`, [
          //   log.id
          // ]);
          // await dbcon.DBCall(`CALL SP_A_PLAY_SET_READY(?)`, [
          //   isId
          // ]);
          await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[log.id, isId, log.idx-1]);
        }
      }
    }
  
    await dbcon.DBCall(`CALL SP_A_PLAY_AUTO_SET(?,?)`, [
      isId,
      st,
    ]);

  }

  return res.send(true);
});

router.post("/play/del", async (req, res) => {
  const userId = req.decoded.userId;
  const idList = req.body.idList;

  for(let i=0;i<idList.length;i++){
    await dbcon.DBCall(`CALL SP_A_PLAY_DEL(?)`, [
      idList[i].id
    ]);
  }

  return res.send(true);
});

router.post("/play/allst", async (req, res) => {
  const userId = req.decoded.userId;

  await dbcon.DBCall(`CALL SP_U_USER_AUTO_EDIT(?,?)`, [userId, req.body.st]);

  return res.send(true);
});


router.get("/play/detail", async (req, res) => {
  const userId = req.decoded.userId;

  let play = await dbcon.DBOneCall(`CALL SP_A_PLAY_DETAIL_ITEM(?)`, [
    req.query.id
  ]);

  let logList = await dbcon.DBCall(`CALL SP_A_PLAY_DETAIL_LOG(?)`, [
    play?.id
  ]);

  let logGroup = await dbcon.DBOneCall(`CALL SP_A_PLAY_DETAIL_LOG_GROUP(?,?)`, [
    play?.id,
    play?.idx
  ]);

  return res.send({
    play:play,
    logList:logList,
    logGroup:logGroup,
  });
});

router.post('/play/add', async function(req, res){
	const userId = req.decoded.userId;

  const {cnt} = await dbcon.DBOneCall(`CALL SP_A_PLAY_LEN(?)`, [
    userId
  ]);

  if(100 <= cnt){
    return res.status(500).json({
      status: 500,
      message: "더 이상 추가할 수 없습니다."
    });
  }


  let sma_id = null
  let stoch_id = null
  let rsi_id = null
  req.body.second1 = 1;

  const type = req.body.bunbong.split('_')[0]
  const bunbong = req.body.bunbong.split('_')[1]

  const stochList = await dbcon.DBOneCall(`CALL SP_API_STOCH_GET(?,?,?,?)`,[
    bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,
  ]);


  // //새로 생성해야함
  if(!stochList){
    do{
      const uuid = seon.randomString(15);
      const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`,[uuid]);

      if(!uuidCK){
        stoch_id = uuid
      }

      await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?)`,[
        uuid,
        bunbong,
        req.body.second2,
        req.body.second3,
        req.body.second4,
      ]);

      await dbcon.DBCall(`CALL SP_API_COOL_ADD(?)`,[uuid]);

    }while(!stoch_id)
  }else{
    stoch_id = stochList.uuid;
  }
  
  const reData = await dbcon.DBOneCall(`CALL SP_A_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    userId,
    req.body.mode,
    req.body.bunbong,
    req.body.second1,
    req.body.second2,
    req.body.second3,
    req.body.second4,
    req.body.enter,
    req.body.cancel,
    req.body.profit,
    req.body.stopLoss,
    req.body.minimumOrderST,
    req.body.m_cancelStopLoss,
    req.body.m_profit,
    req.body.trendOrderST,
    req.body.t_cancelStopLoss,
    req.body.t_profit,
    req.body.t_chase,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,

    req.body.t_autoST,
    req.body.t_ST,

    req.body.t_direct,
    type,

    req.body.direct1ST,
    req.body.direct2ST,
    // t_type,
    // t_tick,
    // t_bunbong

    // req.body.t_long,
    // req.body.t_short,
    // req.body.t_same,
    // req.body.t_sameST,
  ]);

  // await dbcon.DBCall(`CALL SP_API_PLAY_RSI_EDIT(?,?)`,[reData.id, rsi_id]);
  await dbcon.DBCall(`CALL SP_API_PLAY_STOCH_EDIT(?,?)`,[reData.id, stoch_id]);

  if(!reData){
    return res.status(500).json({
      status: 500,
      message: "잠시 후 다시 시도해 주세요."
    });
  }else{
    return res.send(true);
  }
});

router.post('/play/edit', validateItemAdd, async function(req, res){
	const userId = req.decoded.userId;

  // let sma_id = null
  req.body.second1 = 1;
  
  let stoch_id = null
  // await dbcon.DBCall(`CALL SP_A_PLAY_EDIT_ST(?)`,[
  //   req.body.id,
  // ]);

  const type = req.body.bunbong.split('_')[0]
  const bunbong = req.body.bunbong.split('_')[1]
  
  const stochList = await dbcon.DBOneCall(`CALL SP_API_STOCH_GET(?,?,?,?)`,[
    bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,
  ]);

  //새로 생성해야함
  if(!stochList){
    do{
      const uuid = seon.randomString(15);
      const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`,[uuid]);

      if(!uuidCK){
        stoch_id = uuid
      }

      await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?)`,[
        uuid,
        bunbong,
        req.body.second2,
        req.body.second3,
        req.body.second4,
      ]);

      await dbcon.DBCall(`CALL SP_API_COOL_ADD(?)`,[uuid]);
    }while(!stoch_id)
  }else{
    stoch_id = stochList.uuid;
  }

  await dbcon.DBCall(`CALL SP_API_PLAY_STOCH_EDIT(?,?)`,[req.body.id, stoch_id]);

  const reData = await dbcon.DBCall(`CALL SP_A_PLAY_EDIT(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    req.body.id,
    req.body.bunbong,
    req.body.second1,
    req.body.second2,
    req.body.second3,
    req.body.second4,
    req.body.enter,
    req.body.cancel,
    req.body.profit,
    req.body.stopLoss,
    req.body.minimumOrderST,
    req.body.m_cancelStopLoss,
    req.body.m_profit,
    req.body.trendOrderST,
    req.body.t_cancelStopLoss,
    req.body.t_profit,
    req.body.t_chase,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,

    req.body.t_autoST,
    req.body.t_ST,
    req.body.t_direct,
    type,

    req.body.direct1ST,
    req.body.direct2ST,
    // t_type,
    // t_tick,
    // t_bunbong
    // req.body.t_long,
    // req.body.t_short,
    // req.body.t_same,
    // req.body.t_sameST,
  ]);

  if(reData === false){
    return res.status(500).json({
      status: 500,
      message: "잠시 후 다시 시도해 주세요."
    });
  }else{
    return res.send(true);
  }
});


router.get("/loglist", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBPageCall(`CALL SP_LOG_GET(?,?,?)`,[
    isEmpty(req.query.pid),
    req.query.page,
    req.query.size]
  );

  return res.send(reData);
});

router.post("/play/all/edit", async (req, res) => {
  const userId = req.decoded.userId;

  await dbcon.DBCall(`CALL SP_U_USER_ALL_EDIT(?,?,?,?,?,?)`, [
    userId,
    req.body.allExactST,
    req.body.allStopST,
    req.body.allExact,
    req.body.allStop,
    req.body.allStartST,
  ]);

  return res.send(true);
});


router.get("/result", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBPageCall(`CALL SP_A_RESULT_PAGE(?,?,?,?,?)`, [
    userId,
    req.query.page,
    req.query.size,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(reData);
});
router.get("/result/export", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_A_RESULT_EXPORT(?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(reData);
});
router.get("/result/detail", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBPageCall(`CALL SP_A_RESULT_DETAIL_PAGE(?,?,?,?)`, [
    userId,
    req.query.date,
    req.query.page,
    req.query.size
  ]);

  return res.send(reData);
});



router.post("/play/ex/add", async (req, res) => {
  const userId = req.decoded.userId;

  await dbcon.DBCall(`CALL SP_U_USER_PRICE_ADD(?,?)`, [
    userId,
    req.body.price,
  ]);

  return res.send(true);
});


router.post("/play/ex/del", async (req, res) => {
  const userId = req.decoded.userId;

  await dbcon.DBCall(`CALL SP_U_USER_PRICE_DEL(?,?)`, [
    userId,
    req.body.price,
  ]);

  return res.send(true);
});


router.post("/play/select", async (req, res) => {
  const userId = req.decoded.userId;

  const itemList = req.body.itemList;

  for(let i=0;i<itemList.length;i++){
    await dbcon.DBCall(`CALL SP_A_PLAY_SELECT(?,?)`, [
      itemList[i].id,
      itemList[i].st,
    ]);
  }


  return res.send(true);
});

router.post("/play/select/detail", async (req, res) => {
  const userId = req.decoded.userId;

  await dbcon.DBCall(`CALL SP_A_PLAY_DETAIL_TAP(?,?)`, [
    req.body.id,
    req.body.st,
  ]);

  return res.send(true);
});








router.get("/live/list", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_LIVE_PLAY_LOG_LIST(?)`, [
    userId
  ]);

  return res.send(reData);
});
router.get("/live/detail", async (req, res) => {
  const userId = req.decoded.userId;

  let play = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_DETAIL_ITEM(?)`, [
    req.query.id
  ]);

  // let logList = await dbcon.DBCall(`CALL SP_A_PLAY_DETAIL_LOG(?)`, [
  //   play?.id
  // ]);

  // let logGroup = await dbcon.DBOneCall(`CALL SP_A_PLAY_DETAIL_LOG_GROUP(?,?)`, [
  //   play?.id,
  //   play?.idx
  // ]);

  // return res.send({
  //   play:play,
  //   logList:{},
  //   logGroup:{},
  // });

  return res.send(play);
});
router.get("/live/detail/log", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  const reData = await dbcon.DBOriginCall(`CALL SP_LIVE_PLAY_DETAIL_LOG(?,?,?)`, [
    req.query.id,
    page,
    req.query.size
  ]);

  try{
    return res.send({
      status: true,
      item:reData[0],
      pageInfo:reData[1][0],
      sumObj:reData[2][0]
    });
  }catch(e){
    return res.send({
      status: false,
      item: [],
      pageInfo:[],
      sumObj:[]
    });
  }

  
});
router.post('/live/edit', async function(req, res){
  // validateItemAdd
	const userId = req.decoded.userId;
  req.body.second1 = 1;
  
  let stoch_id = null

  if(req.body.trendOrderST != 'Y'){
    req.body.t_cancelStopLoss = 0;
    req.body.t_chase = 0;
  }

  // const type = req.body.bunbong.split('_')[0]
  // const bunbong = req.body.bunbong.split('_')[1]
  
  const stochList = await dbcon.DBOneCall(`CALL SP_API_STOCH_GET(?,?,?,?,?,?)`,[
    req.body.symbol,
    req.body.type,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,
  ]);
  
  //새로 생성해야함
  if(!stochList){
    do{
      const uuid = seon.randomString(15);
      const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`,[uuid]);

      if(!uuidCK){
        stoch_id = uuid
      }

      await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?,?)`,[
        req.body.symbol,
        uuid,
        req.body.bunbong,
        req.body.second2,
        req.body.second3,
        req.body.second4,
      ]);

      await dbcon.DBCall(`CALL SP_API_COOL_ADD(?)`,[uuid]);
    }while(!stoch_id)
  }else{
    stoch_id = stochList.uuid;
  }

  // console.log(`${req.body.symbol} :::  ${req.body.second2}/${req.body.second3}/${req.body.second4}   ${stoch_id}`);

  await dbcon.DBCall(`CALL SP_LIVE_PLAY_STOCH_EDIT(?,?)`,[req.body.id, stoch_id]);
  
  const reData = await dbcon.DBCall(`CALL SP_ZZAR_LIVE_PLAY_EDIT(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    req.body.id,
    req.body.a_name,
    req.body.symbol,
    req.body.bunbong,
    req.body.second1,
    req.body.second2,
    req.body.second3,
    req.body.second4,
    
    req.body.marginType,
    req.body.AI_ST,

    req.body.limitST,

    isEmpty(req.body.enter),
    req.body.cancel,
    req.body.profit,
    req.body.stopLoss,

    req.body.leverage,
    req.body.margin,

    req.body.minimumOrderST,
    req.body.m_cancelStopLoss,
    req.body.m_profit,
    req.body.trendOrderST,
    req.body.t_cancelStopLoss,
    req.body.t_profit,
    req.body.t_chase,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,

    req.body.t_autoST,
    req.body.t_ST,
    req.body.t_direct,
    req.body.type,

    req.body.direct1ST,
    req.body.direct2ST,


    req.body.repeatConfig,
    isEmpty(req.body.profitTradeType),
    isEmpty(req.body.profitFixValue),
    isEmpty(req.body.profitAbsValue),
    isEmpty(req.body.lossTradeType),
    isEmpty(req.body.lossFixValue),
    isEmpty(req.body.lossAbsValue),
    isEmpty(req.body.absValue),

    // t_type,
    // t_tick,
    // t_bunbong
    // req.body.t_long,
    // req.body.t_short,
    // req.body.t_same,
    // req.body.t_sameST,
  ]);

  if(reData === false){
    return res.status(500).json({
      status: 500,
      message: "잠시 후 다시 시도해 주세요."
    });
  }else{
    return res.send(true);
  }
});
router.post('/live/add', async function(req, res){
  const userId = req.decoded.userId;
  req.body.second1 = 1;
  let stoch_id = null

  if(req.body.trendOrderST != 'Y'){
    req.body.t_cancelStopLoss = 0;
    req.body.t_chase = 0;
  }

  const stochList = await dbcon.DBOneCall(`CALL SP_API_STOCH_GET(?,?,?,?,?,?)`,[
    req.body.symbol,
    req.body.type,
    req.body.bunbong+'',
    req.body.second2+'',
    req.body.second3+'',
    req.body.second4+'',
  ]);



  //새로 생성해야함
  if(!stochList){
    do{
      const uuid = seon.randomString(15);
      const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`,[uuid]);

      if(!uuidCK){
        stoch_id = uuid
      }

      await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?,?)`,[
        req.body.symbol,
        uuid,
        req.body.bunbong,
        req.body.second2,
        req.body.second3,
        req.body.second4,
      ]);

      await dbcon.DBCall(`CALL SP_API_COOL_ADD(?)`,[uuid]);
    }while(!stoch_id)
  }else{
    stoch_id = stochList.uuid;
  }

  await dbcon.DBCall(`CALL SP_ZZAR_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    userId,
    stoch_id,
    req.body.a_name,
    req.body.symbol,
    req.body.bunbong,
    req.body.second1,
    req.body.second2,
    req.body.second3,
    req.body.second4,

    req.body.marginType,
    req.body.AI_ST,

    isEmpty(req.body.enter),
    req.body.cancel,
    req.body.profit,
    req.body.stopLoss,

    req.body.leverage,
    req.body.margin,

    req.body.minimumOrderST,
    req.body.m_cancelStopLoss,
    req.body.m_profit,
    req.body.trendOrderST,
    req.body.t_cancelStopLoss,
    req.body.t_profit,
    req.body.t_chase,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,

    req.body.t_autoST,
    req.body.t_ST,
    req.body.t_direct,
    req.body.type,

    req.body.direct1ST,
    req.body.direct2ST,


    req.body.repeatConfig,
    isEmpty(req.body.profitTradeType),
    isEmpty(req.body.profitFixValue),
    isEmpty(req.body.profitAbsValue),
    isEmpty(req.body.lossTradeType),
    isEmpty(req.body.lossFixValue),
    isEmpty(req.body.lossAbsValue),
    isEmpty(req.body.absValue),
    // t_type,
    // t_tick,
    // t_bunbong
    // req.body.t_long,
    // req.body.t_short,
    // req.body.t_same,
    // req.body.t_sameST,
  ]);

  return res.send(true);
});


router.post("/live/auto", async (req, res) => {
  const userId = req.decoded.userId;
  const socketId = req.app.users[userId];
  if (socketId) {
    req.app.io.to(socketId).emit('user-updated', {
        userId,
        message: '회원 정보가 업데이트되었습니다.',
    });
  }

  const item = await dbcon.DBOneCall(`CALL SP_LIVE_PLAY_DETAIL_ITEM(?)`, [req.body.id]);

  // console.log(
  //   item.enter,
  //   item.cancel,
  //   item.direct1ST,
  //   item.profit,
  //   item.stopLoss,
  // );

  // if(((item.enter == null || item.enter == undefined || !item.cancel) && item.direct1ST == 'N') || !item.profit || !item.stopLoss){
  //   return res.status(500).json({ errors: [{
  //       location: "body",
  //       msg: "계좌 설정 후 시도해주세요.",
  //       param: "body",
  //       value: "body",
  //     }] 
  //   });
  // }

  if(!seon.marketST){
    return res.status(500).json({ errors: [{
        location: "body",
        msg: "06:00~07:00 트레이딩은 불가합니다.",
        param: "body",
        value: "body",
      }] 
    });
  }


  let allST = '';

  if (req.body.st == 'N'){
    allST = 'N';

    if(item.status == 'EXACT'){
      //강제 청산 시키기
      // const closeData = await meta.closePo(item.r_tid, 1);

      // if(closeData.status){
      //   //상태값 수정
      //   await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [
      //     item.id,
      //     'START',
      //     'FORCING',
      //   ]);
      // }
      
      //상태값 수정
      await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [
        item.id,
        'START',
        'FORCING',
      ]);

      // await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
      //   item.uid,
      //   item.id,
      //   item.r_tid,
      //   null,
      //   '청산대기_U',
      //   item.st,
      //   'START',
      //   item.status,
      //   'FORCING',
      //   item.r_signalType,
      //   null,
      //   null,
      // ]);

    }else if(item.status == 'EXACT_WAIT'){
      // //주문 취소 시키고 초기화
      // //
      // const cancelOrder = await meta.cancelOrder(item.r_tid)

      // if(cancelOrder.status){
        //상태 값 수정

      await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [
        item.id,
        item.autoST == 'Y' ? 'START' : 'STOP',
        'READY',
      ]);

      //휘발성 데이터 초기화
      await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [item.id]);

      await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
        item.uid,
        item.id,
        item.r_tid,
        null,
        '진입취소_U',
        item.st,
        item.autoST == 'Y' ? 'START' : 'STOP',
        item.status,
        'READY',
        item.r_signalType,
        null,
        null,
      ]);
      // }

    }else{
      //상태 값 수정
      await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [
        item.id,
        item.autoST == 'Y' ? 'START' : 'STOP',
        'READY',
      ]);

      //휘발성 데이터 초기화
      await dbcon.DBCall(`CALL SP_LIVE_PLAY_INIT(?)`, [item.id]);

      await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
        item.uid,
        item.id,
        null,
        null,
        '중지_U',
        item.st,
        item.autoST == 'Y' ? 'START' : 'STOP',
        item.status,
        'READY',
        null,
        null,
        null,
      ]);
    }
    
   
    
    // const p_list = await dbcon.DBCall(`CALL SP_A_PLAY_ALL(?,?)`, [userId, req.body.id]);

    // let st = false;
    // for(let i=0;i<p_list.length;i++){
    //   if(p_list[i].autoST == 'Y'){
    //     st = true;
    //     allST = 'Y';
    //     break;
    //   }
    // }

    // if(!st){
    //   await dbcon.DBCall(`CALL SP_U_USER_AUTO_EDIT(?,?)`, [userId, 'N']);
    // }
  }else{

    allST = 'Y';
    // await dbcon.DBCall(`CALL SP_U_USER_AUTO_EDIT(?,?)`, [userId, 'Y']);

    //시작
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [
      item.id,
      'START',
      'READY',
    ]);

    await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
      item.uid,
      item.id,
      null,
      null,
      '시작_U',
      item.st,
      'START',
      item.status,
      'READY',
      null,
      null,
      null,
    ]);
  }

  await dbcon.DBCall(`CALL SP_LIVE_PLAY_AUTO_SET(?,?)`, [
    req.body.id,
    req.body.st,
  ]);

  return res.send({allST: allST});
});
router.post("/live/select", async (req, res) => {
  const userId = req.decoded.userId;

  const itemList = req.body.itemList;

  for(let i=0;i<itemList.length;i++){
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_SELECT(?,?)`, [
      itemList[i].id,
      itemList[i].st,
    ]);
  }

  return res.send(true);
});
router.post("/live/select/detail", async (req, res) => {
  const userId = req.decoded.userId;

  await dbcon.DBCall(`CALL SP_LIVE_PLAY_DETAIL_TAP(?,?)`, [
    req.body.id,
    req.body.st,
  ]);

  return res.send(true);
});
router.get("/live/result", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_LIVE_RESULT_PAGE(?,?,?,?,?)`, [
    userId,
    page,
    req.query.size,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(reData);
});
router.get("/live/result/export", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_LIVE_RESULT_EXPORT(?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(reData);
});
router.get("/live/result/detail", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  const reData = await dbcon.DBOriginCall(`CALL SP_LIVE_RESULT_DETAIL_PAGE(?,?,?,?)`, [
    userId,
    req.query.date,
    page,
    req.query.size
  ]);

  return res.send({
    item:reData[0],
    pageInfo:reData[1][0],
    sumObj:reData[2][0]
  });
});


router.get("/test/list", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_TEST_PLAY_LOG_LIST(?)`, [
    userId
  ]);

  return res.send(reData);
});
router.get("/test/detail", async (req, res) => {
  const userId = req.decoded.userId;

  let play = await dbcon.DBOneCall(`CALL SP_TEST_PLAY_DETAIL_ITEM(?)`, [
    req.query.id
  ]);

  // let logList = await dbcon.DBCall(`CALL SP_A_PLAY_DETAIL_LOG(?)`, [
  //   play?.id
  // ]);

  // let logGroup = await dbcon.DBOneCall(`CALL SP_A_PLAY_DETAIL_LOG_GROUP(?,?)`, [
  //   play?.id,
  //   play?.idx
  // ]);

  // return res.send({
  //   play:play,
  //   logList:{},
  //   logGroup:{},
  // });

  return res.send(play);
});
router.get("/test/detail/log", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  const reData = await dbcon.DBOriginCall(`CALL SP_TEST_PLAY_DETAIL_LOG(?,?,?)`, [
    req.query.id,
    page,
    req.query.size
  ]);

  try{
    return res.send({
      status: true,
      item:reData[0],
      pageInfo:reData[1][0],
      sumObj:reData[2][0]
    });
  }catch(e){
    return res.send({
      status: false,
      item: [],
      pageInfo:[],
      sumObj:[]
    });
  }

  
});
router.post('/test/edit', async function(req, res){
  // validateItemAdd
  // console.log(req.body);
  // return res.send(true);

	const userId = req.decoded.userId;
  req.body.second1 = 1;
  
  let stoch_id = null

  if(req.body.trendOrderST != 'Y'){
    req.body.t_cancelStopLoss = 0;
    req.body.t_chase = 0;
  }

  // const type = req.body.bunbong.split('_')[0]
  // const bunbong = req.body.bunbong.split('_')[1]
  
  const stochList = await dbcon.DBOneCall(`CALL SP_API_STOCH_GET(?,?,?,?,?,?)`,[
    req.body.symbol,
    req.body.type,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,
  ]);

  //새로 생성해야함
  if(!stochList){
    do{
      const uuid = seon.randomString(15);
      const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`,[uuid]);

      if(!uuidCK){
        stoch_id = uuid
      }

      await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?,?)`,[
        req.body.symbol,
        uuid,
        req.body.bunbong,
        req.body.second2,
        req.body.second3,
        req.body.second4,
      ]);

      await dbcon.DBCall(`CALL SP_API_COOL_ADD(?)`,[uuid]);
    }while(!stoch_id)
  }else{
    stoch_id = stochList.uuid;
  }

  // console.log(`${req.body.symbol} :::  ${req.body.second2}/${req.body.second3}/${req.body.second4}   ${stoch_id}`);

  await dbcon.DBCall(`CALL SP_TEST_PLAY_STOCH_EDIT(?,?)`,[req.body.id, stoch_id]);

  const reData = await dbcon.DBCall(`CALL SP_ZZAR_TEST_PLAY_EDIT(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    req.body.id,
    req.body.a_name,
    req.body.symbol,
    req.body.bunbong,
    req.body.second1,
    req.body.second2,
    req.body.second3,
    req.body.second4,

    req.body.marginType,
    req.body.AI_ST,

    req.body.limitST,

    isEmpty(req.body.enter),
    req.body.cancel,
    req.body.profit,
    req.body.stopLoss,

    req.body.leverage,
    req.body.margin,

    req.body.minimumOrderST,
    req.body.m_cancelStopLoss,
    req.body.m_profit,
    req.body.trendOrderST,
    req.body.t_cancelStopLoss,
    req.body.t_profit,
    req.body.t_chase,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,

    req.body.t_autoST,
    req.body.t_ST,
    req.body.t_direct,
    req.body.type,

    req.body.direct1ST,
    req.body.direct2ST,


    req.body.repeatConfig,
    isEmpty(req.body.profitTradeType),
    isEmpty(req.body.profitFixValue),
    isEmpty(req.body.profitAbsValue),
    isEmpty(req.body.lossTradeType),
    isEmpty(req.body.lossFixValue),
    isEmpty(req.body.lossAbsValue),
    isEmpty(req.body.absValue),
    // t_type,
    // t_tick,
    // t_bunbong
    // req.body.t_long,
    // req.body.t_short,
    // req.body.t_same,
    // req.body.t_sameST,
  ]);

  if(reData === false){
    return res.status(500).json({
      status: 500,
      message: "잠시 후 다시 시도해 주세요."
    });
  }else{
    return res.send(true);
  }
});

router.post('/test/add', async function(req, res){
  const userId = req.decoded.userId;
  req.body.second1 = 1;
  let stoch_id = null

  if(req.body.trendOrderST != 'Y'){
    req.body.t_cancelStopLoss = 0;
    req.body.t_chase = 0;
  }

  const stochList = await dbcon.DBOneCall(`CALL SP_API_STOCH_GET(?,?,?,?,?,?)`,[
    req.body.symbol,
    req.body.type,
    req.body.bunbong,
    req.body.second2,
    req.body.second3,
    req.body.second4,
  ]);

  //새로 생성해야함
  if(!stochList){
    do{
      const uuid = seon.randomString(15);
      const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`,[uuid]);

      if(!uuidCK){
        stoch_id = uuid
      }

      await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?,?)`,[
        req.body.symbol,
        uuid,
        req.body.bunbong,
        req.body.second2,
        req.body.second3,
        req.body.second4,
      ]);

      await dbcon.DBCall(`CALL SP_API_COOL_ADD(?)`,[uuid]);
    }while(!stoch_id)
  }else{
    stoch_id = stochList.uuid;
  }

  await dbcon.DBCall(`CALL SP_ZZAR_TEST_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    userId,
    stoch_id,
    req.body.a_name,
    req.body.symbol,
    req.body.bunbong,
    req.body.second1,
    req.body.second2,
    req.body.second3,
    req.body.second4,

    req.body.marginType,
    req.body.AI_ST,

    isEmpty(req.body.enter),
    req.body.cancel,
    req.body.profit,
    req.body.stopLoss,

    req.body.leverage,
    req.body.margin,

    req.body.minimumOrderST,
    req.body.m_cancelStopLoss,
    req.body.m_profit,
    req.body.trendOrderST,
    req.body.t_cancelStopLoss,
    req.body.t_profit,
    req.body.t_chase,
    req.body.signalType,
    req.body.alarmSignalST,
    req.body.alarmResultST,
    req.body.orderSize,

    req.body.t_autoST,
    req.body.t_ST,
    req.body.t_direct,
    req.body.type,

    req.body.direct1ST,
    req.body.direct2ST,


    req.body.repeatConfig,
    isEmpty(req.body.profitTradeType),
    isEmpty(req.body.profitFixValue),
    isEmpty(req.body.profitAbsValue),
    isEmpty(req.body.lossTradeType),
    isEmpty(req.body.lossFixValue),
    isEmpty(req.body.lossAbsValue),
    isEmpty(req.body.absValue),
    // t_type,
    // t_tick,
    // t_bunbong
    // req.body.t_long,
    // req.body.t_short,
    // req.body.t_same,
    // req.body.t_sameST,
  ]);

  return res.send(true);
});

router.post("/test/auto", async (req, res) => {
  const userId = req.decoded.userId;
  const socketId = req.app.users[userId];
  if (socketId) {
    req.app.io.to(socketId).emit('user-updated', {
        userId,
        message: '회원 정보가 업데이트되었습니다.',
    });
  }

  const item = await dbcon.DBOneCall(`CALL SP_TEST_PLAY_DETAIL_ITEM(?)`, [req.body.id]);

  // if(((item.enter == null || item.enter == undefined || !item.cancel) && item.direct1ST == 'N') || !item.profit || !item.stopLoss){
  //   return res.status(500).json({ errors: [{
  //       location: "body",
  //       msg: "계좌 설정 후 시도해주세요.",
  //       param: "body",
  //       value: "body",
  //     }] 
  //   });
  // }

  if(!seon.marketST){
    return res.status(500).json({ errors: [{
        location: "body",
        msg: "06:00~07:00 트레이딩은 불가합니다.",
        param: "body",
        value: "body",
      }] 
    });
  }


  let allST = '';

  if (req.body.st == 'N'){
    allST = 'N';

    if(item.status == 'EXACT'){
      //상태값 수정
      await dbcon.DBCall(`CALL SP_TEST_PLAY_SET_ST(?,?,?)`, [
        item.id,
        'START',
        'FORCING',
      ]);
    }else if(item.status == 'EXACT_WAIT'){
      // //주문 취소 시키고 초기화
      await dbcon.DBCall(`CALL SP_TEST_PLAY_SET_ST(?,?,?)`, [
        item.id,
        item.autoST == 'Y' ? 'START' : 'STOP',
        'READY',
      ]);

      //휘발성 데이터 초기화
      await dbcon.DBCall(`CALL SP_TEST_PLAY_INIT(?)`, [item.id]);

      await dbcon.DBCall(`CALL SP_TEST_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
        item.uid,
        item.id,
        item.r_tid,
        null,
        '진입취소_U',
        item.st,
        item.autoST == 'Y' ? 'START' : 'STOP',
        item.status,
        'READY',
        item.r_signalType,
        null,
        null,
      ]);
      // }

    }else{
      //상태 값 수정
      await dbcon.DBCall(`CALL SP_TEST_PLAY_SET_ST(?,?,?)`, [
        item.id,
        item.autoST == 'Y' ? 'START' : 'STOP',
        'READY',
      ]);

      //휘발성 데이터 초기화
      await dbcon.DBCall(`CALL SP_TEST_PLAY_INIT(?)`, [item.id]);

      await dbcon.DBCall(`CALL SP_TEST_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
        item.uid,
        item.id,
        null,
        null,
        '중지_U',
        item.st,
        item.autoST == 'Y' ? 'START' : 'STOP',
        item.status,
        'READY',
        null,
        null,
        null,
      ]);
    }
    
   
    
    // const p_list = await dbcon.DBCall(`CALL SP_A_PLAY_ALL(?,?)`, [userId, req.body.id]);

    // let st = false;
    // for(let i=0;i<p_list.length;i++){
    //   if(p_list[i].autoST == 'Y'){
    //     st = true;
    //     allST = 'Y';
    //     break;
    //   }
    // }

    // if(!st){
    //   await dbcon.DBCall(`CALL SP_U_USER_AUTO_EDIT(?,?)`, [userId, 'N']);
    // }
  }else{

    allST = 'Y';
    // await dbcon.DBCall(`CALL SP_U_USER_AUTO_EDIT(?,?)`, [userId, 'Y']);

    //시작
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [
      item.id,
      'START',
      'READY',
    ]);

    await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
      item.uid,
      item.id,
      null,
      null,
      '시작_U',
      item.st,
      'START',
      item.status,
      'READY',
      null,
      null,
      null,
    ]);
  }

  await dbcon.DBCall(`CALL SP_TEST_PLAY_AUTO_SET(?,?)`, [
    req.body.id,
    req.body.st,
  ]);

  return res.send({allST: allST});
});
router.post("/test/select", async (req, res) => {
  const userId = req.decoded.userId;

  const itemList = req.body.itemList;

  for(let i=0;i<itemList.length;i++){
    await dbcon.DBCall(`CALL SP_TEST_PLAY_SELECT(?,?)`, [
      itemList[i].id,
      itemList[i].st,
    ]);
  }

  return res.send(true);
});
router.post("/test/select/detail", async (req, res) => {
  const userId = req.decoded.userId;

  await dbcon.DBCall(`CALL SP_TEST_PLAY_DETAIL_TAP(?,?)`, [
    req.body.id,
    req.body.st,
  ]);

  return res.send(true);
});
router.get("/test/result", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_TEST_RESULT_PAGE(?,?,?,?,?)`, [
    userId,
    page,
    req.query.size,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(reData);
});
router.get("/test/result/export", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_TEST_RESULT_EXPORT(?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,
  ]);

  return res.send(reData);
});
router.get("/test/result/detail", async (req, res) => {
  const userId = req.decoded.userId;

  const page = (req.query.page - 1) * req.query.size

  const reData = await dbcon.DBOriginCall(`CALL SP_TEST_RESULT_DETAIL_PAGE(?,?,?,?)`, [
    userId,
    req.query.date,
    page,
    req.query.size
  ]);

  return res.send({
    item:reData[0],
    pageInfo:reData[1][0],
    sumObj:reData[2][0]
  });
});

router.get("/test/result/item", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_TEST_RESULT_ITEM(?,?,?,?,?,?)`, [
    userId,
    req.query.id,
    req.query.sDate,
    req.query.eDate,

    page,
    req.query.size,
  ]);

  return res.send(reData);
});
router.get("/live/result/item", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_LIVE_RESULT_ITEM(?,?,?,?,?,?)`, [
    userId,
    req.query.id,
    req.query.sDate,
    req.query.eDate,

    page,
    req.query.size,
  ]);

  return res.send(reData);
});
router.get("/test/result/all", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_TEST_RESULT_ALL(?,?,?,?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,

    req.query.pid,

    page,
    req.query.size,
  ]);

  return res.send(reData);
});
router.get("/live/result/all", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_LIVE_RESULT_ALL(?,?,?,?,?,?)`, [
    userId,
    req.query.sDate,
    req.query.eDate,

    req.query.pid,

    page,
    req.query.size,
  ]);

  return res.send(reData);
});
router.get("/live/result/exact/all", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_LIVE_RESULT_EXACT_ALL(?)`, [
    userId
  ]);

  return res.send(reData);
});
router.get("/test/result/exact/all", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_TEST_RESULT_EXACT_ALL(?)`, [
    userId
  ]);

  return res.send(reData);
});

router.get("/live/detail/item/rate", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_LIVE_DETAIL_ITEM_RATE(?)`, [
    req.query.id
  ]);

  return res.send(reData);
});
router.get("/test/detail/item/rate", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_TEST_DETAIL_ITEM_RATE(?)`, [
    req.query.id
  ]);

  return res.send(reData);
});

router.get("/live/detail/rate", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_LIVE_DETAIL_RATE(?)`, [
    userId
  ]);

  return res.send(reData);
});
router.get("/test/detail/rate", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_TEST_DETAIL_RATE(?)`, [
    userId
  ]);

  return res.send(reData);
});

router.get("/live/result/name", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBCall(`CALL SP_LIVE_RESULT_NAME(?)`, [
    userId
  ]);

  return res.send(reData);
});

router.get("/test/result/name", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBCall(`CALL SP_TEST_RESULT_NAME(?)`, [
    userId
  ]);

  return res.send(reData);
});


router.get("/msg/item", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBCall(`CALL SP_MSG_PLAY_GET(?,?)`, [
    userId,
    req.query.pid,
  ]);

  return res.send(reData);
});

router.get("/msg", async (req, res) => {
  const userId = req.decoded.userId;
  const page = (req.query.page - 1) * req.query.size

  let reData = await dbcon.DBPageCall(`CALL SP_MSG_GET(?,?,?)`, [
    userId,
    page,
    req.query.size,
  ]);

  return res.send(reData);
});

router.get("/msg/alert", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_MSG_ONE_GET(?)`, [
    userId,
  ]);

  return res.send(reData);
});


router.get("/zzar/line", async (req, res) => {
  const userId = req.decoded.userId;

  let reData = await dbcon.DBOneCall(`CALL SP_ZZAR_LINE_GET(?,?)`, [
    userId,
    req.query.symbol
  ]);

  if(reData){
    return res.send(reData);
  }else{
    await dbcon.DBCall(`CALL SP_ZZAR_LINE_ADD(?,?)`, [
      userId,
      req.query.symbol
    ]);

    reData = await dbcon.DBOneCall(`CALL SP_ZZAR_LINE_GET(?,?)`, [
      userId,
      req.query.symbol
    ]);

    return res.send(reData);
  }
});
router.post("/zzar/line", async (req, res) => {
  const userId = req.decoded.userId;

  await dbcon.DBCall(`CALL SP_ZZAR_LINE_EDIT(?,?,?,?)`, [
    userId,
    req.body.symbol,
    isEmpty(req.body.subLine),
    isEmpty(req.body.resLine),
  ]);

  return res.send(true);
});


router.get("/candle/data", async (req, res) => {
  let reData = await dbcon.DBCall(`CALL SP_C_CANDLE_GET(?,?)`, [
    req.query.bunbong,
    req.query.symbol,
  ]);



  // if(dt.price){
  //   // console.log(dt.price.ETHUSDT);
  //   for(let i=0;i<reData.length;i++){
  //     try{
  //       const price =  parseFloat(dt.price.BTCUSDT.bestBid);
  //       const symbol = reData[i].symbol;
  //       const close = parseFloat(reData[i].CLOSE_NOW);
  //       const bunbong = reData[i].bunbong;
  
  //       if(symbol != 'BTCUSDT'){
  //         continue;
  //       }
  
  //       // 증감률(%) = (현재값 - 과거값) / 과거값 × 100
  //       console.log(`[${bunbong}]${symbol} :: ${(price-close)/close*100}`);

  //     }catch(e){

  //     }
      

  //   }
  // }


  return res.send(reData);
});



module.exports = router;


