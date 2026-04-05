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

const { validateRegister, validateRegister1, validateRegister2, validateLogin } = require('./validation');
const fs = require("fs");

const coolsms = require('coolsms-node-sdk').default;
const messageService = new coolsms(process.env.COOL_SMS_KEY, process.env.COOL_SMS_SECRET);

/////////////////////////
const 분봉 = 1
const 옵1 = 5
const 옵2 = 3
const 옵3 = 3

const 진입 = 0
const 취소 = 0
const 일차익절 = 0
const 손절 = 0
//////////////////////////
const 손절취소ST = 'N'
const 손절취소 = 0
const b2차익절 = 0
/////////////////////////
const 추세주문ST = 'N'
const 즉시진입ST = 'N'
const 추격ST = 'N'
const 자동청산ST = 'N'
const 손절익절취소 = 0
const c2차익절 = 0
const 추세추격 = 0
/////////////////////////


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
        {msg:'이름과 이메일을 입력해주세요', param: "userId", location: "body"},
        {msg:'이름과 이메일을 입력해주세요', param: "password", location: "body"},
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
// router.post('/api/hook', async function(req, res){
//   const reg_ex = /[^0-9]/g;
//   const reqData = req.body;

//   if(reqData && reqData.db_type == 'stoch'){
//     await seon.coolSET(reqData);
//   }else if(reqData && (reqData.db_type == 'UT' || reqData.db_type == 'ATF')){
//     await dbcon.DBCall(`CALL SP_LOG_ALERT_ADD3(?,?,?,?)`, [
//       reqData.db_type,
//       reqData.type,
//       reqData.bunbong.replace(reg_ex, ""),
//       new Date(parseInt(reqData.time)),
//     ]);
//   }

  
//   if(reqData.db_type == 'UT'){
//     seon.UT_OLD[reqData.bunbong] = seon.UT_NEW[reqData.bunbong]
//     seon.UT_NEW[reqData.bunbong] = reqData.type
//     const reqBun = reqData.bunbong.replace(reg_ex, "");
//     const tgDataList = await dbcon.DBCall(`CALL SP_API_PLAY_Y_GET(?)`,[reqBun]);

//     for(let i=0;i<tgDataList.length;i++){
//       try{
//         const tgData = tgDataList[i];
//         const bunbong = tgData.bunbong.split('_')[1]
//         let logItem = await dbcon.DBOneCall(`CALL SP_API_PLAY_LOG_ITEM2_GET(?,?,?)`, [
//           tgData.id,
//           tgData.uid,
//           tgData.idx,
//         ]);

//         // console.log(`${tgData.type} ${bunbong} ATF :: ${seon.ATF_NEW[bunbong+'m']}, UT :: ${seon.UT_NEW[bunbong+'m']}`);

//         // if(logItem?.signalType == 'SELL' && tgData.st == 'START' && logItem.st == 'EXACT_WAIT' && tgData.type == 'C' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && seon.UT_NEW[bunbong+'m'] == 'LONG'){
//         //   // 골드크로스 숏포지션 진입 취소
//         //   const price = logItem.signalType == 'BUY' ? seon.offerho : seon.bidho

//         //   await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[logItem.id, tgData.id, tgData.idx-1]);

//         //   await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//         //       tgData.uid,
//         //       tgData.id,
//         //       logItem.id,
//         //       tgData.stoch_id,
//         //       null,
//         //       null,
//         //       '취소' + tgData.type,
//         //       null,
//         //       price,
//         //       null,
//         //       null,
//         //       null,
//         //       null,
//         //       null,
//         //       null,
//         //   ]);
//         // }else if(logItem?.signalType == 'BUY' && tgData.st == 'START' && logItem.st == 'EXACT_WAIT' && tgData.type == 'C' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && seon.UT_NEW[bunbong+'m'] == 'SHORT'){
//         //   // 데드크로스 롱포지션 진입 취소
//         //   const price = logItem.signalType == 'BUY' ? seon.offerho : seon.bidho

//         //   await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[logItem.id, tgData.id, tgData.idx-1]);

//         //   await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//         //     tgData.uid,
//         //     tgData.id,
//         //     logItem.id,
//         //     tgData.stoch_id,
//         //     null,
//         //     null,
//         //     '취소' + tgData.type,
//         //     null,
//         //     price,
//         //     null,
//         //     null,
//         //     null,
//         //     null,
//         //     null,
//         //     null,
//         //   ]);
//         // }
        
        
//         if((tgData.signalType == 'BUY' || tgData.signalType == 'TWO') && tgData.type == 'C' && tgData.st == 'READY' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && seon.UT_NEW[bunbong+'m'] == 'LONG'){
//           //롱포지션 진입대기
//           const price = tgData.signalType == 'BUY' ? seon.offerho : seon.bidho

//           const logObj = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//             tgData.id,
//             tgData.uid,
//             price,
//             tgData.idx+1,
//             'BUY',
//           ]);

//           await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//             tgData.uid,
//             tgData.id,
//             logObj.id,
//             reqData.uuid,
//             reqData.db_type,
//             reqData.type,
//             '신호발생' + tgData.type,
//             price,
//             null,
//             tgData.bunbong,
//             tgData.second1,
//             tgData.second2,
//             tgData.second3,
//             tgData.second4,
//             new Date(parseInt(reqData.time)),
//           ]);
//         }else if((tgData.signalType == 'SELL' || tgData.signalType == 'TWO') && tgData.type == 'C' && tgData.st == 'READY' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && seon.UT_NEW[bunbong+'m'] == 'SHORT'){
//           //숏포지션 진입
//           const price = tgData.signalType == 'BUY' ? seon.offerho : seon.bidho

