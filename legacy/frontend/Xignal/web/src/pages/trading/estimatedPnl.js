export const ESTIMATED_UNREALIZED_PNL_SOURCE = 'FRONTEND_MARK_PRICE_ESTIMATE';

export const toFiniteNumber = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
};

export const normalizeMarketSymbol = (value) =>
	String(value || '')
		.trim()
		.toUpperCase()
		.replace(/^BINANCE:/, '')
		.replace(/\.P$/, '');

export const getMarketPriceFromRow = (priceRow = {}) => {
	const directPrice = toFiniteNumber(priceRow?.markPrice ?? priceRow?.lastPrice ?? priceRow?.price);
	if (directPrice > 0) return directPrice;

	const bestBid = toFiniteNumber(priceRow?.bestBid ?? priceRow?.bidPrice);
	const bestAsk = toFiniteNumber(priceRow?.bestAsk ?? priceRow?.askPrice);
	if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;
	return bestBid || bestAsk || 0;
};

export const getMarketPriceForSymbol = (priceMap = {}, symbol) => {
	const normalized = normalizeMarketSymbol(symbol);
	const candidates = [
		symbol,
		String(symbol || '').trim().toUpperCase(),
		normalized,
		normalized ? `${normalized}.P` : '',
		normalized ? `BINANCE:${normalized}.P` : ''
	].filter(Boolean);

	for (const key of candidates) {
		const price = getMarketPriceFromRow(priceMap?.[key]);
		if (price > 0) return price;
	}

	return 0;
};

export const normalizePositionSide = (value) => {
	const normalized = String(value || '').trim().toUpperCase();
	if (normalized === 'LONG' || normalized === 'BUY') return 'LONG';
	if (normalized === 'SHORT' || normalized === 'SELL') return 'SHORT';
	return '';
};

export const estimateUnrealizedPnl = ({ side, positionSide, openQty, avgEntryPrice, markPrice } = {}) => {
	const qty = Math.abs(toFiniteNumber(openQty));
	const entry = toFiniteNumber(avgEntryPrice);
	const mark = toFiniteNumber(markPrice);

	if (!qty || !entry || !mark) return null;

	const normalizedSide = normalizePositionSide(positionSide || side);
	if (normalizedSide === 'LONG') {
		return (mark - entry) * qty;
	}
	if (normalizedSide === 'SHORT') {
		return (entry - mark) * qty;
	}
	return null;
};

export const buildEstimatedUnrealizedPnl = ({ side, positionSide, openQty, avgEntryPrice, markPrice } = {}) => {
	const qty = Math.abs(toFiniteNumber(openQty));
	const entry = toFiniteNumber(avgEntryPrice);
	const mark = toFiniteNumber(markPrice);

	if (!qty) {
		return {
			value: null,
			status: 'FLAT',
			estimated: true,
			source: ESTIMATED_UNREALIZED_PNL_SOURCE
		};
	}

	if (!entry) {
		return {
			value: null,
			status: 'ENTRY_PRICE_UNAVAILABLE',
			estimated: true,
			source: ESTIMATED_UNREALIZED_PNL_SOURCE
		};
	}

	if (!mark) {
		return {
			value: null,
			status: 'PRICE_UNAVAILABLE',
			estimated: true,
			source: ESTIMATED_UNREALIZED_PNL_SOURCE
		};
	}

	const value = estimateUnrealizedPnl({ side, positionSide, openQty: qty, avgEntryPrice: entry, markPrice: mark });
	return {
		value,
		status: value === null ? 'SIDE_UNAVAILABLE' : 'ESTIMATED',
		estimated: true,
		source: ESTIMATED_UNREALIZED_PNL_SOURCE
	};
};

export const estimateGridUnrealizedPnl = (item = {}, markPrice) => {
	const longEstimate = buildEstimatedUnrealizedPnl({
		positionSide: 'LONG',
		openQty: item.longQty,
		avgEntryPrice: item.longEntryPrice,
		markPrice
	});
	const shortEstimate = buildEstimatedUnrealizedPnl({
		positionSide: 'SHORT',
		openQty: item.shortQty,
		avgEntryPrice: item.shortEntryPrice,
		markPrice
	});

	const estimates = [longEstimate, shortEstimate];
	const openEstimates = estimates.filter((estimate) => estimate.status !== 'FLAT');
	if (!openEstimates.length) {
		return {
			value: null,
			status: 'FLAT',
			estimated: true,
			source: ESTIMATED_UNREALIZED_PNL_SOURCE
		};
	}

	const blockingStatus = openEstimates.find((estimate) => estimate.value === null)?.status;
	if (blockingStatus) {
		return {
			value: null,
			status: blockingStatus,
			estimated: true,
			source: ESTIMATED_UNREALIZED_PNL_SOURCE
		};
	}

	return {
		value: openEstimates.reduce((sum, estimate) => sum + toFiniteNumber(estimate.value), 0),
		status: 'ESTIMATED',
		estimated: true,
		source: ESTIMATED_UNREALIZED_PNL_SOURCE
	};
};
