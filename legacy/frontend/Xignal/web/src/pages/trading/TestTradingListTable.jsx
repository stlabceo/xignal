import React, { useEffect, useMemo, useRef, useState } from 'react';
import OnOffToggle from '../../components/ui/toggle/OnOffToggle';
import { comma, formatPrice } from '../../utils/comma';
import { trading } from '../../services/trading';
import { buildStrategyDeletePayload, confirmStrategyDelete, isTradingEnabled, stopTradingActionEvent } from './tradingState';

const strategyLabelMap = {
	'ATF+VIXFIX': 'ATF+VIXFIX',
	'atf+vixfix': 'ATF+VIXFIX',
};

const sideLabelMap = {
	BUY: '매수',
	SELL: '매도',
};

const getStrategyLabel = (item) => strategyLabelMap[item?.type] || item?.type || '-';
const getSignalTypeLabel = (item) => sideLabelMap[item?.signalType] || '-';
const isEnabled = isTradingEnabled;
const getUserStatusLabel = (item = {}) =>
	item.userStatusLabel || (item.runtimeState === 'EXACT' ? '포지션 보유중' : '대기중');

const toNumber = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
};

const formatDisplayPrice = (value) => {
	const numeric = toNumber(value);
	return numeric > 0 ? comma(formatPrice(numeric)) : '-';
};

const formatDisplayAmount = (value) => {
	const numeric = toNumber(value);
	return numeric > 0 ? `${comma(numeric)} USDT` : '-';
};

const formatDisplayPnl = (value) => {
	const numeric = toNumber(value);
	return Number.isFinite(numeric) ? `${numeric >= 0 ? '+' : ''}${comma(Number(numeric.toFixed(8)))}` : '-';
};

const getTradeAmount = (item = {}) => {
	const backendValue = toNumber(item.tradeAmount);
	if (backendValue > 0) {
		return backendValue;
	}
	return toNumber(item.margin) * toNumber(item.leverage);
};

const getEntryPrice = (item = {}) => {
	const backendValue = toNumber(item.entryPrice);
	if (backendValue > 0) {
		return backendValue;
	}
	if (toNumber(item.r_exactPrice) > 0) {
		return toNumber(item.r_exactPrice);
	}
	if (toNumber(item.r_signalPrice) > 0) {
		return toNumber(item.r_signalPrice);
	}
	return 0;
};

const getTargetTakeProfitPrice = (item = {}) => {
	const backendValue = toNumber(item.targetTakeProfitPrice);
	if (backendValue > 0) {
		return backendValue;
	}

	const entryPrice = getEntryPrice(item);
	const profitPercent = toNumber(item.profit);
	if (!(entryPrice > 0) || !(profitPercent > 0)) {
		return 0;
	}

	return item.signalType === 'SELL'
		? entryPrice * (1 - profitPercent / 100)
		: entryPrice * (1 + profitPercent / 100);
};

const getStopCondition = (item = {}) =>
	item.stopConditionLabel || (toNumber(item.stopLoss) > 0 ? `${item.stopLoss}%` : '-');

const getOpenQty = (item = {}) => {
	const backendValue = toNumber(item.openQty);
	if (backendValue > 0) {
		return backendValue;
	}
	return toNumber(item.r_qty);
};

const getUnrealizedPnl = (item = {}, currentPrice) => {
	const entryPrice = getEntryPrice(item);
	const qty = getOpenQty(item);
	const normalizedCurrentPrice = toNumber(currentPrice);
	if (!(entryPrice > 0) || !(qty > 0) || !(normalizedCurrentPrice > 0)) {
		return 0;
	}

	if (String(item.signalType || '').toUpperCase() === 'SELL') {
		return (entryPrice - normalizedCurrentPrice) * qty;
	}
	return (normalizedCurrentPrice - entryPrice) * qty;
};

