import { useState } from 'react';
import { Dropdown } from './Dropdown';
import { DropdownItem } from './DropdownItem';

const DefaultDropdown = ({ cur, onChange, isOpen, setIsOpen, option, className, disabled }) => {
	const normalizedOptions = Array.isArray(option)
		? option.map((item) => {
				if (item && typeof item === 'object' && !Array.isArray(item)) {
					const value = item.value ?? item.label ?? '';
					return {
						value,
						label: item.label ?? String(value),
						disabled: Boolean(item.disabled)
					};
				}

				return {
					value: item,
					label: item,
					disabled: false
				};
		  })
		: [];
	const selectedOption = normalizedOptions.find((item) => String(item.value) === String(cur) || String(item.label) === String(cur));
	const currentLabel = selectedOption?.label ?? cur;

	function toggleDropdown() {
		if (disabled) return;
		setIsOpen(!isOpen);
	}

	function closeDropdown() {
		setIsOpen(false);
	}

	return (
		<div className={`relative inline-block ${className}`}>
			<button
				onClick={toggleDropdown}
				className={`inline-flex items-center justify-between gap-2 w-full text-sm text-[#ffffff] dropdown-toggle shadow-theme-xs cursor-pointer ${
					disabled && 'text-gray-500'
				}`}
			>
				{currentLabel}
				<div className="text-[#494949]">
					<svg
						className={`duration-200 ease-in-out stroke-current ${isOpen ? 'rotate-180' : ''}`}
						width="20"
						height="20"
						viewBox="0 0 20 20"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M4.79199 7.396L10.0003 12.6043L15.2087 7.396"
							stroke=""
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</div>
			</button>

			<Dropdown
				isOpen={isOpen}
				onClose={closeDropdown}
				className="absolute left-[-10px] right-[-10px] top-full z-40 mt-2 rounded-md bg-[#0F0F0F] p-1"
			>
				<ul className="flex flex-col gap-1">
					{normalizedOptions.map((item, index) => (
						<li key={`default_dropdown_item_${item.value}_${index}`}>
							<DropdownItem
								onItemClick={() => {
									if (item.disabled) {
										return;
									}
									onChange(item.value);
									closeDropdown();
								}}
								className={`flex rounded-md px-3 py-2.5 text-sm font-medium ${
									item.disabled
										? 'cursor-not-allowed text-[#555555]'
										: 'cursor-pointer text-[#999999] hover:bg-[#1B1B1B] hover:text-[#fff]'
								}`}
							>
								{item.label}
							</DropdownItem>
						</li>
					))}
				</ul>
			</Dropdown>
		</div>
	);
};

export default DefaultDropdown;