//           const logObj = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//             tgData.id,
//             tgData.uid,
//             price,
//             tgData.idx+1,
//             'SELL',
//           ]);

//           await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//             tgData.uid,
//             tgData.id,
//             logObj.id,
//             reqData.uuid,
//             reqData.db_type,
//             reqData.type,
//             '신호발생' + tgData.type,
//             price,
//             null,
//             tgData.bunbong,
//             tgData.second1,
//             tgData.second2,
//             tgData.second3,
//             tgData.second4,
//             new Date(parseInt(reqData.time)),
//           ]);
//         }
        
//         // else if((tgData.signalType == 'BUY' || tgData.signalType == 'TWO') && tgData.type == 'C' && logItem?.st == 'EXACT_WAIT' && tgData.autoST == 'Y' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && seon.UT_NEW[bunbong+'m'] == 'LONG'){
//         //   //롱포지션 새로운 진입
//         //   const price = tgData.signalType == 'BUY' ? seon.offerho : seon.bidho
//         //   await dbcon.DBCall(`CALL SP_API_PLAY_ST_EXACT_WAIT_UPDATE(?,?,?)`, [
//         //     logItem.id,
//         //     price,
//         //     'BUY',
//         //   ]);

//         //   await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//         //     tgData.uid,
//         //     tgData.id,
//         //     logItem.id,
//         //     reqData.uuid,
//         //     reqData.db_type,
//         //     reqData.type,
//         //     '신호갱신' + tgData.type,
//         //     price,
//         //     null,
//         //     tgData.bunbong,
//         //     tgData.second1,
//         //     tgData.second2,
//         //     tgData.second3,
//         //     tgData.second4,
//         //     new Date(parseInt(reqData.time)),
//         //   ]);
//         // }else if((tgData.signalType == 'SELL' || tgData.signalType == 'TWO') && tgData.type == 'C' && logItem?.st == 'EXACT_WAIT' && tgData.autoST == 'Y' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && seon.UT_NEW[bunbong+'m'] == 'SHORT'){
//         //   //숏포지션 새로운 진입
//         //   const price = tgData.signalType == 'BUY' ? seon.offerho : seon.bidho
//         //   await dbcon.DBCall(`CALL SP_API_PLAY_ST_EXACT_WAIT_UPDATE(?,?,?)`, [
//         //     logItem.id,
//         //     price,
//         //     'SELL',
//         //   ]);

//         //   await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//         //     tgData.uid,
//         //     tgData.id,
//         //     logItem.id,
//         //     reqData.uuid,
//         //     reqData.db_type,
//         //     reqData.type,
//         //     '신호갱신' + tgData.type,
//         //     price,
//         //     null,
//         //     tgData.bunbong,
//         //     tgData.second1,
//         //     tgData.second2,
//         //     tgData.second3,
//         //     tgData.second4,
//         //     new Date(parseInt(reqData.time)),
//         //   ]);
//         // }

//       }catch(e){
//         console.log('api/hook ERROR :: ', e)
//       }
//     }

//   }else if(reqData.db_type == 'ATF'){
//     seon.ATF_OLD[reqData.bunbong] = seon.ATF_NEW[reqData.bunbong]
//     seon.ATF_NEW[reqData.bunbong] = reqData.type

//     const reqBun = reqData.bunbong.replace(reg_ex, "");
//     const tgDataList = await dbcon.DBCall(`CALL SP_API_PLAY_Y_GET(?)`,[reqBun]);

//     for(let i=0;i<tgDataList.length;i++){
//       try{
//         const tgData = tgDataList[i];
//         const bunbong = tgData.bunbong.split('_')[1]
//         let logItem = await dbcon.DBOneCall(`CALL SP_API_PLAY_LOG_ITEM2_GET(?,?,?)`, [
//           tgData.id,
//           tgData.uid,
//           tgData.idx,
//         ]);

//         // console.log(`${tgData.type} ${bunbong} ATF :: ${seon.ATF_NEW[bunbong+'m']}, UT :: ${seon.UT_NEW[bunbong+'m']}`);
//         if(
//           (tgData.signalType == 'BUY' || tgData.signalType == 'TWO')
//           && (tgData.st == 'START' || tgData.st == 'READY' || logItem?.st == 'EXACT_WAIT')
//           // && tgData.type != 'A' 
//           && seon.ATF_OLD[bunbong+'m'] == 'SHORT' 
//           && seon.ATF_NEW[bunbong+'m'] == 'LONG'
//           && tgData.t_direct == 'Y'
//         ){
//           // 롱포지션 즉시 진입
//           //대기 READY, 시작 START [진입대기 EXACT_WAIT]
//           const price = seon.offerho

//           if(tgData.st == 'READY'){
//             logItem = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//               tgData.id,
//               tgData.uid,
//               price,
//               tgData.idx+1,
//               'BUY',
//             ]);
//           }

//           await dbcon.DBCall(`CALL SP_API_PLAY_ST_EXACT(?,?,?,?,?)`,[logItem.id, price, tgData.orderSize, 0, seon.charge]);

//           await dbcon.DBCall(`CALL SP_API_PLAY_ST_USER_PRICE(?,?)`,[
//               tgData.uid, -seon.charge
//           ]);

//           await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//               tgData.uid,
//               tgData.id,
//               logItem.id,
//               tgData.stoch_id,
//               null,
//               null,
//               '즉시진입'+ tgData.type,
//               null,
//               price,
//               null,
//               null,
//               null,
//               null,
//               null,
//               null,
//           ]);

//         }else if(
//           (tgData.signalType == 'SELL' || tgData.signalType == 'TWO')
//           && (tgData.st == 'START' || tgData.st == 'READY' || logItem?.st == 'EXACT_WAIT')
//           // && tgData.type != 'A' 
//           && seon.ATF_OLD[bunbong+'m'] == 'LONG' 
//           && seon.ATF_NEW[bunbong+'m'] == 'SHORT'
//           && tgData.t_direct == 'Y'
//         ){
//           // 숏포지션 즉시 진입

