import React, { useEffect, useState } from 'react';
import { comma } from '../../utils/comma';

const CenterModal = ({ centerModalData }) => {
	const [data, setData] = useState({
		prev: {},
		cur: {}
	});

	useEffect(() => {
		setData({
			prev: centerModalData?.[1] || {},
			cur: centerModalData?.[0] || {}
		});
	}, [centerModalData]);

	const getChangeText = (current, previous) => {
		const safePrev = Number(previous) || 0;
		const safeCur = Number(current) || 0;
		const diff = safePrev !== 0 ? ((safeCur - safePrev) / Math.abs(safePrev)) * 100 : 0;
		const isUp = safeCur > safePrev;

		return {
			className: isUp ? 'text-[#ED4555]' : 'text-[#00ad85]',
			text: `${isUp ? '+' : ''}${comma(diff)}% ${isUp ? 'UP' : 'DN'}`
		};
	};

	const items = [
		{ label: 'BBW', key: 'BBW_NOW' },
		{ label: 'Vol Z-Score', key: 'Vol_Z_score' },
		{ label: 'RSI', key: 'RSI' },
		{ label: 'RSI Slope', key: 'RSI_Slope' },
		{ label: 'ATR', key: 'ATR' },
		{ label: 'Standard Deviation', key: 'STD_DEV' },
		{ label: 'Resistance LV1', key: 'F_UP_LV1' },
		{ label: 'Resistance LV2', key: 'F_UP_LV2' },
		{ label: 'Support LV1', key: 'F_DN_LV1' },
		{ label: 'Support LV2', key: 'F_DN_LV2' },
		{ label: 'CC (with BTC)', key: 'CC_BTC' },
		{ label: 'CC (with ETH)', key: 'CC_ETH' }
	];

	return (
		<>
			{data.prev?.BBW_NOW && (
				<div className="grid flex-1 grid-cols-1 gap-3 rounded-lg bg-[#1B1B1B] p-3 sm:grid-cols-2 sm:gap-4 sm:p-4">
					{items.map((item) => {
						const change = getChangeText(data.cur?.[item.key], data.prev?.[item.key]);

						return (
							<div
								key={item.key}
								className="rounded-lg bg-[#0F0F0F] px-4 py-3 sm:px-5 sm:py-4"
							>
								<div className="flex flex-col gap-2">
									<p className="text-[13px] text-[#999999] sm:text-[15px]">{item.label}</p>

									<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
										<p className="text-[18px] font-bold text-[#ffffff] sm:text-[20px] break-all">
											{data.cur?.[item.key]}
										</p>
										<span className={`text-[12px] sm:text-[14px] ${change.className}`}>
											{change.text}
										</span>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</>
	);
};

export default CenterModal;