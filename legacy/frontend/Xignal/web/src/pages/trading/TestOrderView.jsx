import React, { useCallback, useEffect, useMemo, useState } from 'react';
import CheckboxBig from '../../components/form/input/CheckboxBig';
import DefaultDropdown from '../../components/ui/dropdown/DefaultDropdown';
import { trading } from '../../services/trading';
import { useMessageModal } from '../../hooks/useMessageModal';
import {
	buildCatalogItems,
	normalizeSignalFormBunbong,
	toCatalogStrategyOptions,
	toCatalogSymbolOptions,
	toCatalogTimeframeOptions,
	toSignalPayloadBunbong
} from './tradingCatalogOptions';

const FIXED_SIGNAL_STRATEGY_KEY = 'ATF+VIXFIX';

const signalTypeEnum = {
	BUY: '매수',
	SELL: '매도'
};

const marginTypeEnum = {
	cross: '교차'
};

const FIXED_SIGNAL_AI_ST = 'neutral';
const STRATEGY_CONFIG = {
	'ATF+VIXFIX': { second2: null, second3: null, second4: null },
	SQZGBRK: { second2: null, second3: null, second4: null }
};

const signalTypeOptions = Object.values(signalTypeEnum);
const marginTypeOptions = Object.values(marginTypeEnum);
const MAX_SPLIT_TAKE_PROFIT_STAGES = 5;
const DEFAULT_SPLIT_TAKE_PROFIT_GAP = 0.2;
const MIN_MARGIN_USDT = 5;
const splitCountOptions = Array.from({ length: MAX_SPLIT_TAKE_PROFIT_STAGES }, (_, index) => String(index + 1));
const symbolRuleCache = new Map();

const getLabelByKey = (enumMap, key, fallback) => enumMap[key] || fallback;
const toBoolean = (value) => value === true || value === 'Y' || value === 1 || value === '1';
const createSplitStageList = (count = 1, existing = []) =>
	Array.from({ length: Math.max(1, count) }, (_, index) => ({
		tpPercent: existing[index]?.tpPercent ?? '',
		closeRatio: existing[index]?.closeRatio ?? ''
	}));
const parseSplitTakeProfitConfig = (res = {}) => {
	const enabled = toBoolean(res.splitTakeProfitEnabled);
	if (!enabled) {
		return {
			splitTakeProfitEnabled: false,
			splitTakeProfitCount: '1',
			splitTakeProfitGap: DEFAULT_SPLIT_TAKE_PROFIT_GAP,
			splitTakeProfitStages: createSplitStageList(1)
		};
	}

	let parsed = {};
	try {
		parsed = JSON.parse(res.splitTakeProfitConfigJson || '{}');
	} catch (error) {
		parsed = {};
	}

	const stages = Array.isArray(parsed.stages)
		? parsed.stages.map((stage) => ({
			tpPercent: stage?.tpPercent != null ? String(stage.tpPercent) : '',
			closeRatio: stage?.closeRatio != null ? String(stage.closeRatio) : ''
		}))
		: [];
	const count = Math.min(
		MAX_SPLIT_TAKE_PROFIT_STAGES,
		Math.max(1, Number(res.splitTakeProfitCount || stages.length || 1))
	);

	return {
		splitTakeProfitEnabled: true,
		splitTakeProfitCount: String(count),
		splitTakeProfitGap: Number(parsed.gapPercent || res.splitTakeProfitGap || DEFAULT_SPLIT_TAKE_PROFIT_GAP),
		splitTakeProfitStages: createSplitStageList(count, stages)
	};
};

const createInitialForm = () => ({
	a_name: '',
	symbol: 'BTCUSDT',
	bunbong: '1MIN',
	signalType: '매수',
	margin: '',
	leverage: '',
	type: FIXED_SIGNAL_STRATEGY_KEY,
	enter: '',
	profit: '',
	splitTakeProfitEnabled: false,
	splitTakeProfitCount: '1',
	splitTakeProfitGap: DEFAULT_SPLIT_TAKE_PROFIT_GAP,
	splitTakeProfitStages: createSplitStageList(1),
	stopLoss: '',
	stopLossTimeEnabled: false,
	stopLossTimeValue: '',
	stopLossReverseEnabled: false,
	limitST: 'N',
	marginType: '교차',
	live_ST: 'N',
	second1: null,
	second2: null,
	second3: null,
	second4: null,
	profitTradeType: 'per',
	profitFixValue: null,
	profitAbsValue: null,
	lossTradeType: 'per',
	lossFixValue: null,
	lossAbsValue: null,
	absValue: '0',
	cancel: 0,
	m_profit: 0,
	t_profit: 0,
	t_ST: 'N',
	t_autoST: 'N',
	t_direct: 'N',
	alarmSignalST: 'Y',
	alarmResultST: 'Y',
	orderSize: 1,
	st: 'START',
	status: 'READY',
	autoST: 'N',
	detailTap: 'B',
	selectST: 'Y',
	r_tid: null,
	r_oid: null,
	r_m_st: 'N',
	r_t_st: 'N',
	r_t_tick: 0,
	r_t_cnt: 0,
	r_tempPrice: null,
	r_signalType: null,
	r_signalPrice: null,
	r_signalTime: null,
	r_exactPrice: null,
	r_exactTime: null,
	r_profitPrice: 0,
	r_profitTime: null,
	r_stopPrice: 0,
	r_stopTime: null,
	r_endPrice: 0,
	r_endTime: null,
	r_exact_cnt: 0,
	r_profit_cnt: 0,
	r_profit_tick: 0,
	r_stop_cnt: 0,
	r_stop_tick: 0,
	r_forcing_cnt: 0,
	r_forcing_tick: 0,
	r_real_tick: null,
	r_pol_tick: 0,
	r_charge: 0,
	r_t_charge: 0,
	r_pol_sum: 0,
	r_minQty: 0,
	r_qty: 0,
	r_margin: 0
});

