var exports = module.exports = {};
const SYMBOL = 'NQM25';

exports.offerho = 0;
exports.bidho = 0;

exports.price = {}

exports.getPrice = (symbol) => {

    if(exports.price[symbol]){
        return {
            symbol: symbol,
            bestBid: parseFloat(exports.price[symbol].bestBid),
            bestBidQty: exports.price[symbol].bestBidQty,
            bestAsk: parseFloat(exports.price[symbol].bestAsk),
            bestAskQty: exports.price[symbol].bestAskQty,
            st: true,
        }
    }else{
        return {
            symbol: symbol,
            bestBid: 0,
            bestBidQty: 0,
            bestAsk: 0,
            bestAskQty: 0,
            st: false,
        }
    }
}

exports.usersData = {}