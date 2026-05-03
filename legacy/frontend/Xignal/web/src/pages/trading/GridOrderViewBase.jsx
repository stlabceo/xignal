import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DefaultDropdown from '../../components/ui/dropdown/DefaultDropdown';
import { trading } from '../../services/trading';
import { useMessageModal } from '../../hooks/useMessageModal';
import {
	buildCatalogItems,
	toCatalogStrategyOptions,
	toCatalogSymbolOptions,
	toCatalogTimeframeOptions
} from './tradingCatalogOptions';

const marginTypeEnum = {
	cross: '교차',
};
const marginTypeOptions = Object.values(marginTypeEnum);
const MIN_MARGIN_USDT = 5;
const symbolRuleCache = new Map();

const getLabelByKey = (enumMap, key, fallback) => enumMap[key] || fallback;

const createInitialForm = () => ({
	a_name: '',
	strategySignal: 'SQZ+GRID',
	symbol: 'BTCUSDT',
	bunbong: '1MIN',
	marginType: '교차',
	margin: '',
	leverage: '',
	profit: '',
	tradeValue: 0,
});

const normalizeSymbolRulesResponse = (response) => ({
	minMarginUsdt: Number(response?.minMarginUsdt || MIN_MARGIN_USDT),
	symbol: String(response?.rules?.symbol || '').trim().toUpperCase() || null,
	minTradeValue: Number(response?.rules?.minTradeValue || 0),
	updatedAt: response?.rules?.updatedAt || null,
});

const formatUsdtValue = (value) =>
	Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 8 });

const rowLabelClass = 'mb-2 flex items-center gap-1.5 text-[13px] text-[#999]';
const cardClass = 'rounded-xl border border-[#2D2D2D] bg-[#141414] p-4';
const inputClass =
	'w-full rounded-md border border-[#494949] bg-[#0F0F0F] px-3 py-2.5 pr-8 text-right text-white focus:outline-none disabled:bg-[#212121]';
const dropdownWrapClass = 'w-full rounded-md border border-[#494949] bg-[#0F0F0F] px-3 py-2.5';

