const Radio = ({ id, name, value, checked, label, onChange, className = '', disabled = false }) => {
	return (
		<label htmlFor={id} className={`relative flex cursor-pointer  select-none items-center gap-3 text-sm font-normal ${className}`}>
			<input
				id={id}
				name={name}
				type="radio"
				value={value}
				checked={checked}
				onChange={() => !disabled && onChange(value)} // Prevent onChange when disabled
				className="sr-only"
				disabled={disabled} // Disable input
			/>
			<span
				className={`flex h-5 w-5 items-center justify-center rounded-full border-[1.25px] ${
					checked ? 'border-[#494949] bg-[#0F0F0F]' : 'bg-transparent border-[#494949] dark:border-gray-700'
				} ${disabled ? 'bg-gray-100 dark:bg-gray-700 border-[#494949] dark:border-gray-700' : ''}`}
			>
				<span className={`h-2 w-2 rounded-full  ${checked ? 'bg-[#ffffff]' : ''}`}></span>
			</span>
			{label}
		</label>
	);
};

export default Radio;
