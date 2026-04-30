import React, { useEffect, useMemo, useState } from 'react';
import { DefaultModal } from '../DefaultModal';
import Pagination from '../../ui/pagination/Pagination';
import { trading } from '../../../services/trading';
import { getDateFormat } from '../../../utils/getDateFormat';
import { useNotifyStore } from '../../../store/notifyStore';

const PAGE_SIZE = 10;

const groupDuplicateMessages = (rows = []) =>
	rows.reduce((acc, item) => {
		const lastItem = acc[acc.length - 1];
		const groupingKey = `${item.category || ''}::${item.userMessage || item.msg || ''}`;

		if (lastItem && lastItem.groupingKey === groupingKey) {
			lastItem.repeatCount += 1;
			lastItem.oldestCreatedAt = item.createdAt || item.created_at;
			return acc;
		}

		acc.push({
			...item,
			groupingKey,
			repeatCount: 1,
			oldestCreatedAt: item.createdAt || item.created_at
		});
		return acc;
	}, []);

const getSeverityClass = (severity) => {
	const normalized = String(severity || '').toUpperCase();
	if (normalized === 'CRITICAL') return 'bg-red-500/15 text-red-200 border-red-500/30';
	if (normalized === 'WARN') return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
	return 'bg-sky-500/15 text-sky-200 border-sky-500/30';
};

const MessageModal = ({ isOpen, onClose, className }) => {
	const clearNewMsg = useNotifyStore((s) => s.clearNewMsg);
	const [data, setData] = useState([]);
	const [page, setPage] = useState(1);

	useEffect(() => {
		if (!isOpen) return;

		trading.userFacingMessages({ limit: 100 }, (res) => {
			clearNewMsg();
			setData(Array.isArray(res) ? res : []);
			setPage(1);
		});
	}, [clearNewMsg, isOpen]);

	const groupedData = useMemo(() => groupDuplicateMessages(data), [data]);
	const totalPage = Math.max(1, Math.ceil(groupedData.length / PAGE_SIZE));
	const pageRows = groupedData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

	return (
		<DefaultModal
			isOpen={isOpen}
			showCloseButton={false}
			className={`${className} flex h-[88vh] w-[94vw] max-w-[1100px] flex-col md:h-[78vh]`}
		>
			<div className="flex items-center justify-between border-b border-[#494949] p-4 md:p-5">
				<div>
					<h2 className="text-[18px] font-semibold text-[#fff] md:text-[22px]">알림</h2>
					<p className="mt-1 text-sm text-[#8B96A8]">Binance 조치가 필요한 메시지만 표시합니다.</p>
				</div>
				<button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 md:h-11 md:w-11">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path fillRule="evenodd" clipRule="evenodd" d="M6.04289 16.5413C5.65237 16.9318 5.65237 17.565 6.04289 17.9555C6.43342 18.346 7.06658 18.346 7.45711 17.9555L11.9987 13.4139L16.5408 17.956C16.9313 18.3466 17.5645 18.3466 17.955 17.956C18.3455 17.5655 18.3455 16.9323 17.955 16.5418L13.4129 11.9997L17.955 7.4576C18.3455 7.06707 18.3455 6.43391 17.955 6.04338C17.5645 5.65286 16.9313 5.65286 16.5408 6.04338L11.9987 10.5855L7.45711 6.0439C7.06658 5.65338 6.43342 5.65338 6.04289 6.0439C5.65237 6.43442 5.65237 7.06759 6.04289 7.45811L10.5845 11.9997L6.04289 16.5413Z" fill="currentColor" />
					</svg>
				</button>
			</div>

			<div className="flex flex-1 flex-col bg-[#0F0F0F] p-4 md:p-5">
				<div className="flex-1 overflow-y-auto">
					<div className="space-y-3">
						{pageRows.map((item) => (
							<div key={`${item.id}-${item.groupingKey}`} className="rounded-lg border border-[#494949] bg-[#1B1B1B] p-4 text-white">
								<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
									<div>
										<div className="flex flex-wrap items-center gap-2">
											<span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getSeverityClass(item.severity)}`}>
												{item.severity || 'INFO'}
											</span>
											<span className="text-xs text-[#8B96A8]">{item.category || 'BINANCE'}</span>
											{item.repeatCount > 1 ? <span className="rounded-full bg-[#3A2514] px-2 py-1 text-[11px] text-[#FFD6A5]">x{item.repeatCount}</span> : null}
										</div>
										<p className="mt-3 text-[15px] font-semibold">{item.userMessage || item.msg || '-'}</p>
										{item.actionText ? <p className="mt-2 text-sm text-[#B8C1CF]">{item.actionText}</p> : null}
									</div>
									<div className="text-right text-xs text-[#8B96A8]">
										<p>{getDateFormat(new Date(item.createdAt || item.created_at), 'YY-MM-DD hh:mm')}</p>
										{item.rawStatus ? <p className="mt-1">status {item.rawStatus}</p> : null}
									</div>
								</div>
							</div>
						))}
					</div>

					{pageRows.length === 0 && (
						<div className="flex h-full min-h-[220px] items-center justify-center text-sm text-[#828DA0] md:text-base">
							현재 사용자 조치가 필요한 Binance 메시지가 없습니다.
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
