import { useEffect, useMemo, useState } from 'react';
import { publicBacktest } from '../../services/publicBacktest';
import { publicRealtime } from '../../services/publicRealtime';

const TABS = [
	{ key: 'nybox', label: 'NY Box', description: '뉴욕 박스 상단, 하단, 현재 위치를 공개 데이터로 표시합니다.' },
	{ key: 'fearGreed', label: '공포/탐욕', description: '단기, 중기, 장기 상태와 최근 이벤트를 확인합니다.' },
	{ key: 'supportResistance', label: '지지/저항선', description: '사용자 친화적인 지지선, 저항선, 현재 위치만 표시합니다.' }
];

const TIMEFRAMES = [
	{ value: 'short', label: '단기' },
	{ value: 'mid', label: '중기' },
	{ value: 'long', label: '장기' }
];

const SR_TIMEFRAMES = [
	{ value: 'short', label: '단기' },
	{ value: 'mid', label: '중기' },
	{ value: 'long', label: '장기' },
	{ value: '15', label: '15' },
	{ value: '60', label: '60' }
];

const formatNumber = (value, digits = 4) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return numeric.toLocaleString('ko-KR', {
		maximumFractionDigits: digits
	});
};

const formatPercent = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return `${numeric.toFixed(2)}%`;
};

const formatDateTime = (value) => {
	if (!value) return '-';
	if (String(value).includes('KST')) return value;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString('ko-KR', { hour12: false });
};

const normalizeSearch = (value) => String(value || '').trim().toUpperCase();

const getSymbol = (row) => row?.symbol || row?.baseAsset || '-';
const getPrice = (row) => row?.currentPrice ?? row?.price ?? null;

