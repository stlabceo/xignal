import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import DatePicker from '../../components/form/input/DatePicker';
import Pagination from '../../components/ui/pagination/Pagination';
import { trading } from '../../services/trading';
import { getDateFormat } from '../../utils/getDateFormat';
import { comma } from '../../utils/comma';

const PAGE_SIZE = 10;

const toNumber = (value, fallback = 0) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
};

const formatDateTime = (value) => {
	if (!value) return '-';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '-';
	return getDateFormat(date, 'YYYY.MM.DD hh:mm:ss');
};

const formatPnl = (value) => {
	if (value === null || value === undefined) return '집계 불가';
	const numeric = toNumber(value);
	const rounded = Number(numeric.toFixed(8));
	return `${rounded >= 0 ? '+' : ''}${comma(rounded)} USDT`;
};

const formatPct = (value) => {
	if (value === null || value === undefined) return '-';
	return `${toNumber(value).toFixed(2)}%`;
};

const formatWinRate = (value) => `${toNumber(value).toFixed(1)}%`;

const formatBunbong = (value) => {
	const raw = String(value || '').trim().toUpperCase();
	if (!raw) return '-';
	if (raw.endsWith('MIN')) return `${raw.slice(0, -3)}분`;
	return raw;
};

const getResultBadgeClass = (item) => {
	const result = String(item.result || '').toUpperCase();
	if (result === 'WIN') return 'border-[#2A5C44] bg-[#0D1F17] text-[#94E2B7]';
	if (result === 'LOSS') return 'border-[#7A2E2E] bg-[#2A1111] text-[#FF8E8E]';
	if (result === 'REVIEW') return 'border-[#6A5322] bg-[#21180A] text-[#FFD97A]';
	if (result === 'OPEN') return 'border-[#294B7A] bg-[#0B1628] text-[#9AC5FF]';
	return 'border-[#3A4655] bg-[#111827] text-[#D8E0ED]';
};

const getResultLabel = (item) => {
	const result = String(item.result || '').toUpperCase();
	if (result === 'WIN') return '수익';
	if (result === 'LOSS') return '손실';
	if (result === 'BREAKEVEN') return '본전';
	if (result === 'OPEN') return '진행중';
	if (result === 'REVIEW') return '확인 필요';
	return item.overallResultLabel || '-';
};

const getCategoryLabel = (item) => item.strategyCategoryLabel || item.processKindLabel || '-';

const SummaryCard = ({ label, value, tone = 'default', helper }) => {
	const toneClass =
		tone === 'profit'
			? 'text-[#94E2B7]'
			: tone === 'danger'
				? 'text-[#FF8E8E]'
				: 'text-white';

	return (
		<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] px-4 py-4">
			<p className="text-[12px] text-[#8b94a3]">{label}</p>
			<p className={`mt-2 text-[22px] font-semibold ${toneClass}`}>{value}</p>
			{helper ? <p className="mt-2 text-[11px] text-[#697386]">{helper}</p> : null}
		</div>
	);
};

