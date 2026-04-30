import React, { useEffect, useMemo, useRef, useState } from 'react';
import OnOffToggle from '../../components/ui/toggle/OnOffToggle';
import { comma, formatPrice } from '../../utils/comma';
import { trading } from '../../services/trading';
import { buildStrategyDeletePayload, confirmStrategyDelete, isTradingEnabled, stopTradingActionEvent } from './tradingState';

const strategyLabelMap = {
	'ATF+VIXFIX': 'ATF+VIXFIX',
	'atf+vixfix': 'ATF+VIXFIX',
	SQZGBRK: 'SQZGBRK'
};

const sideLabelMap = {
	BUY: '매수',
	SELL: '매도'
};

const toNumber = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
};

const getStrategyLabel = (item) => strategyLabelMap[item?.type] || item?.a_name || item?.type || '-';
const getSignalTypeLabel = (item) => sideLabelMap[String(item?.signalType || '').toUpperCase()] || '-';
const isEnabled = isTradingEnabled;
const getUserStatusLabel = (item = {}) => item.userStatusLabel || (getOpenQty(item) > 0 ? '포지션 보유중' : isEnabled(item) ? '운용중' : '대기중');

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
	return `${numeric >= 0 ? '+' : ''}${comma(Number(numeric.toFixed(8)))} USDT`;
};

const formatDate = (value) => {
	if (!value) return '-';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '-';
	return date.toLocaleString('ko-KR', { hour12: false });
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
	if (backendValue > 0) return backendValue;
	if (toNumber(item.r_exactPrice) > 0) return toNumber(item.r_exactPrice);
	if (toNumber(item.r_signalPrice) > 0) return toNumber(item.r_signalPrice);
	return 0;
};

const getOpenQty = (item = {}) => {
	const backendValue = toNumber(item.openQty);
	if (backendValue > 0) return backendValue;
	return toNumber(item.r_qty);
};

const getUnrealizedPnl = (item = {}, currentPrice) => {
	const entryPrice = getEntryPrice(item);
	const qty = getOpenQty(item);
	const normalizedCurrentPrice = toNumber(currentPrice);
	if (!(entryPrice > 0) || !(qty > 0) || !(normalizedCurrentPrice > 0)) {
		return 0;
	}
	return String(item.signalType || '').toUpperCase() === 'SELL'
		? (entryPrice - normalizedCurrentPrice) * qty
		: (normalizedCurrentPrice - entryPrice) * qty;
};

const getWinLossLabel = (item = {}) => {
	const win = toNumber(item.r_win || item.winCount);
	const loss = toNumber(item.r_loss || item.lossCount);
	return `${comma(win)}승 / ${comma(loss)}패`;
};

const StatusChip = ({ label }) => (
	<span className="inline-flex rounded-full border border-[#334155] bg-[#111827] px-2.5 py-1 text-xs font-semibold text-[#D8E0ED]">
		{label}
	</span>
);

