import { useState } from 'react';

const strategies = [
	{ number: 1, label: '전략 1', aiModeLabel: 'Aggressive', title: '공격형 스캘핑' },
	{ number: 2, label: '전략 2', aiModeLabel: 'Moderate', title: '중립형 스캘핑' },
	{ number: 3, label: '전략 3', aiModeLabel: 'Conservative', title: '보수형 스캘핑' }
];

function TrendingSection({ onStrategyClick }) {
	const [selectedStrategy, setSelectedStrategy] = useState(1);

	const handleCardClick = (strategy) => {
		setSelectedStrategy(strategy.number);
		if (onStrategyClick) {
			onStrategyClick({
				strategyNumber: strategy.number,
				aiModeLabel: strategy.aiModeLabel,
				title: strategy.title
			});
		}
	};

	return (
		<div className="rounded-lg bg-[#1B1B1B] p-4 md:p-5">
			<p className="mb-4 text-center text-[15px] font-semibold tracking-[0.16em] text-[#7a7a7a]">빠른 전략</p>

			<div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
				{strategies.map((strategy) => (
					<div
						key={strategy.number}
						className={`cursor-pointer rounded-lg border bg-[#0F0F0F] px-5 py-5 text-center transition-all ${
							selectedStrategy === strategy.number ? 'border-[#d9d9d9]' : 'border-[#262626]'
						}`}
						onClick={() => handleCardClick(strategy)}
					>
						<p className="text-[13px] text-[#8a8a8a]">{strategy.label}</p>
						<p className="mt-2 text-[19px] font-bold text-white">{strategy.title}</p>
						<p className="mt-1.5 text-[14px] text-[#d6d6d6]">BTCUSDT.P / 매수 / 10분봉</p>
					</div>
				))}
			</div>
		</div>
	);
}

export default TrendingSection;
