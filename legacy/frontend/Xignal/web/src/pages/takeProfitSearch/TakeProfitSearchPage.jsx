import { useEffect, useMemo, useState } from 'react';
import { directionOrder } from '../../data/takeProfitSearchData';
import { publicBacktest } from '../../services/publicBacktest';
import BotSetupModal from '../trading/BotSetupModal';

const periodOptions = ['all', '2w', '1m', '2m', '3m', '6m', '1y'].map((period) => ({
	value: period,
	label: period
}));

const formatPercent = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return `${numeric.toFixed(2)}%`;
};

const getStatusMessage = (status, error) => {
	if (status === 'NO_REAL_DATA') {
		return '아직 수신된 백테스트 데이터가 없습니다. TradingView 통계 알림 수신 후 표시됩니다.';
	}
	if (status === 'PARTIAL_DATA') {
		return '일부 백테스트 데이터만 수신되었습니다. 현재 수신된 결과를 기준으로 표시합니다.';
	}
	if (status === 'ERROR') {
		return error || '백테스트 API를 불러오지 못했습니다.';
	}
	return '';
};

const SortHeader = ({ label, active, direction, onClick }) => (
	<button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-left text-xs font-semibold text-[#64748B]">
		{label}
		<span className={active ? 'text-[#2563EB]' : 'text-[#CBD5E1]'}>{active ? (direction === 'desc' ? '↓' : '↑') : '↕'}</span>
	</button>
);

const TakeProfitSearchPage = () => {
	const [rows, setRows] = useState([]);
	const [strategies, setStrategies] = useState([]);
	const [dataStatus, setDataStatus] = useState('READY');
	const [errorMessage, setErrorMessage] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [filters, setFilters] = useState({
		symbol: '',
		strategyId: 'all',
		period: 'all',
		minWinrate: '',
		minReturn: ''
	});
	const [sort, setSort] = useState({ key: 'netPnlPct', direction: 'desc' });
	const [selectedRow, setSelectedRow] = useState(null);

	useEffect(() => {
		let canceled = false;
		publicBacktest.strategies().then((res) => {
			if (canceled) return;
			setStrategies(res.items || []);
		});
		return () => {
			canceled = true;
		};
	}, []);

	useEffect(() => {
		let canceled = false;
		setIsLoading(true);
		publicBacktest
			.options({
				symbol: filters.symbol,
				strategyId: filters.strategyId,
				period: filters.period,
				minWinrate: filters.minWinrate,
				minReturn: filters.minReturn,
				limit: 500
			})
			.then((res) => {
				if (canceled) return;
				setRows(res.items || []);
				setDataStatus(res.dataStatus || 'READY');
				setErrorMessage(res.error || '');
				setIsLoading(false);
			});
		return () => {
			canceled = true;
		};
	}, [filters]);

	const updateFilter = (key) => (event) => {
		setFilters((prev) => ({ ...prev, [key]: event.target.value }));
	};

	const filteredRows = useMemo(() => {
		const multiplier = sort.direction === 'desc' ? -1 : 1;
		return [...rows].sort((a, b) => {
			if (sort.key === 'direction') {
				return ((directionOrder[a.direction] ?? 99) - (directionOrder[b.direction] ?? 99)) * (sort.direction === 'desc' ? -1 : 1);
			}
			if (sort.key === 'tpPct') {
				return (Number(a.tpPct || 0) - Number(b.tpPct || 0)) * multiplier;
			}
			return (Number(a[sort.key] || 0) - Number(b[sort.key] || 0)) * multiplier;
		});
	}, [rows, sort]);

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
				strategySignal: selectedRow.strategyId,
				strategyCategory: selectedRow.direction === 'BOTH' ? 'grid' : 'algorithm',
				symbol: selectedRow.symbol,
				timeframeRaw: selectedRow.timeframeRaw,
				direction: selectedRow.direction,
				tpPct: selectedRow.tpPct,
				botName: `${selectedRow.strategyName} ${selectedRow.symbol}`
			}
		: null;
	const statusMessage = getStatusMessage(dataStatus, errorMessage);

	return (
		<div className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#0F172A] sm:px-6 lg:px-8">
			<div className="mx-auto flex max-w-[1440px] flex-col gap-6">
				<header className="flex flex-col gap-2">
					<p className="text-sm font-semibold text-[#2563EB]">QBT_STATS_V1</p>
					<h1 className="text-[28px] font-bold leading-tight">익절 조건 검색</h1>
					<p className="text-sm text-[#64748B]">Ring Levels public backtest API에서 수신된 TradingView 실데이터만 표시합니다.</p>
				</header>

				<section className="rounded-[18px] border border-[#E2E8F0] bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
					<div className="grid gap-4 lg:grid-cols-6">
						<label className="lg:col-span-2">
							<span className="text-[13px] font-semibold text-[#475569]">종목</span>
							<input value={filters.symbol} onChange={updateFilter('symbol')} placeholder="BTCUSDT 또는 BTCUSDT.P" className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] px-3 text-sm outline-none focus:border-[#2563EB]" />
						</label>
						<label>
							<span className="text-[13px] font-semibold text-[#475569]">전략</span>
							<select value={filters.strategyId} onChange={updateFilter('strategyId')} className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-sm outline-none focus:border-[#2563EB]">
								<option value="all">전체</option>
								{strategies.map((strategy) => (
									<option key={strategy.strategyId} value={strategy.strategyId}>{strategy.strategyName}</option>
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
							{statusMessage ? <p className="mt-1 text-sm font-semibold text-[#DC2626]">{statusMessage}</p> : null}
						</div>
						<span className="text-sm font-semibold text-[#64748B]">{isLoading ? '로딩 중' : `${filteredRows.length}개`}</span>
					</div>

					<div className="hidden overflow-x-auto md:block">
						<table className="w-full min-w-[980px] border-collapse">
							<thead className="bg-[#F8FAFC]">
								<tr>
									{['전략', '종목'].map((column) => <th key={column} className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">{column}</th>)}
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left"><SortHeader label="TP 설정" active={sort.key === 'tpPct'} direction={sort.direction} onClick={() => toggleSort('tpPct')} /></th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left"><SortHeader label="방향" active={sort.key === 'direction'} direction={sort.direction} onClick={() => toggleSort('direction')} /></th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">캔들</th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">기간</th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left"><SortHeader label="승률" active={sort.key === 'winratePct'} direction={sort.direction} onClick={() => toggleSort('winratePct')} /></th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left"><SortHeader label="수익률" active={sort.key === 'netPnlPct'} direction={sort.direction} onClick={() => toggleSort('netPnlPct')} /></th>
									<th className="border-b border-[#E2E8F0] px-4 py-3 text-left text-xs font-semibold text-[#64748B]">BOT 추가하기</th>
								</tr>
							</thead>
							<tbody>
								{filteredRows.length === 0 ? (
									<tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-[#64748B]">{isLoading ? '백테스트 데이터를 불러오는 중입니다.' : getStatusMessage(dataStatus, errorMessage) || '검색 조건에 맞는 백테스트 데이터가 없습니다.'}</td></tr>
								) : filteredRows.map((row) => (
									<tr key={row.id || `${row.strategyId}-${row.symbol}-${row.direction}-${row.period}-${row.tpPct}-${row.timeframeRaw}`} className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8FAFC]">
										<td className="px-4 py-3 text-sm font-semibold">{row.strategyName}</td>
										<td className="px-4 py-3 text-sm">{row.symbol}</td>
										<td className="px-4 py-3 text-sm">{formatPercent(row.tpPct)}</td>
										<td className="px-4 py-3 text-sm">{row.directionLabel}</td>
										<td className="px-4 py-3 text-sm">{row.timeframeRaw}</td>
										<td className="px-4 py-3 text-sm">{row.period}</td>
										<td className="px-4 py-3 text-sm font-semibold text-[#0F172A]">{formatPercent(row.winratePct)}</td>
										<td className="px-4 py-3 text-sm font-semibold text-[#16A34A]">{formatPercent(row.netPnlPct)}</td>
										<td className="px-4 py-3"><button type="button" onClick={() => setSelectedRow(row)} className="rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-bold text-white">BOT 추가하기</button></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="space-y-3 p-4 md:hidden">
						{filteredRows.length === 0 ? (
							<div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-6 text-center text-sm text-[#64748B]">{isLoading ? '백테스트 데이터를 불러오는 중입니다.' : getStatusMessage(dataStatus, errorMessage) || '검색 조건에 맞는 백테스트 데이터가 없습니다.'}</div>
						) : filteredRows.map((row) => (
							<div key={`${row.id || row.strategyId}-${row.symbol}-${row.direction}-${row.period}-${row.tpPct}-${row.timeframeRaw}-mobile`} className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
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
