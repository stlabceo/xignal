import React from 'react';

const OnOffToggle = ({ isOn, setIsOn, disabled = false }) => {
	return (
		<button
			className={`w-12 h-7.5 rounded-full border transition relative ${!disabled ? 'cursor-pointer' : 'cursor-default'} ${
				isOn ? 'bg-[#FFD400] border-[#FFD400]' : 'bg-[#0F0F0F] border-2 border-[#a0a0a0]'
			}`}
			onClick={(e) => {
				e.stopPropagation();
				setIsOn(!isOn);
			}}
			disabled={disabled}
		>
			<div
				className={` rounded-full absolute top-0.5 left-0.5 transition-transform ${
					isOn ? 'w-6 h-6 bg-[#0F0F0F] translate-x-4.5' : 'w-5.5 h-5.5 bg-[#1B1B1B] border-2 border-[#a0a0a0]'
				}`}
			></div>
		</button>
	);
};

export default OnOffToggle;