const TradingListTable = ({ setTradingDetailId, listData: data = [], getListData }) => {
	const [livePriceMap, setLivePriceMap] = useState({});
	const [activeTab, setActiveTab] = useState('ON');
	const reqIdRef = useRef(0);

	useEffect(() => {
		if (!data || data.length === 0) {
			setLivePriceMap({});
			return;
		}

		const symbols = [...new Set(data.map((item) => item.symbol).filter(Boolean))];
		if (!symbols.length) return;

		const reqId = ++reqIdRef.current;
		trading.livePrice({ symbols, live: 'Y' }, (res) => {
			if (reqId !== reqIdRef.current || res === false) return;
			setLivePriceMap((prev) => ({ ...prev, ...res }));
		});
	}, [data]);

	const filteredData = useMemo(
		() => data.filter((item) => (activeTab === 'ON' ? isEnabled(item) : !isEnabled(item))),
		[data, activeTab]
	);

	const handleAutoToggle = (id, enabled) => {
		trading.liveAutoItem({ id, enabled: enabled ? 'Y' : 'N' }, { live: 'Y' }, () => {
			getListData?.();
		});
	};

	const handleDelete = (id, event) => {
		stopTradingActionEvent(event);
		if (!confirmStrategyDelete(`algorithm PID ${id}`)) return;
		trading.deleteLivePlayItems(buildStrategyDeletePayload(id), null, () => {
			getListData?.();
		});
	};

	const renderMobileCard = (item) => {
		const currentPrice = livePriceMap[item.symbol]?.lastPrice;
		const unrealizedPnl = getUnrealizedPnl(item, currentPrice);
		const lastTradeAt = item.lastTradeAt || item.r_exactTime || item.updatedAt || item.created_at;

		return (
			<div
				key={`mobile_trading_list_item_${item.id}`}
				className="rounded-xl border border-[#2d3340] bg-[#151A22] p-4 text-white"
				onClick={() => setTradingDetailId(item.id)}
			>
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-[12px] text-[#8b94a3]">PID {item.id ?? '-'}</p>
						<p className="mt-1 text-[16px] font-semibold">{getStrategyLabel(item)}</p>
						<p className="mt-1 text-[12px] text-[#aeb7c6]">
							{item.symbol || '-'} / {getSignalTypeLabel(item)}
						</p>
					</div>
					<StatusChip label={getUserStatusLabel(item)} />
				</div>

				<div className="mt-3 grid grid-cols-2 gap-2">
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">투자금</p>
						<p className="mt-1 text-[14px]">{formatDisplayAmount(getTradeAmount(item))}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">현재 포지션</p>
						<p className="mt-1 text-[14px]">{getOpenQty(item) > 0 ? `${comma(getOpenQty(item))}` : '-'}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">현재 미실현손익</p>
						<p className="mt-1 text-[14px]">{formatDisplayPnl(unrealizedPnl)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">누적 실현손익</p>
						<p className="mt-1 text-[14px]">{formatDisplayPnl(item.realizedPnlTotal)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">승/패</p>
						<p className="mt-1 text-[14px]">{getWinLossLabel(item)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">최근 거래</p>
						<p className="mt-1 text-[14px]">{formatDate(lastTradeAt)}</p>
					</div>
				</div>

				<div className="mt-3 flex items-center justify-between rounded-md bg-[#0F141B] px-3 py-3" onClick={(e) => e.stopPropagation()}>
					<div className="text-[13px] text-[#cfd5df]">ON/OFF</div>
					<OnOffToggle isOn={isEnabled(item)} setIsOn={(value) => handleAutoToggle(item.id, value)} disabled={false} />
				</div>

				{activeTab === 'OFF' && (
					<div className="mt-2 flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
						<button type="button" className="rounded-md border border-[#4b4b4b] bg-[#121212] px-4 py-2 text-xs text-white hover:bg-[#2a2a2a]" onClick={() => setTradingDetailId(item.id)}>
							수정
						</button>
						<button type="button" className="rounded-md border border-[#4b4b4b] bg-[#121212] px-4 py-2 text-xs text-white hover:bg-[#2a2a2a]" onClick={(event) => handleDelete(item.id, event)}>
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
				{['ON', 'OFF'].map((tab) => (
					<button
						key={tab}
						type="button"
						onClick={() => setActiveTab(tab)}
						className={`rounded-md border px-4 py-2 text-sm ${
							activeTab === tab ? 'border-white bg-white text-black' : 'border-[#4E5766] bg-[#1A1C22] text-[#b0b0b0]'
						}`}
					>
						{tab}
					</button>
				))}
			</div>

			<div className="space-y-3 md:hidden">
				{filteredData.length === 0 ? (
					<div className="rounded-lg border border-[#2d3340] bg-[#151A22] px-4 py-6 text-center text-sm text-[#9aa3b2]">
						표시할 알고리즘 전략이 없습니다.
					</div>
				) : (
					filteredData.map(renderMobileCard)
				)}
			</div>

			<div className="hidden w-full overflow-x-auto rounded-xl border border-[#27313D] bg-[#151A22] md:block">
				<table className="table-fixed min-w-[1660px] whitespace-nowrap text-center text-sm">
					<thead className="border-b border-[#2D3746] bg-[#10151C] font-bold text-[#8B96A8]">
						<tr>
							<th className="px-4 py-4">전략</th>
							<th className="px-4 py-4">종목 / 방향</th>
							<th className="px-4 py-4">투자금</th>
							<th className="px-4 py-4">현재 포지션</th>
							<th className="px-4 py-4">현재가 / 진입가</th>
							<th className="px-4 py-4">현재 미실현손익</th>
							<th className="px-4 py-4">누적 실현손익</th>
							<th className="px-4 py-4">승/패</th>
							<th className="px-4 py-4">최근 거래</th>
							<th className="px-4 py-4">상태</th>
							<th className="px-4 py-4">ON/OFF</th>
							<th className="px-4 py-4">수정</th>
							{activeTab === 'OFF' && <th className="px-4 py-4">삭제</th>}
						</tr>
					</thead>
					<tbody>
						{filteredData.length === 0 ? (
							<tr>
								<td className="px-4 py-8 text-[#9aa3b2]" colSpan={activeTab === 'OFF' ? 13 : 12}>
									표시할 알고리즘 전략이 없습니다.
								</td>
							</tr>
						) : (
							filteredData.map((item) => {
								const currentPrice = livePriceMap[item.symbol]?.lastPrice;
								const unrealizedPnl = getUnrealizedPnl(item, currentPrice);
								const lastTradeAt = item.lastTradeAt || item.r_exactTime || item.updatedAt || item.created_at;

								return (
									<tr
										key={`trading_list_item_${item.id}`}
										className="cursor-pointer border-b border-[#27313D] text-[#ffffff] hover:bg-[#101820]"
										onClick={() => setTradingDetailId(item.id)}
									>
										<td className="px-4 py-4">
											<div className="font-semibold">{getStrategyLabel(item)}</div>
											<div className="mt-1 text-xs text-[#8B96A8]">PID {item.id ?? '-'}</div>
										</td>
										<td className="px-4 py-4">{item.symbol || '-'} / {getSignalTypeLabel(item)}</td>
										<td className="px-4 py-4">{formatDisplayAmount(getTradeAmount(item))}</td>
										<td className="px-4 py-4">{getOpenQty(item) > 0 ? comma(getOpenQty(item)) : '-'}</td>
										<td className="px-4 py-4">{formatDisplayPrice(currentPrice)} / {formatDisplayPrice(getEntryPrice(item))}</td>
										<td className={`px-4 py-4 ${unrealizedPnl >= 0 ? 'text-[#8EE6B5]' : 'text-[#FF8E8E]'}`}>{formatDisplayPnl(unrealizedPnl)}</td>
										<td className={`px-4 py-4 ${toNumber(item.realizedPnlTotal) >= 0 ? 'text-[#8EE6B5]' : 'text-[#FF8E8E]'}`}>{formatDisplayPnl(item.realizedPnlTotal)}</td>
										<td className="px-4 py-4">{getWinLossLabel(item)}</td>
										<td className="px-4 py-4">{formatDate(lastTradeAt)}</td>
										<td className="px-4 py-4"><StatusChip label={getUserStatusLabel(item)} /></td>
										<td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
											<OnOffToggle isOn={isEnabled(item)} setIsOn={(value) => handleAutoToggle(item.id, value)} disabled={false} />
										</td>
										<td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
											<button type="button" className="rounded-md border border-[#4b4b4b] px-3 py-1.5 text-xs text-white hover:bg-[#2a2a2a]" onClick={() => setTradingDetailId(item.id)}>
												수정
											</button>
										</td>
										{activeTab === 'OFF' && (
											<td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
												<button type="button" className="rounded-md border border-[#4b4b4b] px-3 py-1.5 text-xs text-white hover:bg-[#2a2a2a]" onClick={(event) => handleDelete(item.id, event)}>
													삭제
												</button>
											</td>
										)}
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default TradingListTable;
