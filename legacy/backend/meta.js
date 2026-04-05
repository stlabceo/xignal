const axios = require('axios');
// const { io, users } = require('./routes/socket');
var exports = module.exports = {};
// const db = require('./database/connect/config');
// const dayjs = require('dayjs');
// const utc = require('dayjs/plugin/utc');
// const timezone = require('dayjs/plugin/timezone');
// require('dayjs/locale/ko');
// dayjs.locale('ko');
// dayjs.extend(utc);
// dayjs.extend(timezone);

const META_ID = process.env.META_ID
const META_PW = process.env.META_PW
const META_KEY = process.env.META_KEY

const RETCODE = {
    'MT_RET_REQUEST_INWAY': '10001',
    'MT_RET_REQUEST_ACCEPTED': '10002',
    'MT_RET_REQUEST_PROCESS': '10003',
    'MT_RET_REQUEST_REQUOTE': '10004',
    'MT_RET_REQUEST_PRICES': '10005',
    'MT_RET_REQUEST_REJECT': '10006',
    'MT_RET_REQUEST_CANCEL': '10007',
    'MT_RET_REQUEST_PLACED': '10008',
    'MT_RET_REQUEST_DONE': '10009',
    'MT_RET_REQUEST_DONE_PARTIAL': '10010',
    'MT_RET_REQUEST_ERROR': '10011',
    'MT_RET_REQUEST_TIMEOUT': '10012',
    'MT_RET_REQUEST_INVALID': '10013',
    'MT_RET_REQUEST_INVALID_VOLUME': '10014',
    'MT_RET_REQUEST_INVALID_PRICE': '10015',
    'MT_RET_REQUEST_INVALID_STOPS': '10016',
    'MT_RET_REQUEST_TRADE_DISABLED': '10017',
    'MT_RET_REQUEST_MARKET_CLOSED': '10018',
    'MT_RET_REQUEST_NO_MONEY': '10019',
    'MT_RET_REQUEST_PRICE_CHANGED': '10020',
    'MT_RET_REQUEST_PRICE_OFF': '10021',
    'MT_RET_REQUEST_INVALID_EXP': '10022',
    'MT_RET_REQUEST_ORDER_CHANGED': '10023',
    'MT_RET_REQUEST_TOO_MANY': '10024',
    'MT_RET_REQUEST_NO_CHANGES': '10025',
    'MT_RET_REQUEST_AT_DISABLED_SERVER': '10026',
    'MT_RET_REQUEST_AT_DISABLED_CLIENT': '10027',
    'MT_RET_REQUEST_LOCKED': '10028',
    'MT_RET_REQUEST_FROZEN': '10029',
    'MT_RET_REQUEST_INVALID_FILL': '10030',
    'MT_RET_REQUEST_CONNECTION': '10031',
    'MT_RET_REQUEST_ONLY_REAL': '10032',
    'MT_RET_REQUEST_LIMIT_ORDERS': '10033',
    'MT_RET_REQUEST_LIMIT_VOLUME': '10034',
    'MT_RET_REQUEST_INVALID_ORDER': '10035',
    'MT_RET_REQUEST_POSITION_CLOSED': '10036',
    'MT_RET_REQUEST_EXECUTION_SKIPPED': '10037',
    'MT_RET_REQUEST_INVALID_CLOSE_VOLUME': '10038',
    'MT_RET_REQUEST_CLOSE_ORDER_EXIST': '10039',
    'MT_RET_REQUEST_LIMIT_POSITIONS': '10040',
    'MT_RET_REQUEST_REJECT_CANCEL': '10041',
    'MT_RET_REQUEST_LONG_ONLY': '10042',
    'MT_RET_REQUEST_SHORT_ONLY': '10043',
    'MT_RET_REQUEST_CLOSE_ONLY': '10044',
    'MT_RET_REQUEST_PROHIBITED_BY_FIFO': '10045',
    'MT_RET_REQUEST_HEDGE_PROHIBITED': '10046',

    '10001': "요청이 진행 중입니다..",
    '10002': "요청이 수락됨.",
    '10003': "요청이 처리됨.",
    '10004': "요청에 대한 재호가(Requote).",
    '10005': "요청에 대한 가격 제시.",
    '10006': "요청이 거부됨.",
    '10007': "요청이 취소됨.",
    '10008': "요청 결과로 주문이 실행됨.",
    '10009': "요청이 완료됨.",
    '10010': "요청이 부분적으로 완료됨.",
    '10011': "요청의 일반적인 오류.",
    '10012': "요청 시간이 초과됨.",
    '10013': "잘못된 요청.",
    '10014': "잘못된 주문 수량.",
    '10015': "잘못된 가격.",
    '10016': "잘못된 스탑 레벨 또는 가격.",
    '10017': "거래가 비활성화됨.",
    '10018': "시장이 닫힘.",
    '10019': "잔액 부족.",
    '10020': "가격이 변경됨.",
    '10021': "가격 없음.",
    '10022': "잘못된 주문 만료.",
    '10023': "주문이 변경됨.",
    '10024': "너무 많은 거래 요청. (예: 한 개의 Manager API 인스턴스에서 128개 이상의 요청을 보낼 경우 발생)",
    '10025': "요청에 변경 사항이 없음.",
    '10026': "서버에서 자동 거래(Autotrading) 비활성화됨.",
    '10027': "클라이언트 측에서 자동 거래(Autotrading) 비활성화됨.",
    '10028': "요청이 딜러에 의해 차단됨.",
    '10029': "시장과 너무 가까운 주문 또는 포지션 변경 실패.",
    '10030': "지원되지 않는 체결(주문 실행) 방식.",
    '10031': "연결 없음.",
    '10032': "실제 계정에서만 허용됨.",
    '10033': "주문 개수 제한 도달.",
    '10034': "주문 수량 제한 도달.",
    '10035': "잘못되었거나 허용되지 않은 주문 유형.",
    '10036': "포지션이 이미 청산됨. (예: 이미 청산된 포지션의 스탑 레벨을 수정하려고 할 때 발생)",
    '10037': "내부 용도로 사용됨.",
    '10038': "청산하려는 수량이 현재 포지션보다 큼.",
    '10039': "해당 포지션을 청산하는 주문이 이미 존재함. (헤징 모드에서 발생 가능)\n기존 포지션을 반대 방향 주문으로 청산하려 할 때 이미 청산 주문이 있는 경우 발생\n현재 청산 주문들의 총량과 새로 추가된 주문의 총량이 포지션의 총량을 초과하는 경우 발생",
    '10040': "계정에서 동시에 개설할 수 있는 포지션 수가 그룹 설정에 의해 제한됨.\n네팅(Netting) 모드: 기존 포지션 수를 기준으로 제한 적용. 새 포지션을 증가시키는 주문은 허용되지 않음.\n헤징(Hedging) 모드: 기존 포지션 및 대기 주문(Pending Order) 포함하여 제한 적용.",
    '10041': "요청이 거부되었으며 주문이 취소됨. (라우팅 규칙에서 IMTConRoute::ACTION_CANCEL_ORDER가 적용된 경우)",
    '10042': "'롱 포지션만 허용' 규칙이 설정된 심볼에 대한 요청이 거부됨. (IMTConSymbol::TRADE_LONGONLY)",
    '10043': "'숏 포지션만 허용' 규칙이 설정된 심볼에 대한 요청이 거부됨. (IMTConSymbol::TRADE_SHORTONLY)",
    '10044': "'포지션 청산만 허용' 규칙이 설정된 심볼에 대한 요청이 거부됨. (IMTConSymbol::TRADE_CLOSEONLY)",
    '10045': "FIFO 규칙에 의해 포지션 청산이 허용되지 않음. (IMTConGroup::TRADEFLAGS_FIFO_CLOSE이 활성화된 그룹에서 발생) 가장 오래된 포지션부터 순서대로 청산해야 함.",
    '10046': "포지션 개설 또는 대기 주문이 허용되지 않음. (헤지 포지션이 금지됨. IMTConGroup::TRADEFLAGS_HEDGE_PROHIBIT이 활성화된 경우)",
}

