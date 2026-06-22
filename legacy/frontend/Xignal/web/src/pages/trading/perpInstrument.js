export const PERP_VENUE = 'BINANCE';
export const PERP_INSTRUMENT_TYPE = 'PERP';
export const PERP_MARKET_TYPE = 'USD_M_FUTURES';

const ASSET_NAME_KO = {
	BTC: '비트코인',
	ETH: '이더리움',
	XRP: '리플',
	SOL: '솔라나',
	DOGE: '도지코인',
	CRV: '커브',
	PUMP: '펌프',
	PAXG: '팍스골드'
};

export const normalizePerpNativeSymbol = (value) =>
	String(value || '')
		.trim()
		.toUpperCase()
		.replace(/^[A-Z0-9_]+:/, '')
		.replace(/\.P$/i, '');

const inferBaseAsset = (symbol) => String(symbol || '').replace(/USDT$/i, '');

export const buildPerpInstrument = (value, options = {}) => {
	const nativeSymbol = normalizePerpNativeSymbol(value);
	const baseAsset = String(options.baseAsset || inferBaseAsset(nativeSymbol)).trim().toUpperCase();
	const assetName = options.displayBase || ASSET_NAME_KO[baseAsset] || baseAsset || nativeSymbol;
	return {
		displaySymbol: nativeSymbol,
		displayName: nativeSymbol ? `${assetName} Perp` : '-',
		nativeSymbol,
		perpInstrument: {
			venue: PERP_VENUE,
			symbol: nativeSymbol,
			instrumentType: PERP_INSTRUMENT_TYPE,
			marketType: PERP_MARKET_TYPE
		},
		backtestQuerySymbol: nativeSymbol,
		liveBotSymbol: nativeSymbol
	};
};

export const formatPerpInstrumentLabel = (value, options = {}) => {
	const instrument = buildPerpInstrument(value, options);
	return instrument.nativeSymbol ? `${instrument.displayName} (${instrument.displaySymbol})` : '-';
};
