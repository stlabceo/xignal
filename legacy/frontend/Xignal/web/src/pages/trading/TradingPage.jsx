import React, { useEffect, useMemo, useState } from 'react';
import { trading } from '../../services/trading';
import { useAuthStore } from '../../store/authState';
import BotSetupModal from './BotSetupModal';

const MODE = {
	TEST: 'TEST',
	LIVE: 'LIVE'
};

const MODE_LABEL = {
	[MODE.TEST]: '데모',
	[MODE.LIVE]: '실거래'
};

const EMPTY_TEXT = '-';
const DIRECTION_ORDER = { 양방향: 0, 매수: 1, 매도: 2 };

const toNumberOrNull = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
};

const firstValue = (...values) => values.find((value) => value !== null && value !== undefined && value !== '') ?? null;

const pickArray = (payload) => {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload?.items)) return payload.items;
	if (Array.isArray(payload?.rows)) return payload.rows;
	if (Array.isArray(payload?.data)) return payload.data;
	if (Array.isArray(payload?.list)) return payload.list;
	if (Array.isArray(payload?.result)) return payload.result;
	if (Array.isArray(payload?.result?.items)) return payload.result.items;
	return [];
};

const requestWithCallback = (requester, params = {}) =>
	new Promise((resolve) => {
		let settled = false;
		const done = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		window.setTimeout(() => done(false), 8000);
		try {
			requester(params, done);
		} catch {
			done(false);
		}
	});

const formatAmount = (value, suffix = '') => {
	const numeric = toNumberOrNull(value);
	if (numeric === null) return EMPTY_TEXT;
	return `${numeric.toLocaleString('ko-KR', {
		minimumFractionDigits: Math.abs(numeric) >= 100 ? 0 : 2,
		maximumFractionDigits: 2
	})}${suffix}`;
};

const formatCompactAmount = (value) => {
	const numeric = toNumberOrNull(value);
	if (numeric === null) return EMPTY_TEXT;
	return numeric.toLocaleString('ko-KR', {
		minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
		maximumFractionDigits: 2
	});
};

const formatSignedAmount = (value, suffix = '') => {
	const numeric = toNumberOrNull(value);
	if (numeric === null) return EMPTY_TEXT;
	return `${numeric > 0 ? '+' : ''}${formatAmount(numeric, suffix)}`;
};

const formatPercent = (value) => {
	const numeric = toNumberOrNull(value);
	if (numeric === null) return EMPTY_TEXT;
	return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
};

const formatPlainPercent = (value) => {
	const numeric = toNumberOrNull(value);
	if (numeric === null) return EMPTY_TEXT;
	return `${numeric.toFixed(2)}%`;
};

