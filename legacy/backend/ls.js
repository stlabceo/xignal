const WebSocket = require('ws');
const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const dt = require("./data");


require('dayjs/locale/ko');
dayjs.locale('ko');
dayjs.extend(utc);
dayjs.extend(timezone);

var exports = module.exports = {};

const APP_KEY = process.env.LS_KEY;
const APP_SECRET = process.env.LS_SECRET

const SYMBOL = 'NQM25';
// const SYMBOL = 'MNQM25';

let ACCESS_TOKEN = '';


const ckCode = (code_) => {
    const code = Number(code_);

    try{
        if(0 <= code && code <= 999){
            return true;
        }else{
            return false;
        }
    }catch(e){
        return false;
    }
}

const initLSAPI = async () => {
    const PATH = "oauth2/token"
    const BASE_URL = "https://openapi.ls-sec.co.kr:8080"
    const URL = `${BASE_URL}/${PATH}`

    const headers = {"content-type": "application/x-www-form-urlencoded"}
    const param = {
        "grant_type": "client_credentials",
        "appkey": APP_KEY,
        "appsecretkey": APP_SECRET,
        "scope": "oob"
    }

    let re = null

    const reData = {
        status: false,
    }

    try{
        console.log('INIT LS API');
        re = await axios.post(URL, param, {headers});

        ACCESS_TOKEN = re.data.access_token;
    }
    catch(e){
        console.log('!!!!! LS INIT ERROR !!!!!');
        console.log(e)
    }

    
    return reData;
}

const LS_clientSocketInit = async () => {
    const WS_SERVER_URL = 'wss://openapi.ls-sec.co.kr:9443/websocket';
    const ws = new WebSocket(WS_SERVER_URL);

    const header = {token: ACCESS_TOKEN, tr_type: "3"}
    const tr_key = SYMBOL.padEnd(8, " ");

    console.log('LS clientSocketInit !!');

    // 연결 성공 이벤트
    ws.on('open', () => {
        console.log('🔥 Connected to the WebSocket server:', WS_SERVER_URL);

        const body_ovh = {tr_cd: "OVH", tr_key: tr_key}
        const data_to_send_ovh = JSON.stringify({header: header, body: body_ovh})
        ws.send(data_to_send_ovh);

        // const body_ovc = {tr_cd: "OVC", tr_key: tr_key}
        // const data_to_send_ovc = JSON.stringify({header: header, body: body_ovc})
        // ws.send(data_to_send_ovc);
    });

    // 서버에서 메시지 수신
    ws.on('message', (data) => {
        if(!ws){
            const {io} = require('./routes/socket');
            ws = io;
        }

        try{
            if(data.toString()){
                const reData = JSON.parse(data.toString());
                console.log(reData);
                if(reData.body){

                    if(reData.header.tr_cd == 'OVH'){
                        ws_setPrice(reData.body.offerho1, reData.body.bidho1);
                    }

                }
                
            }
        }catch(e){
            console.log('WS ERROR ------------------------');
            console.log(e);
            console.log('---------------------------------');
        }
    });

    // 연결 종료 이벤트
    ws.on('close', () => {
        console.log('❌ Disconnected from the WebSocket server');
    });

    // 에러 핸들링
    ws.on('error', (err) => {
        console.error('⚠️ WebSocket error:', err);
    });
}

const ws_setPrice = (offerho, bidho) => {
    dt.offerho = parseFloat(offerho);
    dt.bidho = parseFloat(bidho);
}



exports.init = async () => {
    await initLSAPI();
    LS_clientSocketInit();
}

