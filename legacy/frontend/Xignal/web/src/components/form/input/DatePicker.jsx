import React, { useRef } from 'react';
import CalendarIcon from '../../../assets/icon/calander.png';

const DatePicker = ({ className, date, setDate }) => {
	const inputRef = useRef(null);

	const handleClick = () => {
		inputRef.current?.showPicker();
	};

	return (
		<div className={`flex relative items-center ${className} bg-[#0F0F0F]`}>
			<span className="flex items-center justify-center px-2.5 h-10 text-[#999999] pointer-events-none border border-[#494949] border-r-0 rounded-s-lg">
				<img src={CalendarIcon} alt="" />
			</span>
			<button
				onClick={handleClick}
				className="h-10 w-[120px] rounded-e-lg border appearance-none text-sm shadow-theme-xs focus:outline-hidden focus:ring-3  dark:bg-gray-900 bg-transparent text-[#999999] border-[#494949] focus:border-brand-300 focus:ring-brand-500/20"
			>
				<span>{date}</span>
				<input
					ref={inputRef}
					type="date"
					className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
					onChange={(e) => {
						setDate(e.target.value);
					}}
				/>
			</button>
		</div>
	);
};

export default DatePicker;
