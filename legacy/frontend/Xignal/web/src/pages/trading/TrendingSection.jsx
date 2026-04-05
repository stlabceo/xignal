import { useState } from 'react';

const strategies = [
	{ number: 1, label: 'Strategy 1', aiModeLabel: 'Aggressive' },
	{ number: 2, label: 'Strategy 2', aiModeLabel: 'Moderate' },
	{ number: 3, label: 'Strategy 3', aiModeLabel: 'Conservative' }
];

function TrendingSection({ onStrategyClick }) {
	const [selectedStrategy, setSelectedStrategy] = useState(1);

	const handleCardClick = (strategyNumber, aiModeLabel) => {
		setSelectedStrategy(strategyNumber);
		if (onStrategyClick) {
			onStrategyClick({
				strategyNumber,
				aiModeLabel
			});
		}
	};

	return (
		<div className="rounded-lg bg-[#1B1B1B] p-4 md:p-5">
			<p className="mb-4 text-center text-[15px] font-semibold tracking-[0.16em] text-[#7a7a7a]">
				TRENDING
			</p>

			<div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
				{strategies.map((strategy) => (
					<div
						key={strategy.number}
						className={`cursor-pointer rounded-lg border bg-[#0F0F0F] px-5 py-5 text-center transition-all ${
							selectedStrategy === strategy.number ? 'border-[#d9d9d9]' : 'border-[#262626]'
						}`}
						onClick={() => handleCardClick(strategy.number, strategy.aiModeLabel)}
					>
						<p className="text-[13px] text-[#8a8a8a]">{strategy.label}</p>
						<p className="mt-2 text-[19px] font-bold text-white">
							{strategy.aiModeLabel} Scalping
						</p>
						<p className="mt-1.5 text-[14px] text-[#d6d6d6]">
							BTCUSDT.P / Long / 10m
						</p>
					</div>
				))}
			</div>
		</div>
	);
}

export default TrendingSection;