//           const price = seon.bidho

//           if(tgData.st == 'READY'){
//             logItem = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//               tgData.id,
//               tgData.uid,
//               price,
//               tgData.idx+1,
//               'SELL',
//             ]);
//           }

//           await dbcon.DBCall(`CALL SP_API_PLAY_ST_EXACT(?,?,?,?,?)`,[logItem.id, price, tgData.orderSize, 0, seon.charge]);

//           await dbcon.DBCall(`CALL SP_API_PLAY_ST_USER_PRICE(?,?)`,[
//               tgData.uid, -seon.charge
//           ]);

//           await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//               tgData.uid,
//               tgData.id,
//               logItem.id,
//               tgData.stoch_id,
//               null,
//               null,
//               '즉시진입'+ tgData.type,
//               null,
//               price,
//               null,
//               null,
//               null,
//               null,
//               null,
//               null,
//           ]);

//         }
        
//         // else if(logItem?.signalType == 'SELL' && tgData.st == 'START' && logItem.st == 'EXACT_WAIT' && tgData.type == 'C' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && seon.UT_NEW[bunbong+'m'] == 'LONG'){
//         //   // 골드크로스 숏포지션 진입 취소
//         //   const price = logItem.signalType == 'BUY' ? seon.offerho : seon.bidho

//         //   await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[logItem.id, tgData.id, tgData.idx-1]);

//         //   await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//         //       tgData.uid,
//         //       tgData.id,
//         //       logItem.id,
//         //       tgData.stoch_id,
//         //       null,
//         //       null,
//         //       '취소' + tgData.type,
//         //       null,
//         //       price,
//         //       null,
//         //       null,
//         //       null,
//         //       null,
//         //       null,
//         //       null,
//         //   ]);
//         // }else if(logItem?.signalType == 'BUY' && tgData.st == 'START' && logItem.st == 'EXACT_WAIT' && tgData.type == 'C' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && seon.UT_NEW[bunbong+'m'] == 'SHORT'){
//         //   // 데드크로스 롱포지션 진입 취소
//         //   const price = logItem.signalType == 'BUY' ? seon.offerho : seon.bidho
//         //   await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[logItem.id, tgData.id, tgData.idx-1]);

//         //   await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//         //     tgData.uid,
//         //     tgData.id,
//         //     logItem.id,
//         //     tgData.stoch_id,
//         //     null,
//         //     null,
//         //     '취소' + tgData.type,
//         //     null,
//         //     price,
//         //     null,
//         //     null,
//         //     null,
//         //     null,
//         //     null,
//         //     null,
//         //   ]);
//         // }
        
//         // else if((tgData.signalType == 'BUY' || tgData.signalType == 'TWO') && tgData.type == 'C' && tgData.st == 'READY' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && seon.UT_NEW[bunbong+'m'] == 'LONG'){
//         //   //롱포지션 진입대기
//         //   const price = tgData.signalType == 'BUY' ? seon.offerho : seon.bidho

//         //   const logObj = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//         //     tgData.id,
//         //     tgData.uid,
//         //     price,
//         //     tgData.idx+1,
//         //     'BUY',
//         //   ]);

//         //   await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//         //     tgData.uid,
//         //     tgData.id,
//         //     logObj.id,
//         //     reqData.uuid,
//         //     reqData.db_type,
//         //     reqData.type,
//         //     '신호발생' + tgData.type,
//         //     price,
//         //     null,
//         //     tgData.bunbong,
//         //     tgData.second1,
//         //     tgData.second2,
//         //     tgData.second3,
//         //     tgData.second4,
//         //     new Date(parseInt(reqData.time)),
//         //   ]);
//         // }else if((tgData.signalType == 'SELL' || tgData.signalType == 'TWO') && tgData.type == 'C' && tgData.st == 'READY' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && seon.UT_NEW[bunbong+'m'] == 'SHORT'){
//         //   //숏포지션 진입
//         //   const price = tgData.signalType == 'BUY' ? seon.offerho : seon.bidho
//         //   const logObj = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//         //     tgData.id,
//         //     tgData.uid,
//         //     price,
//         //     tgData.idx+1,
//         //     'SELL',
//         //   ]);

//         //   await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//         //     tgData.uid,
//         //     tgData.id,
//         //     logObj.id,
//         //     reqData.uuid,
//         //     reqData.db_type,
//         //     reqData.type,
//         //     '신호발생' + tgData.type,
//         //     price,
//         //     null,
//         //     tgData.bunbong,
//         //     tgData.second1,
//         //     tgData.second2,
//         //     tgData.second3,
//         //     tgData.second4,
//         //     new Date(parseInt(reqData.time)),
//         //   ]);
//         // }
        
//         else if(logItem && logItem?.st == 'EXACT'){
//           //롱 자동청산
//           const price = logItem.signalType == 'BUY' ? seon.offerho : seon.bidho

//           let stop_st = false

//           if(tgData.type == 'A' || tgData.type == 'A1'){
//             if((tgData.t_ST == 'Y' && tgData.t_autoST == 'Y' && logItem.t_cnt == 2) || (tgData.t_ST == 'N' && tgData.t_autoST == 'Y' && logItem.t_cnt == 1)){
              
//               if(seon.ATF_OLD[bunbong+'m'] == 'SHORT' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && logItem.signalType == 'SELL'){
//                 stop_st = true;
//               }else if(seon.ATF_OLD[bunbong+'m'] == 'LONG' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && logItem.signalType == 'BUY'){
//                 stop_st = true;
//               }  
//             }
//           }else{
//             if(seon.ATF_OLD[bunbong+'m'] == 'SHORT  ' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && logItem.signalType == 'SELL'){
//               stop_st = true;
//             }else if(seon.ATF_OLD[bunbong+'m'] == 'LONG' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && logItem.signalType == 'BUY'){
//               stop_st = true;
//             }  
//           }

