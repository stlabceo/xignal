import React from 'react';

const Pagination = ({ currentPage, totalPages, onPageChange, delta = 2 }) => {
	if (!totalPages || totalPages <= 1) return null;

	const clamp = (p) => Math.max(1, Math.min(totalPages, p));

	const getPageItems = () => {
		const fullWindow = 2 * delta + 5;
		if (totalPages <= fullWindow) {
			return Array.from({ length: totalPages }, (_, i) => i + 1);
		}

		const start = Math.max(2, currentPage - delta);
		const end = Math.min(totalPages - 1, currentPage + delta);

		const items = [1];

		if (start > 2) {
			items.push('left-ellipsis');
		} else {
			for (let i = 2; i < start; i++) items.push(i);
		}

		for (let i = start; i <= end; i++) items.push(i);

		if (end < totalPages - 1) {
			items.push('right-ellipsis');
		} else {
			for (let i = end + 1; i < totalPages; i++) items.push(i);
		}

		items.push(totalPages);

		return items;
	};

	const items = getPageItems();

	const baseBtn = 'w-9.5 h-9.5 rounded-lg border border-[#494949] cursor-pointer text-[14px]';
	const activeBtn = 'bg-[#1B1B1B] text-[#fff]';
	const normalBtn = 'bg-[#1B1B1B] text-[#999] hover:text-[#fff]';
	const arrowBtn =
		'flex items-center justify-center w-9.5 h-9.5 bg-[#1B1B1B] text-[#494949] rounded-lg border border-[#494949] cursor-pointer disabled:cursor-default disabled:opacity-50';

	return (
		<div className="flex items-center justify-center gap-2 mt-4 select-none text-[14px]">
			{/* Prev */}
			<button
				disabled={currentPage === 1}
				onClick={() => onPageChange(clamp(currentPage - 1))}
				className={arrowBtn}
				aria-label="Previous page"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-5">
					<path
						fillRule="evenodd"
						d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
						clipRule="evenodd"
					/>
				</svg>
			</button>

			{/* Pages + Ellipsis */}
			{items.map((it, idx) => {
				if (it === 'left-ellipsis' || it === 'right-ellipsis') {
					const jump = it === 'left-ellipsis' ? clamp(currentPage - delta) : clamp(currentPage + delta);
					return (
						<button
							key={`ellipsis_${it}_${idx}`}
							onClick={() => onPageChange(jump)}
							className={`${baseBtn}  text-[#999] hover:bg-[#1B1B1B]`}
							aria-label={it === 'left-ellipsis' ? 'Jump back' : 'Jump forward'}
							title={it === 'left-ellipsis' ? `-${delta} 페이지` : `+${delta} 페이지`}
						>
							…
						</button>
					);
				}

				const page = it;
				const isActive = page === currentPage;

				return (
					<button
						key={`page_${page}`}
						onClick={() => onPageChange(page)}
						aria-current={isActive ? 'page' : undefined}
						className={`${baseBtn} ${isActive ? activeBtn : normalBtn}`}
					>
						{page}
					</button>
				);
			})}

			{/* Next */}
			<button
				disabled={currentPage === totalPages}
				onClick={() => onPageChange(clamp(currentPage + 1))}
				className={arrowBtn}
				aria-label="Next page"
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