exports.getPrice = async () => {
    // https://openapi.ls-sec.co.kr/apiservice?group_id=c1ef0e8b-4666-4d8c-a77f-6ab488cfdb39&api_id=44c1c082-c899-48fb-bc66-bb5be2f0ab4e
    if(!ACCESS_TOKEN){
        await initLSAPI();
    }

    const PATH = "overseas-futureoption/accno"
    const BASE_URL = "https://openapi.ls-sec.co.kr:8080"
    const URL = `${BASE_URL}/${PATH}`

    const headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": `Bearer ${ACCESS_TOKEN}`,
        "tr_cd": "CIDBQ03000",
        "tr_cont": "N",
        "tr_cont_key": "",
    }

    const param = {
        "CIDBQ03000InBlock1": {
            // "shcode": SYMBOL.padEnd(8, " "),
            "RecCnt": 1,
            "AcntTpCode": "1",
            "TrdDt": dayjs().format('YYYYMMDD'),
        }
    }

    let re = null

    const reData = {
        status: false,
        price: 0,
        code: null,
        codeKR: null,
    }

    try{
        re = await axios.post(URL, param, {headers});
        
        reData.code = re.data.rsp_cd;
        reData.codeKR = re.data.rsp_msg;

        if(ckCode(re.data.rsp_cd)){
            reData.status = true;
            reData.price = parseFloat(re.data.CIDBQ03000OutBlock2[0].OvrsFutsDps);
        }else{
            reData.status = false;
        }

        // console.log(re.data);

        // console.log(re.data.CIDBQ03000OutBlock2);

        //   -OvrsFutsDps	해외선물예수금
        //   -AbrdFutsOrdAbleAmt	해외선물주문가능금액

        return reData;
    }
    catch(e){
        console.log('!!!!! LS getPrice ERROR !!!!!');
        // console.log(e)

        if(e.response?.data){
            console.log(e.response.data);
            const rsp_cd = e.response.data.rsp_cd;
            if(rsp_cd == 'IGW00205' || rsp_cd == 'IGW00121'){
                await initLSAPI();
            }
        }

        return reData;
    }
}

// 주문내역
exports.getHis = async () => {
    // https://openapi.ls-sec.co.kr/apiservice?group_id=c1ef0e8b-4666-4d8c-a77f-6ab488cfdb39&api_id=44c1c082-c899-48fb-bc66-bb5be2f0ab4e
    if(!ACCESS_TOKEN){
        await initLSAPI();
    }

    const PATH = "overseas-futureoption/accno"
    const BASE_URL = "https://openapi.ls-sec.co.kr:8080"
    const URL = `${BASE_URL}/${PATH}`

    const headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": `Bearer ${ACCESS_TOKEN}`,
        "tr_cd": "CIDBQ01800",
        "tr_cont": "N",
        "tr_cont_key": "",
    }

    const param = {
        "CIDBQ01800InBlock1": {
            "IsuCodeVal": SYMBOL.padEnd(8, " "),
            "OrdDt": dayjs().format('YYYYMMDD'),
            "ThdayTpCode": ' ',
            "OrdStatCode": '0',     //주문상태코드 0:전체 1:체결 2:미체결
            "BnsTpCode": '0',        //0:전체 1:매도 2:매수
            "QryTpCode": '1',        //1:역순 2:정순
            "OrdPtnCode": '00',       //주문유형코드	00:전체 01:일반 02:Average 03:Spread
            "OvrsDrvtFnoTpCode": 'A',    //A:전체 F:선물 O:옵션
        }
    }

    let re = null

    const reData = {
        status: false,
        data: [],
        code: null,
        codeKR: null,
    }

    try{
        re = await axios.post(URL, param, {headers});
        
        reData.code = re.data.rsp_cd;
        reData.codeKR = re.data.rsp_msg;

        if(ckCode(re.data.rsp_cd)){
            reData.status = true;
            reData.data = re.data.CIDBQ01800OutBlock2;
        }else{
            reData.status = false;
        }

        //OvrsFutsOrdNo 해외선물주문번호
        //TpCodeNm  == "체결"
        //AbrdFutsExecPrc 체결가격

        // console.log(reData); 

        return reData;
    }
    catch(e){
        console.log('!!!!! LS getHis ERROR !!!!!');
        // console.log(e)

        if(e.response?.data){
            console.log(e.response.data);
            const rsp_cd = e.response.data.rsp_cd;
            if(rsp_cd == 'IGW00205' || rsp_cd == 'IGW00121'){
                await initLSAPI();
            }
        }

        return reData;
    }
}