const normalizeSymbolRulesResponse = (response) => ({
	minMarginUsdt: Number(response?.minMarginUsdt || MIN_MARGIN_USDT),
	symbol: String(response?.rules?.symbol || '').trim().toUpperCase() || null,
	minTradeValue: Number(response?.rules?.minTradeValue || 0),
	updatedAt: response?.rules?.updatedAt || null
});

const formatUsdtValue = (value) =>
	Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 8 });

const rowLabelClass = 'mb-2 flex items-center gap-1.5 text-[13px] text-[#999]';
const cardClass = 'rounded-xl border border-[#2D2D2D] bg-[#141414] p-4';
const inputClass = 'w-full rounded-md border border-[#494949] bg-[#0F0F0F] px-3 py-2.5 pr-8 text-right text-white focus:outline-none disabled:bg-[#212121]';
const dropdownWrapClass = 'w-full rounded-md border border-[#494949] bg-[#0F0F0F] px-3 py-2.5';
const summaryCardClass = 'rounded-md border border-[#2D2D2D] bg-[#101010] px-4 py-3';

const TestOrderView = ({ id, getListData, presetData }) => {
	const showMessage = useMessageModal();
	const [formData, setFormData] = useState(createInitialForm);
	const [mode, setMode] = useState('add');
	const [isSymbolDropDownOn, setSymbolDropDownOn] = useState(false);
	const [isBunbongDropDownOn, setBunbongDropDownOn] = useState(false);
	const [isSignalTypeDropDownOn, setSignalTypeDropDownOn] = useState(false);
	const [isTypeDropDownOn, setTypeDropDownOn] = useState(false);
	const [isMarginTypeDropDownOn, setMarginTypeDropDownOn] = useState(false);
	const [backtestStats, setBacktestStats] = useState([]);
	const [backtestLatestGeneratedAt, setBacktestLatestGeneratedAt] = useState(null);
	const [backtestLoading, setBacktestLoading] = useState(false);
	const [symbolRules, setSymbolRules] = useState(null);
	const [symbolRulesLoading, setSymbolRulesLoading] = useState(false);
	const [catalogItems, setCatalogItems] = useState(() => buildCatalogItems([], 'signal'));

	useEffect(() => {
		let isMounted = true;
		trading.strategyCatalogOptions({ category: 'signal' }, (res) => {
			if (!isMounted) {
				return;
			}

			setCatalogItems(buildCatalogItems(res?.items || [], 'signal'));
		});

		return () => {
			isMounted = false;
		};
	}, []);

	const strategyOptions = useMemo(() => toCatalogStrategyOptions(catalogItems), [catalogItems]);
	const selectedStrategyItem = useMemo(
		() =>
			catalogItems.find((item) => item.strategyCode === formData.type || item.signalName === formData.type) ||
			catalogItems[0] ||
			null,
		[catalogItems, formData.type]
	);
	const symbolOptions = useMemo(
		() => toCatalogSymbolOptions(selectedStrategyItem?.allowedSymbols || []),
		[selectedStrategyItem]
	);
	const bunbongOptions = useMemo(
		() => toCatalogTimeframeOptions(selectedStrategyItem?.allowedTimeframes || []),
		[selectedStrategyItem]
	);

	useEffect(() => {
		if (!catalogItems.length) {
			return;
		}

		setFormData((prev) => {
			const matchedStrategyItem = catalogItems.find(
				(item) => item.strategyCode === prev.type || item.signalName === prev.type
			);
			const nextType = matchedStrategyItem
				? matchedStrategyItem.strategyCode || matchedStrategyItem.signalName
				: catalogItems[0].strategyCode || catalogItems[0].signalName;
			const nextStrategyItem =
				catalogItems.find((item) => item.strategyCode === nextType || item.signalName === nextType) || catalogItems[0];
			const nextSymbol = nextStrategyItem?.allowedSymbols?.includes(prev.symbol)
				? prev.symbol
				: nextStrategyItem?.allowedSymbols?.[0] || prev.symbol;
			const nextBunbong = nextStrategyItem?.allowedTimeframes?.includes(prev.bunbong)
				? prev.bunbong
				: nextStrategyItem?.allowedTimeframes?.[0] || prev.bunbong;

			if (nextType === prev.type && nextSymbol === prev.symbol && nextBunbong === prev.bunbong) {
				return prev;
			}

			return {
				...prev,
				type: nextType,
				symbol: nextSymbol,
				bunbong: nextBunbong
			};
		});
	}, [catalogItems]);

	useEffect(() => {
		if (id) {
			setMode('edit');
			trading.testDetail({ id }, (res) => {
				setFormData({
					...createInitialForm(),
					...res,
					symbol: res.symbol || 'BTCUSDT',
					bunbong: normalizeSignalFormBunbong(res.bunbong || '1'),
					signalType: getLabelByKey(signalTypeEnum, res.signalType, '매수'),
					margin: res.margin ?? '',
					leverage: res.leverage ?? '',
					type: String(res.type || FIXED_SIGNAL_STRATEGY_KEY).trim() || FIXED_SIGNAL_STRATEGY_KEY,
					enter: '',
					profit: res.profit ?? '',
					...parseSplitTakeProfitConfig(res),
					stopLoss: res.stopLoss ?? '',
					stopLossTimeEnabled: toBoolean(res.stopLossTimeEnabled),
					stopLossTimeValue: res.stopLossTimeValue ?? '',
					stopLossReverseEnabled: toBoolean(res.stopLossReverseEnabled),
					limitST: 'N',
					marginType: getLabelByKey(marginTypeEnum, res.marginType, '교차')
				});
			});
			return;
		}

		if (presetData) {
			setMode('add');
			setFormData((prev) => ({
				...prev,
				...presetData,
				enter: '',
				type: presetData.type || prev.type,
				symbol: presetData.symbol || prev.symbol,
				bunbong: normalizeSignalFormBunbong(presetData.bunbong || prev.bunbong),
				limitST: 'N',
				splitTakeProfitEnabled: false,
				splitTakeProfitCount: '1',
				splitTakeProfitGap: DEFAULT_SPLIT_TAKE_PROFIT_GAP,
				splitTakeProfitStages: createSplitStageList(1),
				marginType: presetData.marginType || '교차'
			}));
			return;
		}

		setMode('add');
		setFormData(createInitialForm());
	}, [id, presetData]);

	const backtestQuery = useMemo(() => ({
		strategyKey: String(formData.type || FIXED_SIGNAL_STRATEGY_KEY).trim() || FIXED_SIGNAL_STRATEGY_KEY,
		symbol: formData.symbol,
		bunbong: formData.bunbong,
		signalType: Object.entries(signalTypeEnum).find(([, value]) => value === formData.signalType)?.[0] || 'BUY'
	}), [formData.bunbong, formData.signalType, formData.symbol, formData.type]);

	useEffect(() => {
		if (!backtestQuery.strategyKey || !backtestQuery.symbol || !backtestQuery.bunbong || !backtestQuery.signalType) {
			setBacktestStats([]);
			setBacktestLatestGeneratedAt(null);
			setBacktestLoading(false);
			return;
		}

		let isMounted = true;
		setBacktestLoading(true);
		trading.getBacktestStats(backtestQuery, (res) => {
			if (!isMounted) {
				return;
			}

			setBacktestStats(Array.isArray(res?.items) ? res.items : []);
			setBacktestLatestGeneratedAt(res?.latestGeneratedAt || null);
			setBacktestLoading(false);
		});

		return () => {
			isMounted = false;
		};
	}, [backtestQuery]);

	useEffect(() => {
		const symbol = String(formData.symbol || '').trim().toUpperCase();
		if (!symbol) {
			setSymbolRules(null);
			setSymbolRulesLoading(false);
			return;
		}

		const cachedRules = symbolRuleCache.get(symbol) || null;
		if (cachedRules) {
			setSymbolRules(cachedRules);
		}

		let isMounted = true;
		setSymbolRulesLoading(true);
		trading.symbolRules({ symbol }, (res) => {
			if (!isMounted) {
				return;
			}

			if (res?.ok) {
				const normalizedRules = normalizeSymbolRulesResponse(res);
				symbolRuleCache.set(symbol, normalizedRules);
				setSymbolRules(normalizedRules);
			} else if (!cachedRules) {
				setSymbolRules(null);
			}

			setSymbolRulesLoading(false);
		});

		return () => {
			isMounted = false;
		};
	}, [formData.symbol]);

	const toPayload = useCallback(() => {
		const nextType = String(formData.type || FIXED_SIGNAL_STRATEGY_KEY).trim() || FIXED_SIGNAL_STRATEGY_KEY;
		const strategyConfig = STRATEGY_CONFIG[nextType] || STRATEGY_CONFIG[FIXED_SIGNAL_STRATEGY_KEY];
		const splitStageCount = Math.min(
			MAX_SPLIT_TAKE_PROFIT_STAGES,
			Math.max(1, Number(formData.splitTakeProfitCount || 1))
		);
		const splitTakeProfitStages = createSplitStageList(splitStageCount, formData.splitTakeProfitStages).map((stage) => ({
			tpPercent: stage.tpPercent,
			closeRatio: stage.closeRatio
		}));

		return {
			a_name: formData.a_name,
			symbol: formData.symbol,
			bunbong: toSignalPayloadBunbong(formData.bunbong),
			type: nextType,
			signalType: Object.entries(signalTypeEnum).find(([, value]) => value === formData.signalType)?.[0] || 'BUY',
			marginType: Object.entries(marginTypeEnum).find(([, value]) => value === formData.marginType)?.[0] || 'cross',
			AI_ST: FIXED_SIGNAL_AI_ST,
			margin: formData.margin,
			leverage: formData.leverage,
			profit: formData.splitTakeProfitEnabled ? (splitTakeProfitStages[0]?.tpPercent ?? '') : (formData.profit ?? ''),
			splitTakeProfitEnabled: Boolean(formData.splitTakeProfitEnabled),
			splitTakeProfitCount: splitStageCount,
			splitTakeProfitGap: formData.splitTakeProfitGap ?? DEFAULT_SPLIT_TAKE_PROFIT_GAP,
			splitTakeProfitStages,
			stopLoss: formData.stopLoss ?? '',
			stopLossReverseEnabled: Boolean(formData.stopLossReverseEnabled),
			stopLossTimeEnabled: Boolean(formData.stopLossTimeEnabled),
			stopLossTimeValue: formData.stopLossTimeEnabled ? formData.stopLossTimeValue : '',
			alarmSignalST: 'Y',
			alarmResultST: 'Y',
			orderSize: 1,
			repeatConfig: formData.repeatConfig || 'N',
			second2: strategyConfig.second2,
			second3: strategyConfig.second3,
			second4: strategyConfig.second4
		};
	}, [formData]);

	const validateExitSettings = useCallback(() => {
		if (formData.splitTakeProfitEnabled) {
			if (String(formData.stopLoss || '').trim() === '') {
				showMessage({
					message: '분할 익절을 사용할 때는 퍼센트 손절을 함께 설정해야 합니다.',
					confirmText: '확인'
				});
				return false;
			}

			const stageCount = Math.min(
				MAX_SPLIT_TAKE_PROFIT_STAGES,
				Math.max(1, Number(formData.splitTakeProfitCount || 1))
			);
			const stageList = createSplitStageList(stageCount, formData.splitTakeProfitStages);
			let previousTp = 0;
			let ratioTotal = 0;

			for (let index = 0; index < stageList.length; index += 1) {
				const tpPercent = Number(stageList[index].tpPercent || 0);
				const closeRatio = Number(stageList[index].closeRatio || 0);
				if (!(tpPercent > 0) || !(closeRatio > 0)) {
					showMessage({
						message: '분할 익절 각 단계에 익절 퍼센트와 청산 비율을 모두 입력해 주세요.',
						confirmText: '확인'
					});
					return false;
				}

				if (!(tpPercent > previousTp)) {
					showMessage({
						message: '분할 익절 단계의 익절 퍼센트는 오름차순이어야 합니다.',
						confirmText: '확인'
					});
					return false;
				}

				previousTp = tpPercent;
				ratioTotal += closeRatio;
			}

			if (Math.abs(ratioTotal - 100) > 0.001) {
				showMessage({
					message: '분할 익절 비율의 총합은 100%여야 합니다.',
					confirmText: '확인'
				});
				return false;
			}

			return true;
		}

		const hasStopLossPercent = String(formData.stopLoss || '').trim() !== '';
		if (hasStopLossPercent || formData.stopLossReverseEnabled || formData.stopLossTimeEnabled) {
			return true;
		}

		showMessage({
			message: '손절 옵션은 손절(%), 반대 신호, 시간 경과 중 하나 이상 선택해야 합니다.',
			confirmText: '확인'
		});
		return false;
	}, [formData.splitTakeProfitEnabled, formData.splitTakeProfitCount, formData.splitTakeProfitStages, formData.stopLoss, formData.stopLossReverseEnabled, formData.stopLossTimeEnabled, showMessage]);

	const handleSplitStageCountChange = useCallback((nextCountValue) => {
		const nextCount = Math.min(
			MAX_SPLIT_TAKE_PROFIT_STAGES,
			Math.max(1, Number(nextCountValue || 1))
		);
		setFormData((prev) => ({
			...prev,
			splitTakeProfitCount: String(nextCount),
			splitTakeProfitStages: createSplitStageList(nextCount, prev.splitTakeProfitStages)
		}));
	}, []);

	const updateSplitStage = useCallback((index, field, value) => {
		setFormData((prev) => {
			const nextStages = createSplitStageList(
				Math.min(MAX_SPLIT_TAKE_PROFIT_STAGES, Math.max(1, Number(prev.splitTakeProfitCount || 1))),
				prev.splitTakeProfitStages
			);
			nextStages[index] = {
				...nextStages[index],
				[field]: value
			};
			return {
				...prev,
				splitTakeProfitStages: nextStages
			};
		});
	}, []);

	const showResult = useCallback(
		(result, successMessage) => {
			const errorMessage = result?.msg || (result?.success === false ? result?.message : '');
			showMessage({
				message: errorMessage || successMessage,
				confirmText: '확인',
				onConfirm: () => {
					if (!errorMessage) {
						getListData();
					}
				}
			});
		},
		[getListData, showMessage]
	);

	const numericOrderAmount = useMemo(() => {
		const margin = Number(formData.margin || 0);
		const leverage = Number(formData.leverage || 0);
		if (Number.isNaN(margin) || Number.isNaN(leverage)) {
			return 0;
		}
		return margin * leverage;
	}, [formData.leverage, formData.margin]);

	const minimumTradeValue = Number(symbolRules?.minTradeValue || 0);
	const minimumMarginUsdt = Number(symbolRules?.minMarginUsdt || MIN_MARGIN_USDT);

	const orderConstraintWarning = useMemo(() => {
		const margin = Number(formData.margin || 0);
		if (margin > 0 && margin < minimumMarginUsdt) {
			return `마진은 최소 ${formatUsdtValue(minimumMarginUsdt)} USDT 이상이어야 합니다.`;
		}

		if (minimumTradeValue > 0 && numericOrderAmount > 0 && numericOrderAmount + 0.0000001 < minimumTradeValue) {
			return `${formData.symbol} 최소 거래금액은 ${formatUsdtValue(minimumTradeValue)} USDT 이상입니다.`;
		}

		return null;
	}, [formData.margin, formData.symbol, minimumMarginUsdt, minimumTradeValue, numericOrderAmount]);

	const validateOrderConstraints = useCallback(() => {
		const margin = Number(formData.margin || 0);
		const leverage = Number(formData.leverage || 0);

		if (!(margin >= minimumMarginUsdt)) {
			showMessage({
				message: `마진은 최소 ${formatUsdtValue(minimumMarginUsdt)} USDT 이상이어야 합니다.`,
				confirmText: '확인'
			});
			return false;
		}

		if (!(leverage >= 1 && leverage <= 100)) {
			showMessage({
				message: '레버리지는 1배 이상 100배 이하로 입력해 주세요.',
				confirmText: '확인'
			});
			return false;
		}

		if (minimumTradeValue > 0 && numericOrderAmount + 0.0000001 < minimumTradeValue) {
			showMessage({
				message: `${formData.symbol} 최소 거래금액은 ${formatUsdtValue(minimumTradeValue)} USDT 이상입니다.`,
				confirmText: '확인'
			});
			return false;
		}

		return true;
	}, [formData.leverage, formData.margin, formData.symbol, minimumMarginUsdt, minimumTradeValue, numericOrderAmount, showMessage]);

	const handleSave = useCallback(() => {
		if (selectedStrategyItem?.canCreatePid === false) {
			showMessage({
				message: selectedStrategyItem.createBlockerMessage || '이 전략은 현재 PID 생성이 차단되어 있습니다.',
				confirmText: '확인'
			});
			return;
		}
		if (!validateOrderConstraints()) return;
		if (!validateExitSettings()) return;
		trading.testDetailUpload(toPayload(), null, (res) => {
			showResult(res, '전략을 추가했습니다.');
		});
	}, [selectedStrategyItem, showMessage, showResult, toPayload, validateExitSettings, validateOrderConstraints]);

	const handleEdit = useCallback(() => {
		if (selectedStrategyItem?.canCreatePid === false) {
			showMessage({
				message: selectedStrategyItem.createBlockerMessage || '이 전략은 현재 PID 수정/생성이 차단되어 있습니다.',
				confirmText: '확인'
			});
			return;
		}
		if (!validateOrderConstraints()) return;
		if (!validateExitSettings()) return;
		trading.testDetailEdit(
			{
				...toPayload(),
				id
			},
			null,
			(res) => {
				showResult(res, '전략을 수정했습니다.');
			}
		);
	}, [id, selectedStrategyItem, showMessage, showResult, toPayload, validateExitSettings, validateOrderConstraints]);

	const orderAmount = useMemo(() => {
		return numericOrderAmount.toLocaleString('ko-KR');
	}, [numericOrderAmount]);

	const backtestUpdatedText = useMemo(() => {
		if (!backtestLatestGeneratedAt) {
			return '-';
		}

		const parsed = new Date(backtestLatestGeneratedAt);
		if (Number.isNaN(parsed.getTime())) {
			return '-';
		}

		return parsed.toLocaleString('ko-KR');
	}, [backtestLatestGeneratedAt]);

	const backtestSummary = useMemo(() => {
		if (!backtestStats.length) {
			return null;
		}

		const toNumber = (value) => Number(value || 0);
		const bestPnl = backtestStats.reduce((bestItem, currentItem) => (
			toNumber(currentItem.pnlValue) > toNumber(bestItem.pnlValue) ? currentItem : bestItem
		), backtestStats[0]);
		const bestHitRate = backtestStats.reduce((bestItem, currentItem) => (
			toNumber(currentItem.hitRate) > toNumber(bestItem.hitRate) ? currentItem : bestItem
		), backtestStats[0]);
		const maxTrades = backtestStats.reduce((maxValue, currentItem) => (
			Math.max(maxValue, toNumber(currentItem.tradeCount))
		), 0);

		return {
			bestPnl,
			bestHitRate,
			tpCount: backtestStats.length,
			maxTrades
		};
	}, [backtestStats]);

	return (
		<div className="h-full w-full bg-[#1B1B1B] p-4 text-white md:p-5">
			<div className="space-y-3 md:space-y-4">
				<div className={cardClass}>
					<h3 className="mb-4 text-[15px] font-semibold text-white">전략 설정</h3>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />전략 이름</div>
							<input type="text" value={formData.a_name} onChange={(event) => setFormData({ ...formData, a_name: event.target.value })} className="w-full rounded-md border border-[#494949] bg-[#0F0F0F] p-2.5 text-white focus:outline-none" />
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />종목</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown cur={formData.symbol} onChange={(value) => setFormData({ ...formData, symbol: value })} setIsOpen={setSymbolDropDownOn} isOpen={isSymbolDropDownOn} option={symbolOptions} className="w-full" />
							</div>
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />전략</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown cur={formData.type} onChange={(value) => setFormData({ ...formData, type: value })} isOpen={isTypeDropDownOn} setIsOpen={setTypeDropDownOn} option={strategyOptions} className="w-full" />
							</div>
							{selectedStrategyItem?.canCreatePid === false && (
								<p className="mt-2 text-[12px] text-[#F5B24A]">
									{selectedStrategyItem.createBlockerMessage}
								</p>
							)}
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />타임프레임</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown cur={formData.bunbong} onChange={(value) => setFormData({ ...formData, bunbong: value })} isOpen={isBunbongDropDownOn} setIsOpen={setBunbongDropDownOn} option={bunbongOptions} className="w-full" />
							</div>
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />방향</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown cur={formData.signalType} onChange={(value) => setFormData({ ...formData, signalType: value })} isOpen={isSignalTypeDropDownOn} setIsOpen={setSignalTypeDropDownOn} option={signalTypeOptions} className="w-full" />
							</div>
						</div>
					</div>
				</div>

				<div className={cardClass}>
					<div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
						<div>
							<h3 className="text-[15px] font-semibold text-white">백테스트 통계</h3>
							<p className="mt-1 text-[12px] text-[#9E9E9E]">선택한 전략, 종목, 타임프레임, 방향 기준 TP별 PNL과 승률입니다.</p>
						</div>
						<p className="text-[12px] text-[#9E9E9E]">최근 갱신: {backtestUpdatedText}</p>
					</div>
					{backtestLoading ? (
						<div className="rounded-md border border-[#2D2D2D] bg-[#101010] px-4 py-6 text-center text-[13px] text-[#BDBDBD]">
							백테스트 통계를 불러오는 중입니다.
						</div>
					) : backtestStats.length === 0 ? (
						<div className="rounded-md border border-[#2D2D2D] bg-[#101010] px-4 py-6 text-center text-[13px] text-[#9E9E9E]">
							표시할 백테스트 통계가 없습니다.
						</div>
					) : (
						<div className="space-y-3">
							{backtestSummary ? (
								<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
									<div className={summaryCardClass}>
										<p className="text-[11px] uppercase tracking-[0.08em] text-[#8E8E8E]">Best PNL</p>
										<p className={`mt-1 text-[15px] font-semibold ${Number(backtestSummary.bestPnl?.pnlValue || 0) > 0 ? 'text-[#FF6B6B]' : Number(backtestSummary.bestPnl?.pnlValue || 0) < 0 ? 'text-[#5DA8FF]' : 'text-white'}`}>
											{Number(backtestSummary.bestPnl?.pnlValue || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}
										</p>
										<p className="mt-1 text-[11px] text-[#8E8E8E]">TP {Number(backtestSummary.bestPnl?.tpValue || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}%</p>
									</div>
									<div className={summaryCardClass}>
										<p className="text-[11px] uppercase tracking-[0.08em] text-[#8E8E8E]">Best Hit Rate</p>
										<p className="mt-1 text-[15px] font-semibold text-white">
											{Number(backtestSummary.bestHitRate?.hitRate || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%
										</p>
										<p className="mt-1 text-[11px] text-[#8E8E8E]">TP {Number(backtestSummary.bestHitRate?.tpValue || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}%</p>
									</div>
									<div className={summaryCardClass}>
										<p className="text-[11px] uppercase tracking-[0.08em] text-[#8E8E8E]">TP Count</p>
										<p className="mt-1 text-[15px] font-semibold text-white">
											{Number(backtestSummary.tpCount || 0).toLocaleString('ko-KR')}
										</p>
									</div>
									<div className={summaryCardClass}>
										<p className="text-[11px] uppercase tracking-[0.08em] text-[#8E8E8E]">Max Trades</p>
										<p className="mt-1 text-[15px] font-semibold text-white">
											{Number(backtestSummary.maxTrades || 0).toLocaleString('ko-KR')}
										</p>
									</div>
								</div>
							) : null}
							<div className="overflow-hidden rounded-md border border-[#2D2D2D]">
								<div className="grid grid-cols-4 border-b border-[#2D2D2D] bg-[#101010] px-4 py-3 text-[12px] font-semibold text-[#BDBDBD]">
									<p>TP</p>
									<p className="text-right">PNL</p>
									<p className="text-right">Hit Rate</p>
									<p className="text-right">Trades</p>
								</div>
								{backtestStats.map((item, index) => {
									const pnlValue = Number(item.pnlValue || 0);
									const pnlClass = pnlValue > 0 ? 'text-[#FF6B6B]' : pnlValue < 0 ? 'text-[#5DA8FF]' : 'text-white';

									return (
										<div
											key={`${item.signalType}-${item.tpValue}-${index}`}
											className="grid grid-cols-4 border-b border-[#232323] px-4 py-3 text-[13px] text-white last:border-b-0"
										>
											<p>{Number(item.tpValue || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}%</p>
											<p className={`text-right ${pnlClass}`}>{pnlValue.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}</p>
											<p className="text-right">{Number(item.hitRate || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%</p>
											<p className="text-right">{Number(item.tradeCount || 0).toLocaleString('ko-KR')}</p>
										</div>
									);
								})}
							</div>
						</div>
					)}
				</div>

				<div className={cardClass}>
					<h3 className="mb-4 text-[15px] font-semibold text-white">주문 설정</h3>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />증거금 모드</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown cur={formData.marginType} onChange={(value) => setFormData({ ...formData, marginType: value })} isOpen={isMarginTypeDropDownOn} setIsOpen={setMarginTypeDropDownOn} option={marginTypeOptions} className="w-full" />
							</div>
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Margin (USDT)</div>
							<div className="relative">
								<input type="text" value={formData.margin} onChange={(event) => setFormData({ ...formData, margin: event.target.value })} className={inputClass} />
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">$</span>
							</div>
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Leverage</div>
							<div className="relative">
								<input type="text" value={formData.leverage} onChange={(event) => setFormData({ ...formData, leverage: event.target.value })} className={inputClass} />
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">X</span>
							</div>
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />익절 (%)</div>
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<CheckboxBig checked={formData.splitTakeProfitEnabled} id="splitTakeProfitEnabled-test" onChange={(value) => setFormData({
										...formData,
										splitTakeProfitEnabled: value,
										splitTakeProfitCount: value ? formData.splitTakeProfitCount || '1' : '1',
										splitTakeProfitGap: DEFAULT_SPLIT_TAKE_PROFIT_GAP,
										splitTakeProfitStages: value
											? createSplitStageList(Number(formData.splitTakeProfitCount || 1), formData.splitTakeProfitStages)
											: createSplitStageList(1)
									})} />
									<span className="text-sm text-white">遺꾪븷 ?듭젅</span>
								</div>
								{formData.splitTakeProfitEnabled ? (
									<div className="space-y-3 rounded-md border border-[#2D2D2D] bg-[#101010] p-3">
										<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
											<div>
												<div className="mb-1 text-[12px] text-[#999]">분할 횟수</div>
												<select
													value={formData.splitTakeProfitCount}
													onChange={(event) => handleSplitStageCountChange(event.target.value)}
													className="w-full rounded-md border border-[#494949] bg-[#0F0F0F] px-3 py-2.5 text-white focus:outline-none"
												>
													{splitCountOptions.map((optionValue) => (
														<option key={optionValue} value={optionValue}>
															{optionValue}
														</option>
													))}
												</select>
											</div>
											<div>
												<div className="mb-1 text-[12px] text-[#999]">怨좎젙 GAP</div>
												<div className="relative">
													<input type="text" value={formData.splitTakeProfitGap} readOnly className={inputClass} />
													<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
												</div>
											</div>
										</div>
										<div className="space-y-2">
											{createSplitStageList(Number(formData.splitTakeProfitCount || 1), formData.splitTakeProfitStages).map((stage, index) => (
												<div key={`test-split-stage-${index}`} className="grid grid-cols-[80px_1fr_1fr] items-center gap-2">
													<div className="text-sm text-[#999]">{index + 1}차</div>
													<div className="relative">
														<input
															type="text"
															value={stage.tpPercent}
															onChange={(event) => updateSplitStage(index, 'tpPercent', event.target.value)}
															className={inputClass}
															placeholder="0.5"
														/>
														<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">TP %</span>
													</div>
													<div className="relative">
														<input
															type="text"
															value={stage.closeRatio}
															onChange={(event) => updateSplitStage(index, 'closeRatio', event.target.value)}
															className={inputClass}
															placeholder="20"
														/>
														<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">比率 %</span>
													</div>
												</div>
											))}
										</div>
									</div>
								) : (
									<div className="relative">
										<input type="text" value={formData.profit} onChange={(event) => setFormData({ ...formData, profit: event.target.value })} className={inputClass} />
										<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
									</div>
								)}
							</div>
						</div>
						<div className="md:col-span-2">
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />주문 예정 금액</div>
							<div className="relative">
								<input type="text" value={orderAmount} onChange={() => {}} disabled className={inputClass} />
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">USDT</span>
							</div>
							<div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
								<div className={summaryCardClass}>
									<p className="text-[12px] text-[#9E9E9E]">최소 마진</p>
									<p className="mt-1 text-[15px] font-semibold text-white">{formatUsdtValue(minimumMarginUsdt)} USDT</p>
								</div>
								<div className={summaryCardClass}>
									<p className="text-[12px] text-[#9E9E9E]">종목 최소 거래금액</p>
									<p className="mt-1 text-[15px] font-semibold text-white">
										{minimumTradeValue > 0 ? `${formatUsdtValue(minimumTradeValue)} USDT` : (symbolRulesLoading ? '불러오는 중' : '미확인')}
									</p>
								</div>
								<div className={summaryCardClass}>
									<p className="text-[12px] text-[#9E9E9E]">규칙 기준 시각</p>
									<p className="mt-1 text-[13px] font-medium text-white">
										{symbolRules?.updatedAt ? new Date(symbolRules.updatedAt).toLocaleString('ko-KR') : '-'}
									</p>
								</div>
							</div>
							{orderConstraintWarning ? (
								<p className="mt-3 rounded-md border border-[#6B1F1F] bg-[#261212] px-3 py-2 text-[12px] text-[#FF8A8A]">
									{orderConstraintWarning}
								</p>
							) : (
								<p className="mt-3 text-[12px] text-[#9E9E9E]">
									최소 거래 규칙은 Binance 거래소 정보 캐시를 기준으로 검증합니다.
								</p>
							)}
						</div>
					</div>
				</div>

				<div className={cardClass}>
					<h3 className="mb-4 text-[15px] font-semibold text-white">청산 설정</h3>
					<p className="mb-4 text-[12px] text-[#9E9E9E]">익절은 지정가, 손절 옵션은 하나 이상 선택해 주세요.</p>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />손절 (%)</div>
							<div className="flex items-center gap-2">
								<CheckboxBig checked={formData.stopLoss !== ''} id="stopLossEnabled-test" onChange={(value) => setFormData({ ...formData, stopLoss: value ? formData.stopLoss || '3' : '' })} />
								<div className="relative flex-1">
									<input type="text" value={formData.stopLoss} onChange={(event) => setFormData({ ...formData, stopLoss: event.target.value })} className={inputClass} />
									<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
								</div>
							</div>
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />반대 신호</div>
							<div className="flex min-h-[44px] items-center">
								<CheckboxBig checked={formData.stopLossReverseEnabled} id="stopLossReverseEnabled-test" onChange={(value) => setFormData({ ...formData, stopLossReverseEnabled: value })} />
							</div>
						</div>
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />시간 경과</div>
							<div className="flex items-center gap-2">
								<CheckboxBig checked={formData.stopLossTimeEnabled} id="stopLossTimeEnabled-test" onChange={(value) => setFormData({ ...formData, stopLossTimeEnabled: value })} />
								<div className="relative flex-1">
									<input type="text" value={formData.stopLossTimeValue} onChange={(event) => setFormData({ ...formData, stopLossTimeValue: event.target.value })} disabled={!formData.stopLossTimeEnabled} className={inputClass} placeholder="10" />
									<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">분</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="flex justify-end pt-1">
					{mode === 'add' ? (
						<button className="cursor-pointer rounded-md border border-[#494949] px-6 py-2 hover:bg-[#0f0f0f]" onClick={handleSave}>전략 추가</button>
					) : (
						<button className="cursor-pointer rounded-md border border-[#494949] px-6 py-2 hover:bg-[#0f0f0f]" onClick={handleEdit}>전략 수정</button>
					)}
				</div>
			</div>
		</div>
	);
};

export default TestOrderView;