const TradeHistoryPage = ({ mode = 'live' }) => {
	const navigate = useNavigate();
	const [items, setItems] = useState([]);
	const [summary, setSummary] = useState({
		totalRealizedPnl: 0,
		completedCount: 0,
		activeCount: 0,
		reviewCount: 0,
		winRate: 0,
		averageWin: null,
		averageLoss: null
	});
	const [sd, setSd] = useState('');
	const [ed, setEd] = useState('');
	const [page, setPage] = useState(1);
	const [pageInfo, setPageInfo] = useState({
		page: 1,
		size: PAGE_SIZE,
		totalCount: 0,
		totalPage: 1
	});
	const [tab, setTab] = useState('completed');

	const isDemoMode = mode === 'test';
	const detailPathPrefix = isDemoMode ? '/test/trade-history' : '/trade-history';
	const trackRecordRequester = isDemoMode ? trading.getTestRuntimeTrackRecord : trading.getRuntimeTrackRecord;

	useEffect(() => {
		const today = new Date();
		const oneMonthAgo = new Date();
		oneMonthAgo.setMonth(today.getMonth() - 1);

		setSd(oneMonthAgo.toISOString().slice(0, 10));
		setEd(today.toISOString().slice(0, 10));
	}, []);

	useEffect(() => {
		setPage(1);
	}, [tab]);

	useEffect(() => {
		if (!sd || !ed) return;

		trackRecordRequester(
			{
				status: tab,
				page,
				size: PAGE_SIZE,
				sDate: sd,
				eDate: ed
			},
			(res) => {
				if (res === false) return;

				setItems(Array.isArray(res?.items) ? res.items : []);
				setSummary({
					totalRealizedPnl: toNumber(res?.summary?.totalRealizedPnl),
					completedCount: toNumber(res?.summary?.completedCount),
					activeCount: toNumber(res?.summary?.activeCount),
					reviewCount: toNumber(res?.summary?.reviewCount ?? res?.summary?.abnormalCount),
					winRate: toNumber(res?.summary?.winRate),
					averageWin: res?.summary?.averageWin ?? null,
					averageLoss: res?.summary?.averageLoss ?? null
				});
				setPageInfo({
					page: toNumber(res?.pageInfo?.page, 1),
					size: toNumber(res?.pageInfo?.size, PAGE_SIZE),
					totalCount: toNumber(res?.pageInfo?.totalCount, 0),
					totalPage: Math.max(1, toNumber(res?.pageInfo?.totalPage, 1))
				});
			}
		);
	}, [ed, page, sd, tab, trackRecordRequester]);

	const summaryTone = useMemo(
		() => (summary.totalRealizedPnl >= 0 ? 'profit' : 'danger'),
		[summary.totalRealizedPnl]
	);

	const tabs = [
		{ key: 'completed', label: '완료' },
		{ key: 'active', label: '진행중' },
		{ key: 'review', label: '확인 필요' }
	];

	return (
		<div className="inner-container">
			<div className="mb-5 flex flex-col gap-3 md:mb-5.5 md:flex-row md:items-center md:gap-4">
				<h2 className="text-[26px] font-bold text-white md:text-[32px]">Track Record</h2>
				<div className="flex items-center gap-2">
					{isDemoMode ? (
						<>
							<button type="button" className="rounded-sm border border-[#494949] px-2 text-[14px] font-bold text-white md:text-[16px]" onClick={() => navigate('/trade-history')}>
								TRADING
							</button>
							<div className="rounded-sm bg-white px-2 text-[14px] font-bold text-black md:text-[16px]">DEMO</div>
						</>
					) : (
						<>
							<div className="rounded-sm bg-white px-2 text-[14px] font-bold text-black md:text-[16px]">TRADING</div>
							<button type="button" className="rounded-sm border border-[#494949] px-2 text-[14px] font-bold text-white md:text-[16px]" onClick={() => navigate('/test/trade-history')}>
								DEMO
							</button>
						</>
					)}
				</div>
			</div>

			<div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
				<SummaryCard label="누적 실현손익" value={formatPnl(summary.totalRealizedPnl)} tone={summaryTone} />
				<SummaryCard label="완료 거래 수" value={`${comma(summary.completedCount)}건`} />
				<SummaryCard label="진행 중 거래 수" value={`${comma(summary.activeCount)}건`} />
				<SummaryCard label="승률" value={formatWinRate(summary.winRate)} />
				<SummaryCard label="평균 수익" value={formatPnl(summary.averageWin)} tone="profit" />
				<SummaryCard label="평균 손실" value={formatPnl(summary.averageLoss)} tone="danger" />
				<SummaryCard label="확인 필요" value={`${comma(summary.reviewCount)}건`} helper="성과 기록과 분리" />
			</div>

			<div className="mb-5 flex flex-col gap-3 rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4 md:flex-row md:items-center md:justify-between">
				<div className="flex gap-2">
					{tabs.map((item) => (
						<button
							key={item.key}
							type="button"
							className={`rounded-md border px-4 py-2 text-sm ${
								tab === item.key ? 'border-white bg-white text-black' : 'border-[#4E5766] bg-[#1A1C22] text-[#b0b0b0]'
							}`}
							onClick={() => setTab(item.key)}
						>
							{item.label}
						</button>
					))}
				</div>

				<div className="flex flex-col gap-2 text-sm text-white sm:flex-row sm:flex-wrap sm:items-center">
					<div className="min-w-0 flex-1 sm:flex-none">
						<DatePicker date={sd} setDate={setSd} />
					</div>
					<span className="hidden sm:inline">~</span>
					<div className="min-w-0 flex-1 sm:flex-none">
						<DatePicker date={ed} setDate={setEd} />
					</div>
				</div>
			</div>

			<div className="space-y-3 md:hidden">
				{items.length === 0 ? (
					<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4 text-center text-[#999999]">
						조회된 성과 기록이 없습니다.
					</div>
				) : (
					items.map((item) => (
						<div key={`runtime_track_mobile_${item.id}`} className="cursor-pointer rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4 text-white" onClick={() => navigate(`${detailPathPrefix}/${item.id}`)}>
							<div className="flex items-start justify-between gap-3">
								<div>
									<p className="text-[12px] text-[#8b94a3]">PID {item.pid} / {item.seriesLabel || '-'} / LOG {item.id}</p>
									<p className="mt-1 text-[16px] font-semibold">{item.strategyName}</p>
									<p className="mt-1 text-[12px] text-[#aeb7c6]">
										{getCategoryLabel(item)} / {item.symbol} / {item.directionLabel}
									</p>
								</div>
								<div className={`rounded-full border px-2.5 py-1 text-[12px] ${getResultBadgeClass(item)}`}>
									{getResultLabel(item)}
								</div>
							</div>

							<div className="mt-3 grid grid-cols-1 gap-2 text-sm">
								<div className="flex justify-between gap-4"><span className="text-[#828DA0]">종료 시각</span><span>{formatDateTime(item.completedAt || item.webhookOccurredAt)}</span></div>
								<div className="flex justify-between gap-4"><span className="text-[#828DA0]">타임프레임</span><span>{formatBunbong(item.bunbong)}</span></div>
								<div className="flex justify-between gap-4"><span className="text-[#828DA0]">처리 요약</span><span className="text-right">{item.summaryText || '-'}</span></div>
								<div className="flex justify-between gap-4"><span className="text-[#828DA0]">실현손익</span><span className={toNumber(item.realizedPnl) >= 0 ? 'text-[#94E2B7]' : 'text-[#FF8E8E]'}>{formatPnl(item.realizedPnl)}</span></div>
							</div>
						</div>
					))
				)}
			</div>

			<div className="hidden overflow-x-auto rounded-lg border border-[#2d3340] bg-[#1B1B1B] md:block">
				<table className="min-w-[1280px] table-fixed whitespace-nowrap text-center text-sm text-white">
					<thead className="border-b border-[#4E5766] bg-[#1A1C22] font-semibold text-[#828DA0]">
						<tr>
							<th className="px-4 py-4">종료 시각</th>
							<th className="px-4 py-4">전략</th>
							<th className="px-4 py-4">종목 / 방향</th>
							<th className="px-4 py-4">투자금</th>
							<th className="px-4 py-4">진입가</th>
							<th className="px-4 py-4">청산가</th>
							<th className="px-4 py-4">실현손익</th>
							<th className="px-4 py-4">수익률</th>
							<th className="px-4 py-4">결과</th>
							<th className="px-4 py-4">처리 요약</th>
						</tr>
					</thead>
					<tbody>
						{items.length === 0 ? (
							<tr>
								<td className="px-4 py-8 text-[#9aa3b2]" colSpan={10}>
									조회된 성과 기록이 없습니다.
								</td>
							</tr>
						) : (
							items.map((item) => (
								<tr key={`runtime_track_row_${item.id}`} className="cursor-pointer border-b border-[#232323] hover:bg-[#14161b]" onClick={() => navigate(`${detailPathPrefix}/${item.id}`)}>
									<td className="px-4 py-4">{formatDateTime(item.completedAt || item.webhookOccurredAt)}</td>
									<td className="px-4 py-4">
										<div className="flex flex-col">
											<span>{item.strategyName}</span>
											<span className="text-[12px] text-[#8b94a3]">PID {item.pid} / {formatBunbong(item.bunbong)}</span>
										</div>
									</td>
									<td className="px-4 py-4">{item.symbol} / {item.directionLabel}</td>
									<td className="px-4 py-4">{comma(toNumber(item.tradeAmount))} USDT</td>
									<td className="px-4 py-4">{item.entryAvgPrice ? comma(item.entryAvgPrice) : '-'}</td>
									<td className="px-4 py-4">{item.exitAvgPrice ? comma(item.exitAvgPrice) : '-'}</td>
									<td className={`px-4 py-4 ${toNumber(item.realizedPnl) >= 0 ? 'text-[#94E2B7]' : 'text-[#FF8E8E]'}`}>{formatPnl(item.realizedPnl)}</td>
									<td className="px-4 py-4">{formatPct(item.returnPct)}</td>
									<td className="px-4 py-4"><span className={`rounded-full border px-2.5 py-1 text-[12px] ${getResultBadgeClass(item)}`}>{getResultLabel(item)}</span></td>
									<td className="px-4 py-4">{item.summaryText || '-'}</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>

			<div className="mt-5">
				<Pagination currentPage={page} totalPages={pageInfo.totalPage} onPageChange={setPage} />
			</div>
		</div>
	);
};

export default TradeHistoryPage;