//           // if(seon.ATF_OLD[bunbong+'m'] == 'SHORT' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && logItem.signalType == 'SELL'){
//           //   stop_st = true;
//           // }else if(seon.ATF_OLD[bunbong+'m'] == 'LONG' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && logItem.signalType == 'BUY'){
//           //   stop_st = true;
//           // }  

//           if(stop_st){
//             const re = seon.resultPrice(logItem.exactPrice, price, logItem.signalType);

//             await dbcon.DBCall(`CALL SP_API_PLAY_ST_FORCING(?,?,?,?,?,?,?)`,[
//               logItem.id, tgData.id, price, tgData.orderSize, 
//               re.pol_tick, re.pol_sum, seon.charge
//             ]);
  
//             await dbcon.DBCall(`CALL SP_API_PLAY_ST_USER_PRICE(?,?)`,[
//               tgData.uid, re.pol_sum-seon.charge
//             ]);
  
//             await dbcon.DBCall(`CALL SP_API_PLAY_ST_ATUO(?)`,[tgData.id]);
  
//             await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//                 tgData.uid,
//                 tgData.id,
//                 logItem.id,
//                 tgData.stoch_id,
//                 null,
//                 null,
//                 '자동청산' + tgData.type,
//                 null,
//                 price,
//                 null,
//                 null,
//                 null,
//                 null,
//                 null,
//                 null,
//             ]);

//             await seon.coolRE(tgData, price, tgData.idx+1, tgData.cooltime);
//           }

//         }

//       }catch(e){
//         console.log('api/hook ERROR :: ', e)
//       }
//     }
//   }

  
//   // else if(reqData.db_type == 'stoch'){

//   //   return true;

//   //   const tgDataList = await dbcon.DBCall(`CALL SP_API_PLAY_UUID_GET(?)`, [reqData.uuid]);

//   //   for(let i=0;i<tgDataList.length;i++){
//   //     try{
//   //       const tgData = tgDataList[i];
//   //       const bunbong = tgData.bunbong.split('_')[1]

//   //       if(tgData){
//   //         // const logItem = await dbcon.DBOneCall(`CALL SP_API_PLAY_LOG_ITEM2_GET(?,?,?)`, [
//   //         //   tgData.id,
//   //         //   tgData.uid,
//   //         //   tgData.idx,
//   //         // ]);
          
//   //         if(reqData.type == 'gold' && (tgData.signalType == 'BUY' || tgData.signalType == 'TWO') && tgData.st == 'READY' && tgData.autoST == 'Y'){
//   //           // 골드크로스 롱포지션 진입
//   //           let enterST = false

//   //           if(tgData.type == 'A'){
//   //             enterST = true;
//   //           }else if(tgData.type == 'B' && seon.ATF_NEW[bunbong+'m'] == 'LONG'){
//   //             enterST = true;
//   //           }
            
//   //           if(enterST){
//   //             const logObj = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//   //               tgData.id,
//   //               tgData.uid,
//   //               reqData.close,
//   //               tgData.idx+1,
//   //               'BUY',
//   //             ]);

//   //             await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //               tgData.uid,
//   //               tgData.id,
//   //               logObj.id,
//   //               reqData.uuid,
//   //               reqData.db_type,
//   //               reqData.type,
//   //               '신호발생' + tgData.type,
//   //               parseFloat(reqData.close),
//   //               null,
//   //               tgData.bunbong,
//   //               tgData.second1,
//   //               tgData.second2,
//   //               tgData.second3,
//   //               tgData.second4,
//   //               new Date(parseInt(reqData.time)),
//   //             ]);
//   //           }
//   //         }else if(reqData.type == 'dead' && (tgData.signalType == 'SELL' || tgData.signalType == 'TWO') && tgData.st == 'READY' && tgData.autoST == 'Y'){
//   //           // 데드크로스 숏포지션 진입
//   //           let enterST = false

//   //           if(tgData.type == 'A'){
//   //             enterST = true;
//   //           }else if(tgData.type == 'B' && seon.ATF_NEW[bunbong+'m'] == 'SHORT'){
//   //             enterST = true;
//   //           }

//   //           if(enterST){
//   //             const logObj = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//   //               tgData.id,
//   //               tgData.uid,
//   //               reqData.close,
//   //               tgData.idx+1,
//   //               'SELL',
//   //             ]);
  
//   //             await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //               tgData.uid,
//   //               tgData.id,
//   //               logObj.id,
//   //               reqData.uuid,
//   //               reqData.db_type,
//   //               reqData.type,
//   //               '신호발생' + tgData.type,
//   //               parseFloat(reqData.close),
//   //               null,
//   //               tgData.bunbong,
//   //               tgData.second1,
//   //               tgData.second2,
//   //               tgData.second3,
//   //               tgData.second4,
//   //               new Date(parseInt(reqData.time)),
//   //             ]);
//   //           }

//   //         }

//   //         // else if(reqData.type == 'gold' && (tgData.signalType == 'BUY' || tgData.signalType == 'TWO') && logItem?.st == 'EXACT_WAIT' && tgData.autoST == 'Y'){
//   //         //   // 골드크로스 롱포지션 새로운 진입
//   //         //   let enterST = false

//   //         //   if(tgData.type == 'A'){
//   //         //     enterST = true;
//   //         //   }else if(tgData.type == 'B' && seon.ATF_NEW[bunbong+'m'] == 'LONG'){
//   //         //     enterST = true;
//   //         //   }

