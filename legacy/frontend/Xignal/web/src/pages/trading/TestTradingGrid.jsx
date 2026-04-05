import React, { useCallback, useEffect, useState } from 'react';
import TradingListTable from './TestTradingListTable';
import { comma } from '../../utils/comma';
import { useAuthStore } from '../../store/authState';

const typeEnum = {
	scalping: 'Scalping',
	trend: 'Trend',
	greenlight: 'GreenLight'
};

const TestTradingGrid = ({ setTradingDetailId, listData, getListData }) => {
	const { userPrice } = useAuthStore();
	const [extremePolResults, setExtremePolResults] = useState({});

	useEffect(() => {
		if (!listData || listData.length === 0) {
			setExtremePolResults(null);
			return;
		}

		let scored = listData.map((item) => ({
			...item,
			score: (item.r_pol_sum ?? 0) - (item.r_charge ?? 0),
			leverageMargin: (item.leverage ?? 0) * (item.margin ?? 0)
		}));

		scored = scored.filter((item) => item.score !== 0);

		if (scored.length === 0) {
			setExtremePolResults(null);
			return;
		}

		const groupedByType = scored.reduce((acc, item) => {
			if (!acc[item.type]) acc[item.type] = [];
			acc[item.type].push(item);
			return acc;
		}, {});

		let maxTypeItem = null;
		let minTypeItem = null;

		Object.values(groupedByType).forEach((itemsOfType) => {
			const typeBest = itemsOfType.reduce((prev, curr) => (curr.score > prev.score ? curr : prev));
			const typeWorst = itemsOfType.reduce((prev, curr) => (curr.score < prev.score ? curr : prev));

			if (!maxTypeItem || typeBest.score > maxTypeItem.score) {
				maxTypeItem = typeBest;
			}
			if (!minTypeItem || typeWorst.score < minTypeItem.score) {
				minTypeItem = typeWorst;
			}
		});

		if (!maxTypeItem || !minTypeItem) {
			setExtremePolResults(null);
			return;
		}

		setExtremePolResults({
			max: {
				symbol: maxTypeItem.symbol,
				type: maxTypeItem.type,
				bunbong: maxTypeItem.bunbong,
				leverageMargin: maxTypeItem.leverageMargin,
				PolMinusCharge: comma(maxTypeItem.r_pol_sum - maxTypeItem.r_charge),
				score: maxTypeItem.score
			},
			min: {
				symbol: minTypeItem.symbol,
				type: minTypeItem.type,
				bunbong: minTypeItem.bunbong,
				leverageMargin: minTypeItem.leverageMargin,
				PolMinusCharge: comma(minTypeItem.r_pol_sum - minTypeItem.r_charge),
				score: minTypeItem.score
			}
		});
	}, [listData]);

	const sumLevMar = useCallback(() => {
		return listData.reduce((sum, item) => {
			if (item.status === 'EXACT') {
				const lev = Number(item.leverage) || 0;
				const mar = Number(item.margin) || 0;
				return sum + lev * mar;
			}
			return sum;
		}, 0);
	}, [listData]);

	const sumPolMinusCharge = useCallback(() => {
		return listData.reduce((sum, item) => {
			const pol = Number(item.r_pol_sum) || 0;
			const charge = Number(item.r_charge) || 0;
			return sum + (pol - charge);
		}, 0);
	}, [listData]);

	return (
		<div className="space-y-4 md:space-y-5">
			<div className="hidden md:grid grid-cols-2 gap-2 rounded-lg bg-[#1B1B1B] p-4 md:p-5 xl:grid-cols-6">
				<div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-[#0F0F0F] px-6 pb-6 pt-4">
					<p className="text-[15px] text-[#999999]">On going Setup</p>
					<p className="text-center text-[20px] text-[#ffffff]">{listData.length}Unit</p>
				</div>

				<div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-[#0F0F0F] px-6 pb-6 pt-4">
					<p className="text-[15px] text-[#999999]">Holding Position</p>
					<p className="text-center text-[20px] text-[#ffffff]">
						{comma(userPrice?.paperPrice || 0)}$ ({sumLevMar()}$)
					</p>
				</div>

				<div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-[#0F0F0F] px-6 pb-6 pt-4">
					<p className="text-[15px] text-[#999999]">Real Time Profit</p>
					<p className="text-center text-[20px] text-[#ffffff]">{comma(sumPolMinusCharge())}$</p>
				</div>

				<div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-[#0F0F0F] px-6 pb-6 pt-4">
					<p className="text-[15px] text-[#999999]">PNL</p>
					<p className="text-center text-[20px] text-[#ffffff]">{comma(sumPolMinusCharge())}$</p>
				</div>

				<div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-[#0F0F0F] px-6 pb-6 pt-4">
					<p className="text-[15px] text-[#999999]">Most Favorable Setup</p>
					{extremePolResults?.max ? (
						<p className="text-center text-[20px] text-[#ffffff]">
							{extremePolResults.max?.symbol}
							<br />
							{typeEnum[extremePolResults.max?.type]}–{extremePolResults.max?.bunbong}분
							<br />
							{extremePolResults.max?.PolMinusCharge}$
						</p>
					) : (
						<p className="text-center text-[20px] text-[#ffffff]">-</p>
					)}
				</div>

				<div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-[#0F0F0F] px-6 pb-6 pt-4">
					<p className="text-[15px] text-[#999999]">Most Adverse Setup</p>
					{extremePolResults?.min ? (
						<p className="text-center text-[20px] text-[#ffffff]">
							{extremePolResults.min?.symbol}
							<br />
							{typeEnum[extremePolResults.min?.type]}–{extremePolResults.min?.bunbong}분
							<br />
							{extremePolResults.min?.PolMinusCharge}$
						</p>
					) : (
						<p className="text-center text-[20px] text-[#ffffff]">-</p>
					)}
				</div>
			</div>

			<TradingListTable setTradingDetailId={setTradingDetailId} listData={listData} getListData={getListData} />
		</div>
	);
};

export default TestTradingGrid;
