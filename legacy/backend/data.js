var exports = module.exports = {};

exports.price = {}

exports.getPrice = (symbol) => {

    if(exports.price[symbol]){
        return {
            symbol: symbol,
            bestBid: parseFloat(exports.price[symbol].bestBid),
            bestBidQty: exports.price[symbol].bestBidQty,
            bestAsk: parseFloat(exports.price[symbol].bestAsk),
            bestAskQty: exports.price[symbol].bestAskQty,
            lastPrice: exports.price[symbol].lastPrice ? parseFloat(exports.price[symbol].lastPrice) : 0,
            lastQty: exports.price[symbol].lastQty ? parseFloat(exports.price[symbol].lastQty) : 0,
            lastTradeTime: exports.price[symbol].lastTradeTime || 0,
            st: true,
        }
    }else{
        return {
            symbol: symbol,
            bestBid: 0,
            bestBidQty: 0,
            bestAsk: 0,
            bestAskQty: 0,
            lastPrice: 0,
            lastQty: 0,
            lastTradeTime: 0,
            st: false,
        }
    }
}

exports.usersData = {}