//   //         //   if(enterST){
//   //         //     await dbcon.DBCall(`CALL SP_API_PLAY_ST_EXACT_WAIT_UPDATE(?,?,?)`, [
//   //         //       logItem.id,
//   //         //       reqData.close,
//   //         //       'BUY',
//   //         //     ]);
  
//   //         //     await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //         //       tgData.uid,
//   //         //       tgData.id,
//   //         //       logItem.id,
//   //         //       reqData.uuid,
//   //         //       reqData.db_type,
//   //         //       reqData.type,
//   //         //       '신호갱신' + tgData.type,
//   //         //       parseFloat(reqData.close),
//   //         //       null,
//   //         //       tgData.bunbong,
//   //         //       tgData.second1,
//   //         //       tgData.second2,
//   //         //       tgData.second3,
//   //         //       tgData.second4,
//   //         //       new Date(parseInt(reqData.time)),
//   //         //     ]);
//   //         //   }
            
//   //         // }else if(reqData.type == 'dead' && (tgData.signalType == 'SELL' || tgData.signalType == 'TWO') && logItem?.st == 'EXACT_WAIT' && tgData.autoST == 'Y'){
//   //         //   // 데드크로스 숏포지션 새로운 진입
//   //         //   let enterST = false

//   //         //   if(tgData.type == 'A'){
//   //         //     enterST = true;
//   //         //   }else if(tgData.type == 'B' && seon.ATF_NEW[bunbong+'m'] == 'SHORT'){
//   //         //     enterST = true;
//   //         //   }

//   //         //   if(enterST){
//   //         //     await dbcon.DBCall(`CALL SP_API_PLAY_ST_EXACT_WAIT_UPDATE(?,?,?)`, [
//   //         //       logItem.id,
//   //         //       reqData.close,
//   //         //       'SELL',
//   //         //     ]);

//   //         //     await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //         //       tgData.uid,
//   //         //       tgData.id,
//   //         //       logItem.id,
//   //         //       reqData.uuid,
//   //         //       reqData.db_type,
//   //         //       reqData.type,
//   //         //       '신호갱신' + tgData.type,
//   //         //       parseFloat(reqData.close),
//   //         //       null,
//   //         //       tgData.bunbong,
//   //         //       tgData.second1,
//   //         //       tgData.second2,
//   //         //       tgData.second3,
//   //         //       tgData.second4,
//   //         //       new Date(parseInt(reqData.time)),
//   //         //     ]);
//   //         //   }
//   //         // }
          
//   //         // else if(reqData.type == 'gold' && logItem?.signalType == 'SELL' && tgData.st == 'START'){
//   //         //   // 골드크로스 숏포지션 진입 취소
//   //         //   if(logItem && logItem.st == 'EXACT_WAIT'){
//   //         //     let enterST = false

//   //         //     if(tgData.type == 'A'){
//   //         //       enterST = true;
//   //         //     }else if(tgData.type == 'B' && seon.ATF_NEW[bunbong+'m'] != 'SHORT'){
//   //         //       enterST = true;
//   //         //     }

//   //         //     if(enterST){
//   //         //       await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[logItem.id, tgData.id, tgData.idx-1]);

//   //         //       await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //         //           tgData.uid,
//   //         //           tgData.id,
//   //         //           logItem.id,
//   //         //           tgData.stoch_id,
//   //         //           null,
//   //         //           null,
//   //         //           '취소' + tgData.type,
//   //         //           null,
//   //         //           parseFloat(reqData.close),
//   //         //           null,
//   //         //           null,
//   //         //           null,
//   //         //           null,
//   //         //           null,
//   //         //           null,
//   //         //       ]);
//   //         //     }
//   //         //   }
//   //         // }else if(reqData.type == 'dead' && logItem?.signalType == 'BUY' && tgData.st == 'START'){
//   //         //   // 데드크로스 롱포지션 진입 취소
//   //         //   if(logItem && logItem.st == 'EXACT_WAIT'){
//   //         //     let enterST = false

//   //         //     if(tgData.type == 'A'){
//   //         //       enterST = true;
//   //         //     }else if(tgData.type == 'B' && seon.ATF_NEW[bunbong+'m'] != 'LONG'){
//   //         //       enterST = true;
//   //         //     }

//   //         //     if(enterST){
//   //         //       await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[logItem.id, tgData.id, tgData.idx-1]);

//   //         //       await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //         //         tgData.uid,
//   //         //         tgData.id,
//   //         //         logItem.id,
//   //         //         tgData.stoch_id,
//   //         //         null,
//   //         //         null,
//   //         //         '취소' + tgData.type,
//   //         //         null,
//   //         //         parseFloat(reqData.close),
//   //         //         null,
//   //         //         null,
//   //         //         null,
//   //         //         null,
//   //         //         null,
//   //         //         null,
//   //         //       ]);
//   //         //     }
//   //         //   }
//   //         // }
      
//   //       }

//   //     }
//   //     catch(e){
//   //       console.log('api/hook ERROR :: ', e)
//   //     }
//   //   }
//   // }
  
  
//   // else if(reqData.db_type == 'rsi'){
//   //   // console.log('RSI ----------------')

//   //   const logList = await dbcon.DBCall(`CALL SP_A_PLAY_LOG_GET3(?)`, [
//   //     Math.abs(reqData.bunbong)
//   //   ]);

//   //   // console.log(logList.length);

//   //   for(let i=0;i<logList.length;i++){
//   //     const log = logList[i]
//   //     const price = log.signalType == 'BUY' ? seon.offerho : seon.bidho

//   //     if((reqData.type == 'DOWN' && log.signalType == 'BUY') || (reqData.type == 'UP' && log.signalType == 'SELL')){
//   //       const re = seon.resultPrice(log.exactPrice, price, log.signalType);

