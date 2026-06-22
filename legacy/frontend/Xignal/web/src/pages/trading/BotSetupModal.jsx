import React, { useEffect, useMemo, useRef, useState } from 'react';
import { trading } from '../../services/trading';
import { publicBacktest } from '../../services/publicBacktest';
import {
	buildCatalogItems,
	formatCatalogStrategyLabel,
	formatCatalogSymbolLabel,
	formatCatalogTimeframeLabel,
	toSignalPayloadBunbong
} from './tradingCatalogOptions';
import { normalizePerpNativeSymbol } from './perpInstrument';
import { BOT_CREATE_DISABLED_MESSAGE, getExplicitLiveStrategyCode, getRuntimeStrategyCode } from './liveStrategyContract';

const DEFAULTS = {
	algorithm: {
		category: 'algorithm',
		displayName: 'Algorithm Bot',
		symbol: 'BTCUSDT',
		bunbong: '1MIN',
		direction: 'BUY'
	},
	grid: {
		category: 'grid',
		displayName: 'Grid Bot',
		symbol: 'BTCUSDT',
		bunbong: '1MIN',
		direction: 'BOTH'
	}
};

const sourceLabels = {
	dashboard: '대시보드 Bot 설정',
	'tp-search': '익절 조건 검색 결과 기반',
	'strategy-search': '전략 검색 결과 기반'
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

const formatCompactNumber = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return numeric.toLocaleString('ko-KR', {
		minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
		maximumFractionDigits: 2
	});
};

const normalizeSymbol = normalizePerpNativeSymbol;

const normalizeStrategyCategory = (value) => (String(value || '').toLowerCase() === 'grid' ? 'grid' : 'algorithm');

const resolveCategoryFromPrefill = (prefill = {}) =>
	normalizeStrategyCategory(
		prefill.strategyCategory ||
			prefill.category ||
			(prefill.direction === 'BOTH' ? 'grid' : 'algorithm')
	);

const buildStrategyOptions = (catalogItems, category) => {
	return catalogItems.map((item) => ({
		value: getExplicitLiveStrategyCode(item) || item.strategyCode || item.signalName,
		label: formatCatalogStrategyLabel(item),
		item,
		category
	}));
};

const getStrategyOption = (strategyOptions, category, value) =>
	strategyOptions.find((option) => option.category === category && option.value === value) || null;

const uniqueOptions = (...groups) =>
	groups
		.flat()
		.map((value) => String(value || '').trim())
		.filter(Boolean)
		.filter((value, index, values) => values.indexOf(value) === index);

const encodeStrategyOption = (option) => `${option.category}:${option.value}`;

const buildInitialForm = (prefill = {}) => {
	const category = resolveCategoryFromPrefill(prefill);
	const fallback = DEFAULTS[category];
	const symbol = normalizeSymbol(prefill.symbol || fallback.symbol);
	const tpPct = prefill.tpPct ?? prefill.profit ?? '';
	const strategySource = getExplicitLiveStrategyCode(prefill);
	const reverseStopEnabled = prefill.stopLossReverseEnabled === 'Y' || prefill.stopLossReverseEnabled === true;
	const timeStopEnabled = prefill.stopLossTimeEnabled === 'Y' || prefill.stopLossTimeEnabled === true || Boolean(prefill.stopLossTimeValue);
	const stopLossMode = prefill.stopLoss ? 'percent' : reverseStopEnabled ? 'reverse' : timeStopEnabled ? 'time' : '';

	return {
		category,
		botName: prefill.botName || prefill.strategyName || fallback.displayName,
		strategySignal: strategySource,
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
		stopLoss: prefill.stopLoss || '',
		stopLossMode,
		stopLossReverseEnabled: reverseStopEnabled,
		stopLossTimeEnabled: timeStopEnabled,
		stopLossTimeValue: prefill.stopLossTimeValue || ''
	};
};

const resolveRuntimeStrategyCode = (form, strategyItem) =>
	getRuntimeStrategyCode(strategyItem || {}) || form.strategySignal;

