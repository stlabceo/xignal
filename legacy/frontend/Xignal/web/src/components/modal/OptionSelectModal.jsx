import React, { useEffect, useState } from 'react';
import Radio from '../form/input/Radio';
import { DefaultModal } from './DefaultModal';

const indicatorMapping = {
	A: { second2: 10, second3: 6, second4: 6 },
	B: { second2: 14, second3: 3, second4: 3 },
	C: { second2: 5, second3: 3, second4: 3 }
};

export const OptionSelectModal = ({ isOpen, onClose, options = ['A', 'B', 'C'], onSelect, selectedOption, className }) => {
	const [curSelect, setCurSelect] = useState('');

	useEffect(() => {
		setCurSelect(selectedOption);
	}, [selectedOption]);

	return (
		<DefaultModal isOpen={isOpen} onClose={onClose} className={`p-6 px-12 ${className} w-[360px]`}>
			<h2 className="mt-1 mb-4 text-xl font-semibold text-gray-800">보조지표 옵션선택</h2>
			<div className="my-8 space-y-3">
				{options.map((opt, i) => (
					<React.Fragment key={`radio_option_${i}`}>
						<Radio
							id={`radio_option_${i}`}
							name="radio_option"
							value={opt}
							checked={curSelect === opt}
							onChange={(value) => {
								setCurSelect(value);
							}}
							label={`${opt} ${Object.values(indicatorMapping[opt]).join('/')}`}
						/>
					</React.Fragment>
				))}
			</div>
			<button
				className="bg-blue-600 text-white px-18 py-2 w-full rounded cursor-pointer"
				onClick={() => {
					onSelect(curSelect);
					onClose();
				}}
			>
				완료
			</button>
		</DefaultModal>
	);
};