// 상세 주문내역
exports.getHisMore = async () => {
    // https://openapi.ls-sec.co.kr/apiservice?group_id=c1ef0e8b-4666-4d8c-a77f-6ab488cfdb39&api_id=44c1c082-c899-48fb-bc66-bb5be2f0ab4e
    if(!ACCESS_TOKEN){
        await initLSAPI();
    }

    const PATH = "overseas-futureoption/accno"
    const BASE_URL = "https://openapi.ls-sec.co.kr:8080"
    const URL = `${BASE_URL}/${PATH}`

    const headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": `Bearer ${ACCESS_TOKEN}`,
        "tr_cd": "CIDBQ02400",
        "tr_cont": "N",
        "tr_cont_key": "",
    }

    const param = {
        "CIDBQ02400InBlock1": {
            "IsuCodeVal": SYMBOL.padEnd(8, " "),

            // "QrySrtDt": dayjs().format('YYYYMMDD'),
            // "QryEndDt": dayjs().format('YYYYMMDD'),

            "QrySrtDt": '20250408',
            "QryEndDt": '20250409',

            "ThdayTpCode": '0',
            "OrdStatCode": '0',     //주문상태코드 0:전체 1:체결 2:미체결
            "BnsTpCode": '0',        //0:전체 1:매도 2:매수
            "QryTpCode": '1',        //1:역순 2:정순
            "OrdPtnCode": '00',       //주문유형코드	00:전체 01:일반 02:Average 03:Spread
            "OvrsDrvtFnoTpCode": 'A',    //A:전체 F:선물 O:옵션
        }
    }

    let re = null

    const reData = {
        status: false,
        data: [],
        code: null,
        codeKR: null,
    }

    try{
        re = await axios.post(URL, param, {headers});
        
        reData.code = re.data.rsp_cd;
        reData.codeKR = re.data.rsp_msg;

        if(ckCode(re.data.rsp_cd)){
            reData.status = true;
            reData.data = re.data.CIDBQ02400OutBlock2;
        }else{
            reData.status = false;
        }

        // for(let i=0;i<reData.data.length;i++){
        //     const dd = reData.data[i];

        //     console.log(parseFloat(dd.CsgnCmsn));
        // }
        

        return reData;
    }
    catch(e){
        console.log('!!!!! LS getHis ERROR !!!!!');
        // console.log(e)

        if(e.response?.data){
            console.log(e.response.data);
            const rsp_cd = e.response.data.rsp_cd;
            if(rsp_cd == 'IGW00205' || rsp_cd == 'IGW00121'){
                await initLSAPI();
            }
        }

        return reData;
    }
}


// 주문
exports.sendReq = async (side) => {
    // https://openapi.ls-sec.co.kr/apiservice?group_id=c1ef0e8b-4666-4d8c-a77f-6ab488cfdb39&api_id=b820f925-e189-4553-a7d1-8e5f2750fe08
    if(!ACCESS_TOKEN){
        await initLSAPI();
    }

    const PATH = "overseas-futureoption/order"
    const BASE_URL = "https://openapi.ls-sec.co.kr:8080"
    const URL = `${BASE_URL}/${PATH}`

    const headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": `Bearer ${ACCESS_TOKEN}`,
        "tr_cd": "CIDBT00100",
        "tr_cont": "N",
        "tr_cont_key": "",
    }

    const sideType = side == 'BUY' ? '2' : '1';
    const param = {
        "CIDBT00100InBlock1": {
            "OrdDt": dayjs().format('YYYYMMDD'),
            "IsuCodeVal": SYMBOL.padEnd(8, " "),
            "FutsOrdTpCode": '1',        //	선물주문구분코드       	1:신규
            "BnsTpCode": sideType,       //	매매구분코드       	1:매도 2:매수
            "AbrdFutsOrdPtnCode": '1',    //	해외선물주문유형코드       	1:시장가2:지정가
            "CrcyCode": ' ',              //	통화코드       	SPACE
            // "OvrsDrvtOrdPrc": 0,       //	해외파생주문가격      
            // "CndiOrdPrc": '',           //	조건주문가격     
            "OrdQty": 1,               //	주문수량       	
            "PrdtCode": ' ',             //	상품코드       	SPACE
            "DueYymm": ' ',              //	만기년월       	SPACE
            "ExchCode": ' ',             //	거래소코드       	SPACE
        }
    }

    let re = null

    const reData = {
        status: false,
        tid: null,
        code: null,
        codeKR: null,
    }

    try{
        re = await axios.post(URL, param, {headers});
        
        reData.code = re.data.rsp_cd;
        reData.codeKR = re.data.rsp_msg;

        if(ckCode(re.data.rsp_cd)){
            reData.status = true;
            reData.tid = re.data.CIDBT00100OutBlock2.OvrsFutsOrdNo;
        }else{
            reData.status = false;
        }

        //OvrsFutsOrdNo 해외선물주문번호
        console.log(re.data); 

        return reData;
    }
    catch(e){
        console.log('!!!!! LS sendReq ERROR !!!!!');
        // console.log(e)

        if(e.response?.data){
            console.log(e.response.data);
            const rsp_cd = e.response.data.rsp_cd;
            if(rsp_cd == 'IGW00205' || rsp_cd == 'IGW00121'){
                await initLSAPI();
            }
        }

        return reData;
    }
}