//   //       await dbcon.DBCall(`CALL SP_API_PLAY_ST_FORCING(?,?,?,?,?,?,?)`,[
//   //           log.lid, log.pid, price, log.orderSize, 
//   //           re.pol_tick, re.pol_sum, seon.charge
//   //       ]);
        
//   //       await dbcon.DBCall(`CALL SP_API_PLAY_ST_USER_PRICE(?,?)`,[
//   //           log.uid, re.pol_sum-seon.charge
//   //       ]);
        
//   //       await dbcon.DBCall(`CALL SP_API_PLAY_ST_ATUO(?)`,[log.pid]);
        
//   //       await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //         log.uid,
//   //         log.pid,
//   //         log.lid,
//   //         null,
//   //         null,
//   //         null,
//   //         'RSI자동청산',
//   //         null,
//   //         price,
//   //         null,
//   //         null,
//   //         null,
//   //         null,
//   //         null,
//   //         null,
//   //     ]);
//   //     }
//   //   }

//   //   // console.log('----------------')
//   // }else if(reqData.db_type == 'B_BONG_GOLD'){
//   //   // console.log('B_BONG_GOLD ----------------')
//   //   // console.log(reqData);
//   //   for(let i=0;i<tgDataList.length;i++){

//   //     try{
//   //       const tgData = tgDataList[i];

//   //       if(tgData){
//   //         const logItem = await dbcon.DBOneCall(`CALL SP_API_PLAY_LOG_ITEM2_GET(?,?,?)`, [
//   //           tgData.id,
//   //           tgData.uid,
//   //           tgData.idx,
//   //         ]);
          
//   //         if(reqData.type == 'ENTER' && (tgData.signalType == 'BUY' || tgData.signalType == 'TWO') && tgData.st == 'READY' && tgData.autoST == 'Y'){
//   //           // 골드크로스 롱포지션 진입
//   //           const logObj = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//   //             tgData.id,
//   //             tgData.uid,
//   //             reqData.close,
//   //             tgData.idx+1,
//   //             'BUY',
//   //           ]);

//   //           await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //             tgData.uid,
//   //             tgData.id,
//   //             logObj.id,
//   //             reqData.uuid,
//   //             reqData.db_type,
//   //             reqData.type,
//   //             '신호발생B',
//   //             parseFloat(reqData.close),
//   //             null,
//   //             tgData.bunbong,
//   //             tgData.second1,
//   //             tgData.second2,
//   //             tgData.second3,
//   //             tgData.second4,
//   //             new Date(parseInt(reqData.time)),
//   //           ]);

//   //         }
//   //         else if(reqData.type == 'ENTER' && (tgData.signalType == 'BUY' || tgData.signalType == 'TWO') && logItem?.st == 'EXACT_WAIT' && tgData.autoST == 'Y'){
//   //           // 골드크로스 롱포지션 새로운 진입
//   //           await dbcon.DBCall(`CALL SP_API_PLAY_ST_EXACT_WAIT_UPDATE(?,?,?)`, [
//   //             logItem.id,
//   //             reqData.close,
//   //             'BUY',
//   //           ]);

//   //           await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //             tgData.uid,
//   //             tgData.id,
//   //             logItem.id,
//   //             reqData.uuid,
//   //             reqData.db_type,
//   //             reqData.type,
//   //             '신호갱신B',
//   //             parseFloat(reqData.close),
//   //             null,
//   //             tgData.bunbong,
//   //             tgData.second1,
//   //             tgData.second2,
//   //             tgData.second3,
//   //             tgData.second4,
//   //             new Date(parseInt(reqData.time)),
//   //           ]);
//   //         }
//   //         else if(reqData.type == 'CANCEL' && logItem?.signalType == 'BUY' && tgData.st == 'START'){
//   //           // 골드크로스 롱포지션 진입 취소
//   //           if(logItem && logItem.st == 'EXACT_WAIT'){
//   //             await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[logItem.id, tgData.id, tgData.idx-1]);

//   //             await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //                 tgData.uid,
//   //                 tgData.id,
//   //                 logItem.id,
//   //                 tgData.stoch_id,
//   //                 null,
//   //                 null,
//   //                 '취소B',
//   //                 null,
//   //                 parseFloat(reqData.close),
//   //                 null,
//   //                 null,
//   //                 null,
//   //                 null,
//   //                 null,
//   //                 null,
//   //             ]);
//   //           }
//   //         }
          
      
//   //       }

//   //     }
//   //     catch(e){
//   //       console.log('api/hook ERROR :: ', e)
//   //     }
//   //   }
//   //   // console.log('----------------')
//   // }else if(reqData.db_type == 'B_BONG_DEAD'){
//   //   // console.log('B_BONG_DEAD ----------------')
//   //   // console.log(reqData);
//   //   for(let i=0;i<tgDataList.length;i++){
//   //     try{
//   //       const tgData = tgDataList[i];
//   //       if(tgData){
//   //         const logItem = await dbcon.DBOneCall(`CALL SP_API_PLAY_LOG_ITEM2_GET(?,?,?)`, [
//   //           tgData.id,
//   //           tgData.uid,
//   //           tgData.idx,
//   //         ]);

//   //         if(reqData.type == 'dead' && (tgData.signalType == 'SELL' || tgData.signalType == 'TWO') && tgData.st == 'READY' && tgData.autoST == 'Y'){
//   //           // 데드크로스 숏포지션 진입
//   //           const logObj = await dbcon.DBOneCall(`CALL SP_API_PLAY_ST_EXACT_WAIT(?,?,?,?,?)`, [
//   //             tgData.id,
//   //             tgData.uid,
//   //             reqData.close,
//   //             tgData.idx+1,
//   //             'SELL',
//   //           ]);

