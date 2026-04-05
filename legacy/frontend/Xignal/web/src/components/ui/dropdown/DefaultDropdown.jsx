import { useState } from 'react';
import { Dropdown } from './Dropdown';
import { DropdownItem } from './DropdownItem';

const DefaultDropdown = ({ cur, onChange, isOpen, setIsOpen, option, className, disabled }) => {
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
				{cur}
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
					{option.map((item) => (
						<li key={`default_dropdown_item_${item}`}>
							<DropdownItem
								onItemClick={() => {
									onChange(item);
									closeDropdown();
								}}
								className="flex rounded-md px-3 py-2.5 text-sm font-medium text-[#999999] hover:text-[#fff] hover:bg-[#1B1B1B] cursor-pointer"
							>
								{item}
							</DropdownItem>
						</li>
					))}
				</ul>
			</Dropdown>
		</div>
	);
};

export default DefaultDropdown;
