import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trading } from '../../services/trading';
import { useMessageModal } from '../../hooks/useMessageModal';
import { comma, formatPrice } from '../../utils/comma';
import { buildStrategyDeletePayload, confirmStrategyDelete, isTradingEnabled, stopTradingActionEvent } from './tradingState';

const cardClass = 'rounded-xl border border-[#27313D] bg-[#151A22]';

const toNumber = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
};

const formatDisplayNumber = (value, digits = 0) => {
	const numeric = toNumber(value);
	return numeric.toLocaleString('ko-KR', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
};

const formatDisplayPrice = (value) => {
	const numeric = toNumber(value);
	return numeric > 0 ? comma(formatPrice(numeric)) : '-';
};

const formatDisplayPnl = (value) => {
	const numeric = toNumber(value);
	return `${numeric >= 0 ? '+' : ''}${comma(Number(numeric.toFixed(8)))} USDT`;
};

const formatDisplayAmount = (value) => {
	const numeric = toNumber(value);
	return numeric > 0 ? `${comma(numeric)} USDT` : '-';
};

const isEnabled = isTradingEnabled;
const getOverallStatusLabel = (item = {}) => item.userOverallStatusLabel || item.displayStatus || (isEnabled(item) ? '운용중 / 신호대기' : 'OFF / 대기중');
const getLongStatusLabel = (item = {}) => item.longPositionStatusLabel || (toNumber(item.longQty) > 0 ? 'LONG 보유' : '진입 대기');
const getShortStatusLabel = (item = {}) => item.shortPositionStatusLabel || (toNumber(item.shortQty) > 0 ? 'SHORT 보유' : '진입 대기');

const getGridTargetTakeProfitLabel = (item = {}) => (toNumber(item.profit) > 0 ? `${item.profit}%` : '-');

const getMetricValue = (item = {}, keys = [], fallback = 0) => {
	for (const key of keys) {
		if (item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== '') {
			return toNumber(item[key]);
		}
	}
	return fallback;
};

const getConfiguredNotional = (item = {}) =>
	getMetricValue(item, ['configuredNotional', 'tradeAmount', 'tradeValue'], toNumber(item.margin) * toNumber(item.leverage));

const getActualEntryNotional = (item = {}) => getMetricValue(item, ['actualEntryNotional'], 0);

const getGridUnrealizedPnl = (item = {}, currentPrice) => {
	if (item.unrealizedPnl !== null && item.unrealizedPnl !== undefined && item.unrealizedPnl !== '') {
		return toNumber(item.unrealizedPnl);
	}
	const price = toNumber(currentPrice);
	if (!(price > 0)) return getMetricValue(item, ['openQty'], 0) > 0 ? null : 0;
	const longQty = toNumber(item.longQty);
	const shortQty = toNumber(item.shortQty);
	const longEntryPrice = toNumber(item.longEntryPrice);
	const shortEntryPrice = toNumber(item.shortEntryPrice);
	const longPnl = longQty > 0 && longEntryPrice > 0 ? (price - longEntryPrice) * longQty : 0;
	const shortPnl = shortQty > 0 && shortEntryPrice > 0 ? (shortEntryPrice - price) * shortQty : 0;
	return longPnl + shortPnl;
};

const formatGridUnrealizedPnl = (value) => {
	if (value === null || value === undefined) return '집계 불가';
	return formatDisplayPnl(value);
};

const StatusChip = ({ label }) => (
	<span className="inline-flex rounded-full border border-[#334155] bg-[#111827] px-2.5 py-1 text-xs font-semibold text-[#D8E0ED]">
		{label}
	</span>
);

const GridTradingGridBase = ({ mode = 'live', listData = [], setTradingDetailId, getListData }) => {
	const showMessage = useMessageModal();
	const autoAction = mode === 'live' ? trading.gridLiveAutoItem : trading.gridTestAutoItem;
	const deleteAction = mode === 'live' ? trading.gridLiveDeleteItem : trading.gridTestDeleteItem;
	const [livePriceMap, setLivePriceMap] = useState({});
	const reqIdRef = useRef(0);

	useEffect(() => {
		if (!listData || listData.length === 0) {
			setLivePriceMap({});
			return;
		}

		const symbols = [...new Set(listData.map((item) => item.symbol).filter(Boolean))];
		if (!symbols.length) return;

		const reqId = ++reqIdRef.current;
		trading.livePrice({ symbols, live: 'Y' }, (res) => {
			if (reqId !== reqIdRef.current || res === false) return;
			setLivePriceMap((prev) => ({ ...prev, ...res }));
		});
	}, [listData]);

	const rows = useMemo(() => listData || [], [listData]);

	const handleToggle = useCallback(
		(item) => {
			const nextEnabled = !isEnabled(item);
			autoAction({ id: item.id, enabled: nextEnabled ? 'Y' : 'N' }, null, (res) => {
				const errorMessage =
					res?.msg ||
					(res?.success === false ? res?.message : '') ||
					(res === false ? '그리드 전략 상태 변경에 실패했습니다.' : '');

				showMessage({
					message: errorMessage || (nextEnabled ? '그리드 전략이 ON 되었습니다.' : '그리드 전략이 OFF 되었습니다.'),
					confirmText: '확인',
					onConfirm: () => {
						if (!errorMessage) getListData?.();
					}
				});
			});
		},
		[autoAction, getListData, showMessage]
	);

	const handleDelete = useCallback(
		(item, event) => {
			stopTradingActionEvent(event);
			if (!confirmStrategyDelete(`grid PID ${item.id}`)) return;
			deleteAction(buildStrategyDeletePayload(item.id), null, (res) => {
				const errorMessage =
					res?.msg ||
					(res?.success === false ? res?.message : '') ||
					(res === false ? '그리드 전략 삭제에 실패했습니다.' : '');

				showMessage({
					message: errorMessage || '그리드 전략이 삭제되었습니다.',
					confirmText: '확인',
					onConfirm: () => {
						if (!errorMessage) getListData?.();
					}
				});
			});
		},
		[deleteAction, getListData, showMessage]
	);

	const renderMobileCard = (item) => {
		const currentPrice = livePriceMap[item.symbol]?.lastPrice;
		const unrealizedPnl = getGridUnrealizedPnl(item, currentPrice);
		const currentRegimeTakeProfitCount = getMetricValue(item, ['currentRegimeTakeProfitCount', 'regimeTakeProfitCount', 'currentTpCount']);
		const cumulativePnl = getMetricValue(item, ['realizedPnlTotal', 'cumulativePnl', 'totalRealizedPnl', 'r_pol_sum']);
		const cumulativeTakeProfitCount = getMetricValue(item, ['cumulativeTakeProfitCount', 'totalTakeProfitCount', 'profitCount']);
		const cumulativeStopLossCount = getMetricValue(item, ['cumulativeStopLossCount', 'totalStopLossCount', 'stopCount']);

		return (
			<div key={`mobile_grid_item_${item.id}`} className="rounded-xl border border-[#2d3340] bg-[#151A22] p-4 text-white" onClick={() => setTradingDetailId?.(item.id)}>
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-[12px] text-[#8b94a3]">PID {item.id ?? '-'}</p>
						<p className="mt-1 text-[16px] font-semibold">{item.a_name || item.strategySignal || 'SQZ+GRID'}</p>
						<p className="mt-1 text-[12px] text-[#aeb7c6]">{item.symbol || '-'} / {item.bunbong || '-'}</p>
					</div>
					<StatusChip label={getOverallStatusLabel(item)} />
				</div>

				<div className="mt-3 grid grid-cols-2 gap-2">
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">현재 레짐</p>
						<p className="mt-1 text-[14px]">{getOverallStatusLabel(item)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">현재가</p>
						<p className="mt-1 text-[14px]">{formatDisplayPrice(currentPrice)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">LONG 상태</p>
						<p className="mt-1 text-[14px]">{getLongStatusLabel(item)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">SHORT 상태</p>
						<p className="mt-1 text-[14px]">{getShortStatusLabel(item)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">현재 미실현손익</p>
						<p className="mt-1 text-[14px]">{formatDisplayPnl(unrealizedPnl)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">누적 실현손익</p>
						<p className="mt-1 text-[14px]">{formatDisplayPnl(cumulativePnl)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">현재 회차 익절</p>
						<p className="mt-1 text-[14px]">{formatDisplayNumber(currentRegimeTakeProfitCount)}</p>
					</div>
					<div className="rounded-md bg-[#0F141B] px-3 py-2">
						<p className="text-[11px] text-[#7f8898]">누적 익절/손절</p>
						<p className="mt-1 text-[14px]">{formatDisplayNumber(cumulativeTakeProfitCount)} / {formatDisplayNumber(cumulativeStopLossCount)}</p>
					</div>
				</div>

				<div className="mt-3 flex items-center justify-between rounded-md bg-[#0F141B] px-3 py-3" onClick={(e) => e.stopPropagation()}>
					<div className="text-[13px] text-[#cfd5df]">ON/OFF</div>
					<button type="button" className="rounded border border-[#494949] px-3 py-1.5 text-[12px] hover:bg-[#14161b]" onClick={() => handleToggle(item)}>
						{isEnabled(item) ? 'OFF' : 'ON'}
					</button>
				</div>
			</div>
		);
	};

	return (
		<div className="space-y-4 md:space-y-5">
			<div className="space-y-3 md:hidden">
				{rows.length === 0 ? (
					<div className="rounded-lg border border-[#2d3340] bg-[#151A22] px-4 py-6 text-center text-sm text-[#9aa3b2]">
						표시할 그리드 전략이 없습니다.
					</div>
				) : (
					rows.map(renderMobileCard)
				)}
			</div>

			<div className={`${cardClass} hidden overflow-x-auto md:block`}>
				<table className="table-fixed min-w-[1760px] whitespace-nowrap text-center text-sm">
					<thead className="border-b border-[#2D3746] bg-[#10151C] text-[12px] font-semibold text-[#8B96A8]">
						<tr>
							<th className="px-4 py-3">전략 / 타임프레임</th>
							<th className="px-4 py-3">종목</th>
							<th className="px-4 py-3">설정금액</th>
							<th className="px-4 py-3">실제 진입금액</th>
							<th className="px-4 py-3">현재 레짐</th>
							<th className="px-4 py-3">LONG 상태</th>
							<th className="px-4 py-3">SHORT 상태</th>
							<th className="px-4 py-3">현재가</th>
							<th className="px-4 py-3">현재 미실현손익</th>
							<th className="px-4 py-3">누적 실현손익</th>
							<th className="px-4 py-3">현재 회차 익절</th>
							<th className="px-4 py-3">누적 익절/손절</th>
							<th className="px-4 py-3">상태</th>
							<th className="px-4 py-3">ON/OFF</th>
							<th className="px-4 py-3">수정</th>
							<th className="px-4 py-3">삭제</th>
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<tr>
								<td colSpan={16} className="px-4 py-8 text-center text-[13px] text-[#9E9E9E]">
									표시할 그리드 전략이 없습니다.
								</td>
							</tr>
						) : (
							rows.map((item) => {
								const currentPrice = livePriceMap[item.symbol]?.lastPrice;
								const currentRegimeTakeProfitCount = getMetricValue(item, ['currentRegimeTakeProfitCount', 'regimeTakeProfitCount', 'currentTpCount']);
								const cumulativePnl = getMetricValue(item, ['realizedPnlTotal', 'cumulativePnl', 'totalRealizedPnl', 'r_pol_sum']);
								const cumulativeTakeProfitCount = getMetricValue(item, ['cumulativeTakeProfitCount', 'totalTakeProfitCount', 'profitCount']);
								const cumulativeStopLossCount = getMetricValue(item, ['cumulativeStopLossCount', 'totalStopLossCount', 'stopCount']);
								const unrealizedPnl = getGridUnrealizedPnl(item, currentPrice);

								return (
									<tr key={`grid_item_${item.id}`} className="cursor-pointer border-b border-[#27313D] text-white last:border-b-0 hover:bg-[#101820]" onClick={() => setTradingDetailId?.(item.id)}>
										<td className="px-4 py-3">
											<div className="font-semibold">{item.a_name || item.strategySignal || 'SQZ+GRID'}</div>
											<div className="mt-1 text-xs text-[#8B96A8]">PID {item.id ?? '-'} / {item.bunbong || '-'}</div>
										</td>
										<td className="px-4 py-3">{item.symbol || '-'}</td>
										<td className="px-4 py-3">{formatDisplayAmount(getConfiguredNotional(item))}</td>
										<td className="px-4 py-3">{getActualEntryNotional(item) > 0 ? formatDisplayAmount(getActualEntryNotional(item)) : '-'}</td>
										<td className="px-4 py-3">{getOverallStatusLabel(item)}</td>
										<td className="px-4 py-3">{getLongStatusLabel(item)}</td>
										<td className="px-4 py-3">{getShortStatusLabel(item)}</td>
										<td className="px-4 py-3">{formatDisplayPrice(currentPrice)}</td>
										<td className={`px-4 py-3 ${unrealizedPnl == null || unrealizedPnl >= 0 ? 'text-[#8EE6B5]' : 'text-[#FF8E8E]'}`}>{formatGridUnrealizedPnl(unrealizedPnl)}</td>
										<td className={`px-4 py-3 ${cumulativePnl >= 0 ? 'text-[#8EE6B5]' : 'text-[#FF8E8E]'}`}>{formatDisplayPnl(cumulativePnl)}</td>
										<td className="px-4 py-3">{formatDisplayNumber(currentRegimeTakeProfitCount)}</td>
										<td className="px-4 py-3">{formatDisplayNumber(cumulativeTakeProfitCount)} / {formatDisplayNumber(cumulativeStopLossCount)}</td>
										<td className="px-4 py-3"><StatusChip label={getOverallStatusLabel(item)} /></td>
										<td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
											<button className="rounded border border-[#494949] px-2 py-1 text-[12px] hover:bg-[#0F0F0F]" onClick={() => handleToggle(item)}>
												{isEnabled(item) ? 'OFF' : 'ON'}
											</button>
										</td>
										<td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
											<button className="rounded border border-[#494949] px-2 py-1 text-[12px] hover:bg-[#0F0F0F]" onClick={() => setTradingDetailId?.(item.id)}>
												수정
											</button>
										</td>
										<td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
											{!isEnabled(item) ? (
												<button className="rounded border border-[#494949] px-2 py-1 text-[12px] hover:bg-[#0F0F0F]" onClick={(event) => handleDelete(item, event)}>
													삭제
												</button>
											) : (
												<span className="text-[#6B7280]">-</span>
											)}
										</td>
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

export default GridTradingGridBase;
