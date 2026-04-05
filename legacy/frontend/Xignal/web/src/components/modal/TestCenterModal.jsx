import React from 'react';

const CenterModal = ({ centerModalData: data }) => {
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
		<div className="grid flex-1 grid-cols-1 gap-3 rounded-lg bg-[#1B1B1B] p-3 sm:grid-cols-2 sm:gap-4 sm:p-4">
			{items.map((item) => (
				<div
					key={item.key}
					className="rounded-lg bg-[#0F0F0F] px-4 py-3 sm:px-5 sm:py-4"
				>
					<div className="flex flex-col gap-2">
						<p className="text-[13px] text-[#999999] sm:text-[15px]">{item.label}</p>
						<p className="text-[18px] font-bold text-[#ffffff] sm:text-[20px] break-all">
							{data?.[item.key]}
						</p>
					</div>
				</div>
			))}
		</div>
	);
};

export default CenterModal;