const Badge = ({ children, tone = 'blue' }) => {
	const colors = {
		blue: 'bg-[#EFF6FF] text-[#2563EB]',
		green: 'bg-[#ECFDF5] text-[#16A34A]',
		red: 'bg-[#FEF2F2] text-[#DC2626]',
		gray: 'bg-[#F8FAFC] text-[#64748B]'
	};
	return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${colors[tone] || colors.blue}`}>{children}</span>;
};

const EmptyState = ({ status, error }) => (
	<div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-8 text-center text-sm text-[#64748B]">
		{status === 'ERROR' ? error || 'public realtime API를 불러오지 못했습니다.' : '아직 수신된 public realtime 데이터가 없습니다.'}
	</div>
);

const Field = ({ label, value }) => (
	<div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
		<p className="text-xs font-semibold text-[#64748B]">{label}</p>
		<p className="mt-1 text-sm font-bold text-[#0F172A]">{value || '-'}</p>
	</div>
);

const BacktestMiniPanel = ({ row, activeTab }) => {
	const [state, setState] = useState({ status: 'LOADING', items: [], error: '' });
	const symbol = getSymbol(row);

	useEffect(() => {
		if (!symbol || symbol === '-') return;
		let canceled = false;
		const strategyId = activeTab === 'nybox' ? 'NY_QUIET_CLOSE_ASIA_BOX' : activeTab === 'fearGreed' ? 'ATF_VIXFIX' : undefined;
		setState({ status: 'LOADING', items: [], error: '' });
		publicBacktest
			.options({
				strategyId,
				symbol,
				period: 'all',
				limit: 4
			})
			.then((res) => {
				if (canceled) return;
				setState({
					status: res.dataStatus || (res.items?.length ? 'READY' : 'NO_REAL_DATA'),
					items: res.items || [],
					error: res.error || ''
				});
			});
		return () => {
			canceled = true;
		};
	}, [activeTab, symbol]);

	return (
		<section className="mt-5 rounded-2xl border border-[#E2E8F0] bg-white p-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h3 className="text-sm font-bold text-[#0F172A]">관련 백테스트</h3>
					<p className="mt-1 text-xs text-[#64748B]">QBT_STATS_V1 public backtest API 결과만 표시합니다.</p>
				</div>
				<Badge tone="gray">{state.status}</Badge>
			</div>
			{state.status === 'LOADING' ? <p className="mt-4 text-sm text-[#64748B]">불러오는 중입니다.</p> : null}
			{state.status !== 'LOADING' && state.items.length === 0 ? (
				<p className="mt-4 text-sm text-[#64748B]">
					{state.status === 'ERROR' ? state.error || '백테스트 API를 불러오지 못했습니다.' : '동일 조건의 백테스트 데이터가 없습니다.'}
				</p>
			) : null}
			{state.items.length ? (
				<div className="mt-4 grid gap-3 sm:grid-cols-2">
					{state.items.slice(0, 4).map((item) => (
						<div key={item.id || `${item.strategyId}-${item.direction}-${item.tpPct}-${item.period}`} className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
							<p className="text-xs font-semibold text-[#64748B]">{item.strategyName}</p>
							<p className="mt-1 text-sm font-bold text-[#0F172A]">
								TP {formatPercent(item.tpPct)} · {item.directionLabel}
							</p>
							<p className="mt-1 text-xs text-[#64748B]">
								{item.period} · 승률 {formatPercent(item.winratePct)} · 수익률 {formatPercent(item.netPnlPct)}
							</p>
						</div>
					))}
				</div>
			) : null}
		</section>
	);
};

const DetailModal = ({ row, activeTab, onClose }) => {
	if (!row) return null;
	const symbol = getSymbol(row);
	const price = getPrice(row);
	const isNyBox = activeTab === 'nybox';
	const isFearGreed = activeTab === 'fearGreed';
	const isSupportResistance = activeTab === 'supportResistance';

	return (
		<div className="fixed inset-0 z-[130] flex items-end justify-center bg-[#0F172A]/40 px-0 py-0 sm:items-center sm:px-4 sm:py-6">
			<div className="max-h-[94vh] w-full max-w-[760px] overflow-y-auto rounded-t-[20px] bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.22)] sm:rounded-[20px] sm:p-6">
				<header className="flex items-start justify-between gap-4">
					<div>
						<p className="text-sm font-semibold text-[#2563EB]">public realtime detail</p>
						<h2 className="mt-1 text-2xl font-bold text-[#0F172A]">{symbol}</h2>
						<p className="mt-2 text-sm text-[#64748B]">거래 실행 상태와 분리된 공개 데이터 상세입니다.</p>
					</div>
					<button type="button" onClick={onClose} className="h-9 rounded-lg border border-[#E2E8F0] px-3 text-sm font-semibold text-[#64748B]">
						닫기
					</button>
				</header>

				<div className="mt-5 grid gap-3 sm:grid-cols-3">
					<Field label="현재가" value={formatNumber(price)} />
					<Field label="캔들" value={row.interval || row.timeframe || '-'} />
					<Field label="업데이트" value={formatDateTime(row.updatedAt)} />
				</div>

				{isNyBox ? (
					<div className="mt-5 grid gap-3 sm:grid-cols-3">
						<Field label="박스 상단" value={formatNumber(row.boxTop)} />
						<Field label="박스 하단" value={formatNumber(row.boxBottom)} />
						<Field label="트리거/위치" value={row.currentBoxPositionLabel || row.currentBoxPosition || '-'} />
					</div>
				) : null}

				{isFearGreed ? (
					<div className="mt-5 grid gap-3 sm:grid-cols-3">
						<Field label="단기" value={row.shortTrendLabel || '-'} />
						<Field label="중기" value={row.midTrendLabel || '-'} />
						<Field label="장기" value={row.longTrendLabel || '-'} />
						<Field label="공포" value={`${row.fearStatusLabel || '-'} / ${row.fearResolvedLabel || '-'}`} />
						<Field label="탐욕" value={`${row.greedStatusLabel || '-'} / ${row.greedResolvedLabel || '-'}`} />
						<Field label="최근 상태" value={row.currentTrendLabel || '-'} />
					</div>
				) : null}

				{isSupportResistance ? (
					<div className="mt-5 grid gap-3 sm:grid-cols-3">
						<Field label="지지선" value={formatNumber(row.support?.mid)} />
						<Field label="저항선" value={formatNumber(row.resistance?.mid)} />
						<Field label="현재 위치" value={row.userPriceState || '-'} />
					</div>
				) : null}

				<BacktestMiniPanel row={row} activeTab={activeTab} />
			</div>
		</div>
	);
};

const RealtimeDataPage = () => {
	const [activeTab, setActiveTab] = useState('nybox');
	const [timeframe, setTimeframe] = useState('short');
	const [symbolSearch, setSymbolSearch] = useState('');
	const [state, setState] = useState({ status: 'LOADING', rows: [], raw: null, error: '' });
	const [selectedRow, setSelectedRow] = useState(null);

	useEffect(() => {
		let canceled = false;
		const load = async () => {
			setState((prev) => ({ ...prev, status: 'LOADING', error: '' }));
			const request =
				activeTab === 'nybox'
					? publicRealtime.nyBoxSnapshot()
					: activeTab === 'fearGreed'
						? publicRealtime.fearGreedSnapshot({ timeframe })
						: publicRealtime.supportResistanceSnapshot({ timeframe, logic: 'vp' });
			const res = await request;
			if (canceled) return;
			setState({
				status: res.dataStatus || (res.items?.length ? 'READY' : 'NO_REAL_DATA'),
				rows: res.items || [],
				raw: res.raw,
				error: res.error || ''
			});
		};
		load();
		return () => {
			canceled = true;
		};
	}, [activeTab, timeframe]);

	const filteredRows = useMemo(() => {
		const search = normalizeSearch(symbolSearch);
		const rows = state.rows || [];
		if (!search) return rows.slice(0, 200);
		return rows.filter((row) => normalizeSearch(getSymbol(row)).includes(search)).slice(0, 200);
	}, [state.rows, symbolSearch]);

	const activeMeta = TABS.find((tab) => tab.key === activeTab);
	const updatedAt = state.raw?.updatedAt || state.raw?.meta?.livePriceUpdatedAtKst || state.raw?.nyBoxCacheMeta?.calculatedAtKst;

	return (
		<div className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#0F172A] sm:px-6 lg:px-8">
			<div className="mx-auto flex max-w-[1440px] flex-col gap-6">
				<header className="flex flex-col gap-2">
					<p className="text-sm font-semibold text-[#2563EB]">PUBLIC REALTIME DATA</p>
					<h1 className="text-[28px] font-bold leading-tight">실시간 데이터</h1>
					<p className="max-w-3xl text-sm text-[#64748B]">
						Ring Levels public API에서 수신한 NY Box, 공포/탐욕, 지지/저항선 데이터를 Xignal 화면에 맞게 표시합니다.
					</p>
				</header>

				<section className="rounded-[18px] border border-[#E2E8F0] bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
						<div>
							<div className="flex flex-wrap gap-2">
								{TABS.map((tab) => (
									<button
										key={tab.key}
										type="button"
										onClick={() => {
											setActiveTab(tab.key);
											setSelectedRow(null);
										}}
										className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
											activeTab === tab.key ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]' : 'border-[#E2E8F0] bg-white text-[#64748B]'
										}`}
									>
										{tab.label}
									</button>
								))}
							</div>
							<p className="mt-3 text-sm text-[#64748B]">{activeMeta?.description}</p>
						</div>
						<div className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px]">
							<label>
								<span className="text-[13px] font-semibold text-[#475569]">timeframe</span>
								<select
									value={timeframe}
									onChange={(event) => setTimeframe(event.target.value)}
									disabled={activeTab === 'nybox'}
									className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-sm outline-none focus:border-[#2563EB] disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]"
								>
									{(activeTab === 'supportResistance' ? SR_TIMEFRAMES : TIMEFRAMES).map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</label>
							<label>
								<span className="text-[13px] font-semibold text-[#475569]">symbol search</span>
								<input
									value={symbolSearch}
									onChange={(event) => setSymbolSearch(event.target.value)}
									placeholder="BTCUSDT"
									className="mt-1 h-[46px] w-full rounded-xl border border-[#CBD5E1] px-3 text-sm outline-none focus:border-[#2563EB]"
								/>
							</label>
						</div>
					</div>
				</section>

				<section className="grid gap-4 sm:grid-cols-3">
					<Field label="status" value={state.status} />
					<Field label="rows" value={`${filteredRows.length.toLocaleString('ko-KR')} / ${(state.rows || []).length.toLocaleString('ko-KR')}`} />
					<Field label="updatedAt" value={formatDateTime(updatedAt)} />
				</section>

				<section className="rounded-[18px] border border-[#E2E8F0] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
					<div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
						<div>
							<h2 className="text-lg font-bold">{activeMeta?.label}</h2>
							<p className="mt-1 text-sm text-[#64748B]">행을 클릭하면 공개 데이터 상세와 관련 백테스트를 확인합니다.</p>
						</div>
						<Badge tone={state.status === 'READY' ? 'green' : state.status === 'ERROR' ? 'red' : 'gray'}>{state.status}</Badge>
					</div>

					<div className="overflow-x-auto">
						{state.status === 'LOADING' ? <div className="p-6 text-sm text-[#64748B]">불러오는 중입니다.</div> : null}
						{state.status !== 'LOADING' && filteredRows.length === 0 ? <div className="p-5"><EmptyState status={state.status} error={state.error} /></div> : null}
						{filteredRows.length ? (
							<table className="w-full min-w-[980px] border-collapse">
								<thead className="bg-[#F8FAFC]">
									<tr>
										{activeTab === 'nybox' ? (
											<>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">종목</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">캔들</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">박스 상태</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">상단/하단/현재가</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">업데이트</th>
											</>
										) : activeTab === 'fearGreed' ? (
											<>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">종목</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">단기/중기/장기</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">현재 상태</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">최근 이벤트</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">업데이트</th>
											</>
										) : (
											<>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">종목</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">기간</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">지지선</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">저항선</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">현재 위치</th>
												<th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B]">업데이트</th>
											</>
										)}
									</tr>
								</thead>
								<tbody>
									{filteredRows.map((row) => (
										<tr
											key={`${activeTab}-${getSymbol(row)}-${row.timeframe || row.interval}-${row.updatedAt}`}
											onClick={() => setSelectedRow(row)}
											className="cursor-pointer border-t border-[#E2E8F0] hover:bg-[#F8FAFC]"
										>
											{activeTab === 'nybox' ? (
												<>
													<td className="px-4 py-3 text-sm font-bold">{getSymbol(row)}</td>
													<td className="px-4 py-3 text-sm">{row.interval || row.timeframe || '-'}</td>
													<td className="px-4 py-3 text-sm"><Badge>{row.currentBoxPositionLabel || row.currentBoxPosition || '-'}</Badge></td>
													<td className="px-4 py-3 text-sm">
														{formatNumber(row.boxTop)} / {formatNumber(row.boxBottom)} / {formatNumber(row.currentPrice)}
													</td>
													<td className="px-4 py-3 text-sm text-[#64748B]">{formatDateTime(row.updatedAt)}</td>
												</>
											) : activeTab === 'fearGreed' ? (
												<>
													<td className="px-4 py-3 text-sm font-bold">{getSymbol(row)}</td>
													<td className="px-4 py-3 text-sm">
														{row.shortTrendLabel || '-'} / {row.midTrendLabel || '-'} / {row.longTrendLabel || '-'}
													</td>
													<td className="px-4 py-3 text-sm"><Badge tone={row.currentTrend === 'BULLISH' ? 'green' : row.currentTrend === 'BEARISH' ? 'red' : 'gray'}>{row.currentTrendLabel || '-'}</Badge></td>
													<td className="px-4 py-3 text-sm">
														공포 {row.fearStatusLabel || '-'} · 탐욕 {row.greedStatusLabel || '-'}
													</td>
													<td className="px-4 py-3 text-sm text-[#64748B]">{formatDateTime(row.updatedAt)}</td>
												</>
											) : (
												<>
													<td className="px-4 py-3 text-sm font-bold">{getSymbol(row)}</td>
													<td className="px-4 py-3 text-sm">{row.timeframe || '-'}</td>
													<td className="px-4 py-3 text-sm">{formatNumber(row.support?.mid)}</td>
													<td className="px-4 py-3 text-sm">{formatNumber(row.resistance?.mid)}</td>
													<td className="px-4 py-3 text-sm"><Badge>{row.userPriceState || '-'}</Badge></td>
													<td className="px-4 py-3 text-sm text-[#64748B]">{formatDateTime(row.updatedAt)}</td>
												</>
											)}
										</tr>
									))}
								</tbody>
							</table>
						) : null}
					</div>
				</section>
			</div>
			<DetailModal row={selectedRow} activeTab={activeTab} onClose={() => setSelectedRow(null)} />
		</div>
	);
};

export default RealtimeDataPage;