const makeAlgorithmPayload = (form, strategyItem) => {
	const runtimeStrategyCode = resolveRuntimeStrategyCode(form, strategyItem);
	const payload = {
		a_name: form.botName,
		symbol: normalizeSymbol(form.symbol),
		bunbong: toSignalPayloadBunbong(form.bunbong),
		second2: '',
		second3: '',
		second4: '',
		marginType: form.marginType,
		AI_ST: 'N',
		profit: form.splitTakeProfitEnabled ? '' : form.profit,
		leverage: form.leverage,
		margin: form.margin,
		signalType: form.direction,
		alarmSignalST: 'Y',
		alarmResultST: 'Y',
		orderSize: 1,
		type: runtimeStrategyCode,
		liveStrategyCode: form.strategySignal,
		runtimeStrategyCode,
		repeatConfig: 'N',
		splitTakeProfitEnabled: form.splitTakeProfitEnabled ? 'Y' : 'N',
		splitTakeProfitCount: form.splitTakeProfitEnabled ? form.splitTakeProfitCount : 0,
		splitTakeProfitGap: form.splitTakeProfitEnabled ? form.splitTakeProfitGap : ''
	};
	if (form.stopLossMode === 'percent') {
		payload.stopLoss = form.stopLoss;
	}
	if (form.stopLossMode === 'reverse') {
		payload.stopLossReverseEnabled = 'Y';
	}
	if (form.stopLossMode === 'time') {
		payload.stopLossTimeEnabled = 'Y';
		payload.stopLossTimeValue = form.stopLossTimeValue;
	}
	return payload;
};

const makeGridPayload = (form, strategyItem) => {
	const runtimeStrategyCode = resolveRuntimeStrategyCode(form, strategyItem);
	return {
		a_name: form.botName,
		strategySignal: runtimeStrategyCode,
		liveStrategyCode: form.strategySignal,
		runtimeStrategyCode,
		symbol: normalizeSymbol(form.symbol),
		bunbong: form.bunbong,
		marginType: form.marginType,
		margin: form.margin,
		leverage: form.leverage,
		profit: form.profit,
		tradeValue: toNumber(form.margin) * toNumber(form.leverage)
	};
};

const isSuccessfulCreateResponse = (response) => {
	const data = response?.data ?? response;
	return data?.ok !== false && Number(getCreatedPid(data)) > 0;
};

const getCreatedPid = (response) => {
	const data = response?.data ?? response;
	const pid = Number(data?.pid || data?.id || 0);
	return pid > 0 ? pid : null;
};

const getCreateErrorMessage = (response) => {
	if (!response) return 'Bot 생성 요청에 실패했습니다.';
	if (typeof response === 'string') return response;
	if (response?.errors?.[0]?.msg) return response.errors[0].msg;
	if (response?.msg) return response.msg;
	if (response?.message) return response.message;
	if (response?.error) return response.error;
	return 'Bot 생성 요청에 실패했습니다.';
};

const callCreateApi = (isGrid, payload) =>
	new Promise((resolve, reject) => {
		const submit = isGrid ? trading.gridLiveDetailUpload : trading.liveDetailUpload;
		submit(payload, {}, (response) => {
			if (isSuccessfulCreateResponse(response)) {
				resolve(response);
				return;
			}
			reject(response);
		});
	});

const validateFormForCreate = (form, isGrid) => {
	if (!String(form.botName || '').trim()) return 'Bot 이름을 입력해 주세요.';
	if (!String(form.strategySignal || '').trim()) return '전략을 선택해 주세요.';
	if (!normalizeSymbol(form.symbol)) return '종목을 선택해 주세요.';
	if (!String(form.bunbong || '').trim()) return '캔들을 선택해 주세요.';
	if (toNumber(form.margin) <= 0) return '마진을 입력해 주세요.';
	if (toNumber(form.leverage) < 1) return '레버리지를 입력해 주세요.';
	if (toNumber(form.profit) <= 0) return '익절 설정을 입력해 주세요.';
	if (isGrid) return '';
	if (!['BUY', 'SELL'].includes(form.direction)) return '알고리즘 Bot 방향을 선택해 주세요.';
	if (!['percent', 'reverse', 'time'].includes(form.stopLossMode)) {
		return '알고리즘 Bot은 손절 유형을 하나 선택해야 합니다.';
	}
	if (form.stopLossMode === 'percent' && (toNumber(form.stopLoss) < 0.1 || toNumber(form.stopLoss) > 50)) {
		return '% 손절은 0.1% 이상 50% 이하로 입력해 주세요.';
	}
	if (form.stopLossMode === 'time' && (!Number.isInteger(toNumber(form.stopLossTimeValue)) || toNumber(form.stopLossTimeValue) <= 0)) {
		return '시간 경과 손절은 1분 이상의 정수로 입력해 주세요.';
	}
	return '';
};

