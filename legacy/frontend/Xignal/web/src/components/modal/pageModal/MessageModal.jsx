import React, { useEffect, useState } from 'react';
import { DefaultModal } from '../DefaultModal';
import Pagination from '../../ui/pagination/Pagination';
import { trading } from '../../../services/trading';
import { getDateFormat } from '../../../utils/getDateFormat';
import { useNotifyStore } from '../../../store/notifyStore';

const MessageModal = ({ isOpen, onClose, className }) => {
	const clearNewMsg = useNotifyStore((s) => s.clearNewMsg);
	const [data, setData] = useState([]);
	const [page, setPage] = useState(1);
	const [totalPage, setTotalPage] = useState(1);
	const PAGE_SIZE = 10;

	useEffect(() => {
		if (!isOpen) return;

		const params = {
			page,
			size: PAGE_SIZE
		};

		trading.msg(params, (res) => {
			clearNewMsg();
			setData(res.item);
			setTotalPage(Math.ceil(res.pageInfo.totalCount / PAGE_SIZE));
		});
	}, [isOpen, page, clearNewMsg]);

	return (
		<DefaultModal
			isOpen={isOpen}
			showCloseButton={false}
			className={`${className} flex h-[88vh] w-[94vw] max-w-[1100px] flex-col md:h-[78vh]`}
		>
			<div className="flex items-center justify-between border-b border-[#494949] p-4 md:p-5">
				<h2 className="text-[18px] font-semibold text-[#fff] md:text-[22px]">Messages</h2>
				<button
					onClick={onClose}
					className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 cursor-pointer md:h-11 md:w-11"
				>
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path
							fillRule="evenodd"
							clipRule="evenodd"
							d="M6.04289 16.5413C5.65237 16.9318 5.65237 17.565 6.04289 17.9555C6.43342 18.346 7.06658 18.346 7.45711 17.9555L11.9987 13.4139L16.5408 17.956C16.9313 18.3466 17.5645 18.3466 17.955 17.956C18.3455 17.5655 18.3455 16.9323 17.955 16.5418L13.4129 11.9997L17.955 7.4576C18.3455 7.06707 18.3455 6.43391 17.955 6.04338C17.5645 5.65286 16.9313 5.65286 16.5408 6.04338L11.9987 10.5855L7.45711 6.0439C7.06658 5.65338 6.43342 5.65338 6.04289 6.0439C5.65237 6.43442 5.65237 7.06759 6.04289 7.45811L10.5845 11.9997L6.04289 16.5413Z"
							fill="currentColor"
						/>
					</svg>
				</button>
			</div>

			<div className="flex flex-1 flex-col bg-[#0F0F0F] p-4 md:p-5">
				<div className="flex-1 overflow-y-auto">
					<div className="space-y-3 md:hidden">
						{data.map((item) => (
							<div
								key={item.id}
								className="rounded-lg border border-[#494949] bg-[#1B1B1B] p-4 text-white"
							>
								<div className="grid grid-cols-1 gap-2 text-sm">
									<div className="flex justify-between gap-4">
										<span className="text-[#828DA0]">Created At</span>
										<span className="text-right">
											{getDateFormat(new Date(item.created_at), 'YY-MM-DD hh:mm')}
										</span>
									</div>
									<div className="flex justify-between gap-4">
										<span className="text-[#828DA0]">Strategy Name</span>
										<span className="break-all text-right">{item.a_name}</span>
									</div>
									<div className="flex flex-col gap-2 rounded-md bg-[#0F0F0F] px-3 py-3">
										<span className="text-[#828DA0]">Message</span>
										<p className="break-words text-left text-white">{item.msg}</p>
									</div>
								</div>
							</div>
						))}
					</div>

					<div className="hidden md:block overflow-x-auto">
						<table className="min-w-full table-fixed overflow-hidden rounded-lg text-[16px] text-center whitespace-nowrap">
							<thead className="border-b border-[#4E5766] bg-[#1A1C22] text-[#828DA0]">
								<tr>
									<th className="w-3/12 px-5 py-4.5 font-normal">Created At</th>
									<th className="w-3/12 px-5 py-4.5 font-normal">Strategy Name</th>
									<th className="w-6/12 px-5 py-4.5 text-start font-normal">Message</th>
								</tr>
							</thead>
							<tbody>
								{data.map((item) => (
									<tr
										key={item.id}
										className="border-b border-[#494949] bg-[#1B1B1B] text-[#FFFFFF]"
									>
										<td className="px-5 py-4">
											{getDateFormat(new Date(item.created_at), 'YY-MM-DD hh:mm')}
										</td>
										<td className="px-5 py-4">{item.a_name}</td>
										<td className="px-5 py-4 text-start whitespace-normal break-words">
											{item.msg}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{data.length === 0 && (
						<div className="flex h-full min-h-[220px] items-center justify-center text-sm text-[#828DA0] md:text-base">
							No messages found.
						</div>
					)}
				</div>

				<div className="mt-4">
					<Pagination currentPage={page} totalPages={totalPage} onPageChange={(newPage) => setPage(newPage)} />
				</div>
			</div>
		</DefaultModal>
	);
};

export default MessageModal;