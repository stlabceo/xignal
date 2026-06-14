import React, { useEffect, useMemo, useState } from 'react';
import { trading } from '../../services/trading';
import { filterTakeProfitRows, normalizeQbtStats, qbtStatsFixture } from '../../data/takeProfitSearchData';
import {
	buildCatalogItems,
	formatCatalogStrategyLabel,
	formatCatalogSymbolLabel,
	formatCatalogTimeframeLabel,
	toSignalPayloadBunbong
} from './tradingCatalogOptions';

const DEFAULTS = {
	algorithm: {
		category: 'algorithm',
		strategySignal: 'ATF+VIXFIX',
		displayName: 'ATF+VIXFIX',
		symbol: 'BTCUSDT',
		bunbong: '1MIN',
		direction: 'BUY'
	},
	grid: {
		category: 'grid',
		strategySignal: 'SQZ+GRID',
		displayName: 'SQZ+GRID',
		symbol: 'BTCUSDT',
		bunbong: '1MIN',
		direction: 'BOTH'
	}
};

const strategyTypeById = {
	ATF_VIXFIX: 'algorithm',
	'ATF+VIXFIX': 'algorithm',
	NY_QUIET_CLOSE_ASIA_BOX: 'grid',
	'SQZ+GRID': 'grid'
};

const directionLabels = {
	BUY: '매수',
	SELL: '매도',
	BOTH: '양방향'
};

const toNumber = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
};

const formatNumber = (value, digits = 2) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return numeric.toLocaleString('ko-KR', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
};

const normalizeSymbol = (value) =>
	String(value || '')
		.trim()
		.toUpperCase()
		.replace(/\.P$/i, '');

const normalizeStrategyCategory = (value) => (String(value || '').toLowerCase() === 'grid' ? 'grid' : 'algorithm');

const resolveCategoryFromPrefill = (prefill = {}) =>
	normalizeStrategyCategory(
		prefill.strategyCategory ||
			prefill.category ||
			strategyTypeById[prefill.strategyId] ||
			strategyTypeById[prefill.strategySignal] ||
			(prefill.direction === 'BOTH' ? 'grid' : 'algorithm')
	);

const buildFallbackCatalog = (category) => buildCatalogItems([], category === 'grid' ? 'grid' : 'signal');

const buildStrategyOptions = (catalogItems, category) => {
	const rows = catalogItems.length ? catalogItems : buildFallbackCatalog(category);
	return rows.map((item) => ({
		value: item.strategyCode || item.signalName,
		label: formatCatalogStrategyLabel(item),
		item
	}));
};

const getStrategyItem = (strategyOptions, value) => strategyOptions.find((option) => option.value === value)?.item || strategyOptions[0]?.item || null;

const buildInitialForm = (prefill = {}) => {
	const category = resolveCategoryFromPrefill(prefill);
	const fallback = DEFAULTS[category];
	const symbol = normalizeSymbol(prefill.symbol || fallback.symbol);
	const tpPct = prefill.tpPct ?? prefill.profit ?? '';

	return {
		category,
		botName: prefill.botName || prefill.strategyName || fallback.displayName,
		strategySignal: prefill.strategySignal || prefill.strategyCode || prefill.strategyName || fallback.strategySignal,
		symbol,
		bunbong: prefill.timeframeRaw || prefill.bunbong || fallback.bunbong,
		direction: category === 'grid' ? 'BOTH' : prefill.direction || fallback.direction,
		marginType: 'cross',
		margin: prefill.margin || '',
		leverage: prefill.leverage || '1',
		profit: tpPct === '' ? '' : String(tpPct),
		splitTakeProfitEnabled: false,
		splitTakeProfitCount: '2',
		splitTakeProfitGap: '0.3',
		stopLoss: '',
		stopLossReverseEnabled: false,
		stopLossTimeEnabled: false,
		stopLossTimeValue: ''
	};
};

const makeAlgorithmPayloadPreview = (form) => ({
	a_name: form.botName,
	symbol: normalizeSymbol(form.symbol),
	bunbong: toSignalPayloadBunbong(form.bunbong),
	second2: '',
	second3: '',
	second4: '',
	marginType: form.marginType,
	AI_ST: 'N',
	profit: form.splitTakeProfitEnabled ? '' : form.profit,
	stopLoss: form.stopLoss,
	leverage: form.leverage,
	margin: form.margin,
	signalType: form.direction,
	alarmSignalST: 'Y',
	alarmResultST: 'Y',
	orderSize: 1,
	type: form.strategySignal,
	repeatConfig: 'N',
	splitTakeProfitEnabled: form.splitTakeProfitEnabled ? 'Y' : 'N',
	splitTakeProfitCount: form.splitTakeProfitEnabled ? form.splitTakeProfitCount : 0,
	splitTakeProfitGap: form.splitTakeProfitEnabled ? form.splitTakeProfitGap : '',
	stopLossReverseEnabled: form.stopLossReverseEnabled ? 'Y' : 'N',
	stopLossTimeEnabled: form.stopLossTimeEnabled ? 'Y' : 'N',
	stopLossTimeValue: form.stopLossTimeEnabled ? form.stopLossTimeValue : ''
});