const FormField = ({ label, children, helper }) => (
	<label className="block">
		<span className="text-[13px] font-semibold text-[#475569]">{label}</span>
		{children}
		{helper ? <span className="mt-1 block text-xs text-[#94A3B8]">{helper}</span> : null}
	</label>
);

const inputClass = 'mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]';
const readOnlyClass = `${inputClass} bg-[#F8FAFC]`;

const BotSetupModal = ({ isOpen, onClose, prefill = null, source = 'dashboard', onCreated = null }) => {
	const [catalogByCategory, setCatalogByCategory] = useState({ algorithm: [], grid: [] });
	const [form, setForm] = useState(() => buildInitialForm(prefill || {}));
	const [message, setMessage] = useState('');
	const [messageType, setMessageType] = useState('info');
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [createCompleted, setCreateCompleted] = useState(false);
	const [backtestRows, setBacktestRows] = useState([]);
	const [backtestLoading, setBacktestLoading] = useState(false);
	const [backtestDataStatus, setBacktestDataStatus] = useState('READY');
	const submitInFlightRef = useRef(false);
	const isOpenRef = useRef(false);

	useEffect(() => {
		isOpenRef.current = isOpen;
		if (!isOpen) return;
		setForm(buildInitialForm(prefill || {}));
		setMessage('');
		setMessageType('info');
		setIsSubmitting(false);
		setCreateCompleted(false);
		submitInFlightRef.current = false;
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

	const strategyOptions = useMemo(
		() => {
			const options = [
				...buildStrategyOptions(catalogByCategory.algorithm || [], 'algorithm'),
				...buildStrategyOptions(catalogByCategory.grid || [], 'grid')
			];
			if (!prefill) return options;
			const category = resolveCategoryFromPrefill(prefill);
			const value = getExplicitLiveStrategyCode(prefill);
			if (!value || options.some((option) => option.category === category && option.value === value)) return options;
			return [
				{
					value,
					label: prefill.strategyName || value,
					category,
					item: {
						strategyCode: value,
						liveStrategyCode: value,
						runtimeStrategyCode: getRuntimeStrategyCode(prefill || {}) || value,
						signalName: value,
						displayName: prefill.strategyName || value,
						allowedSymbols: prefill.symbol ? [normalizeSymbol(prefill.symbol)] : [],
						allowedTimeframes: prefill.timeframeRaw ? [prefill.timeframeRaw] : []
					}
				},
				...options
			];
		},
		[catalogByCategory, prefill]
	);
	const selectedStrategyOption = useMemo(() => getStrategyOption(strategyOptions, form.category, form.strategySignal), [form.category, form.strategySignal, strategyOptions]);
	const strategyItem = selectedStrategyOption?.item || null;
	const strategySelectValue = selectedStrategyOption ? encodeStrategyOption(selectedStrategyOption) : '';
	const fallback = DEFAULTS[form.category] || DEFAULTS.algorithm;
	const baseSymbolOptions = strategyItem?.allowedSymbols?.length ? strategyItem.allowedSymbols : [fallback.symbol];
	const baseTimeframeOptions = strategyItem?.allowedTimeframes?.length ? strategyItem.allowedTimeframes : [fallback.bunbong];
	const symbolOptions = uniqueOptions(form.symbol, baseSymbolOptions);
	const timeframeOptions = uniqueOptions(form.bunbong, baseTimeframeOptions);

	const isGrid = form.category === 'grid';
	const orderAmount = toNumber(form.margin) * toNumber(form.leverage);
	const orderAmountLabel = `${formatCompactNumber(form.margin)}$ X ${formatCompactNumber(form.leverage)} = ${formatNumber(orderAmount)} USDT`;
	const isPrefilledSource = source === 'tp-search' || source === 'strategy-search' || prefill?.source === 'tp-search' || prefill?.source === 'strategy-search';
	const fieldLocks = {
		strategy: isPrefilledSource && Boolean(getExplicitLiveStrategyCode(prefill || {})),
		symbol: isPrefilledSource && Boolean(prefill?.symbol),
		bunbong: isPrefilledSource && Boolean(prefill?.timeframeRaw || prefill?.bunbong),
		direction: isGrid || (isPrefilledSource && Boolean(prefill?.direction)),
		profit: isPrefilledSource && Boolean(prefill?.tpPct ?? prefill?.profit)
	};
	const canCreateFromSelectedStrategy = Boolean(form.strategySignal && selectedStrategyOption);
	const statusMessageClass = messageType === 'error'
		? 'mt-4 rounded-xl bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]'
		: messageType === 'success'
			? 'mt-4 rounded-xl bg-[#F0FDF4] px-4 py-3 text-sm text-[#15803D]'
			: 'mt-4 rounded-xl bg-[#EFF6FF] px-4 py-3 text-sm text-[#1D4ED8]';

	useEffect(() => {
		if (!isOpen) return;
		let canceled = false;
		const strategyId = strategyItem?.backtestStrategyId || prefill?.backtestStrategyId || prefill?.publicBacktestStrategyId || '';
		if (!strategyId) {
			setBacktestRows([]);
			setBacktestDataStatus('NO_REAL_DATA');
			setBacktestLoading(false);
			return undefined;
		}
		const direction = isGrid ? 'BOTH' : form.direction;
		const request = form.profit
			? publicBacktest.detail({
					strategyId,
					symbol: form.symbol,
					timeframe: form.bunbong,
					direction,
					tpPct: form.profit
				})
			: publicBacktest.options({
					strategyId,
					symbol: form.symbol,
					timeframe: form.bunbong,
					direction,
					period: 'all',
					limit: 10
				});

		setBacktestLoading(true);
		request.then((res) => {
			if (canceled) return;
			const rows = (res.items || [])
				.filter((row) => (isGrid ? row.direction === 'BOTH' : row.direction === direction))
				.filter((row) => !form.profit || Number(row.tpPct) === Number(form.profit))
				.slice(0, 3);
			setBacktestRows(rows);
			setBacktestDataStatus(res.dataStatus || 'READY');
			setBacktestLoading(false);
		});
		return () => {
			canceled = true;
		};
	}, [form.bunbong, form.direction, form.profit, form.symbol, isGrid, isOpen, prefill, strategyItem]);

	if (!isOpen) return null;

	const updateForm = (key, value) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	const updateStopLossMode = (value) => {
		setForm((prev) => ({
			...prev,
			stopLossMode: value,
			stopLoss: value === 'percent' ? prev.stopLoss : '',
			stopLossReverseEnabled: value === 'reverse',
			stopLossTimeEnabled: value === 'time',
			stopLossTimeValue: value === 'time' ? prev.stopLossTimeValue : ''
		}));
	};

	const handleStrategyChange = (value) => {
		if (!value) {
			setForm((prev) => ({ ...prev, strategySignal: '' }));
			return;
		}
		const [category, ...strategyParts] = value.split(':');
		const strategySignal = strategyParts.join(':');
		const fallback = DEFAULTS[category] || DEFAULTS.algorithm;
		const option = strategyOptions.find((item) => item.category === category && item.value === strategySignal);
		const allowedSymbols = option?.item?.allowedSymbols || [];
		const allowedTimeframes = option?.item?.allowedTimeframes || [];
		setForm((prev) => ({
			...prev,
			category,
			strategySignal,
			direction: category === 'grid' ? 'BOTH' : prev.direction === 'BOTH' ? 'BUY' : prev.direction,
			symbol: allowedSymbols.includes(prev.symbol) ? prev.symbol : allowedSymbols[0] || prev.symbol || fallback.symbol,
			bunbong: allowedTimeframes.includes(prev.bunbong) ? prev.bunbong : allowedTimeframes[0] || prev.bunbong || fallback.bunbong,
			stopLoss: category === 'grid' ? '' : prev.stopLoss,
			stopLossMode: category === 'grid' ? '' : prev.stopLossMode,
			stopLossReverseEnabled: category === 'grid' ? false : prev.stopLossMode === 'reverse',
			stopLossTimeEnabled: category === 'grid' ? false : prev.stopLossMode === 'time',
			splitTakeProfitEnabled: category === 'grid' ? false : prev.splitTakeProfitEnabled
		}));
	};

	const handleInstallClick = async () => {
		if (submitInFlightRef.current || isSubmitting || createCompleted) return;
		if (!canCreateFromSelectedStrategy) {
			setMessageType('error');
			setMessage(BOT_CREATE_DISABLED_MESSAGE);
			return;
		}
		const validationMessage = validateFormForCreate(form, isGrid);
		if (validationMessage) {
			setMessageType('error');
			setMessage(validationMessage);
			return;
		}

		const payload = isGrid ? makeGridPayload(form, strategyItem) : makeAlgorithmPayload(form, strategyItem);
		submitInFlightRef.current = true;
		setIsSubmitting(true);
		setMessageType('info');
		setMessage('Bot 생성 요청을 전송하고 있습니다.');
		try {
			const response = await callCreateApi(isGrid, payload);
			const createdInfo = typeof onCreated === 'function'
				? await onCreated({ category: isGrid ? 'grid' : 'algorithm', payload, response })
				: null;
			if (!isOpenRef.current) return;
			const createdPid = getCreatedPid(response) || getCreatedPid(createdInfo);
			const pidPrefix = isGrid ? 'Grid' : 'Algorithm';
			setMessageType('success');
			setCreateCompleted(true);
			setMessage(`Bot이 추가되었습니다.${createdPid ? ` ${pidPrefix} PID #${createdPid}` : ''} 현재 중지 상태입니다.`);
		} catch (error) {
			if (!isOpenRef.current) return;
			setMessageType('error');
			setMessage(getCreateErrorMessage(error));
		} finally {
			submitInFlightRef.current = false;
			if (isOpenRef.current) setIsSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-[120] flex items-end justify-center bg-[#0F172A]/40 px-0 py-0 sm:items-center sm:px-4 sm:py-6">
			<div className="max-h-[94vh] w-full max-w-[720px] overflow-y-auto rounded-t-[20px] bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.22)] sm:rounded-[20px] sm:p-6">
				<header className="flex items-start justify-between gap-4">
					<div>
						<p className="text-sm font-semibold text-[#2563EB]">{sourceLabels[source] || sourceLabels.dashboard}</p>
						<h2 className="mt-1 text-2xl font-bold text-[#0F172A]">Bot 추가</h2>
						<p className="mt-2 text-sm text-[#64748B]">전략과 거래 조건을 현재 Bot 생성 API 구조에 맞춰 확인합니다.</p>
					</div>
					<button type="button" onClick={onClose} className="h-9 rounded-lg border border-[#E2E8F0] px-3 text-sm font-semibold text-[#64748B]">
						닫기
					</button>
				</header>

				<section className="mt-5 rounded-[18px] border border-[#E2E8F0] p-4">
					<h3 className="text-base font-bold text-[#0F172A]">기본 정보</h3>
					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						<FormField label="Bot 이름">
							<input className={inputClass} value={form.botName} onChange={(event) => updateForm('botName', event.target.value)} placeholder="예: BTC ATF 15m" />
						</FormField>
						<FormField label="전략">
							<select
								className={fieldLocks.strategy ? readOnlyClass : inputClass}
								value={strategySelectValue}
								disabled={fieldLocks.strategy || !strategyOptions.length}
								onChange={(event) => handleStrategyChange(event.target.value)}
							>
								<option value="">{strategyOptions.length ? '전략을 선택해 주세요' : BOT_CREATE_DISABLED_MESSAGE}</option>
								{strategyOptions.map((option) => (
									<option key={`${option.category}-${option.value}`} value={encodeStrategyOption(option)}>
										{option.label}
									</option>
								))}
							</select>
						</FormField>
						<FormField label="종목">
							<select className={fieldLocks.symbol ? readOnlyClass : inputClass} value={form.symbol} disabled={fieldLocks.symbol} onChange={(event) => updateForm('symbol', event.target.value)}>
								{symbolOptions.map((symbol) => (
									<option key={symbol} value={symbol}>
										{formatCatalogSymbolLabel(symbol)}
									</option>
								))}
							</select>
						</FormField>
						<FormField label="캔들">
							<select className={fieldLocks.bunbong ? readOnlyClass : inputClass} value={form.bunbong} disabled={fieldLocks.bunbong} onChange={(event) => updateForm('bunbong', event.target.value)}>
								{timeframeOptions.map((timeframe) => (
									<option key={timeframe} value={timeframe}>
										{formatCatalogTimeframeLabel(timeframe)}
									</option>
								))}
							</select>
						</FormField>
						<FormField label="방향" helper={isGrid ? 'Grid 전략은 양방향으로 고정됩니다.' : 'Algorithm 전략에서만 매수/매도를 선택합니다.'}>
							<select className={fieldLocks.direction ? readOnlyClass : inputClass} value={form.direction} disabled={fieldLocks.direction} onChange={(event) => updateForm('direction', event.target.value)}>
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
							<input className={readOnlyClass} value={orderAmountLabel} readOnly />
						</FormField>
					</div>
				</section>

				<section className="mt-4 rounded-[18px] border border-[#E2E8F0] p-4">
					<h3 className="text-base font-bold text-[#0F172A]">익절 / 손절 설정</h3>
					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						<FormField label="익절 설정">
							<input className={fieldLocks.profit ? readOnlyClass : inputClass} value={form.profit} disabled={fieldLocks.profit} onChange={(event) => updateForm('profit', event.target.value)} placeholder="예: 0.5" inputMode="decimal" />
						</FormField>

						{isGrid ? (
							<div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-4 text-sm text-[#1D4ED8] sm:col-span-2">
								Grid 전략은 별도 손절값을 입력하지 않습니다. 종료 웹훅을 수신하거나 관리자가 지정한 레짐 종료 조건에 도달하면 Grid Exit 경로로 처리합니다.
							</div>
						) : (
							<>
								<FormField label="손절 유형">
									<select className={inputClass} value={form.stopLossMode} onChange={(event) => updateStopLossMode(event.target.value)}>
										<option value="">선택</option>
										<option value="percent">% 손절</option>
										<option value="reverse">반대 신호 손절</option>
										<option value="time">시간 경과 손절</option>
									</select>
								</FormField>
								{form.stopLossMode === 'percent' ? (
									<FormField label="% 손절 값">
										<input className={inputClass} value={form.stopLoss} onChange={(event) => updateForm('stopLoss', event.target.value)} placeholder="예: 0.6" inputMode="decimal" />
									</FormField>
								) : null}
								{form.stopLossMode === 'time' ? (
									<FormField label="시간 경과 손절">
										<input className={inputClass} value={form.stopLossTimeValue} onChange={(event) => updateForm('stopLossTimeValue', event.target.value)} placeholder="분 단위" inputMode="numeric" />
									</FormField>
								) : null}
								{form.stopLossMode === 'reverse' ? (
									<div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-sm text-[#475569]">
										반대 신호가 수신되면 손절 조건으로 사용합니다.
									</div>
								) : null}
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
								</div>
							</>
						)}
					</div>
				</section>

				<section className="mt-4 rounded-[18px] border border-[#E2E8F0] p-4">
					<h3 className="text-base font-bold text-[#0F172A]">백테스트 참고</h3>
					<p className="mt-1 text-sm text-[#64748B]">QBT_STATS_V1 public backtest dataset 기준 참고값입니다. 거래 실행 상태와 섞지 않습니다.</p>
					<div className="mt-4 grid gap-3 sm:grid-cols-3">
						{backtestLoading ? (
							<div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-5 text-sm text-[#64748B] sm:col-span-3">
								백테스트 데이터를 불러오는 중입니다.
							</div>
						) : backtestRows.length ? (
							backtestRows.map((row) => (
								<div key={`${row.strategyId}-${row.symbol}-${row.direction}-${row.period}-${row.tpPct}`} className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
									<p className="text-sm font-bold text-[#0F172A]">{row.period} · TP {formatNumber(row.tpPct)}%</p>
									<p className="mt-2 text-sm text-[#64748B]">승률 {formatNumber(row.winratePct)}%</p>
									<p className="mt-1 text-sm font-bold text-[#16A34A]">수익률 {formatNumber(row.netPnlPct)}%</p>
								</div>
							))
						) : (
							<div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-5 text-sm text-[#64748B] sm:col-span-3">
								{backtestDataStatus === 'NO_REAL_DATA' ? '아직 수신된 백테스트 데이터가 없습니다.' : '동일 조건의 백테스트 데이터가 없습니다.'}
							</div>
						)}
					</div>
				</section>

				<section className="mt-4 rounded-[18px] border border-[#E2E8F0] p-4">
					<h3 className="text-base font-bold text-[#0F172A]">추가 확인</h3>
					<p className="mt-2 text-sm text-[#64748B]">
						Bot 생성 API로 설정을 저장합니다. 생성 직후 Bot은 기본 OFF 상태이며, 자동 시작, 자동 enable, 자동 ARM, 주문 실행은 수행하지 않습니다.
					</p>
				</section>

				<footer className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button type="button" onClick={onClose} className="h-11 rounded-xl border border-[#CBD5E1] px-5 text-sm font-bold text-[#475569]">
						취소
					</button>
					<button type="button" onClick={handleInstallClick} disabled={isSubmitting || createCompleted || !canCreateFromSelectedStrategy} className="h-11 rounded-xl bg-[#2563EB] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#94A3B8]">
						{isSubmitting ? '생성 중' : createCompleted ? '추가 완료' : 'Bot 추가'}
					</button>
				</footer>
				{message ? <p className={statusMessageClass}>{message}</p> : null}
			</div>
		</div>
	);
};

export default BotSetupModal;