//   //           await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //             tgData.uid,
//   //             tgData.id,
//   //             logObj.id,
//   //             reqData.uuid,
//   //             reqData.db_type,
//   //             reqData.type,
//   //             '신호발생B',
//   //             parseFloat(reqData.close),
//   //             null,
//   //             tgData.bunbong,
//   //             tgData.second1,
//   //             tgData.second2,
//   //             tgData.second3,
//   //             tgData.second4,
//   //             new Date(parseInt(reqData.time)),
//   //           ]);
//   //         }
//   //         else if(reqData.type == 'dead' && (tgData.signalType == 'SELL' || tgData.signalType == 'TWO') && logItem?.st == 'EXACT_WAIT' && tgData.autoST == 'Y'){
//   //           // 데드크로스 숏포지션 새로운 진입
//   //           await dbcon.DBCall(`CALL SP_API_PLAY_ST_EXACT_WAIT_UPDATE(?,?,?)`, [
//   //             logItem.id,
//   //             reqData.close,
//   //             'SELL',
//   //           ]);

//   //           await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //             tgData.uid,
//   //             tgData.id,
//   //             logItem.id,
//   //             reqData.uuid,
//   //             reqData.db_type,
//   //             reqData.type,
//   //             '신호갱신B',
//   //             parseFloat(reqData.close),
//   //             null,
//   //             tgData.bunbong,
//   //             tgData.second1,
//   //             tgData.second2,
//   //             tgData.second3,
//   //             tgData.second4,
//   //             new Date(parseInt(reqData.time)),
//   //           ]);
//   //         }
//   //         else if(reqData.type == 'CANCEL' && logItem?.signalType == 'SELL' && tgData.st == 'START'){
//   //           if(logItem && logItem.st == 'EXACT_WAIT'){
//   //             await dbcon.DBCall(`CALL SP_API_PLAY_ST_CANCEL(?,?,?)`,[logItem.id, tgData.id, tgData.idx-1]);

//   //             await dbcon.DBCall(`CALL SP_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
//   //               tgData.uid,
//   //               tgData.id,
//   //               logItem.id,
//   //               tgData.stoch_id,
//   //               null,
//   //               null,
//   //               '취소B',
//   //               null,
//   //               parseFloat(reqData.close),
//   //               null,
//   //               null,
//   //               null,
//   //               null,
//   //               null,
//   //               null,
//   //           ]);
//   //           }
//   //         }
//   //       }
//   //     }catch(e){
//   //       console.log('api/hook ERROR :: ', e)
//   //     }
//   //   }
//   // }
  
//   return res.send(true);
// });
router.post('/api/hook', async function(req, res){
  const reg_ex = /[^0-9]/g;
  const reqData = req.body;

  // ATF
  if(reqData && (reqData.db_type == 'scalping' || reqData.db_type == 'greenlight' || reqData.db_type == 'trend')){
    // if(reqData.db_type == 'trend'){
    //   console.log(reqData);
    // }
    await seon.enterCoin(reqData);
  }else if(reqData && reqData.db_type == 'ATF' || reqData.db_type == 'UT'){
    // await seon.enterATF_UT(reqData);
  }else{
    return res.send(false);
  }
  
  
  // else if(reqData && (reqData.db_type == 'UT' || reqData.db_type == 'ATF')){
  //   await dbcon.DBCall(`CALL SP_LOG_ALERT_ADD3(?,?,?,?)`, [
  //     reqData.db_type,
  //     reqData.type,
  //     reqData.bunbong.replace(reg_ex, ""),
  //     new Date(parseInt(reqData.time)),
  //   ]);
  // }
  
  // if(reqData.db_type == 'ATF'){
  //   seon.ATF_OLD[reqData.bunbong] = seon.ATF_NEW[reqData.bunbong]
  //   seon.ATF_NEW[reqData.bunbong] = reqData.type

  //   const reqBun = reqData.bunbong.replace(reg_ex, "");
  //   const tgDataList = await dbcon.DBCall(`CALL SP_API_PLAY_Y_GET(?)`,[reqBun]);

  //   for(let i=0;i<tgDataList.length;i++){
  //     try{
  //       const tgData = tgDataList[i];
  //       const bunbong = tgData.bunbong.split('_')[1]
  //       // console.log(`${tgData.type} ${bunbong} ATF :: ${seon.ATF_NEW[bunbong+'m']}, UT :: ${seon.UT_NEW[bunbong+'m']}`);
  //       let stop_st = false

  //       if(tgData.type == 'A'){
  //         if((tgData.t_ST == 'Y' && tgData.t_autoST == 'Y') || (tgData.t_ST == 'N' && tgData.t_autoST == 'Y')){
  //           if(seon.ATF_OLD[bunbong+'m'] == 'SHORT' && seon.ATF_NEW[bunbong+'m'] == 'LONG' && tgData.r_signalType == 'SELL'){
  //             stop_st = true;
  //           }else if(seon.ATF_OLD[bunbong+'m'] == 'LONG' && seon.ATF_NEW[bunbong+'m'] == 'SHORT' && tgData.r_signalType == 'BUY'){
  //             stop_st = true;
  //           }  
  //         }
  //       }

  //       if(stop_st){
  //         await dbcon.DBCall(`CALL SP_LIVE_PLAY_SET_ST(?,?,?)`, [
  //           tgData.id,
  //           'START',
  //           'FORCING_WAIT',
  //         ]);

  //         await dbcon.DBCall(`CALL SP_LIVE_EVENT_LOG_ADD(?,?,?,?,?,?,?,?,?,?,?,?)`, [
  //           tgData.uid,
  //           tgData.id,
  //           tgData.r_tid,
  //           null,
  //           '청산대기_ATF',
  //           tgData.st,
  //           'START',
  //           tgData.status,
  //           'FORCING_WAIT',
  //           tgData.r_signalType,
  //           null,
  //           null,
  //         ]);
  //       }


  //     }catch(e){
  //       console.log('api/hook ERROR :: ', e)
  //     }
  //   }
  // }

  
  return res.send(true);
});

