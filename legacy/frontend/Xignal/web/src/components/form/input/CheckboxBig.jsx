import React from 'react';

const CheckboxBig = ({ label, checked, id, onChange, className = '', disabled = false }) => {
	return (
		<label className={`flex items-center space-x-3 group cursor-pointer ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
			<div className="relative w-8.5 h-8.5">
				<input
					id={id}
					type="checkbox"
					className={`w-8.5 h-8.5 appearance-none cursor-pointer border border-[#494949] rounded-md bg-[#0F0F0F] disabled:opacity-60 ${className}`}
					checked={checked}
					onChange={(e) => onChange(e.target.checked)}
					disabled={disabled}
				/>
				<div
					className={`absolute inset-0 flex items-center justify-center pointer-events-none ${
						checked ? 'text-white' : 'text-[#cdcdcd83]'
					}`}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
						<path
							fillRule="evenodd"
							d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
							clipRule="evenodd"
						/>
					</svg>
				</div>
				{/* {disabled && (
					<div className="absolute inset-0 flex items-center justify-center pointer-events-none ">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
							<path
								fillRule="evenodd"
								d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
								clipRule="evenodd"
							/>
						</svg>
					</div>
				)} */}
			</div>
			{label && <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>}
		</label>
	);
};

export default CheckboxBig;
