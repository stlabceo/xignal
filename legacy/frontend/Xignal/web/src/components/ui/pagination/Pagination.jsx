import React from 'react';

const Pagination = ({ currentPage, totalPages, onPageChange, delta = 2 }) => {
	if (!totalPages || totalPages <= 1) return null;

	const clamp = (page) => Math.max(1, Math.min(totalPages, page));

	const getPageItems = () => {
		const fullWindow = 2 * delta + 5;
		if (totalPages <= fullWindow) {
			return Array.from({ length: totalPages }, (_, index) => index + 1);
		}

		const start = Math.max(2, currentPage - delta);
		const end = Math.min(totalPages - 1, currentPage + delta);
		const items = [1];

		if (start > 2) {
			items.push('left-ellipsis');
		} else {
			for (let index = 2; index < start; index += 1) {
				items.push(index);
			}
		}

		for (let index = start; index <= end; index += 1) {
			items.push(index);
		}

		if (end < totalPages - 1) {
			items.push('right-ellipsis');
		} else {
			for (let index = end + 1; index < totalPages; index += 1) {
				items.push(index);
			}
		}

		items.push(totalPages);

		return items;
	};

	const items = getPageItems();
	const baseButtonClass = 'h-9.5 w-9.5 cursor-pointer rounded-lg border border-[#494949] text-[14px]';
	const activeButtonClass = 'bg-[#1B1B1B] text-[#fff]';
	const normalButtonClass = 'bg-[#1B1B1B] text-[#999999] hover:text-[#fff]';
	const arrowButtonClass = 'flex h-9.5 w-9.5 cursor-pointer items-center justify-center rounded-lg border border-[#494949] bg-[#1B1B1B] text-[#494949] disabled:cursor-default disabled:opacity-50';

	return (
		<div className="mt-4 flex select-none items-center justify-center gap-2 text-[14px]">
			<button
				disabled={currentPage === 1}
				onClick={() => onPageChange(clamp(currentPage - 1))}
				className={arrowButtonClass}
				aria-label="이전 페이지"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-5">
					<path
						fillRule="evenodd"
						d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
						clipRule="evenodd"
					/>
				</svg>
			</button>

			{items.map((item, index) => {
				if (item === 'left-ellipsis' || item === 'right-ellipsis') {
					const jumpPage = item === 'left-ellipsis' ? clamp(currentPage - delta) : clamp(currentPage + delta);

					return (
						<button
							key={`ellipsis_${item}_${index}`}
							onClick={() => onPageChange(jumpPage)}
							className={`${baseButtonClass} text-[#999999] hover:bg-[#1B1B1B] hover:text-[#fff]`}
							aria-label={item === 'left-ellipsis' ? '이전 페이지 구간으로 이동' : '다음 페이지 구간으로 이동'}
							title={item === 'left-ellipsis' ? `-${delta} 페이지 이동` : `+${delta} 페이지 이동`}
						>
							...
						</button>
					);
				}

				const isActive = item === currentPage;

				return (
					<button
						key={`page_${item}`}
						onClick={() => onPageChange(item)}
						aria-current={isActive ? 'page' : undefined}
						className={`${baseButtonClass} ${isActive ? activeButtonClass : normalButtonClass}`}
					>
						{item}
					</button>
				);
			})}

			<button
				disabled={currentPage === totalPages}
				onClick={() => onPageChange(clamp(currentPage + 1))}
				className={arrowButtonClass}
				aria-label="다음 페이지"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-5">
					<path
						fillRule="evenodd"
						d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
						clipRule="evenodd"
					/>
				</svg>
			</button>
		</div>
	);
};

export default Pagination;