const TestTradingListTable = ({ setTradingDetailId, listData: data = [], getListData }) => {
	const [livePriceMap, setLivePriceMap] = useState({});
	const [activeTab, setActiveTab] = useState('ON');
	const reqIdRef = useRef(0);

	useEffect(() => {
		if (!data || data.length === 0) {
			setLivePriceMap({});
			return;
		}

		const symbols = [...new Set(data.map((item) => item.symbol).filter(Boolean))];
		if (!symbols.length) {
			return;
		}

		const reqId = ++reqIdRef.current;
		trading.livePrice({ symbols, live: 'Y' }, (res) => {
			if (reqId !== reqIdRef.current || res === false) {
				return;
			}
			setLivePriceMap((prev) => ({ ...prev, ...res }));
		});
	}, [data]);

	const filteredData = useMemo(
		() => data.filter((item) => (activeTab === 'ON' ? isEnabled(item) : !isEnabled(item))),
		[data, activeTab]
	);

	const handleAutoToggle = (id, enabled) => {
		trading.testAutoItem({ id, enabled: enabled ? 'Y' : 'N' }, { live: 'Y' }, () => {
			getListData?.();
		});
	};

	const handleDelete = (id, event) => {
		stopTradingActionEvent(event);
		if (!confirmStrategyDelete(`test algorithm PID ${id}`)) {
			return;
		}
		trading.deleteTestPlayItems(buildStrategyDeletePayload(id), null, () => {
			getListData?.();
		});
	};

	const renderMobileCard = (item) => {
		const currentPrice = livePriceMap[item.symbol]?.lastPrice;
		const unrealizedPnl = getUnrealizedPnl(item, currentPrice);

		return (
			<div
				key={`mobile_test_trading_list_item_${item.id}`}
				className="rounded-lg border border-[#2d3340] bg-[#1A1C22] p-4 text-white"
				onClick={() => setTradingDetailId(item.id)}
			>
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-[12px] text-[#8b94a3]">PID {item.id ?? '-'}</p>
						<p className="mt-1 text-[16px] font-semibold">{item.symbol || '-'}</p>
						<p className="mt-1 text-[12px] text-[#aeb7c6]">
							{getSignalTypeLabel(item)} / {getStrategyLabel(item)}
						</p>
					</div>
					<div className="rounded-md bg-[#0F0F0F] px-2.5 py-1 text-[12px] text-[#d7dbe3]">
						{getUserStatusLabel(item)}
					</div>
				</div>

				<div className="mt-3 grid grid-cols-2 gap-2">
					<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">현재가</p>
						<p className="mt-1 text-[14px]">{formatDisplayPrice(currentPrice)}</p>
					</div>
					<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">진입가</p>
						<p className="mt-1 text-[14px]">{formatDisplayPrice(getEntryPrice(item))}</p>
					</div>
					<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">목표 익절가격</p>
						<p className="mt-1 text-[14px]">{formatDisplayPrice(getTargetTakeProfitPrice(item))}</p>
					</div>
					<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">거래금액</p>
						<p className="mt-1 text-[14px]">{formatDisplayAmount(getTradeAmount(item))}</p>
					</div>
					<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">손절</p>
						<p className="mt-1 text-[14px]">{getStopCondition(item)}</p>
					</div>
					<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">미실현 손익</p>
						<p className="mt-1 text-[14px]">{formatDisplayPnl(unrealizedPnl)}</p>
					</div>
					<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">실현 손익(누적)</p>
						<p className="mt-1 text-[14px]">{formatDisplayPnl(item.realizedPnlTotal)}</p>
					</div>
				</div>

				<div className="mt-3 flex items-center justify-between rounded-md bg-[#0F0F0F] px-3 py-3" onClick={(e) => e.stopPropagation()}>
					<div className="text-[13px] text-[#cfd5df]">운용 ON/OFF</div>
					<OnOffToggle isOn={isEnabled(item)} setIsOn={(value) => handleAutoToggle(item.id, value)} disabled={false} />
				</div>

				{activeTab === 'OFF' && (
					<div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
						<button
							type="button"
							className="cursor-pointer rounded-md border border-[#4b4b4b] bg-[#121212] px-4 py-2 text-xs text-white hover:bg-[#2a2a2a]"
							onClick={(event) => handleDelete(item.id, event)}
						>
							삭제
						</button>
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => setActiveTab('ON')}
					className={`cursor-pointer rounded-md border px-4 py-2 text-sm ${
						activeTab === 'ON' ? 'border-white bg-white text-black' : 'border-[#4E5766] bg-[#1A1C22] text-[#b0b0b0]'
					}`}
				>
					ON
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('OFF')}
					className={`cursor-pointer rounded-md border px-4 py-2 text-sm ${
						activeTab === 'OFF' ? 'border-white bg-white text-black' : 'border-[#4E5766] bg-[#1A1C22] text-[#b0b0b0]'
					}`}
				>
					OFF
				</button>
			</div>

			<div className="space-y-3 md:hidden">
				{filteredData.length === 0 ? (
					<div className="rounded-lg border border-[#2d3340] bg-[#1A1C22] px-4 py-6 text-center text-sm text-[#9aa3b2]">
						표시할 전략이 없습니다.
					</div>
				) : (
					filteredData.map(renderMobileCard)
				)}
			</div>

			<div className="hidden w-full overflow-x-auto rounded-lg shadow-[0_0_5px_rgba(0,0,0,0.1)] md:block">
				<table className="table-fixed min-w-[1850px] whitespace-nowrap text-center text-sm">
					<thead className="border-b border-[#4E5766] bg-[#1A1C22] font-bold text-[#828DA0]">
						<tr>
							<th className="px-4 py-4">PID</th>
							<th className="px-4 py-4">종목</th>
							<th className="px-4 py-4">방향</th>
							<th className="px-4 py-4">전략</th>
							<th className="px-4 py-4">상태</th>
							<th className="px-4 py-4">현재가</th>
							<th className="px-4 py-4">진입가</th>
							<th className="px-4 py-4">목표 익절가격</th>
							<th className="px-4 py-4">거래금액</th>
							<th className="px-4 py-4">손절</th>
							<th className="px-4 py-4">미실현 손익</th>
							<th className="px-4 py-4">실현 손익(누적)</th>
							{activeTab === 'OFF' && <th className="px-4 py-4">삭제</th>}
							<th className="px-4 py-4">운용 ON/OFF</th>
						</tr>
					</thead>
					<tbody>
						{filteredData.map((item) => {
							const currentPrice = livePriceMap[item.symbol]?.lastPrice;
							const unrealizedPnl = getUnrealizedPnl(item, currentPrice);

							return (
								<tr
									key={`test_trading_list_item_${item.id}`}
									className="cursor-pointer border-b border-[#4E5766] text-[#ffffff] hover:bg-[#14161b]"
									onClick={() => setTradingDetailId(item.id)}
								>
									<td className="px-4 py-4">{item.id ?? '-'}</td>
									<td className="px-4 py-4">{item.symbol || '-'}</td>
									<td className="px-4 py-4">{getSignalTypeLabel(item)}</td>
									<td className="px-4 py-4">{getStrategyLabel(item)}</td>
									<td className="px-4 py-4">{getUserStatusLabel(item)}</td>
									<td className="px-4 py-4">{formatDisplayPrice(currentPrice)}</td>
									<td className="px-4 py-4">{formatDisplayPrice(getEntryPrice(item))}</td>
									<td className="px-4 py-4">{formatDisplayPrice(getTargetTakeProfitPrice(item))}</td>
									<td className="px-4 py-4">{formatDisplayAmount(getTradeAmount(item))}</td>
									<td className="px-4 py-4">{getStopCondition(item)}</td>
									<td className="px-4 py-4">{formatDisplayPnl(unrealizedPnl)}</td>
									<td className="px-4 py-4">{formatDisplayPnl(item.realizedPnlTotal)}</td>
									{activeTab === 'OFF' && (
										<td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
											<button
												type="button"
												className="cursor-pointer rounded-md border border-[#4b4b4b] bg-[#121212] px-4 py-1.5 text-xs text-white hover:bg-[#2a2a2a]"
												onClick={(event) => handleDelete(item.id, event)}
											>
												삭제
											</button>
										</td>
									)}
									<td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
										<OnOffToggle isOn={isEnabled(item)} setIsOn={(value) => handleAutoToggle(item.id, value)} disabled={false} />
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default TestTradingListTable;
