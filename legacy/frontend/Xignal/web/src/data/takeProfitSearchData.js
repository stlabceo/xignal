const PERIODS = ['2w', '1m', '2m', '3m', '6m', '1y', 'all'];

const STRATEGY_LABELS = {
	ATF_VIXFIX: 'ATF+VIXFIX',
	NY_QUIET_CLOSE_ASIA_BOX: 'NYBOX Grid'
};

const DIRECTION_LABELS = {
	BUY: '매수',
	SELL: '매도',
	BOTH: '양방향'
};

const toNumber = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
};

const parseTimeframeMinutes = (value) => {
	const raw = String(value || '').trim().toUpperCase();
	const minute = raw.match(/^(\d+)\s*(M|MIN|MINUTE|MINUTES)?$/);
	if (minute) return Number(minute[1]);
	const hour = raw.match(/^(\d+)\s*(H|HOUR|HOURS)$/);
	if (hour) return Number(hour[1]) * 60;
	return null;
};

const normalizeSymbol = (value) => String(value || '').trim().toUpperCase();

const makeRow = ({
	strategyId,
	symbol,
	timeframeRaw,
	period,
	tpPct,
	direction,
	winratePct,
	netPnlPct,
	status = 'OK'
}) => ({
	strategyId,
	strategyName: STRATEGY_LABELS[strategyId] || strategyId,
	symbol: normalizeSymbol(symbol),
	timeframeRaw: String(timeframeRaw || ''),
	timeframeMinutes: parseTimeframeMinutes(timeframeRaw),
	period: PERIODS.includes(period) ? period : 'all',
	tpPct: toNumber(tpPct),
	direction,
	directionLabel: DIRECTION_LABELS[direction] || direction,
	winratePct: toNumber(winratePct),
	netPnlPct: toNumber(netPnlPct),
	status,
	sourceDataset: 'public_backtest'
});

export const qbtStatsFixture = [
	{
		strategy_id: 'ATF_VIXFIX',
		symbol: 'BTCUSDT.P',
		timeframe: '15MIN',
		period: '1m',
		matrix: {
			buy: [
				{ tp_pct: 0.3, winrate_pct: 58.4, net_pnl_pct: 7.8 },
				{ tp_pct: 0.5, winrate_pct: 54.1, net_pnl_pct: 9.2 }
			],
			sell: [
				{ tp_pct: 0.3, winrate_pct: 56.2, net_pnl_pct: 6.9 },
				{ tp_pct: 0.6, winrate_pct: 51.8, net_pnl_pct: 8.1 }
			]
		}
	},
	{
		strategy_id: 'ATF_VIXFIX',
		symbol: 'ETHUSDT.P',
		timeframe: '30MIN',
		period: '3m',
		matrix: {
			buy: [
				{ tp_pct: 0.4, winrate_pct: 61.1, net_pnl_pct: 10.4 },
				{ tp_pct: 0.7, winrate_pct: 52.7, net_pnl_pct: 11.3 }
			],
			sell: [
				{ tp_pct: 0.4, winrate_pct: 55.9, net_pnl_pct: 7.6 }
			]
		}
	},
	{
		strategy_id: 'NY_QUIET_CLOSE_ASIA_BOX',
		symbol: 'SOLUSDT.P',
		timeframe: '10MIN',
		matrix: {
			'1m': [
				{ tp_pct: 0.5, winrate_pct: 63.5, net_pnl_pct: 12.2 },
				{ tp_pct: 0.8, winrate_pct: 57.6, net_pnl_pct: 13.1 }
			],
			'3m': [
				{ tp_pct: 0.5, winrate_pct: 60.4, net_pnl_pct: 15.8 },
				{ tp_pct: 1.0, winrate_pct: 50.2, net_pnl_pct: 14.6 }
			]
		}
	}
];

export const normalizeQbtStats = (datasets = qbtStatsFixture) =>
	datasets.flatMap((dataset) => {
		const strategyId = dataset.strategy_id || dataset.strategyId;
		const symbol = dataset.symbol;
		const timeframeRaw = dataset.timeframe || dataset.timeframeRaw || dataset.bunbong;

		if (strategyId === 'ATF_VIXFIX') {
			return ['buy', 'sell'].flatMap((side) =>
				(dataset.matrix?.[side] || []).map((item) =>
					makeRow({
						strategyId,
						symbol,
						timeframeRaw,
						period: dataset.period || 'all',
						tpPct: item.tp_pct,
						direction: side === 'buy' ? 'BUY' : 'SELL',
						winratePct: item.winrate_pct,
						netPnlPct: item.net_pnl_pct,
						status: item.status || 'OK'
					})
				)
			);
		}

		if (strategyId === 'NY_QUIET_CLOSE_ASIA_BOX') {
			return Object.entries(dataset.matrix || {}).flatMap(([period, items]) =>
				(items || []).map((item) =>
					makeRow({
						strategyId,
						symbol,
						timeframeRaw,
						period,
						tpPct: item.tp_pct,
						direction: 'BOTH',
						winratePct: item.winrate_pct,
						netPnlPct: item.net_pnl_pct,
						status: item.status || 'OK'
					})
				)
			);
		}

		return [];
	});

export const filterTakeProfitRows = (rows, filters = {}) => {
	const symbol = normalizeSymbol(filters.symbol);
	const strategyId = String(filters.strategyId || '').trim();
	const period = String(filters.period || 'all').trim();
	const minWinrate = toNumber(filters.minWinrate);
	const minReturn = toNumber(filters.minReturn);

	return rows
		.filter((row) => row.status === 'OK')
		.filter((row) => (!symbol ? true : row.symbol.includes(symbol)))
		.filter((row) => (!strategyId || strategyId === 'all' ? true : row.strategyId === strategyId))
		.filter((row) => (period === 'all' ? true : row.period === period || row.period === 'all'))
		.filter((row) => (minWinrate === null ? true : Number(row.winratePct || 0) >= minWinrate))
		.filter((row) => (minReturn === null ? true : Number(row.netPnlPct || 0) >= minReturn))
		.sort((a, b) => Number(b.netPnlPct || -Infinity) - Number(a.netPnlPct || -Infinity));
};

export const directionOrder = {
	BOTH: 0,
	BUY: 1,
	SELL: 2
};

export const strategyOptions = Object.entries(STRATEGY_LABELS).map(([value, label]) => ({ value, label }));

export const periodOptions = PERIODS.map((period) => ({ value: period, label: period }));
