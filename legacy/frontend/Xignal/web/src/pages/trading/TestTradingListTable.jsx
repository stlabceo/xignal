import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OnOffToggle from '../../components/ui/toggle/OnOffToggle';
import { comma, formatPrice } from '../../utils/comma';
import { trading } from '../../services/trading';

const statusNameEnum = {
	READY: 'Ready',
	EXACT_WAIT: 'Entry Pending',
	EXACT: 'Exit Pending',
	CANCEL_WAIT: 'Entry Pending',
	CANCEL: 'Ready',
	PROFIT: 'Profit Closed',
	STOP: 'Stop Closed',
	FORCING: 'Force Exit',
	FORCING_WAIT: 'Force Exit Pending',
	CLOSE: 'Closed'
};

const typeEnum = {
	scalping: 'Scalping',
	trend: 'Trend',
	greenlight: 'GreenLight'
};

const signalTypeEnum = {
	BUY: 'Buy',
	SELL: 'Sell',
	TWO: 'Combined'
};

const aiTypeEnum = {
	attack: 'Aggressive',
	neutral: 'Neutral',
	conser: 'Conservative'
};

const TestTradingListTable = ({ setTradingDetailId, listData: data, getListData }) => {
	const [buySellDataList, setBuySellDataList] = useState({});
	const [activeTab, setActiveTab] = useState('ON');
	const reqIdRef = useRef(0);

	useEffect(() => {
		if (!data || data.length === 0) return;

		const symbols = [...new Set(data.map((d) => d.symbol))];
		const params = { symbols, live: 'Y' };
		const reqId = ++reqIdRef.current;

		trading.livePrice(params, (res) => {
			if (reqId !== reqIdRef.current) return;
			if (res === false) return;
			setBuySellDataList((prev) => ({ ...prev, ...res }));
		});
	}, [data]);

	const filteredData = useMemo(() => {
		return data.filter((item) => {
			if (activeTab === 'ON') return item.autoST === 'Y';
			return item.autoST !== 'Y';
		});
	}, [data, activeTab]);

	const sumRealizedProfit = useCallback(() => {
		return filteredData.reduce((sum, item) => {
			const pol = Number(item.r_pol_sum) || 0;
			const charge = Number(item.r_charge) || 0;
			return sum + (pol - charge);
		}, 0);
	}, [filteredData]);

	const handleAutoToggle = (id, st) => {
		const body = {
			id,
			st: st ? 'Y' : 'N'
		};
		const params = {
			live: 'Y'
		};

		trading.testAutoItem(body, params, () => {
			getListData();
		});
	};

	const handleDelete = (id) => {
		console.log('Delete pending backend protocol:', id);
	};

	const getEntryPrice = (item) => {
		if (item.status === 'EXACT_WAIT') {
			return comma(formatPrice(item.r_signalPrice));
		}
		if (item.status === 'EXACT' || item.status === 'FORCING' || item.status === 'FORCING_WAIT') {
			return comma(formatPrice(item.r_exactPrice));
		}
		return '-';
	};

	const getSize = (item) => {
		return item.r_qty ? comma(item.r_qty) : '-';
	};

	const getTrailingStop = (item) => {
		return item.t_chase ? `${item.t_chase}%` : '-';
	};

	const getRoi = (item) => {
		const roi = Number(item.r_pol_tick);
		if (Number.isNaN(roi)) return '-';
		return `${comma(roi)}%`;
	};

	const getRealizedProfit = (item) => {
		return `${comma((Number(item.r_pol_sum) || 0) - (Number(item.r_charge) || 0))}$`;
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => setActiveTab('ON')}
					className={`cursor-pointer rounded-md border px-4 py-2 text-sm ${
						activeTab === 'ON'
							? 'border-white bg-white text-black'
							: 'border-[#4E5766] bg-[#1A1C22] text-[#b0b0b0]'
					}`}
				>
					ON
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('OFF')}
					className={`cursor-pointer rounded-md border px-4 py-2 text-sm ${
						activeTab === 'OFF'
							? 'border-white bg-white text-black'
							: 'border-[#4E5766] bg-[#1A1C22] text-[#b0b0b0]'
					}`}
				>
					OFF
				</button>
			</div>

			<div className="space-y-3 md:hidden">
				{filteredData.length === 0 ? (
					<div className="rounded-lg border border-[#2d3340] bg-[#1A1C22] px-4 py-6 text-center text-sm text-[#9aa3b2]">
						No strategies to display.
					</div>
				) : (
					filteredData.map((item) => (
						<div
							key={`mobile_test_trading_list_item_${item.id}`}
							className="rounded-lg border border-[#2d3340] bg-[#1A1C22] p-4 text-white"
							onClick={() => {
								setTradingDetailId(item.id);
							}}
						>
							<div className="flex items-start justify-between gap-3">
								<div>
									<p className="text-[12px] text-[#8b94a3]">Order No. {item.id ?? '-'}</p>
									<p className="mt-1 text-[16px] font-semibold">{item.symbol || '-'}</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-2.5 py-1 text-[12px] text-[#d7dbe3]">
									{statusNameEnum[item.status] || item.status}
								</div>
							</div>

							<div className="mt-3 grid grid-cols-2 gap-2">
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">Direction</p>
									<p className="mt-1 text-[14px]">{signalTypeEnum[item.signalType] || '-'}</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">Strategy</p>
									<p className="mt-1 text-[14px]">{typeEnum[item.type] || '-'}</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">AI Type</p>
									<p className="mt-1 text-[14px]">{aiTypeEnum[item.AI_ST] || '-'}</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">Entry Price</p>
									<p className="mt-1 text-[14px]">{getEntryPrice(item)}</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">Bid / Ask</p>
									<p className="mt-1 text-[14px]">
										{comma(buySellDataList[item.symbol]?.bestBid)} / {comma(buySellDataList[item.symbol]?.bestAsk)}
									</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">Margin / Lev</p>
									<p className="mt-1 text-[14px]">
										{comma(item.margin)}$ / {item.leverage}X
									</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">TP / SL</p>
									<p className="mt-1 text-[14px]">
										{item.profit ? `${item.profit}%` : '-'} / {item.stopLoss ? `${item.stopLoss}%` : '-'}
									</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">Trailing Stop</p>
									<p className="mt-1 text-[14px]">{getTrailingStop(item)}</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">Size</p>
									<p className="mt-1 text-[14px]">{getSize(item)}</p>
								</div>
								<div className="rounded-md bg-[#0F0F0F] px-3 py-2">
									<p className="text-[11px] text-[#7f8898]">ROI / Profit</p>
									<p className="mt-1 text-[14px]">
										{getRoi(item)} / {getRealizedProfit(item)}
									</p>
								</div>
							</div>

							<div
								className="mt-3 flex items-center justify-between rounded-md bg-[#0F0F0F] px-3 py-3"
								onClick={(e) => {
									e.stopPropagation();
								}}
							>
								<div className="text-[13px] text-[#cfd5df]">Order On/Off</div>
								<OnOffToggle
									isOn={item.autoST === 'Y'}
									setIsOn={(value) => handleAutoToggle(item.id, value)}
									disabled={item.status === 'CLOSE'}
								/>
							</div>

							{activeTab === 'OFF' && (
								<div
									className="mt-2 flex justify-end"
									onClick={(e) => {
										e.stopPropagation();
									}}
								>
									<button
										type="button"
										className="cursor-pointer rounded-md border border-[#4b4b4b] bg-[#121212] px-4 py-2 text-xs text-white hover:bg-[#2a2a2a]"
										onClick={() => handleDelete(item.id)}
									>
										Delete
									</button>
								</div>
							)}
						</div>
					))
				)}

				<div className="rounded-lg bg-[#321F21] px-4 py-3 text-white">
					<div className="flex items-center justify-between">
						<span className="text-[13px] text-[#d5d5d5]">Total</span>
						<span className="text-[16px] font-bold">{comma(sumRealizedProfit())}$</span>
					</div>
				</div>
			</div>

			<div className="hidden w-full overflow-x-auto rounded-lg shadow-[0_0_5px_rgba(0,0,0,0.1)] md:block">
				<table className="table-fixed min-w-[2200px] whitespace-nowrap text-center text-sm">
					<thead className="border-b border-[#4E5766] bg-[#1A1C22] font-bold text-[#828DA0]">
						<tr>
							<th className="px-4 py-4">Order No.</th>
							<th className="px-4 py-4">Symbol</th>
							<th className="px-4 py-4">Long / Short</th>
							<th className="px-4 py-4">Strategy</th>
							<th className="px-4 py-4">AI Type</th>
							<th className="px-4 py-4">Bid Price</th>
							<th className="px-4 py-4">Ask Price</th>
							<th className="px-4 py-4">Entry Price</th>
							<th className="px-4 py-4">Status</th>
							<th className="px-4 py-4">Margin</th>
							<th className="px-4 py-4">Leverage</th>
							<th className="px-4 py-4">Size</th>
							<th className="px-4 py-4">Trailing Stop</th>
							<th className="px-4 py-4">Take Profit</th>
							<th className="px-4 py-4">Stop Loss</th>
							<th className="px-4 py-4">PnL (ROI%)</th>
							<th className="px-4 py-4">Realized Profit</th>
							{activeTab === 'OFF' && <th className="px-4 py-4">Delete</th>}
							<th className="px-4 py-4">Order On/Off</th>
						</tr>
					</thead>

					<tbody>
						{filteredData.map((item, idx) => (
							<tr
								key={`test_trading_list_item_${idx}`}
								className="cursor-pointer border-b border-[#4E5766] text-[#ffffff] hover:bg-[#14161b]"
								onClick={() => {
									setTradingDetailId(item.id);
								}}
							>
								<td className="px-4 py-4">{item.id ?? '-'}</td>
								<td className="px-4 py-4">{item.symbol}</td>
								<td className="px-4 py-4">{signalTypeEnum[item.signalType] || '-'}</td>
								<td className="px-4 py-4">{typeEnum[item.type] || '-'}</td>
								<td className="px-4 py-4">{aiTypeEnum[item.AI_ST] || '-'}</td>
								<td className="px-4 py-4">{comma(buySellDataList[item.symbol]?.bestBid)}</td>
								<td className="px-4 py-4">{comma(buySellDataList[item.symbol]?.bestAsk)}</td>
								<td className="px-4 py-4">{getEntryPrice(item)}</td>
								<td className="px-4 py-4">{statusNameEnum[item.status] || item.status}</td>
								<td className="px-4 py-4">{comma(item.margin)}$</td>
								<td className="px-4 py-4">{item.leverage}X</td>
								<td className="px-4 py-4">{getSize(item)}</td>
								<td className="px-4 py-4">{getTrailingStop(item)}</td>
								<td className="px-4 py-4">{item.profit ? `${item.profit}%` : '-'}</td>
								<td className="px-4 py-4">{item.stopLoss ? `${item.stopLoss}%` : '-'}</td>
								<td className="px-4 py-4">{getRoi(item)}</td>
								<td className="px-4 py-4">{getRealizedProfit(item)}</td>
								{activeTab === 'OFF' && (
									<td
										className="px-4 py-4"
										onClick={(e) => {
											e.stopPropagation();
										}}
									>
										<button
											type="button"
											className="cursor-pointer rounded-md border border-[#4b4b4b] bg-[#121212] px-4 py-1.5 text-xs text-white hover:bg-[#2a2a2a]"
											onClick={() => handleDelete(item.id)}
										>
											Delete
										</button>
									</td>
								)}
								<td
									className="px-4 py-4"
									onClick={(e) => {
										e.stopPropagation();
									}}
								>
									<OnOffToggle
										isOn={item.autoST === 'Y'}
										setIsOn={(value) => handleAutoToggle(item.id, value)}
										disabled={item.status === 'CLOSE'}
									/>
								</td>
							</tr>
						))}

						<tr className="bg-[#321F21] font-normal text-[#FFFFFF]">
							<td className="px-4 py-4">Total</td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4"></td>
							<td className="px-4 py-4 font-bold text-[16px]">{comma(sumRealizedProfit())}$</td>
							{activeTab === 'OFF' && <td className="px-4 py-4"></td>}
							<td className="px-4 py-4"></td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default TestTradingListTable;