const symbol = 'US100';

exports.getPrice = async () => {
    const BASE_URL = "https://api.innohed.com/portal/api"
    const PATH = "price/get"
    const URL = `${BASE_URL}/${PATH}`

    // const headers = {"content-type": "application/x-www-form-urlencoded"}
    const param = {
        "symbol": symbol,
        "trans_id": "0",
        "apikey": META_KEY,
    }

    let re = null
        
    const reData = {
        status: true,
        offerho: 0, //매도호가
        bidho: 0, //매수호가
    }

    try{
        re = await axios.post(URL, param);
        
        if(!re.data.result){
            reData.status = false;
            reData.offerho = 0;
            reData.bidho = 0;
            return reData;
        }

        const data = JSON.parse(re.data.result);

        reData.status = true;
        reData.offerho = parseFloat(data.answer[0].Ask);
        reData.bidho = parseFloat(data.answer[0].Bid);
    }
    catch(e){
        // if(e.status){
        //     console.log(e.status);
        //     console.log(e.response.data)
        // }else{
        //     console.log(e);
        // }

        reData.status = false;
        reData.offerho = 0;
        reData.bidho = 0;
    }


    return reData;
}

exports.sendReq = async (metaId, price, cnt, sl, tp, side) => {
    const BASE_URL = "https://api.innohed.com/portal/api"
    const PATH = "action/send_pending_request"
    const URL = `${BASE_URL}/${PATH}`

    // - BUY_STOP : 브로커에게 현재 가격보다 높은 가격으로 롱 포지션을 오픈하도록 요청하는 것
    // - BUY_LIMIT : 현재 가격보다 낮은 가격으로 롱 포지션을 엽니다.
    // - SELL_STOP : 현재 가격보다 낮은 가격으로 단기 포지션을 엽니다.
    // - SELL_LIMIT : 현재 가격보다 높은 가격으로 단기 포지션을 엽니다.

    const sideType = side == 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';
    const param = {
        "login": metaId,
        "apikey": META_KEY,
        "symbol": symbol,
        "lot": 0.01 * cnt + '',
        "price": price + '',
        "type": sideType,
        "sl": sl + '',
        "tp": tp + '',
    }

    let re = null
    const reData = {
        metaId: metaId,
        status: false,
        code: null,
        codeKR: null,
        tid: null,
    }

    try{
        re = await axios.post(URL, param);
        if(!re.data.result){
            reData.status = false;
            reData.code = '-1';
            return reData;
        }
        
        const data = JSON.parse(re.data.result);

        const result = data.answer[0].result;
        const answer = data.answer[1].answer;
        
        if(result.Retcode == RETCODE.MT_RET_REQUEST_DONE){
            reData.status = true;
            reData.code = result.Retcode;
            reData.codeKR = RETCODE[result.Retcode];
            reData.tid = answer.ResultOrder;
        }else{
            reData.status = false;
            reData.code = result.Retcode;
            reData.codeKR = RETCODE[result.Retcode];
        }

    }
    catch(e){
        if(e.status){
            console.log('!!!!!! sendReq !!!!!! ::: ', metaId, price, cnt, sl, tp, side);
            console.log(e.status);
            console.log(e.response.data)
        }else{
            console.log(e);
        }

        reData.status = false;
        reData.code = '-1';
    }

    // console.log(reData);

    return reData;
}