const formatDateTime = (value) => {
	if (!value) return EMPTY_TEXT;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString('ko-KR', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
};

const normalizeSymbol = (value) => String(value || '').trim() || EMPTY_TEXT;
const isEnabledValue = (value) => ['Y', 'YES', 'TRUE', '1', 'ON'].includes(String(value ?? '').trim().toUpperCase());

const normalizeDirection = (row = {}, strategyCategory = 'SIGNAL') => {
	if (strategyCategory === 'GRID') return '양방향';
	const raw = String(firstValue(row.signalType, row.positionSide, row.side, row.direction, row.orderSide, row.r_signalType) || '')
		.trim()
		.toUpperCase();
	if (['BUY', 'LONG'].includes(raw)) return '매수';
	if (['SELL', 'SHORT'].includes(raw)) return '매도';
	return EMPTY_TEXT;
};

const normalizeBotName = (row = {}, strategyCategory = 'SIGNAL') =>
	String(
		firstValue(row.a_name, row.strategyName, row.botName, row.strategySignal, row.type, row.name) ||
			(strategyCategory === 'GRID' ? 'Grid Bot' : 'Algorithm Bot')
	);

const normalizeWinRateNumber = (row = {}) => {
	const direct = toNumberOrNull(firstValue(row.winRate, row.recentWinRate, row.runtimeWinRate, row.successRate));
	if (direct !== null) return direct;
	const wins = toNumberOrNull(firstValue(row.winCount, row.successCount));
	const losses = toNumberOrNull(firstValue(row.lossCount, row.failCount));
	if (wins !== null && losses !== null && wins + losses > 0) return (wins / (wins + losses)) * 100;
	return null;
};

const normalizeProfitRateNumber = (row = {}) =>
	toNumberOrNull(firstValue(row.profitRate, row.returnRate, row.pnlRate, row.realizedPnlRate, row.totalReturnRate));

const getMargin = (row = {}) => toNumberOrNull(firstValue(row.margin, row.tradeValue, row.orderSize, row.assignedAmount, row.seedMoney));
const getLeverage = (row = {}) => toNumberOrNull(firstValue(row.leverage, row.marginLeverage)) ?? 1;

const STRATEGY_NAME_MAP = {
	ATF_VIXFIX: 'ATF+VIXFIX',
	'ATF+VIXFIX': 'ATF+VIXFIX',
	NYBOX: 'NY Quiet Close Asia Box Grid',
	NY_QUIET_CLOSE_ASIA_BOX: 'NY Quiet Close Asia Box Grid',
	SQZ_GRID: 'SQZ+GRID',
	'SQZ+GRID': 'SQZ+GRID'
};

const BACKTEST_STRATEGY_KEY_MAP = {
	ATF_VIXFIX: 'ATF+VIXFIX',
	'ATF+VIXFIX': 'ATF+VIXFIX',
	NYBOX: 'NY_QUIET_CLOSE_ASIA_BOX',
	NY_QUIET_CLOSE_ASIA_BOX: 'NY_QUIET_CLOSE_ASIA_BOX',
	SQZ_GRID: 'NY_QUIET_CLOSE_ASIA_BOX',
	'SQZ+GRID': 'NY_QUIET_CLOSE_ASIA_BOX'
};

const resolveStrategyName = (row = {}, strategyCategory = 'SIGNAL') => {
	const rawName = firstValue(
		row.strategyDisplayName,
		row.strategyName,
		row.displayName,
		strategyCategory === 'GRID' ? row.strategySignal : row.type,
		row.strategySignal,
		row.strategyCode,
		row.signalName
	);
	const key = String(rawName || '').trim();
	if (!key) return '전략 이름 없음';
	return STRATEGY_NAME_MAP[key] || key;
};

const resolveWebhookStrategyName = (row = {}, strategyCategory = 'SIGNAL') => {
	const rawName = strategyCategory === 'GRID' ? row.strategySignal : firstValue(row.type, row.strategySignal);
	const key = String(rawName || '').trim();
	if (!key) return '전략 이름 없음';
	return STRATEGY_NAME_MAP[key] || key;
};

const normalizeTradeAmount = (row = {}) => {
	const margin = getMargin(row);
	const leverage = getLeverage(row);
	if (margin === null) return { label: EMPTY_TEXT, margin: null, leverage };
	return {
		label: `${formatCompactAmount(margin)}$ X ${formatCompactAmount(leverage)}`,
		margin,
		leverage
	};
};

const estimatePosition = (row = {}, strategyCategory = 'SIGNAL', publicPrices = {}) => {
	const symbol = normalizeSymbol(row.symbol || row.r_symbol);
	if (symbol === EMPTY_TEXT) return null;
	const currentPrice = publicPrices[symbol.replace('.P', '')] ?? publicPrices[symbol] ?? null;

	if (strategyCategory === 'GRID') {
		const longQty = toNumberOrNull(row.longQty) || 0;
		const shortQty = toNumberOrNull(row.shortQty) || 0;
		const longEntry = toNumberOrNull(row.longEntryPrice);
		const shortEntry = toNumberOrNull(row.shortEntryPrice);
		const items = [];
		if (longQty > 0) items.push({ side: 'LONG', qty: longQty, entry: longEntry });
		if (shortQty > 0) items.push({ side: 'SHORT', qty: shortQty, entry: shortEntry });
		if (!items.length) return null;
		const pnl = currentPrice
			? items.reduce((sum, item) => {
					if (!item.entry) return sum;
					return sum + (item.side === 'LONG' ? (currentPrice - item.entry) * item.qty : (item.entry - currentPrice) * item.qty);
				}, 0)
			: null;
		return { label: items.map((item) => `${item.side} ${formatAmount(item.qty)}`).join(' / '), pnl };
	}

	const qty = toNumberOrNull(firstValue(row.r_qty, row.qty, row.positionQty, row.quantity)) || 0;
	if (qty <= 0) return null;
	const direction = normalizeDirection(row, strategyCategory) === '매도' ? 'SHORT' : 'LONG';
	const entry = toNumberOrNull(firstValue(row.r_exactPrice, row.entryPrice, row.r_signalPrice, row.signalPrice));
	const pnl = currentPrice && entry ? (direction === 'LONG' ? (currentPrice - entry) * qty : (entry - currentPrice) * qty) : null;
	return { label: `${direction} ${formatAmount(qty)}`, pnl };
};

const buildBotRows = ({ signalRows = [], gridRows = [], mode, publicPrices = {} }) => [
	...signalRows.map((row) => {
		const tradeAmount = normalizeTradeAmount(row);
		const position = estimatePosition(row, 'SIGNAL', publicPrices);
		const enabled = isEnabledValue(row.enabled);
		return {
			id: row.id,
			raw: row,
			key: `signal-${mode}-${row.id}`,
			strategyCategory: 'SIGNAL',
			typeLabel: 'Algorithm',
			strategyName: resolveStrategyName(row, 'SIGNAL'),
			webhookStrategyName: resolveWebhookStrategyName(row, 'SIGNAL'),
			name: normalizeBotName(row, 'SIGNAL'),
			symbol: normalizeSymbol(row.symbol || row.r_symbol),
			direction: normalizeDirection(row, 'SIGNAL'),
			enabled,
			tradeAmount,
			winRateNumber: normalizeWinRateNumber(row),
			profitRateNumber: normalizeProfitRateNumber(row),
			position,
			recentEvent: position ? formatSignedAmount(position.pnl, ' USDT') : 'Ready'
		};
	}),
	...gridRows.map((row) => {
		const tradeAmount = normalizeTradeAmount(row);
		const position = estimatePosition(row, 'GRID', publicPrices);
		const enabled = isEnabledValue(row.enabled);
		return {
			id: row.id,
			raw: row,
			key: `grid-${mode}-${row.id}`,
			strategyCategory: 'GRID',
			typeLabel: 'Grid',
			strategyName: resolveStrategyName(row, 'GRID'),
			webhookStrategyName: resolveWebhookStrategyName(row, 'GRID'),
			name: normalizeBotName(row, 'GRID'),
			symbol: normalizeSymbol(row.symbol),
			direction: '양방향',
			enabled,
			tradeAmount,
			winRateNumber: normalizeWinRateNumber(row),
			profitRateNumber: normalizeProfitRateNumber(row),
			position,
			recentEvent: position ? formatSignedAmount(position.pnl, ' USDT') : 'Ready'
		};
	})
];

const buildTrackRows = (payload) =>
	pickArray(payload)
		.slice(0, 20)
		.map((row, index) => {
			const rawTime = firstValue(row.exitTime, row.tradeTime, row.closedAt, row.updatedAt, row.createdAt);
			const pnlValue = toNumberOrNull(firstValue(row.realizedPnl, row.pnl, row.realizedDemoPnl));
			return {
				key: row.id || row.demoRecordId || row.recordId || `${index}`,
				raw: row,
				rawTime,
				timestamp: rawTime ? new Date(rawTime).getTime() : null,
				time: formatDateTime(rawTime),
				bot: String(firstValue(row.strategyName, row.botName, row.a_name, row.strategySignal, row.strategyType) || EMPTY_TEXT),
				symbol: normalizeSymbol(row.symbol),
				direction: normalizeDirection(row),
				result: String(firstValue(row.exitReason, row.result, row.status, row.resultCode) || EMPTY_TEXT),
				profitRate: formatPercent(firstValue(row.profitRate, row.returnRate, row.pnlRate, row.realizedPnlRate)),
				pnl: formatSignedAmount(pnlValue, ' USDT'),
				pnlValue,
				pnlTone: (pnlValue || 0) >= 0 ? 'positive' : 'negative',
				detail: firstValue(row.summaryText, row.detail, row.resultCode, row.status) || EMPTY_TEXT
			};
		});

const TRACK_RECORD_PERIODS = [
	{ key: '1w', label: '1주', days: 7 },
	{ key: '1m', label: '1개월', days: 30 },
	{ key: '3m', label: '3개월', days: 90 },
	{ key: '6m', label: '6개월', days: 180 },
	{ key: '1y', label: '1년', days: 365 },
	{ key: 'all', label: '전체', days: null }
];

const filterTrackRowsByPeriod = (rows = [], periodKey = '1m') => {
	const selected = TRACK_RECORD_PERIODS.find((period) => period.key === periodKey) || TRACK_RECORD_PERIODS[1];
	if (!selected.days) return rows;
	const cutoff = Date.now() - selected.days * 24 * 60 * 60 * 1000;
	return rows.filter((row) => !row.timestamp || row.timestamp >= cutoff);
};

const getBotTrackRows = (bot, trackRows = []) => {
	if (!bot) return [];
	const botName = String(bot.name || '').trim();
	const symbol = normalizeSymbol(bot.symbol);
	return trackRows.filter((row) => {
		const sameSymbol = !row.symbol || row.symbol === EMPTY_TEXT || row.symbol === symbol;
		const sameBot = !row.bot || row.bot === EMPTY_TEXT || row.bot === botName || row.bot === bot.strategyName || row.bot === bot.webhookStrategyName;
		return sameSymbol && sameBot;
	});
};

const LineChart = ({ rows, valueKey, labelKey }) => {
	const values = rows.map((row) => toNumberOrNull(row[valueKey])).filter((value) => value !== null);
	if (values.length < 2) {
		return (
			<div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-sm text-[#64748B]">
				계산 가능한 일자별 데이터가 부족합니다.
			</div>
		);
	}

	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	const points = rows
		.map((row, index) => {
			const value = toNumberOrNull(row[valueKey]);
			const x = (index / Math.max(rows.length - 1, 1)) * 100;
			const y = 100 - (((value ?? min) - min) / span) * 84 - 8;
			return `${x},${y}`;
		})
		.join(' ');

	return (
		<div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
			<svg viewBox="0 0 100 100" className="h-[220px] w-full overflow-visible">
				<polyline fill="none" stroke="#2563EB" strokeWidth="2.5" points={points} vectorEffect="non-scaling-stroke" />
				{rows.map((row, index) => {
					const value = toNumberOrNull(row[valueKey]);
					const x = (index / Math.max(rows.length - 1, 1)) * 100;
					const y = 100 - (((value ?? min) - min) / span) * 84 - 8;
					return <circle key={`${row[labelKey]}-${index}`} cx={x} cy={y} r="1.6" fill="#2563EB" />;
				})}
			</svg>
		</div>
	);
};

const KpiModal = ({ activeTab, onClose, rows }) => {
	const [tab, setTab] = useState(activeTab || 'balance');
	const tabs = [
		{ key: 'balance', label: '총 잔고', valueKey: 'balance', tableHeaders: ['날짜', '총 잔고', '일별 증감', '모드'] },
		{ key: 'pnl', label: '누적 손익', valueKey: 'cumulativePnl', tableHeaders: ['날짜', '누적 손익', '일별 손익', '모드'] },
		{ key: 'returnRate', label: '누적 수익률', valueKey: 'returnRate', tableHeaders: ['날짜', '누적 수익률', '해당 일자 수익률', '모드'] }
	];
	const current = tabs.find((item) => item.key === tab) || tabs[0];

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0F172A]/40 px-4 py-6">
			<div className="max-h-[92vh] w-full max-w-[900px] overflow-y-auto rounded-[18px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2 className="text-xl font-bold text-[#0F172A]">성과 추이</h2>
						<p className="mt-1 text-sm text-[#64748B]">기존 트랙레코드에서 계산 가능한 범위만 표시합니다.</p>
					</div>
					<button type="button" onClick={onClose} className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm font-semibold text-[#64748B]">닫기</button>
				</div>
				<div className="mt-5 flex flex-wrap gap-2">
					{tabs.map((item) => (
						<button
							key={item.key}
							type="button"
							onClick={() => setTab(item.key)}
							className={`rounded-full px-4 py-2 text-sm font-bold ${tab === item.key ? 'bg-[#2563EB] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
						>
							{item.label}
						</button>
					))}
				</div>
				<div className="mt-5">
					<LineChart rows={rows} valueKey={current.valueKey} labelKey="date" />
				</div>
				<div className="mt-5 overflow-x-auto">
					<table className="w-full min-w-[620px] border-collapse">
						<thead className="bg-[#F8FAFC]">
							<tr>{current.tableHeaders.map((header) => <th key={header} className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">{header}</th>)}</tr>
						</thead>
						<tbody>
							{rows.length === 0 ? (
								<tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-[#64748B]">일자별 잔고/수익률 데이터가 없습니다.</td></tr>
							) : (
								rows.map((row) => (
									<tr key={`${tab}-${row.date}`} className="border-b border-[#E2E8F0] last:border-b-0">
										<td className="px-4 py-3 text-sm">{row.date}</td>
										<td className="px-4 py-3 text-sm font-semibold">{tab === 'returnRate' ? formatPercent(row.returnRate) : formatAmount(row[current.valueKey], ' USDT')}</td>
										<td className="px-4 py-3 text-sm">{tab === 'balance' ? formatSignedAmount(row.dailyChange, ' USDT') : tab === 'pnl' ? formatSignedAmount(row.dailyPnl, ' USDT') : formatPercent(row.dailyReturnRate)}</td>
										<td className="px-4 py-3 text-sm text-[#64748B]">{row.mode}</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
};

const KpiCard = ({ label, value, helper, tone = 'neutral', onClick }) => (
	<button
		type="button"
		onClick={onClick}
		className="min-h-[118px] rounded-2xl border border-[#E2E8F0] bg-white p-5 text-left shadow-[0_12px_30px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,23,42,0.08)]"
	>
		<p className="text-[13px] font-medium text-[#64748B]">{label}</p>
		<p className={`mt-3 whitespace-pre-line text-[26px] font-bold leading-tight ${tone === 'positive' ? 'text-[#16A34A]' : tone === 'negative' ? 'text-[#DC2626]' : 'text-[#0F172A]'}`}>{value}</p>
		{helper ? <p className="mt-3 text-xs text-[#94A3B8]">{helper}</p> : null}
	</button>
);

const SortHeader = ({ label, active, direction, onClick }) => (
	<button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-left text-xs font-semibold text-[#64748B]">
		{label}
		<span className={active ? 'text-[#2563EB]' : 'text-[#CBD5E1]'}>{active ? (direction === 'desc' ? '↓' : '↑') : '↕'}</span>
	</button>
);

const ToggleSwitch = ({ active }) => (
	<span className={`inline-flex h-7 w-12 items-center rounded-full p-1 ${active ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'}`}>
		<span className={`h-5 w-5 rounded-full bg-white shadow transition ${active ? 'translate-x-5' : 'translate-x-0'}`} />
	</span>
);

const normalizeSignalTypeForBacktest = (direction) => {
	if (direction === '매수') return 'BUY';
	if (direction === '매도') return 'SELL';
	if (direction === '양방향') return 'BOTH';
	return String(direction || '').toUpperCase();
};

const normalizeBacktestStrategyKey = (strategyKey, strategyCategory) => {
	const fallback = strategyCategory === 'GRID' ? 'NY_QUIET_CLOSE_ASIA_BOX' : 'ATF+VIXFIX';
	const rawKey = String(strategyKey || '').trim();
	if (!rawKey) return fallback;
	const upperKey = rawKey.toUpperCase();
	return BACKTEST_STRATEGY_KEY_MAP[rawKey] || BACKTEST_STRATEGY_KEY_MAP[upperKey] || rawKey;
};

const getBotBacktestQuery = (bot) => {
	if (!bot) return null;
	const rawStrategyKey = bot.strategyCategory === 'GRID'
		? firstValue(bot.raw.strategySignal, bot.raw.strategyName, 'NY_QUIET_CLOSE_ASIA_BOX')
		: firstValue(bot.raw.type, bot.raw.strategySignal, 'ATF+VIXFIX');
	const strategyKey = normalizeBacktestStrategyKey(rawStrategyKey, bot.strategyCategory);
	const symbol = normalizeSymbol(firstValue(bot.raw.symbol, bot.raw.r_symbol, bot.symbol)).replace('.P', '');
	const bunbong = firstValue(bot.raw.bunbong, bot.raw.timeframe, bot.raw.interval);
	const signalType = bot.strategyCategory === 'GRID' ? 'BOTH' : normalizeSignalTypeForBacktest(bot.direction);
	if (!strategyKey || !symbol || !bunbong || !signalType) return null;
	return { strategyKey, symbol, bunbong, signalType };
};

const formatSplitTakeProfit = (row = {}) => {
	const enabled = isEnabledValue(firstValue(row.splitTakeProfitEnabled, row.splitTakeProfitST));
	if (!enabled) return '사용 안 함';
	const count = firstValue(row.splitTakeProfitCount, row.splitCount) || '-';
	const gap = firstValue(row.splitTakeProfitGap, row.splitGap) || '-';
	return `사용 / ${count}단계 / 간격 ${gap}%`;
};

const formatStopLossTime = (row = {}) => {
	const enabled = isEnabledValue(row.stopLossTimeEnabled);
	if (!enabled) return '사용 안 함';
	return `${firstValue(row.stopLossTimeValue, row.stopLossMinutes) || '-'}분`;
};

const getSettingRows = (bot) => {
	if (!bot) return [];
	const row = bot.raw || {};
	const commonRows = [
		['Bot 이름 / 별명', bot.name],
		['전략 설정 이름', firstValue(row.a_name, row.strategyName, bot.name) || '-'],
		['실제 웹훅 수신 전략 이름', bot.webhookStrategyName],
		['종목', bot.symbol],
		['캔들 / timeframe', firstValue(row.bunbong, row.timeframe, row.interval) || '-'],
		['방향', bot.direction],
		['마진', bot.tradeAmount.margin === null ? '-' : `${formatCompactAmount(bot.tradeAmount.margin)} USDT`],
		['레버리지', bot.tradeAmount.leverage === null ? '-' : `${formatCompactAmount(bot.tradeAmount.leverage)}x`],
		['거래금액', bot.tradeAmount.label],
		['익절 설정', firstValue(row.profit, row.t_profit, row.longTakeProfitPrice, row.shortTakeProfitPrice) || '-']
	];

	if (bot.strategyCategory === 'GRID') {
		return [
			...commonRows,
			['그리드 종료 정책', '그리드 전략은 별도 손절값을 입력하지 않습니다. Grid Exit 웹훅을 수신하면 해당 레짐의 보유 포지션/주문 정리 경로가 실행됩니다.']
		];
	}

	return [
		...commonRows,
		['분할 익절 설정', formatSplitTakeProfit(row)],
		['% 손절', firstValue(row.stopLoss, row.r_stopPrice) || '-'],
		['시간 경과 손절', formatStopLossTime(row)]
	];
};

const BotDetailModal = ({ bot, trackRows, onClose }) => {
	const [tab, setTab] = useState('settings');
	const [trackPeriod, setTrackPeriod] = useState('1m');
	const [backtestRows, setBacktestRows] = useState([]);
	const [backtestLoading, setBacktestLoading] = useState(false);
	const [backtestLatestGeneratedAt, setBacktestLatestGeneratedAt] = useState(null);

	const backtestQuery = useMemo(() => getBotBacktestQuery(bot), [bot]);
	const settingRows = useMemo(() => getSettingRows(bot), [bot]);
	const botTrackRows = useMemo(() => getBotTrackRows(bot, trackRows), [bot, trackRows]);
	const filteredTrackRows = useMemo(() => filterTrackRowsByPeriod(botTrackRows, trackPeriod), [botTrackRows, trackPeriod]);

	useEffect(() => {
		if (!bot || !backtestQuery) {
			setBacktestRows([]);
			setBacktestLatestGeneratedAt(null);
			setBacktestLoading(false);
			return;
		}

		let canceled = false;
		setBacktestLoading(true);
		trading.getBacktestStats(backtestQuery, (res) => {
			if (canceled) return;
			const items = Array.isArray(res?.items) ? res.items : [];
			setBacktestRows(items);
			setBacktestLatestGeneratedAt(res?.latestGeneratedAt || null);
			setBacktestLoading(false);
		});
		return () => {
			canceled = true;
		};
	}, [backtestQuery, bot]);

	if (!bot) return null;
	const hasPosition = Boolean(bot.position);
	const canEdit = !hasPosition;

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0F172A]/40 px-4 py-6">
			<div className="max-h-[92vh] w-full max-w-[860px] overflow-y-auto rounded-[18px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
				<div className="flex items-start justify-between gap-4">
					<div>
						<p className="text-sm font-semibold text-[#2563EB]">{bot.strategyName}</p>
						<h2 className="mt-1 text-xl font-bold text-[#0F172A]">{bot.name}</h2>
						<p className="mt-2 text-sm text-[#64748B]">{bot.symbol} · {bot.direction} · {bot.enabled ? 'ON' : 'OFF'} · 승률 {formatPercent(bot.winRateNumber)} · 수익률 {formatPercent(bot.profitRateNumber)}</p>
					</div>
					<button type="button" onClick={onClose} className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm font-semibold text-[#64748B]">닫기</button>
				</div>

				<div className="mt-5 flex flex-wrap gap-2">
					{[
						['settings', '설정'],
						['records', '트랙레코드'],
						['backtest', '백테스트']
					].map(([key, label]) => (
						<button key={key} type="button" onClick={() => setTab(key)} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === key ? 'bg-[#2563EB] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}>{label}</button>
					))}
				</div>

				{tab === 'settings' ? (
					<div className="mt-5">
						<div className="grid gap-4 sm:grid-cols-2">
							{settingRows.map(([label, value]) => (
								<div key={label} className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
									<p className="text-xs font-semibold text-[#64748B]">{label}</p>
									<p className="mt-2 whitespace-pre-line text-sm font-bold text-[#0F172A]">{value}</p>
								</div>
							))}
						</div>
						<div className="mt-4 rounded-2xl border border-[#E2E8F0] bg-white p-4">
							<p className="text-xs font-semibold text-[#64748B]">수정 가능 여부</p>
							<p className="mt-2 text-sm font-bold text-[#0F172A]">
								{canEdit ? '포지션 없음 / 수정 API 연결 필요' : '포지션 보유 중 / 조건 수정 불가'}
							</p>
							<p className="mt-1 text-xs text-[#94A3B8]">기존 owner/snapshot/open position projection에서 포지션이 있으면 수정하지 않습니다. 안전한 수정 API 연결 전까지 mutation은 호출하지 않습니다.</p>
						</div>
						<button
							type="button"
							disabled
							className="mt-5 h-11 rounded-xl bg-[#2563EB] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#CBD5E1]"
							title={hasPosition ? '포지션 보유 중인 Bot은 수정할 수 없습니다.' : '조건 수정 API 연결 필요'}
						>
							조건 수정 API 연결 필요
						</button>
					</div>
				) : null}

				{tab === 'records' ? (
					<div className="mt-5">
						<div className="mb-4 flex flex-wrap gap-2">
							{TRACK_RECORD_PERIODS.map((period) => (
								<button
									key={period.key}
									type="button"
									onClick={() => setTrackPeriod(period.key)}
									className={`rounded-full px-3 py-1.5 text-xs font-bold ${trackPeriod === period.key ? 'bg-[#2563EB] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
								>
									{period.label}
								</button>
							))}
						</div>
						<div className="overflow-x-auto">
							<table className="w-full min-w-[760px] border-collapse">
								<thead className="bg-[#F8FAFC]"><tr>{['날짜', '종목', '방향', '결과', '수익', '수익률', '상세'].map((header) => <th key={header} className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">{header}</th>)}</tr></thead>
								<tbody>
									{filteredTrackRows.length === 0 ? (
										<tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[#64748B]">선택 기간의 트랙레코드가 없습니다.</td></tr>
									) : filteredTrackRows.map((row) => (
										<tr key={`${bot.key}-${row.key}`} className="border-b border-[#E2E8F0] last:border-b-0">
											<td className="px-4 py-3 text-sm">{row.time}</td>
											<td className="px-4 py-3 text-sm">{row.symbol}</td>
											<td className="px-4 py-3 text-sm">{row.direction}</td>
											<td className="px-4 py-3 text-sm">{row.result}</td>
											<td className={`px-4 py-3 text-sm font-semibold ${row.pnlTone === 'negative' ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>{row.pnl}</td>
											<td className="px-4 py-3 text-sm">{row.profitRate}</td>
											<td className="px-4 py-3 text-sm text-[#64748B]">{row.detail}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				) : null}

				{tab === 'backtest' ? (
					<div className="mt-5">
						<div className="mb-4 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-sm text-[#64748B]">
							<p>조회 조건: {backtestQuery ? `${backtestQuery.strategyKey} / ${backtestQuery.symbol} / ${backtestQuery.bunbong} / ${backtestQuery.signalType}` : '조건 부족'}</p>
							<p className="mt-1">최근 갱신: {backtestLatestGeneratedAt ? formatDateTime(backtestLatestGeneratedAt) : '-'}</p>
						</div>
						{backtestLoading ? (
							<div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-8 text-center text-sm text-[#64748B]">백테스트 데이터를 불러오는 중입니다.</div>
						) : backtestRows.length === 0 ? (
							<div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-8 text-center text-sm text-[#64748B]">동일 조건의 백테스트 데이터가 없습니다.</div>
						) : (
							<div className="grid gap-3 sm:grid-cols-2">
								{backtestRows.map((row) => (
									<div key={`${row.strategyKey}-${row.symbol}-${row.signalType}-${row.tpValue}`} className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
										<p className="text-sm font-bold text-[#0F172A]">{row.strategyKey} · {row.signalType}</p>
										<p className="mt-2 text-sm text-[#64748B]">TP {formatPlainPercent(row.tpValue)} · 승률 {formatPlainPercent(row.hitRate)} · 수익률 {formatPlainPercent(row.pnlValue)}</p>
									</div>
								))}
							</div>
						)}
					</div>
				) : null}
			</div>
		</div>
	);
};

const TrackRecordModal = ({ rows, onClose }) => (
	<div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0F172A]/40 px-4 py-6">
		<div className="max-h-[92vh] w-full max-w-[980px] overflow-y-auto rounded-[18px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h2 className="text-xl font-bold text-[#0F172A]">전체 트랙레코드</h2>
					<p className="mt-1 text-sm text-[#64748B]">현재 조회된 최근 20개 기록입니다.</p>
				</div>
				<button type="button" onClick={onClose} className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm font-semibold text-[#64748B]">닫기</button>
			</div>
			<div className="mt-5 overflow-x-auto">
				<TrackRecordTable rows={rows} full />
			</div>
		</div>
	</div>
);

const TrackRecordTable = ({ rows, full = false }) => (
	<table className="w-full min-w-[760px] border-collapse">
		<thead className="bg-[#F8FAFC]">
			<tr>{['시간', 'Bot', '종목', '방향', '결과', '수익률', '수익', '상세'].map((column) => <th key={column} className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">{column}</th>)}</tr>
		</thead>
		<tbody>
			{rows.length === 0 ? (
				<tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-[#64748B]">최근 트랙레코드가 없습니다.</td></tr>
			) : (
				rows.map((row) => (
					<tr key={`${full ? 'full' : 'small'}-${row.key}`} className="border-b border-[#E2E8F0] last:border-b-0">
						<td className="px-4 py-3 text-sm text-[#64748B]">{row.time}</td>
						<td className="px-4 py-3 text-sm font-semibold text-[#0F172A]">{row.bot}</td>
						<td className="px-4 py-3 text-sm text-[#334155]">{row.symbol}</td>
						<td className="px-4 py-3 text-sm text-[#334155]">{row.direction}</td>
						<td className="px-4 py-3 text-sm text-[#334155]">{row.result}</td>
						<td className={`px-4 py-3 text-sm font-semibold ${row.profitRate.startsWith('-') ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>{row.profitRate}</td>
						<td className={`px-4 py-3 text-sm font-semibold ${row.pnlTone === 'negative' ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>{row.pnl}</td>
						<td className="px-4 py-3 text-sm font-semibold text-[#2563EB]">보기</td>
					</tr>
				))
			)}
		</tbody>
	</table>
);

const TradingPage = () => {
	const { userPrice } = useAuthStore();
	const [mode, setMode] = useState(MODE.TEST);
	const [signalRows, setSignalRows] = useState([]);
	const [gridRows, setGridRows] = useState([]);
	const [trackRows, setTrackRows] = useState([]);
	const [performanceSummary, setPerformanceSummary] = useState(null);
	const [publicPrices, setPublicPrices] = useState({});
	const [isLoading, setIsLoading] = useState(true);
	const [sort, setSort] = useState({ key: 'profitRateNumber', direction: 'desc' });
	const [kpiModalTab, setKpiModalTab] = useState(null);
	const [selectedBot, setSelectedBot] = useState(null);
	const [trackModalOpen, setTrackModalOpen] = useState(false);
	const [actionMessage, setActionMessage] = useState('');
	const [isBotSetupOpen, setIsBotSetupOpen] = useState(false);

	useEffect(() => {
		let canceled = false;
		const loadDashboard = async () => {
			setIsLoading(true);
			const isTestMode = mode === MODE.TEST;
			const [signalPayload, gridPayload, trackPayload, performancePayload] = await Promise.all([
				requestWithCallback(isTestMode ? trading.testList.bind(trading) : trading.liveList.bind(trading), isTestMode ? {} : { live: 'Y' }),
				requestWithCallback(isTestMode ? trading.gridTestList.bind(trading) : trading.gridLiveList.bind(trading), {}),
				requestWithCallback(isTestMode ? trading.getTestRuntimeTrackRecord.bind(trading) : trading.getRuntimeTrackRecord.bind(trading), {
					page: 1,
					size: 20,
					status: 'completed'
				}),
				isTestMode ? Promise.resolve(null) : requestWithCallback(trading.performanceSummary.bind(trading), {})
			]);
			if (canceled) return;
			setSignalRows(pickArray(signalPayload));
			setGridRows(pickArray(gridPayload));
			setTrackRows(buildTrackRows(trackPayload));
			setPerformanceSummary(performancePayload && typeof performancePayload === 'object' ? performancePayload : null);
			setIsLoading(false);
		};
		loadDashboard();
		return () => {
			canceled = true;
		};
	}, [mode]);

	const rawBotRows = useMemo(() => buildBotRows({ signalRows, gridRows, mode, publicPrices }), [signalRows, gridRows, mode, publicPrices]);
	const priceSymbols = useMemo(
		() =>
			[
				...new Set(
					[...signalRows.map((row) => row.symbol || row.r_symbol), ...gridRows.map((row) => row.symbol)]
						.map((symbol) => normalizeSymbol(symbol).replace('.P', ''))
						.filter((symbol) => symbol && symbol !== EMPTY_TEXT)
				)
			].slice(0, 12),
		[signalRows, gridRows]
	);

	useEffect(() => {
		if (!priceSymbols.length) return;
		let canceled = false;
		Promise.all(
			priceSymbols.map((symbol) =>
				fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`)
					.then((response) => response.ok ? response.json() : null)
					.catch(() => null)
			)
		).then((items) => {
			if (canceled) return;
			const nextPrices = {};
			items.filter(Boolean).forEach((item) => {
				const price = toNumberOrNull(item.price);
				if (item.symbol && price !== null) nextPrices[item.symbol] = price;
			});
			setPublicPrices(nextPrices);
		});
		return () => {
			canceled = true;
		};
	}, [priceSymbols]);

	const botRows = useMemo(() => {
		const multiplier = sort.direction === 'desc' ? -1 : 1;
		return [...rawBotRows].sort((a, b) => {
			if (sort.key === 'direction') {
				return (DIRECTION_ORDER[a.direction] - DIRECTION_ORDER[b.direction]) * (sort.direction === 'desc' ? -1 : 1);
			}
			if (sort.key === 'tradeAmount') {
				return (Number(a.tradeAmount.margin || 0) - Number(b.tradeAmount.margin || 0)) * multiplier;
			}
			return (Number(a[sort.key] || 0) - Number(b[sort.key] || 0)) * multiplier;
		});
	}, [rawBotRows, sort]);

	const toggleSort = (key) => setSort((prev) => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));

	const totalPositionPnl = botRows.reduce((sum, row) => sum + (toNumberOrNull(row.position?.pnl) || 0), 0);
	const openPositionCount = botRows.filter((row) => row.position).length;
	const balance = mode === MODE.TEST ? userPrice?.paperPrice : userPrice?.livePrice;
	const pnlSource = mode === MODE.LIVE ? firstValue(performanceSummary?.cards?.totalRealizedPnl, performanceSummary?.cards?.totalRealizedPnlGross) : null;
	const pnlRate = toNumberOrNull(balance) && toNumberOrNull(pnlSource) !== null ? (toNumberOrNull(pnlSource) / Math.max(Math.abs(toNumberOrNull(balance)), 1)) * 100 : null;
	const activeCount = botRows.filter((row) => row.enabled).length;

	const kpiHistoryRows = useMemo(() => {
		let cumulativePnl = 0;
		return trackRows
			.slice()
			.reverse()
			.map((row) => {
				const pnl = toNumberOrNull(String(row.pnl).replace(/[+,\sA-Z]/gi, '')) || 0;
				cumulativePnl += pnl;
				return {
					date: row.time,
					balance: null,
					dailyChange: null,
					cumulativePnl,
					dailyPnl: pnl,
					returnRate: null,
					dailyReturnRate: null,
					mode: MODE_LABEL[mode]
				};
			});
	}, [trackRows, mode]);

	const kpis = [
		{ label: '총 잔고', value: formatAmount(balance, ' USDT'), helper: `${MODE_LABEL[mode]} 기준`, tab: 'balance' },
		{ label: '누적 손익', value: formatSignedAmount(pnlSource, ' USDT'), tone: (toNumberOrNull(pnlSource) || 0) >= 0 ? 'positive' : 'negative', helper: '계산 가능한 누적 실현 손익', tab: 'pnl' },
		{ label: '누적 수익률', value: pnlRate === null ? EMPTY_TEXT : formatPercent(pnlRate), tone: pnlRate === null || pnlRate >= 0 ? 'positive' : 'negative', helper: '잔고/손익 기반 추정', tab: 'returnRate' },
		{ label: '설치 Bot 수', value: `${botRows.length}개`, helper: `ON ${activeCount}개` },
		{ label: '현재 보유 포지션 합 & 현재 손익', value: `${openPositionCount}개\n${formatSignedAmount(totalPositionPnl, ' USDT')}`, tone: totalPositionPnl >= 0 ? 'positive' : 'negative', helper: 'public ticker 기반 추정' }
	];

	return (
		<div className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#0F172A] sm:px-6 lg:px-8">
			<div className="mx-auto flex max-w-[1440px] flex-col gap-6">
				<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h1 className="text-[28px] font-bold leading-tight">대시보드</h1>
						<p className="mt-2 text-sm text-[#64748B]">기존 캐노니컬/API projection을 사용자 화면에 맞게 간결하게 표시합니다.</p>
					</div>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
						<button type="button" onClick={() => setIsBotSetupOpen(true)} className="h-10 rounded-xl bg-[#2563EB] px-4 text-sm font-bold text-white">
							+ Bot 추가
						</button>
						<div className="flex rounded-full border border-[#E2E8F0] bg-white p-1">
							{[MODE.TEST, MODE.LIVE].map((item) => (
								<button key={item} type="button" onClick={() => setMode(item)} className={`h-9 rounded-full px-4 text-sm font-semibold transition ${mode === item ? 'bg-[#2563EB] text-white' : 'text-[#64748B] hover:text-[#0F172A]'}`}>{MODE_LABEL[item]}</button>
							))}
						</div>
					</div>
				</header>

				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
					{kpis.map((card) => (
						<KpiCard key={card.label} {...card} onClick={card.tab ? () => setKpiModalTab(card.tab) : undefined} />
					))}
				</div>

				{isLoading ? <div className="rounded-2xl border border-[#E2E8F0] bg-white px-5 py-4 text-sm text-[#64748B]">대시보드 데이터를 불러오는 중입니다.</div> : null}
				{actionMessage ? <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] px-5 py-4 text-sm text-[#1D4ED8]">{actionMessage}</div> : null}

				<section className="rounded-[18px] border border-[#E2E8F0] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
					<div className="flex flex-col gap-2 border-b border-[#E2E8F0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 className="text-lg font-bold">Bot 목록</h2>
							<p className="mt-1 text-sm text-[#64748B]">Grid와 Algorithm을 하나의 표에서 방향 컬럼으로 구분합니다.</p>
						</div>
						<span className="text-sm font-medium text-[#64748B]">{botRows.length}개</span>
					</div>

					<div className="hidden overflow-x-auto md:block">
						<table className="w-full min-w-[1080px] border-collapse">
							<thead className="bg-[#F8FAFC]">
								<tr>
									{['Bot 이름', '종목'].map((column) => <th key={column} className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">{column}</th>)}
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left"><SortHeader label="방향" active={sort.key === 'direction'} direction={sort.direction} onClick={() => toggleSort('direction')} /></th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left"><SortHeader label="거래금액" active={sort.key === 'tradeAmount'} direction={sort.direction} onClick={() => toggleSort('tradeAmount')} /></th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left"><SortHeader label="승률" active={sort.key === 'winRateNumber'} direction={sort.direction} onClick={() => toggleSort('winRateNumber')} /></th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left"><SortHeader label="수익률" active={sort.key === 'profitRateNumber'} direction={sort.direction} onClick={() => toggleSort('profitRateNumber')} /></th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">실시간 손익</th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">On/Off</th>
								</tr>
							</thead>
							<tbody>
								{botRows.length === 0 ? (
									<tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[#64748B]">설치된 Bot이 없습니다.</td></tr>
								) : botRows.map((row) => (
									<tr key={row.key} onClick={() => setSelectedBot(row)} className={`h-16 cursor-pointer border-b border-[#E2E8F0] last:border-b-0 ${row.enabled ? 'border-l-4 border-l-[#2563EB] bg-white' : 'bg-[#F8FAFC] text-[#64748B] opacity-80'} hover:bg-[#EFF6FF]`}>
										<td className="px-4 py-3"><div className="flex flex-col"><span className="text-sm font-semibold text-[#0F172A]">{row.name}</span><span className="mt-1 w-fit rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">{row.strategyName}</span></div></td>
										<td className="px-4 py-3 text-sm font-medium">{row.symbol}</td>
										<td className="px-4 py-3 text-sm font-medium">{row.direction}</td>
										<td className="whitespace-pre-line px-4 py-3 text-sm font-medium">{row.tradeAmount.label}</td>
										<td className="px-4 py-3 text-sm font-medium">{formatPercent(row.winRateNumber)}</td>
										<td className="px-4 py-3 text-sm font-medium">{formatPercent(row.profitRateNumber)}</td>
										<td className="whitespace-pre-line px-4 py-3 text-sm text-[#475569]">{row.recentEvent}</td>
										<td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
											<div className="flex items-center gap-3">
												<button type="button" aria-label={`${row.name} On/Off`} onClick={() => setActionMessage('ON/OFF는 이번 화면에서 실제 mutation을 호출하지 않았습니다. 안전 API 연결이 필요합니다.')}><ToggleSwitch active={row.enabled} /></button>
												{!row.enabled ? <button type="button" onClick={() => setActionMessage('삭제는 이번 화면에서 실제 mutation을 호출하지 않았습니다. 안전 API 연결이 필요합니다.')} className="rounded-md px-1 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2]">삭제</button> : null}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="space-y-3 p-4 md:hidden">
						{botRows.map((row) => (
							<div key={`${row.key}-mobile`} onClick={() => setSelectedBot(row)} className={`rounded-2xl border p-4 ${row.enabled ? 'border-[#BFDBFE] bg-white' : 'border-[#E2E8F0] bg-[#F8FAFC] opacity-80'}`}>
								<div className="flex items-start justify-between gap-3">
									<div><p className="text-base font-bold">{row.name}</p><p className="mt-1 text-sm text-[#64748B]">{row.symbol} · {row.direction}</p></div>
									<ToggleSwitch active={row.enabled} />
								</div>
								<div className="mt-4 grid grid-cols-2 gap-3 text-sm">
									<div><p className="text-[#94A3B8]">거래금액</p><p className="whitespace-pre-line font-semibold">{row.tradeAmount.label}</p></div>
									<div><p className="text-[#94A3B8]">승률 / 수익률</p><p className="font-semibold">{formatPercent(row.winRateNumber)} / {formatPercent(row.profitRateNumber)}</p></div>
									<div className="col-span-2"><p className="text-[#94A3B8]">실시간 손익</p><p className="whitespace-pre-line font-semibold">{row.recentEvent}</p></div>
								</div>
							</div>
						))}
					</div>
				</section>

				<section className="rounded-[18px] border border-[#E2E8F0] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
					<div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
						<div><h2 className="text-lg font-bold">최근 트랙레코드</h2><p className="mt-1 text-sm text-[#64748B]">최근 20개 기록을 표시합니다.</p></div>
						<button type="button" onClick={() => setTrackModalOpen(true)} className="text-sm font-semibold text-[#2563EB]">전체보기</button>
					</div>
					<div className="overflow-x-auto"><TrackRecordTable rows={trackRows} /></div>
				</section>
			</div>

			{kpiModalTab ? <KpiModal activeTab={kpiModalTab} onClose={() => setKpiModalTab(null)} rows={kpiHistoryRows} /> : null}
			<BotDetailModal bot={selectedBot} trackRows={trackRows} onClose={() => setSelectedBot(null)} />
			{trackModalOpen ? <TrackRecordModal rows={trackRows} onClose={() => setTrackModalOpen(false)} /> : null}
			<BotSetupModal isOpen={isBotSetupOpen} onClose={() => setIsBotSetupOpen(false)} source="dashboard" />
		</div>
	);
};

export default TradingPage;