const GridOrderViewBase = ({ id, getListData, presetData, mode = 'live' }) => {
	const showMessage = useMessageModal();
	const [formData, setFormData] = useState(createInitialForm);
	const [viewMode, setViewMode] = useState('add');
	const [isStrategyDropDownOn, setStrategyDropDownOn] = useState(false);
	const [isSymbolDropDownOn, setSymbolDropDownOn] = useState(false);
	const [isBunbongDropDownOn, setBunbongDropDownOn] = useState(false);
	const [isMarginTypeDropDownOn, setIsMarginTypeDropDownOn] = useState(false);
	const [symbolRules, setSymbolRules] = useState(null);
	const [symbolRulesLoading, setSymbolRulesLoading] = useState(false);
	const [catalogItems, setCatalogItems] = useState(() => buildCatalogItems([], 'grid'));

	const loadDetail = mode === 'live' ? trading.gridLiveDetail : trading.gridTestDetail;
	const createDetail = mode === 'live' ? trading.gridLiveDetailUpload : trading.gridTestDetailUpload;
	const editDetail = mode === 'live' ? trading.gridLiveDetailEdit : trading.gridTestDetailEdit;

	useEffect(() => {
		let isMounted = true;
		trading.strategyCatalogOptions({ category: 'grid' }, (res) => {
			if (!isMounted) {
				return;
			}

			setCatalogItems(buildCatalogItems(res?.items || [], 'grid'));
		});

		return () => {
			isMounted = false;
		};
	}, []);

	const strategyOptions = useMemo(() => toCatalogStrategyOptions(catalogItems), [catalogItems]);
	const selectedStrategyItem = useMemo(
		() => catalogItems.find((item) => item.signalName === formData.strategySignal) || catalogItems[0] || null,
		[catalogItems, formData.strategySignal]
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
			const nextStrategySignal = catalogItems.some((item) => item.signalName === prev.strategySignal)
				? prev.strategySignal
				: catalogItems[0].signalName;
			const nextStrategyItem = catalogItems.find((item) => item.signalName === nextStrategySignal) || catalogItems[0];
			const nextSymbol = nextStrategyItem?.allowedSymbols?.includes(prev.symbol)
				? prev.symbol
				: nextStrategyItem?.allowedSymbols?.[0] || prev.symbol;
			const nextBunbong = nextStrategyItem?.allowedTimeframes?.includes(prev.bunbong)
				? prev.bunbong
				: nextStrategyItem?.allowedTimeframes?.[0] || prev.bunbong;

			if (
				nextStrategySignal === prev.strategySignal &&
				nextSymbol === prev.symbol &&
				nextBunbong === prev.bunbong
			) {
				return prev;
			}

			return {
				...prev,
				strategySignal: nextStrategySignal,
				symbol: nextSymbol,
				bunbong: nextBunbong
			};
		});
	}, [catalogItems]);

	useEffect(() => {
		if (id) {
			setViewMode('edit');
			loadDetail({ id }, (res) => {
				setFormData({
					...createInitialForm(),
					...res,
					symbol: res.symbol || 'BTCUSDT',
					bunbong: res.bunbong || '1MIN',
					marginType: getLabelByKey(marginTypeEnum, res.marginType, '교차'),
					margin: res.margin ?? '',
					leverage: res.leverage ?? '',
					profit: res.profit ?? '',
					tradeValue: res.tradeValue ?? 0,
				});
			});
			return;
		}

		if (presetData) {
			setViewMode('add');
			setFormData((prev) => ({
				...prev,
				...presetData,
				marginType: presetData.marginType || '교차',
			}));
			return;
		}

		setViewMode('add');
		setFormData(createInitialForm());
	}, [id, loadDetail, presetData]);

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

	const numericOrderAmount = useMemo(() => {
		const margin = Number(formData.margin || 0);
		const leverage = Number(formData.leverage || 0);
		if (Number.isNaN(margin) || Number.isNaN(leverage)) {
			return 0;
		}
		return margin * leverage;
	}, [formData.leverage, formData.margin]);

	const orderAmount = useMemo(() => String(numericOrderAmount), [numericOrderAmount]);
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

	const validateForm = useCallback(() => {
		if (!String(formData.a_name || '').trim()) {
			showMessage({ message: '전략 이름을 입력해 주세요.', confirmText: '확인' });
			return false;
		}
		if (!String(formData.strategySignal || '').trim()) {
			showMessage({ message: 'Grid 전략 신호 이름을 입력해 주세요.', confirmText: '확인' });
			return false;
		}
		if (!(Number(formData.margin) >= minimumMarginUsdt)) {
			showMessage({ message: `마진은 최소 ${formatUsdtValue(minimumMarginUsdt)} USDT 이상이어야 합니다.`, confirmText: '확인' });
			return false;
		}
		if (!(Number(formData.leverage) >= 1 && Number(formData.leverage) <= 100)) {
			showMessage({ message: '레버리지는 1배 이상 100배 이하로 입력해 주세요.', confirmText: '확인' });
			return false;
		}
		if (!(Number(formData.profit) > 0)) {
			showMessage({ message: 'Grid 익절(%)을 입력해 주세요.', confirmText: '확인' });
			return false;
		}
		if (minimumTradeValue > 0 && numericOrderAmount + 0.0000001 < minimumTradeValue) {
			showMessage({
				message: `${formData.symbol} 최소 거래금액은 ${formatUsdtValue(minimumTradeValue)} USDT입니다.`,
				confirmText: '확인',
			});
			return false;
		}
		return true;
	}, [formData.a_name, formData.leverage, formData.margin, formData.profit, formData.strategySignal, formData.symbol, minimumMarginUsdt, minimumTradeValue, numericOrderAmount, showMessage]);

	const toPayload = useCallback(
		() => ({
			a_name: formData.a_name,
			strategySignal: formData.strategySignal,
			symbol: formData.symbol,
			bunbong: formData.bunbong,
			marginType: Object.entries(marginTypeEnum).find(([, value]) => value === formData.marginType)?.[0] || 'cross',
			margin: formData.margin,
			leverage: formData.leverage,
			profit: formData.profit,
			tradeValue: orderAmount,
		}),
		[formData, orderAmount]
	);

	const handleSaveResult = useCallback(
		(res, successMessage) => {
			const errorMessage =
				res?.msg ||
				(res?.success === false ? res?.message : '') ||
				(res === false ? '요청 처리에 실패했습니다.' : '');

			showMessage({
				message: errorMessage || successMessage,
				confirmText: '확인',
				onConfirm: () => {
					if (!errorMessage) {
						getListData?.();
					}
				},
			});
		},
		[getListData, showMessage]
	);

	const handleSave = useCallback(() => {
		if (!validateForm()) return;
		createDetail(toPayload(), null, (res) => {
			handleSaveResult(res, 'Grid 전략을 추가했습니다.');
		});
	}, [createDetail, handleSaveResult, toPayload, validateForm]);

	const handleEdit = useCallback(() => {
		if (!validateForm()) return;
		editDetail({ ...toPayload(), id }, null, (res) => {
			handleSaveResult(res, 'Grid 전략을 수정했습니다.');
		});
	}, [editDetail, handleSaveResult, id, toPayload, validateForm]);

	return (
		<div className="h-full w-full bg-[#1B1B1B] p-4 text-white md:p-5">
			<div className="space-y-3 md:space-y-4">
				<div className={cardClass}>
					<h3 className="mb-4 text-[15px] font-semibold text-white">Grid 전략 설정</h3>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								전략 이름
							</div>
							<input
								type="text"
								value={formData.a_name}
								onChange={(event) => setFormData({ ...formData, a_name: event.target.value })}
								className="w-full rounded-md border border-[#494949] bg-[#0F0F0F] p-2.5 text-white focus:outline-none"
							/>
						</div>
						<div>
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								Grid Signal
							</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.strategySignal}
									onChange={(value) => setFormData({ ...formData, strategySignal: value })}
									isOpen={isStrategyDropDownOn}
									setIsOpen={setStrategyDropDownOn}
									option={strategyOptions}
									className="w-full"
								/>
							</div>
						</div>
						<div>
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								종목
							</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.symbol}
									onChange={(value) => setFormData({ ...formData, symbol: value })}
									setIsOpen={setSymbolDropDownOn}
									isOpen={isSymbolDropDownOn}
									option={symbolOptions}
									className="w-full"
								/>
							</div>
						</div>
						<div>
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								타임프레임
							</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.bunbong}
									onChange={(value) => setFormData({ ...formData, bunbong: value })}
									isOpen={isBunbongDropDownOn}
									setIsOpen={setBunbongDropDownOn}
									option={bunbongOptions}
									className="w-full"
								/>
							</div>
						</div>
					</div>
				</div>

				<div className={cardClass}>
					<h3 className="mb-4 text-[15px] font-semibold text-white">Grid 주문 설정</h3>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								증거금 모드
							</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.marginType}
									onChange={(value) => setFormData({ ...formData, marginType: value })}
									isOpen={isMarginTypeDropDownOn}
									setIsOpen={setIsMarginTypeDropDownOn}
									option={marginTypeOptions}
									className="w-full"
								/>
							</div>
						</div>
						<div>
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								Margin (USDT)
							</div>
							<div className="relative">
								<input
									type="text"
									value={formData.margin}
									onChange={(event) => setFormData({ ...formData, margin: event.target.value })}
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">$</span>
							</div>
						</div>
						<div>
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								Leverage
							</div>
							<div className="relative">
								<input
									type="text"
									value={formData.leverage}
									onChange={(event) => setFormData({ ...formData, leverage: event.target.value })}
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">X</span>
							</div>
						</div>
						<div>
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								익절 (%)
							</div>
							<div className="relative">
								<input
									type="text"
									value={formData.profit}
									onChange={(event) => setFormData({ ...formData, profit: event.target.value })}
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
							</div>
						</div>
						<div className="md:col-span-2">
							<div className={rowLabelClass}>
								<p className="h-1 w-1 rounded-full bg-[#999]" />
								거래금액 자동계산
							</div>
							<div className="relative">
								<input
									type="text"
									value={Number(orderAmount || 0).toLocaleString('ko-KR')}
									readOnly
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">USDT</span>
							</div>
							<div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
								<div className={cardClass}>
									<p className="text-[12px] text-[#9E9E9E]">최소 마진</p>
									<p className="mt-1 text-[15px] font-semibold text-white">{formatUsdtValue(minimumMarginUsdt)} USDT</p>
								</div>
								<div className={cardClass}>
									<p className="text-[12px] text-[#9E9E9E]">종목 최소 거래금액</p>
									<p className="mt-1 text-[15px] font-semibold text-white">
										{minimumTradeValue > 0 ? `${formatUsdtValue(minimumTradeValue)} USDT` : (symbolRulesLoading ? 'Loading' : 'Unknown')}
									</p>
								</div>
								<div className={cardClass}>
									<p className="text-[12px] text-[#9E9E9E]">Rule Updated</p>
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
									최소 거래 규칙은 캐시된 Binance exchange info 기준으로 확인합니다.
								</p>
							)}
						</div>
					</div>
				</div>

				<div className={cardClass}>
					<h3 className="mb-3 text-[15px] font-semibold text-white">Grid webhook 메모</h3>
					<div className="space-y-2 text-[12px] text-[#BDBDBD]">
						<p>- Grid는 알고리즘 전략과 별도 카테고리이며, 손절/분할익절 설정은 별도로 받지 않습니다.</p>
						<p>- webhook은 전략명, 종목, 캔들, 신호시간, 지지선, 저항선, 트리거라인을 보냅니다.</p>
						<p>- 수신 경로: <span className="font-medium text-white">/user/api/grid/hook</span></p>
						<p>
							- 필드: <span className="font-medium text-white">signal, symbol, candle_min(or bunbong), time, supportPrice, resistancePrice, triggerPrice</span>
						</p>
						<p>
							- 예시: signal=<span className="font-medium text-white">{formData.strategySignal || 'STATIC_GRID'}</span>, symbol=
							<span className="font-medium text-white">{formData.symbol}.P</span>, candle_min=
							<span className="font-medium text-white">{String(formData.bunbong || '').replace('MIN', '')}</span>
						</p>
					</div>
				</div>

				<div className="flex justify-end pt-1">
					{viewMode === 'add' ? (
						<button
							className="cursor-pointer rounded-md border border-[#494949] px-6 py-2 hover:bg-[#0f0f0f]"
							onClick={handleSave}
						>
							Grid 전략 추가
						</button>
					) : (
						<button
							className="cursor-pointer rounded-md border border-[#494949] px-6 py-2 hover:bg-[#0f0f0f]"
							onClick={handleEdit}
						>
							Grid 전략 수정
						</button>
					)}
				</div>
			</div>
		</div>
	);
};

export default GridOrderViewBase;