const makeGridPayloadPreview = (form) => ({
	a_name: form.botName,
	strategySignal: form.strategySignal,
	symbol: normalizeSymbol(form.symbol),
	bunbong: form.bunbong,
	marginType: form.marginType,
	margin: form.margin,
	leverage: form.leverage,
	profit: form.profit,
	tradeValue: toNumber(form.margin) * toNumber(form.leverage)
});

const FormField = ({ label, children, helper }) => (
	<label className="block">
		<span className="text-[13px] font-semibold text-[#475569]">{label}</span>
		{children}
		{helper ? <span className="mt-1 block text-xs text-[#94A3B8]">{helper}</span> : null}
	</label>
);

const inputClass = 'mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]';
const readOnlyClass = `${inputClass} bg-[#F8FAFC]`;

const BotSetupModal = ({ isOpen, onClose, prefill = null, source = 'dashboard' }) => {
	const [catalogByCategory, setCatalogByCategory] = useState({ algorithm: [], grid: [] });
	const [form, setForm] = useState(() => buildInitialForm(prefill || {}));
	const [message, setMessage] = useState('');

	useEffect(() => {
		if (!isOpen) return;
		setForm(buildInitialForm(prefill || {}));
		setMessage('');
	}, [isOpen, prefill]);

	useEffect(() => {
		if (!isOpen) return;
		let canceled = false;
		const loadCatalog = (category, apiCategory) => {
			trading.strategyCatalogOptions({ category: apiCategory }, (res) => {
				if (canceled) return;
				const items = buildCatalogItems(Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [], apiCategory);
				setCatalogByCategory((prev) => ({ ...prev, [category]: items }));
			});
		};

		loadCatalog('algorithm', 'signal');
		loadCatalog('grid', 'grid');
		return () => {
			canceled = true;
		};
	}, [isOpen]);

	const strategyOptions = useMemo(() => buildStrategyOptions(catalogByCategory[form.category] || [], form.category), [catalogByCategory, form.category]);
	const strategyItem = useMemo(() => getStrategyItem(strategyOptions, form.strategySignal), [strategyOptions, form.strategySignal]);
	const symbolOptions = strategyItem?.allowedSymbols?.length ? strategyItem.allowedSymbols : buildFallbackCatalog(form.category)[0]?.allowedSymbols || [];
	const timeframeOptions = strategyItem?.allowedTimeframes?.length ? strategyItem.allowedTimeframes : buildFallbackCatalog(form.category)[0]?.allowedTimeframes || [];

	const isGrid = form.category === 'grid';
	const orderAmount = toNumber(form.margin) * toNumber(form.leverage);
	const backtestRows = useMemo(() => {
		const strategyId = isGrid ? 'NY_QUIET_CLOSE_ASIA_BOX' : 'ATF_VIXFIX';
		return filterTakeProfitRows(normalizeQbtStats(qbtStatsFixture), {
			symbol: form.symbol,
			strategyId,
			period: 'all',
			minWinrate: '',
			minReturn: ''
		})
			.filter((row) => (isGrid ? row.direction === 'BOTH' : row.direction === form.direction))
			.filter((row) => !form.profit || Number(row.tpPct) === Number(form.profit))
			.slice(0, 3);
	}, [form.direction, form.profit, form.symbol, isGrid]);

	if (!isOpen) return null;

	const updateForm = (key, value) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	const switchCategory = (category) => {
		const fallback = DEFAULTS[category];
		setForm((prev) => ({
			...prev,
			category,
			botName: prev.botName || fallback.displayName,
			strategySignal: fallback.strategySignal,
			direction: category === 'grid' ? 'BOTH' : prev.direction === 'BOTH' ? 'BUY' : prev.direction,
			symbol: prev.symbol || fallback.symbol,
			bunbong: prev.bunbong || fallback.bunbong,
			stopLoss: category === 'grid' ? '' : prev.stopLoss,
			stopLossReverseEnabled: category === 'grid' ? false : prev.stopLossReverseEnabled,
			stopLossTimeEnabled: category === 'grid' ? false : prev.stopLossTimeEnabled,
			splitTakeProfitEnabled: category === 'grid' ? false : prev.splitTakeProfitEnabled
		}));
	};

	const handleInstallClick = () => {
		const payloadPreview = isGrid ? makeGridPayloadPreview(form) : makeAlgorithmPayloadPreview(form);
		setMessage(
			`이번 작업은 UI 재구성 범위라 실제 설치 API mutation은 호출하지 않았습니다. 기존 ${isGrid ? 'grid' : 'algorithm'} add payload 구조로 변환 가능: ${JSON.stringify(payloadPreview)}`
		);
	};

	return (
		<div className="fixed inset-0 z-[120] flex items-end justify-center bg-[#0F172A]/40 px-0 py-0 sm:items-center sm:px-4 sm:py-6">
			<div className="max-h-[94vh] w-full max-w-[720px] overflow-y-auto rounded-t-[20px] bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.22)] sm:rounded-[20px] sm:p-6">
				<header className="flex items-start justify-between gap-4">
					<div>
						<p className="text-sm font-semibold text-[#2563EB]">{source === 'tp-search' ? '익절 조건 검색 결과 기반' : '대시보드 Bot 설정'}</p>
						<h2 className="mt-1 text-2xl font-bold text-[#0F172A]">Bot 추가</h2>
						<p className="mt-2 text-sm text-[#64748B]">전략과 거래 조건을 현재 주문 설정 구조에 맞춰 확인합니다.</p>
					</div>
					<button type="button" onClick={onClose} className="h-9 rounded-lg border border-[#E2E8F0] px-3 text-sm font-semibold text-[#64748B]">
						닫기
					</button>
				</header>

				<section className="mt-5 rounded-[18px] border border-[#E2E8F0] p-4">
					<div className="mb-4 flex rounded-full bg-[#F1F5F9] p-1">
						{[
							['algorithm', 'Algorithm'],
							['grid', 'Grid']
						].map(([value, label]) => (
							<button
								key={value}
								type="button"
								onClick={() => switchCategory(value)}
								className={`h-9 flex-1 rounded-full text-sm font-bold ${form.category === value ? 'bg-[#2563EB] text-white' : 'text-[#64748B]'}`}
							>
								{label}
							</button>
						))}
					</div>
					<h3 className="text-base font-bold text-[#0F172A]">기본 정보</h3>
					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						<FormField label="Bot 이름">
							<input className={inputClass} value={form.botName} onChange={(event) => updateForm('botName', event.target.value)} placeholder="예: BTC ATF 15m" />
						</FormField>
						<FormField label="전략">
							<select
								className={inputClass}
								value={form.strategySignal}
								onChange={(event) => updateForm('strategySignal', event.target.value)}
							>
								{strategyOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</FormField>
						<FormField label="종목">
							<select className={inputClass} value={form.symbol} onChange={(event) => updateForm('symbol', event.target.value)}>
								{symbolOptions.map((symbol) => (
									<option key={symbol} value={symbol}>
										{formatCatalogSymbolLabel(symbol)}
									</option>
								))}
							</select>
						</FormField>
						<FormField label="캔들">
							<select className={inputClass} value={form.bunbong} onChange={(event) => updateForm('bunbong', event.target.value)}>
								{timeframeOptions.map((timeframe) => (
									<option key={timeframe} value={timeframe}>
										{formatCatalogTimeframeLabel(timeframe)}
									</option>
								))}
							</select>
						</FormField>
						<FormField label="방향" helper={isGrid ? 'Grid 전략은 양방향으로 고정됩니다.' : 'Algorithm 전략에서만 매수/매도를 선택합니다.'}>
							<select className={isGrid ? readOnlyClass : inputClass} value={form.direction} disabled={isGrid} onChange={(event) => updateForm('direction', event.target.value)}>
								{isGrid ? (
									<option value="BOTH">{directionLabels.BOTH}</option>
								) : (
									<>
										<option value="BUY">{directionLabels.BUY}</option>
										<option value="SELL">{directionLabels.SELL}</option>
									</>
								)}
							</select>
						</FormField>
						<FormField label="전략 유형">
							<input className={readOnlyClass} value={isGrid ? 'Grid' : 'Algorithm'} readOnly />
						</FormField>
					</div>
				</section>

				<section className="mt-4 rounded-[18px] border border-[#E2E8F0] p-4">
					<h3 className="text-base font-bold text-[#0F172A]">거래 설정</h3>
					<div className="mt-4 grid gap-4 sm:grid-cols-3">
						<FormField label="마진">
							<input className={inputClass} value={form.margin} onChange={(event) => updateForm('margin', event.target.value)} placeholder="예: 6" inputMode="decimal" />
						</FormField>
						<FormField label="레버리지">
							<input className={inputClass} value={form.leverage} onChange={(event) => updateForm('leverage', event.target.value)} placeholder="예: 1" inputMode="numeric" />
						</FormField>
						<FormField label="거래금액" helper="read-only 계산값입니다.">
							<input className={readOnlyClass} value={`${formatNumber(orderAmount)} USDT`} readOnly />
						</FormField>
					</div>
				</section>

				<section className="mt-4 rounded-[18px] border border-[#E2E8F0] p-4">
					<h3 className="text-base font-bold text-[#0F172A]">익절 / 손절 설정</h3>
					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						<FormField label="익절 설정">
							<input className={inputClass} value={form.profit} onChange={(event) => updateForm('profit', event.target.value)} placeholder="예: 0.5" inputMode="decimal" />
						</FormField>

						{isGrid ? (
							<div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-4 text-sm text-[#1D4ED8] sm:col-span-2">
								Grid 전략은 별도 손절값을 입력하지 않습니다. 종료 웹훅을 수신하거나 관리자가 지정한 레짐 종료 조건에 도달하면 Grid Exit 경로로 처리합니다.
							</div>
						) : (
							<>
								<FormField label="손절 설정">
									<input className={inputClass} value={form.stopLoss} onChange={(event) => updateForm('stopLoss', event.target.value)} placeholder="예: 0.6" inputMode="decimal" />
								</FormField>
								<div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 sm:col-span-2">
									<label className="flex items-center gap-2 text-sm font-semibold text-[#334155]">
										<input type="checkbox" checked={form.splitTakeProfitEnabled} onChange={(event) => updateForm('splitTakeProfitEnabled', event.target.checked)} />
										분할 익절 설정
									</label>
									{form.splitTakeProfitEnabled ? (
										<div className="mt-3 grid gap-3 sm:grid-cols-2">
											<input className={inputClass} value={form.splitTakeProfitCount} onChange={(event) => updateForm('splitTakeProfitCount', event.target.value)} placeholder="분할 단계 수" />
											<input className={inputClass} value={form.splitTakeProfitGap} onChange={(event) => updateForm('splitTakeProfitGap', event.target.value)} placeholder="단계 간격 %" />
										</div>
									) : null}
									<div className="mt-4 grid gap-3 sm:grid-cols-2">
										<label className="flex items-center gap-2 text-sm font-semibold text-[#334155]">
											<input type="checkbox" checked={form.stopLossTimeEnabled} onChange={(event) => updateForm('stopLossTimeEnabled', event.target.checked)} />
											시간 경과 손절
										</label>
										<input className={inputClass} value={form.stopLossTimeValue} disabled={!form.stopLossTimeEnabled} onChange={(event) => updateForm('stopLossTimeValue', event.target.value)} placeholder="분 단위" />
									</div>
								</div>
							</>
						)}
					</div>
				</section>

				<section className="mt-4 rounded-[18px] border border-[#E2E8F0] p-4">
					<h3 className="text-base font-bold text-[#0F172A]">백테스트 참고</h3>
					<p className="mt-1 text-sm text-[#64748B]">QBT_STATS_V1 public backtest dataset 기준 참고값입니다. 거래 실행 상태와 섞지 않습니다.</p>
					<div className="mt-4 grid gap-3 sm:grid-cols-3">
						{backtestRows.length ? (
							backtestRows.map((row) => (
								<div key={`${row.strategyId}-${row.symbol}-${row.direction}-${row.period}-${row.tpPct}`} className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
									<p className="text-sm font-bold text-[#0F172A]">{row.period} · TP {formatNumber(row.tpPct)}%</p>
									<p className="mt-2 text-sm text-[#64748B]">승률 {formatNumber(row.winratePct)}%</p>
									<p className="mt-1 text-sm font-bold text-[#16A34A]">수익률 {formatNumber(row.netPnlPct)}%</p>
								</div>
							))
						) : (
							<div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-5 text-sm text-[#64748B] sm:col-span-3">
								동일 조건의 백테스트 데이터가 없습니다.
							</div>
						)}
					</div>
				</section>

				<footer className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button type="button" onClick={onClose} className="h-11 rounded-xl border border-[#CBD5E1] px-5 text-sm font-bold text-[#475569]">
						취소
					</button>
					<button type="button" onClick={handleInstallClick} className="h-11 rounded-xl bg-[#2563EB] px-5 text-sm font-bold text-white">
						Bot 설치
					</button>
				</footer>
				{message ? <p className="mt-4 rounded-xl bg-[#EFF6FF] px-4 py-3 text-sm text-[#1D4ED8]">{message}</p> : null}
			</div>
		</div>
	);
};

export default BotSetupModal;