exports.closePo = async (tid, cnt) => {
    const BASE_URL = "https://api.innohed.com/portal/api"
    const PATH = "action/close_position"
    const URL = `${BASE_URL}/${PATH}`

    const param = {
        "ticket": tid,
        "apikey": META_KEY,
        "lot": 0.01 * cnt + '',
    }
    // console.log(param);

    let re = null
    const reData = {
        status: false,
        code: null,
    }

    try{
        re = await axios.post(URL, param);
        
        if(!re.data.result){
            reData.status = false;
            return reData;
        }

        const data = JSON.parse(re.data.result);

        if(data.retcode == '0 Done'){
            reData.status = true;
        }else{
            if(data.answer == 'position not found or already close'){
                reData.status = true;
            }else{
                reData.status = false;
            }
        }
    }
    catch(e){
        if(e.status){
            reData.code = e.status;
            console.log('!!!!!! closePo !!!!!!', tid);
            console.log(e);
            // console.log(e.response.data)
        }else{
            console.log(e);
        }

        reData.status = false;
    }

    return reData;
}

exports.cancelOrder = async (tid) => {
    const BASE_URL = "https://api.innohed.com/portal/api"
    const PATH = "order/cancel"
    const URL = `${BASE_URL}/${PATH}`

    const param = {
        "ticket": tid,
        "apikey": META_KEY,
    }
    // console.log(param);

    let re = null
    const reData = {
        status: false,
    }

    try{
        re = await axios.post(URL, param);
        if(!re.data.result){
            reData.status = false;
            return reData;
        }

        const data = JSON.parse(re.data.result);
        
        if(data.retcode == '0 Done'){
            reData.status = true;
        }else{
            reData.status = false;
        }

    }
    catch(e){
        if(e.status){
            console.log('!!!!!! cancelOrder !!!!!!');
            console.log(e.status);
            console.log(e.response.data)
        }else{
            console.log('!!!!!! cancelOrder !!!!!! ::: ', tid);
            console.log(e);
            
        }

        reData.status = false;
    }

    // console.log('취소 : ', reData.status);

    return reData;
}

