import React from 'react';

const directionLabel = {
	up: '▲',
	down: '▼',
	flat: '-'
};

const statusLabelMap = {
	g: {
		up: '강세 강화',
		down: '강세 둔화',
		flat: '강세 유지'
	},
	y: {
		up: '중립 상승',
		down: '중립 하락',
		flat: '중립 유지'
	},
	r: {
		up: '약세 완화',
		down: '약세 심화',
		flat: '약세 유지'
	}
};

const activeColorClass = {
	g: 'bg-[#22c55e]',
	y: 'bg-[#facc15]',
	r: 'bg-[#ef4444]'
};

const glowColorClass = {
	g: 'shadow-[0_0_28px_rgba(34,197,94,0.55)]',
	y: 'shadow-[0_0_28px_rgba(250,204,21,0.45)]',
	r: 'shadow-[0_0_28px_rgba(239,68,68,0.50)]'
};

const ringColorClass = {
	g: 'border-[#22c55e]',
	y: 'border-[#facc15]',
	r: 'border-[#ef4444]'
};

const inactiveColorClass = 'bg-[#2a2a2a]';
const inactiveScaleClass = 'scale-[0.92] opacity-45';
const activeScaleClass = 'scale-[1.12]';

const TrafficLight = ({
	active = 'y',
	direction = null,
	isBlinking = false,
	score = 0
}) => {
	const statusLabel =
		direction && statusLabelMap[active]
			? statusLabelMap[active][direction]
			: active === 'g'
			? '강세'
			: active === 'r'
			? '약세'
			: '중립';

	const renderLight = (key) => {
		const isActive = active === key;

		return (
			<div className="relative flex items-center justify-center" key={key}>
				{isActive && isBlinking && (
					<div
						className={`absolute inset-0 rounded-full border-2 ${ringColorClass[key]} animate-ping opacity-45`}
					/>
				)}

				<div
					className={`relative flex items-center justify-center rounded-full transition-all duration-300
						${isActive ? activeColorClass[key] : inactiveColorClass}
						${isActive ? activeScaleClass : inactiveScaleClass}
						${isActive ? glowColorClass[key] : ''}
						w-16 h-16`}
				>
					{isActive && direction && (
						<span className="text-[#111111] text-[28px] font-black leading-none">
							{directionLabel[direction]}
						</span>
					)}
				</div>
			</div>
		);
	};

	return (
		<div className="w-full flex flex-col items-center justify-center gap-5">
			<div className="w-full max-w-[420px] flex items-center justify-center gap-7 px-8 py-7 rounded-[36px] bg-[#111111] border border-[#2d2d2d]">
				{renderLight('g')}
				{renderLight('y')}
				{renderLight('r')}
			</div>

			<div className="flex flex-col items-center gap-1.5">
				<div className="text-[15px] text-[#bdbdbd] tracking-[0.02em]">
					{statusLabel}
				</div>
				<div className="text-[22px] font-semibold text-white">
					Score {score}
				</div>
			</div>
		</div>
	);
};

export default TrafficLight;