import React from 'react';
import { useEffect, useRef } from 'react';

export const Dropdown = ({ isOpen, onClose, children, className = '' }) => {
	const dropdownRef = useRef();

	useEffect(() => {
		const handleClickOutside = (event) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target) && !event.target.closest('.dropdown-toggle')) {
				onClose();
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [onClose]);

	if (!isOpen) return null;

	return (
		<div ref={dropdownRef} className={`absolute z-40 shadow-theme-lg ${className}`}>
			{children}
		</div>
	);
};