router.get('/api/seon', async function(req, res){
  // console.log(req.query);

  let memberList = await dbcon.DBCall(`CALL SP_A_MEMBER_ALL_GET()`);

  for(let i=0;i<memberList.length;i++){
    const isId = memberList[i].id;

    if(isId == 1){
      continue;
    }

    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_1',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_1',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_3',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_3',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_5',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_5',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
  }

  let stochList = await dbcon.DBCall(`CALL SP_WS_PLAY_STOCH_GET()`);

  for(let i=0;i<stochList.length;i++){
    const stoch = stochList[i]

    const type = stoch.bunbong.split('_')[0]
    const bunbong = stoch.bunbong.split('_')[1]

    const tg = await dbcon.DBOneCall(`CALL SP_WS_PLAY_LIST_GET(?,?,?,?)`,[bunbong, stoch.second2, stoch.second3, stoch.second4]);
    let stoch_id = null

    if(!tg){
      do{
        const uuid = seon.randomString(15);
        const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`,[uuid]);
  
        if(!uuidCK){
          stoch_id = uuid
        }
  
        await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?)`,[uuid, bunbong, stoch.second2, stoch.second3, stoch.second4]);
  
      }while(!stoch_id)
    }else{
      stoch_id = tg.uuid
    }

    await dbcon.DBCall(`CALL SP_API_PLAY_STOCH_ALL_EDIT(?,?,?,?,?)`,[stoch_id, stoch.bunbong, stoch.second2, stoch.second3, stoch.second4]);
  }
  



  // const stochAllList = await dbcon.DBCall(`CALL SP_WS_PLAY_STOCH_ALL_GET()`);

  // for(let i=0;i<stochAllList.length;i++){
  //   try{
  //     const uuid = stochAllList[i].uuid
    
  //     await dbcon.DBCall(`CALL SP_API_COOL_ADD(?)`,[uuid]);
  //   }catch(e){
  //     // console.log(e);
  //   }
  // }
  

  return res.send(true);

});
router.get('/api/seon/one', async function(req, res){
  // console.log(req.query);
  
  const isId = req.query.id;

  if(!isId){
    console.log('!!');
    return res.send(true);
  }

  await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_1',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
  await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_1',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
  await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_3',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
  await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_3',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
  await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_5',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
  await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_5',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);

  let stochList = await dbcon.DBCall(`CALL SP_WS_PLAY_STOCH_GET()`);

  for(let i=0;i<stochList.length;i++){
    const stoch = stochList[i]

    const type = stoch.bunbong.split('_')[0]
    const bunbong = stoch.bunbong.split('_')[1]

    const tg = await dbcon.DBOneCall(`CALL SP_WS_PLAY_LIST_GET(?,?,?,?)`,[bunbong, stoch.second2, stoch.second3, stoch.second4]);
    let stoch_id = null

    if(!tg){
      do{
        const uuid = seon.randomString(15);
        const uuidCK = await dbcon.DBOneCall(`CALL SP_API_STOCH_ID_GET(?)`,[uuid]);
  
        if(!uuidCK){
          stoch_id = uuid
        }
  
        await dbcon.DBCall(`CALL SP_API_STOCH_ADD(?,?,?,?,?)`,[uuid, bunbong, stoch.second2, stoch.second3, stoch.second4]);
  
      }while(!stoch_id)
    }else{
      stoch_id = tg.uuid
    }

    await dbcon.DBCall(`CALL SP_API_PLAY_STOCH_ALL_EDIT(?,?,?,?,?)`,[stoch_id, stoch.bunbong, stoch.second2, stoch.second3, stoch.second4]);
  }
  


  return res.send(true);
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
    // await dbcon.DBCall(`CALL SP_A_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,1,'A_1',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_A_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,1,'A_1',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_A_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,1,'A_3',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_A_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,1,'A_3',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_A_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,1,'A_5',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_A_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,1,'A_5',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);

    // await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_1',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_1',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_3',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_3',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_5',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'BUY', 'Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
    // await dbcon.DBCall(`CALL SP_LIVE_PLAY_ADD(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [isId,'A_5',1,옵1,옵2,옵3,진입,취소,일차익절,손절,손절취소ST,손절취소,b2차익절,추세주문ST,손절익절취소,c2차익절,추세추격,'SELL','Y', 'Y',1, 자동청산ST, 추격ST, 즉시진입ST, 'A','N','N']);
  
    // let stochList = await dbcon.DBCall(`CALL SP_WS_PLAY_STOCH_GET()`);
  
    // for(let i=0;i<stochList.length;i++){
    //   const stoch = stochList[i]
  
    //   const type = stoch.bunbong.split('_')[0]
    //   const bunbong = stoch.bunbong.split('_')[1]
  
    //   const tg = await dbcon.DBOneCall(`CALL SP_WS_PLAY_LIST_GET(?,?,?,?)`,[bunbong, stoch.second2, stoch.second3, stoch.second4]);
    //   let stoch_id = null
    //   stoch_id = tg.uuid
  
    //   await dbcon.DBCall(`CALL SP_API_PLAY_STOCH_ONE_EDIT(?,?,?,?,?,?)`,[isId, stoch_id, stoch.bunbong, stoch.second2, stoch.second3, stoch.second4]);
    // }


    return res.status(200).json({
      status: 200,
    });

  }catch(e){
    return res.status(500).json({ errors: [{
        location: "body",
        msg: "알수없는 오류 /reg",
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