exports.getPositions = async (metaId) => {
    const BASE_URL = "https://api.innohed.com/portal/api"
    const PATH = "position/get_batch"
    const URL = `${BASE_URL}/${PATH}`

    const param = {
        // "ticket": tid+'',
        "login": metaId,
        "apikey": META_KEY,
    }

    let re = null
    const reData = []

    try{
        re = await axios.post(URL, param);
        if(!re.data.result){
            return reData;
        }

        const data = JSON.parse(re.data.result);

        for(let i=0;i<data.answer.length;i++){
            const answer = data.answer[i];
            
            const reData_ = {
                'tid': answer.Position,
                'cnt': answer.Volume,
                'open': parseFloat(answer.PriceOpen),
                'current': parseFloat(answer.PriceCurrent),
                'sl': parseFloat(answer.PriceSL),
                'tp': parseFloat(answer.PriceTP),
            }

            reData.push(reData_);
        }
    }
    catch(e){
        if(e.status){
            console.log('!!!!!! getPositions !!!!!!');
            console.log(e.status);
            console.log(e.response.data)
        }else{
            console.log('!!!!!! getPositions !!!!!! ::: ', metaId);
            console.log(e);
        }
    }

    return reData;
}

exports.getHistory = async (metaId) => {
    const BASE_URL = "https://api.innohed.com/portal/api"
    const PATH = "history/get_batch"
    const URL = `${BASE_URL}/${PATH}`

    const param = {
        "login": metaId,
        "apikey": META_KEY,
    }

    let re = null
    const reData = {
        status: false,
        data: [],
    }

    try{
        re = await axios.post(URL, param);
        if(!re.data.result){
            reData.status = false;
            return reData;
        }

        const data = JSON.parse(re.data.result);

        if(data.answer.length){
            reData.status = true;
            reData.data = data.answer;
        }
    }
    catch(e){
        if(e.status){
            console.log('!!!!!! getHistory !!!!!!');
            console.log(e.status);
            console.log(e.response.data)
        }else{
            console.log('!!!!!! getHistory !!!!!! ::: ', metaId);
            console.log(e);
        }

        reData.status = false;
        
    }

    return reData;
}

exports.getBalance = async (metaId) => {
    const BASE_URL = "https://api.innohed.com/portal/api"
    const PATH = "user/get"
    const URL = `${BASE_URL}/${PATH}`

    const param = {
        "login": metaId,
        "apikey": META_KEY,
    }

    let re = null
    const reData = {
        status: false,
        balance: null,
    }

    try{
        re = await axios.post(URL, param);
        if(!re.data.result){
            reData.status = false;
            return reData;
        }

        const data = JSON.parse(re.data.result);

        if(data.retcode == '0 Done'){
            reData.status = true;
            reData.balance = parseFloat(data.answer.Balance)

        }else{
            reData.status = false;
        }

    }
    catch(e){
        if(e.status){
            console.log('!!!!!! getBalance !!!!!!');
            console.log(e.status);
            console.log(e.response.data)
        }else{
            console.log(e);
        }

        reData.status = false;
    }

    return reData;
}

// exports.sendReq(20517.20, 1, 20008, 21510, 'BUY');
// exports.getHistory();

// (price, cnt, sl, tp) 