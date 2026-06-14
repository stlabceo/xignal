import { useMemo, useState } from 'react';
import {
	directionOrder,
	filterTakeProfitRows,
	normalizeQbtStats,
	periodOptions,
	qbtStatsFixture,
	strategyOptions
} from '../../data/takeProfitSearchData';
import BotSetupModal from '../trading/BotSetupModal';

const formatPercent = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return `${numeric.toFixed(2)}%`;
};

const SortHeader = ({ label, active, direction, onClick }) => (
	<button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-left text-xs font-semibold text-[#64748B]">
		{label}
		<span className={active ? 'text-[#2563EB]' : 'text-[#CBD5E1]'}>{active ? (direction === 'desc' ? '↓' : '↑') : '↕'}</span>
	</button>
);

const TakeProfitSearchPage = () => {
	const allRows = useMemo(() => normalizeQbtStats(qbtStatsFixture), []);
	const [filters, setFilters] = useState({
		symbol: '',
		strategyId: 'all',
		period: 'all',
		minWinrate: '',
		minReturn: ''
	});
	const [sort, setSort] = useState({ key: 'netPnlPct', direction: 'desc' });
	const [selectedRow, setSelectedRow] = useState(null);

	const updateFilter = (key) => (event) => {
		setFilters((prev) => ({ ...prev, [key]: event.target.value }));
	};

	const filteredRows = useMemo(() => {
		const baseRows = filterTakeProfitRows(allRows, filters);
		const multiplier = sort.direction === 'desc' ? -1 : 1;
		return [...baseRows].sort((a, b) => {
			if (sort.key === 'direction') {
				return (directionOrder[a.direction] - directionOrder[b.direction]) * (sort.direction === 'desc' ? -1 : 1);
			}
			return (Number(a[sort.key] || 0) - Number(b[sort.key] || 0)) * multiplier;
		});
	}, [allRows, filters, sort]);

	const toggleSort = (key) => {
		setSort((prev) => ({
			key,
			direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
		}));
	};

	const modalPrefill = selectedRow
		? {
				source: 'tp-search',
				strategyId: selectedRow.strategyId,
				strategyName: selectedRow.strategyName,
				strategySignal: selectedRow.strategyId === 'ATF_VIXFIX' ? 'ATF+VIXFIX' : 'SQZ+GRID',
				strategyCategory: selectedRow.direction === 'BOTH' ? 'grid' : 'algorithm',
				symbol: selectedRow.symbol,
				timeframeRaw: selectedRow.timeframeRaw,
				direction: selectedRow.direction,
				tpPct: selectedRow.tpPct,
				botName: `${selectedRow.strategyName} ${selectedRow.symbol}`
			}
		: null;

	return (
		<div className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#0F172A] sm:px-6 lg:px-8">
			<div className="mx-auto flex max-w-[1440px] flex-col gap-6">
				<header className="flex flex-col gap-2">
					<p className="text-sm font-semibold text-[#2563EB]">QBT_STATS_V1</p>
					<h1 className="text-[28px] font-bold leading-tight">익절 조건 검색</h1>
					<p className="text-sm text-[#64748B]">public backtest dataset에서 전략별 TP 조건을 검색합니다. 거래 실행 상태와 섞지 않습니다.</p>
				</header>

				<section className="rounded-[18px] border border-[#E2E8F0] bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
					<div className="grid gap-4 lg:grid-cols-6">
						<label className="lg:col-span-2">
							<span className="text-[13px] font-semibold text-[#475569]">종목</span>
							<input
								value={filters.symbol}
								onChange={updateFilter('symbol')}
								placeholder="BTCUSDT.P"
								className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] px-3 text-sm outline-none focus:border-[#2563EB]"
							/>
						</label>
						<label>
							<span className="text-[13px] font-semibold text-[#475569]">전략</span>
							<select value={filters.strategyId} onChange={updateFilter('strategyId')} className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-sm outline-none focus:border-[#2563EB]">
								<option value="all">전체</option>
								{strategyOptions.map((option) => (
									<option key={option.value} value={option.value}>{option.label}</option>
								))}
							</select>
						</label>
						<label>
							<span className="text-[13px] font-semibold text-[#475569]">기간</span>
							<select value={filters.period} onChange={updateFilter('period')} className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-sm outline-none focus:border-[#2563EB]">
								{periodOptions.map((option) => (
									<option key={option.value} value={option.value}>{option.label}</option>
								))}
							</select>
						</label>
						<label>
							<span className="text-[13px] font-semibold text-[#475569]">최소 승률</span>
							<input value={filters.minWinrate} onChange={updateFilter('minWinrate')} type="number" placeholder="%" className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] px-3 text-sm outline-none focus:border-[#2563EB]" />
						</label>
						<label>
							<span className="text-[13px] font-semibold text-[#475569]">최소 수익률</span>
							<input value={filters.minReturn} onChange={updateFilter('minReturn')} type="number" placeholder="%" className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] px-3 text-sm outline-none focus:border-[#2563EB]" />
						</label>
					</div>
				</section>

				<section className="rounded-[18px] border border-[#E2E8F0] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
					<div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
						<div>
							<h2 className="text-lg font-bold">검색 결과</h2>
							<p className="mt-1 text-sm text-[#64748B]">기본 정렬은 수익률 높은 순입니다.</p>
						</div>
						<span className="text-sm font-semibold text-[#64748B]">{filteredRows.length}개</span>
					</div>

					<div className="hidden overflow-x-auto md:block">
						<table className="w-full min-w-[980px] border-collapse">
							<thead className="bg-[#F8FAFC]">
								<tr>
									{['전략', '종목', 'TP 설정'].map((column) => (
										<th key={column} className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">{column}</th>
									))}
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left">
										<SortHeader label="방향" active={sort.key === 'direction'} direction={sort.direction} onClick={() => toggleSort('direction')} />
									</th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">캔들</th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">기간</th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left">
										<SortHeader label="승률" active={sort.key === 'winratePct'} direction={sort.direction} onClick={() => toggleSort('winratePct')} />
									</th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left">
										<SortHeader label="수익률" active={sort.key === 'netPnlPct'} direction={sort.direction} onClick={() => toggleSort('netPnlPct')} />
									</th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">BOT 추가하기</th>
								</tr>
							</thead>
							<tbody>
								{filteredRows.map((row) => (
									<tr key={`${row.strategyId}-${row.symbol}-${row.direction}-${row.period}-${row.tpPct}-${row.timeframeRaw}`} className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8FAFC]">
										<td className="px-4 py-3 text-sm font-semibold">{row.strategyName}</td>
										<td className="px-4 py-3 text-sm">{row.symbol}</td>
										<td className="px-4 py-3 text-sm">{formatPercent(row.tpPct)}</td>
										<td className="px-4 py-3 text-sm">{row.directionLabel}</td>
										<td className="px-4 py-3 text-sm">{row.timeframeRaw}</td>
										<td className="px-4 py-3 text-sm">{row.period}</td>
										<td className="px-4 py-3 text-sm font-semibold text-[#0F172A]">{formatPercent(row.winratePct)}</td>
										<td className="px-4 py-3 text-sm font-semibold text-[#16A34A]">{formatPercent(row.netPnlPct)}</td>
										<td className="px-4 py-3">
											<button type="button" onClick={() => setSelectedRow(row)} className="rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-bold text-white">BOT 추가하기</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="space-y-3 p-4 md:hidden">
						{filteredRows.map((row) => (
							<div key={`${row.strategyId}-${row.symbol}-${row.direction}-${row.period}-${row.tpPct}-${row.timeframeRaw}-mobile`} className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
								<div className="flex items-start justify-between gap-3">
									<div>
										<p className="text-base font-bold">{row.strategyName}</p>
										<p className="mt-1 text-sm text-[#64748B]">{row.symbol} · {row.directionLabel} · {row.timeframeRaw}</p>
									</div>
									<span className="rounded-full bg-[#EFF6FF] px-2 py-1 text-xs font-bold text-[#2563EB]">TP {formatPercent(row.tpPct)}</span>
								</div>
								<div className="mt-4 grid grid-cols-3 gap-3 text-sm">
									<div><p className="text-[#94A3B8]">기간</p><p className="font-semibold">{row.period}</p></div>
									<div><p className="text-[#94A3B8]">승률</p><p className="font-semibold">{formatPercent(row.winratePct)}</p></div>
									<div><p className="text-[#94A3B8]">수익률</p><p className="font-semibold text-[#16A34A]">{formatPercent(row.netPnlPct)}</p></div>
								</div>
								<button type="button" onClick={() => setSelectedRow(row)} className="mt-4 h-10 w-full rounded-xl bg-[#2563EB] text-sm font-bold text-white">BOT 추가하기</button>
							</div>
						))}
					</div>
				</section>
			</div>
			<BotSetupModal isOpen={Boolean(selectedRow)} prefill={modalPrefill} source="tp-search" onClose={() => setSelectedRow(null)} />
		</div>
	);
};

export default TakeProfitSearchPage;
