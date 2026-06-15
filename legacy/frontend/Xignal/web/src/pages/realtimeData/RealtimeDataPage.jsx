import { useEffect, useMemo, useState } from 'react';
import { publicBacktest } from '../../services/publicBacktest';
import { publicRealtime } from '../../services/publicRealtime';
import './realtimeDataPage.css';

const PUBLIC_ITEM_TYPES = [
	{
		key: 'ny_box',
		label: '뉴욕박스',
		kicker: '뉴욕 박스',
		title: '뉴욕 세션 기준 박스와 현재 위치',
		lead: '전일 뉴욕 세션에서 만들어진 상단과 하단을 기준으로 현재 가격이 박스 안, 상단 돌파, 하단 이탈 중 어디에 있는지 확인합니다.',
		help: ['박스 상단과 하단은 공개 시장 데이터로 계산됩니다.', '상세 모달에서 전략 설명과 관련 백테스트를 함께 확인할 수 있습니다.', '자동매매 설정은 로그인 후 익절 조건 검색 화면에서 이어집니다.']
	},
	{
		key: 'fear_greed',
		label: '공포/탐욕',
		kicker: '시장 심리',
		title: '단기·중기·장기 공포와 탐욕 이벤트',
		lead: '가격 흐름에서 공포와 탐욕 이벤트가 발생했는지, 그리고 해소됐는지 기간별로 보여줍니다.',
		help: ['단기, 중기, 장기 기간을 바꾸며 시장의 심리 변화를 비교합니다.', '상세 모달은 최근 이벤트, 발생 가격, 해소 가격을 분리해 보여줍니다.', 'ATF+VIXFIX 백테스트는 매수와 매도 방향을 나누어 표시합니다.']
	},
	{
		key: 'support_resistance',
		label: '지지/저항선',
		kicker: '가격대 분석',
		title: '볼륨 프로파일 기반 지지선과 저항선',
		lead: '현재가가 의미 있는 지지선과 저항선에 얼마나 가까운지 공개 데이터로 확인합니다.',
		help: ['지지선과 저항선은 공개 가격·거래량 기반 구간으로 계산됩니다.', '상세 모달에서 현재가 위치와 다음 구간을 한눈에 볼 수 있습니다.', '이 화면은 공개 데이터 확인용이며 주문이나 포지션을 만들지 않습니다.']
	}
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
	{ value: '15', label: '15분' },
	{ value: '60', label: '1시간' }
];

const NYBOX_FILTERS = [
	{ value: null, label: '전체' },
	{ value: 'break_above', label: '상단 돌파' },
	{ value: 'inside_box', label: '박스 내부' },
	{ value: 'break_below', label: '하단 이탈' }
];

const intervalByTimeframe = {
	short: '15',
	mid: '60',
	long: '240',
	15: '15',
	60: '60'
};

const strategyByItemType = {
	ny_box: {
		strategyId: 'NY_QUIET_CLOSE_ASIA_BOX',
		expectedType: 'GRID',
		title: 'NY Quiet Close Asia Box Grid',
		description: '박스 상단과 하단을 기준으로 양방향 Grid 조건을 관찰합니다.'
	},
	fear_greed: {
		strategyId: 'ATF_VIXFIX',
		expectedType: 'ALGORITHM',
		title: 'ATF+VIXFIX',
		description: '공포·탐욕 이벤트를 매수 또는 매도 조건으로 해석합니다.'
	},
	support_resistance: {
		strategyId: undefined,
		expectedType: undefined,
		title: '지지·저항선 참고',
		description: '현재 공개 백테스트 계약에 직접 연결된 전략이 있으면 이 영역에 표시합니다.'
	}
};

let tradingViewLoader = null;

function loadTradingView() {
	if (window.TradingView) return Promise.resolve();
	if (tradingViewLoader) return tradingViewLoader;

	tradingViewLoader = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = 'https://s3.tradingview.com/tv.js';
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('TradingView script failed'));
		document.head.appendChild(script);
	});

	return tradingViewLoader;
}

const normalizeSearch = (value) => String(value || '').trim().toUpperCase();

const formatPrice = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return numeric.toLocaleString('ko-KR', {
		maximumFractionDigits: numeric >= 1 ? 4 : 8
	});
};

const formatPercent = (value, digits = 2, withSign = false) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	const sign = withSign && numeric > 0 ? '+' : '';
	return `${sign}${numeric.toFixed(digits)}%`;
};

const formatDateTime = (value) => {
	if (!value) return '-';
	if (String(value).includes('KST')) return value;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString('ko-KR', { hour12: false });
};

const getSymbol = (row) => row?.symbol || row?.baseAsset || '-';
const getDisplaySymbol = (row) => row?.baseAsset || String(getSymbol(row)).replace(/USDT$/i, '') || '-';
const getPrice = (row) => row?.currentPrice ?? row?.price ?? null;
const getUpdatedAt = (row) => row?.updatedAt || row?.calculatedAtKst || row?.lastUpdatedAt || null;
const publicSupport = (row) => (row?.supportProvenance?.source === 'vp' || row?.support ? row?.support : null);
const publicResistance = (row) => row?.resistance || null;

function nyBoxPosition(row) {
	const position = row?.currentBoxPosition;
	const label = row?.currentBoxPositionLabel || position || '-';
	if (position === 'ABOVE_BOX') return { label: label === 'ABOVE_BOX' ? '상단 돌파' : label, className: 'box-upper' };
	if (position === 'BELOW_BOX') return { label: label === 'BELOW_BOX' ? '하단 이탈' : label, className: 'box-lower' };
	if (position === 'INSIDE_BOX') return { label: label === 'INSIDE_BOX' ? '박스 내부' : label, className: 'box-inside' };
	return { label, className: 'muted' };
}

function matchesNyBoxFilter(row, filter) {
	if (!filter) return true;
	const position = row?.currentBoxPosition;
	if (filter === 'break_above') return position === 'ABOVE_BOX';
	if (filter === 'break_below') return position === 'BELOW_BOX';
	if (filter === 'inside_box') return position === 'INSIDE_BOX';
	return true;
}

function statusTone(text) {
	const value = String(text || '');
	if (value.includes('상승') || value.includes('돌파') || value.includes('탐욕') || value.includes('상단')) return 'up';
	if (value.includes('하락') || value.includes('이탈') || value.includes('공포') || value.includes('하단')) return 'down';
	if (value.includes('박스')) return 'box-inside';
	return 'muted';
}

function chartSymbolFor(row, fallback = 'BTCUSDT') {
	const symbol = getSymbol(row);
	if (!symbol || symbol === '-') return fallback;
	return String(symbol).replace(/\.P$/i, '');
}

function timeframeForWidget(value) {
	return intervalByTimeframe[value] || '15';
}

function TradingViewWidget({ symbol, timeframe }) {
	const containerId = useMemo(() => `xignal-tv-${Math.random().toString(36).slice(2)}`, []);

	useEffect(() => {
		let cancelled = false;
		const container = document.getElementById(containerId);
		if (!container) return undefined;
		container.innerHTML = '';

		loadTradingView()
			.then(() => {
				if (cancelled || !window.TradingView) return;
				new window.TradingView.widget({
					autosize: true,
					symbol: `BINANCE:${symbol}`,
					interval: timeframeForWidget(timeframe),
					timezone: 'Asia/Seoul',
					theme: 'light',
					style: '1',
					locale: 'kr',
					enable_publishing: false,
					hide_side_toolbar: false,
					allow_symbol_change: false,
					container_id: containerId
				});
			})
			.catch(() => {
				if (!container) return;
				container.innerHTML = '<div class="chart-fallback">차트를 불러오지 못했습니다. 공개 실시간 데이터는 아래 표에서 계속 확인할 수 있습니다.</div>';
			});

		return () => {
			cancelled = true;
			const current = document.getElementById(containerId);
			if (current) current.innerHTML = '';
		};
	}, [containerId, symbol, timeframe]);

	return <div id={containerId} className="trading-view" />;
}

function StatusBadge({ children, tone = 'muted' }) {
	return <span className={`status-badge ${tone}`}>{children}</span>;
}

function PriceWithChange({ price, pct }) {
	const numeric = Number(pct);
	const className = Number.isFinite(numeric) && numeric > 0 ? 'price-change-positive' : Number.isFinite(numeric) && numeric < 0 ? 'price-change-negative' : 'price-change-neutral';
	return (
		<span className="price-with-change">
			<strong>{formatPrice(price)}</strong>
			{Number.isFinite(numeric) ? <em className={className}>{formatPercent(numeric, 2, true)}</em> : null}
		</span>
	);
}

function RangeBar({ markers, zones = [] }) {
	const values = [
		...markers.map((marker) => Number(marker.value)).filter(Number.isFinite),
		...zones.flatMap((zone) => [Number(zone?.low), Number(zone?.mid), Number(zone?.high)]).filter(Number.isFinite)
	];
	if (values.length < 2) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = Math.max(max - min, Number.EPSILON);
	const pct = (value) => Math.max(0, Math.min(100, ((value - min) / span) * 100));

	return (
		<div className="range-wrap">
			<div className="range-track">
				{zones
					.filter((zone) => Number.isFinite(Number(zone?.low)) && Number.isFinite(Number(zone?.high)))
					.map((zone, index) => (
						<span
							key={`${zone.kind}-${index}`}
							className={`range-zone ${zone.kind}`}
							style={{
								left: `${pct(Number(zone.low))}%`,
								width: `${Math.max(1, pct(Number(zone.high)) - pct(Number(zone.low)))}%`
							}}
						/>
					))}
				{markers
					.filter((marker) => Number.isFinite(Number(marker.value)))
					.map((marker) => (
						<span key={marker.label} className={`range-marker ${marker.kind}`} style={{ left: `${pct(Number(marker.value))}%` }}>
							<span>{marker.label}</span>
						</span>
					))}
			</div>
			<div className="range-scale">
				<span>{formatPrice(min)}</span>
				<span>{formatPrice(max)}</span>
			</div>
		</div>
	);
}

function NyBoxGauge({ row }) {
	const current = Number(row?.currentPrice);
	const bottom = Number(row?.boxBottom);
	const top = Number(row?.boxTop);
	const hasGaugeData = Number.isFinite(current) && Number.isFinite(bottom) && Number.isFinite(top) && top > bottom;
	const position = nyBoxPosition(row);
	const pct = hasGaugeData ? Math.max(0, Math.min(100, ((current - bottom) / (top - bottom)) * 100)) : 50;
	const pricePlacement = pct < 10 ? 'left-outside' : pct > 90 ? 'right-outside' : 'center';

	return (
		<section className={`bear-bull-box-gauge position-${pricePlacement}`} aria-label={`${getSymbol(row)} NY Box position gauge`}>
			<div className="nybox-gauge-stage">
				<div className="nybox-gauge-icon bear-icon">BEAR</div>
				<div className="nybox-gauge-bar" aria-hidden="true">
					<span className="price-marker" style={{ left: `${pct}%` }} />
				</div>
				<div className="nybox-gauge-icon bull-icon">BULL</div>
			</div>
			<div className="nybox-gauge-values">
				<span>{formatPrice(row?.boxBottom)}</span>
				<strong>{formatPrice(row?.currentPrice)}</strong>
				<span>{formatPrice(row?.boxTop)}</span>
			</div>
			<div className="nybox-gauge-meta">
				<StatusBadge tone={position.className}>{position.label}</StatusBadge>
				<span>박스 폭 {formatPercent(row?.boxWidthPct)}</span>
			</div>
		</section>
	);
}

function BacktestPanel({ row, itemType }) {
	const [state, setState] = useState({ status: 'LOADING', items: [], error: '' });
	const symbol = getSymbol(row);
	const strategy = strategyByItemType[itemType] || {};

	useEffect(() => {
		if (!symbol || symbol === '-') return undefined;
		let cancelled = false;
		setState({ status: 'LOADING', items: [], error: '' });
		publicBacktest
			.options({
				strategyId: strategy.strategyId,
				symbol,
				timeframe: row?.interval || row?.timeframe || undefined,
				period: 'all',
				limit: 8
			})
			.then((res) => {
				if (cancelled) return;
				const items = (res.items || []).filter((item) => !strategy.expectedType || item.strategyType === strategy.expectedType);
				setState({
					status: res.dataStatus || (items.length ? 'READY' : 'NO_REAL_DATA'),
					items,
					error: res.error || ''
				});
			});
		return () => {
			cancelled = true;
		};
	}, [itemType, row?.interval, row?.timeframe, strategy.expectedType, strategy.strategyId, symbol]);

	const bestRows = [...state.items].sort((a, b) => {
		const pnl = Number(b.netPnlPct ?? -Infinity) - Number(a.netPnlPct ?? -Infinity);
		if (pnl !== 0) return pnl;
		const winrate = Number(b.winratePct ?? -Infinity) - Number(a.winratePct ?? -Infinity);
		if (winrate !== 0) return winrate;
		return Number(a.tpPct ?? Infinity) - Number(b.tpPct ?? Infinity);
	});

	return (
		<section className="backtest-section">
			<div className="nybox-backtest-head">
				<div>
					<strong>{strategy.title}</strong>
					<p>{strategy.description}</p>
				</div>
				<StatusBadge tone={state.status === 'READY' ? 'up' : state.status === 'ERROR' ? 'down' : 'muted'}>{state.status}</StatusBadge>
			</div>
			{state.status === 'LOADING' ? <div className="backtest-footnote">백테스트 데이터를 불러오는 중입니다.</div> : null}
			{state.status !== 'LOADING' && bestRows.length === 0 ? (
				<div className="backtest-footnote">
					<p>{state.status === 'ERROR' ? state.error || '백테스트 API를 불러오지 못했습니다.' : '동일 조건의 백테스트 데이터가 없습니다.'}</p>
				</div>
			) : null}
			{bestRows.length ? (
				<div className="backtest-table-wrap">
					<table className="backtest-table">
						<thead>
							<tr>
								<th>기간</th>
								<th>TP</th>
								<th>방향</th>
								<th>승률</th>
								<th>수익률</th>
							</tr>
						</thead>
						<tbody>
							{bestRows.slice(0, 8).map((item) => (
								<tr key={item.id || `${item.strategyId}-${item.symbol}-${item.direction}-${item.tpPct}-${item.period}`}>
									<td>{item.period}</td>
									<td>{formatPercent(item.tpPct)}</td>
									<td>{item.directionLabel || item.direction}</td>
									<td>{formatPercent(item.winratePct)}</td>
									<td className={Number(item.netPnlPct) >= 0 ? 'backtest-cell-positive' : 'backtest-cell-negative'}>{formatPercent(item.netPnlPct, 2, true)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
			<div className="backtest-footnote">
				<p>TradingView QBT_STATS_V1 public backtest API의 실데이터만 표시합니다. 더미나 fixture fallback은 사용하지 않습니다.</p>
			</div>
		</section>
	);
}

function DetailSection({ title, rows }) {
	return (
		<div className="zone-list modal-detail-section">
			<div className="nybox-section-header">
				<strong>{title}</strong>
			</div>
			{rows.map((row) => (
				<div className="zone-row nybox-kv-row modal-detail-kv-row" key={`${title}-${row.label}`}>
					<span>{row.label}</span>
					<strong>{row.value ?? '-'}</strong>
				</div>
			))}
		</div>
	);
}

function ModalActionRow() {
	return (
		<div className="modal-cta-row">
			<a className="icon-text-button primary" href="/take-profit-search">
				로그인 후 익절 조건 검색
			</a>
			<a className="icon-text-button" href="/login">
				회원 로그인
			</a>
		</div>
	);
}

function NyBoxDetail({ row, activeTab }) {
	const position = nyBoxPosition(row);
	const overviewRows = [
		{ label: '현재가', value: formatPrice(row?.currentPrice) },
		{ label: '박스 상단', value: formatPrice(row?.boxTop) },
		{ label: '박스 하단', value: formatPrice(row?.boxBottom) },
		{ label: '현재 위치', value: position.label },
		{ label: '기준 세션', value: row?.currentSessionLabel || row?.nySessionLabel || '-' },
		{ label: '업데이트', value: formatDateTime(getUpdatedAt(row)) }
	];

	return (
		<>
			{activeTab === 'overview' ? (
				<div className="modal-overview-layout">
					<NyBoxGauge row={row} />
					<DetailSection title="NY Box 공개 데이터" rows={overviewRows} />
					<div className="modal-disclaimer">
						<p>뉴욕 세션에서 계산된 박스 상단과 하단을 기준으로 현재 위치를 표시합니다.</p>
						<p>이 화면은 공개 데이터 확인용이며 주문이나 포지션을 생성하지 않습니다.</p>
					</div>
				</div>
			) : null}
			{activeTab === 'strategy' ? (
				<div className="nybox-strategy-layout">
					<div className="nybox-strategy-message">
						<strong>박스 기준 Grid 전략 흐름</strong>
						<p>상단과 하단을 기준으로 양방향 조건을 관찰하고, 회원 영역에서는 별도 봇 설정과 Grid Exit 운영 규칙으로 이어집니다.</p>
						<p>공개 화면에서는 전략 설명과 백테스트 참고만 제공하며 실제 주문 설정은 보호된 회원 화면에서 진행됩니다.</p>
					</div>
					<ModalActionRow />
				</div>
			) : null}
			{activeTab === 'backtest' ? <BacktestPanel row={row} itemType="ny_box" /> : null}
		</>
	);
}

function FearGreedDetail({ row, activeTab }) {
	const eventRows = [
		{ label: '현재가', value: formatPrice(row?.currentPrice) },
		{ label: '단기', value: row?.shortTrendLabel || '-' },
		{ label: '중기', value: row?.midTrendLabel || '-' },
		{ label: '장기', value: row?.longTrendLabel || '-' },
		{ label: '공포 상태', value: `${row?.fearStatusLabel || '-'} / ${row?.fearResolvedLabel || '-'}` },
		{ label: '탐욕 상태', value: `${row?.greedStatusLabel || '-'} / ${row?.greedResolvedLabel || '-'}` }
	];

	return (
		<>
			{activeTab === 'overview' ? (
				<div className="modal-overview-layout">
					<DetailSection title="공포·탐욕 이벤트" rows={eventRows} />
					<DetailSection
						title="최근 이벤트 가격"
						rows={[
							{ label: '공포 시작', value: `${formatDateTime(row?.fearStartedAt)} · ${formatPrice(row?.fearStartedPrice)}` },
							{ label: '공포 해소', value: `${formatDateTime(row?.fearResolvedAt)} · ${formatPrice(row?.fearResolvedPrice)}` },
							{ label: '탐욕 시작', value: `${formatDateTime(row?.greedStartedAt)} · ${formatPrice(row?.greedStartedPrice)}` },
							{ label: '탐욕 해소', value: `${formatDateTime(row?.greedResolvedAt)} · ${formatPrice(row?.greedResolvedPrice)}` }
						]}
					/>
				</div>
			) : null}
			{activeTab === 'strategy' ? (
				<div className="nybox-strategy-layout">
					<div className="nybox-strategy-message">
						<strong>ATF+VIXFIX 전략 참고</strong>
						<p>공포와 탐욕 이벤트는 Algorithm 전략의 매수·매도 조건 참고 데이터로 사용됩니다.</p>
						<p>공개 화면에서는 신호와 백테스트를 확인하고, Bot 추가는 로그인 후 보호 화면에서 진행합니다.</p>
					</div>
					<ModalActionRow />
				</div>
			) : null}
			{activeTab === 'backtest' ? <BacktestPanel row={row} itemType="fear_greed" /> : null}
		</>
	);
}

function SupportResistanceDetail({ row, activeTab }) {
	const support = publicSupport(row);
	const resistance = publicResistance(row);
	const markers = [
		{ label: '현재가', value: getPrice(row), kind: 'price' },
		{ label: '지지선', value: support?.mid, kind: 'support' },
		{ label: '저항선', value: resistance?.mid, kind: 'resistance' }
	];
	const zones = [
		support ? { ...support, kind: 'support' } : null,
		resistance ? { ...resistance, kind: 'resistance' } : null
	].filter(Boolean);

	return (
		<>
			{activeTab === 'overview' ? (
				<div className="modal-overview-layout">
					<RangeBar markers={markers} zones={zones} />
					<DetailSection
						title="지지·저항선 위치"
						rows={[
							{ label: '현재가', value: formatPrice(getPrice(row)) },
							{ label: '지지선', value: formatPrice(support?.mid) },
							{ label: '저항선', value: formatPrice(resistance?.mid) },
							{ label: '현재 상태', value: row?.userPriceState || '-' },
							{ label: '지지선 이동', value: `${row?.supportMovementDirection || '-'} ${formatPercent(row?.supportMovementPct)}` },
							{ label: '저항선 이동', value: `${row?.resistanceMovementDirection || '-'} ${formatPercent(row?.resistanceMovementPct)}` }
						]}
					/>
				</div>
			) : null}
			{activeTab === 'strategy' ? (
				<div className="nybox-strategy-layout">
					<div className="nybox-strategy-message">
						<strong>가격대 분석 참고</strong>
						<p>지지선과 저항선은 공개 가격·거래량 데이터에서 의미 있는 구간을 추려 보여줍니다.</p>
						<p>자동매매 설정은 보호된 회원 화면에서만 이어집니다.</p>
					</div>
					<ModalActionRow />
				</div>
			) : null}
			{activeTab === 'backtest' ? <BacktestPanel row={row} itemType="support_resistance" /> : null}
		</>
	);
}

function LevelModal({ row, itemType, onClose }) {
	const [activeTab, setActiveTab] = useState('overview');
	if (!row) return null;
	const config = PUBLIC_ITEM_TYPES.find((item) => item.key === itemType) || PUBLIC_ITEM_TYPES[0];
	const strategyTabLabel = itemType === 'ny_box' ? '뉴욕 박스 그리드 전략' : itemType === 'fear_greed' ? '공포/탐욕 전략' : '지지/저항선 전략';
	const backtestTabLabel = itemType === 'ny_box' ? '뉴욕 박스 그리드 전략 백테스트' : itemType === 'fear_greed' ? '공포/탐욕 백테스트' : '지지/저항선 백테스트';

	return (
		<div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
			<article className="modal" role="dialog" aria-modal="true" aria-label={`${config.label} 상세`} onMouseDown={(event) => event.stopPropagation()}>
				<header className="modal-header">
					<div>
						<p className="modal-kicker">{config.kicker}</p>
						<h2>{getDisplaySymbol(row)} · {config.label}</h2>
					</div>
					<button className="icon-button" type="button" onClick={onClose} title="닫기" aria-label="닫기">
						×
					</button>
				</header>

				<div className="modal-tabs" role="tablist" aria-label="공개 데이터 상세 탭">
					<button type="button" className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>
						Overview
					</button>
					<button type="button" className={activeTab === 'strategy' ? 'active' : ''} onClick={() => setActiveTab('strategy')}>
						{strategyTabLabel}
					</button>
					<button type="button" className={activeTab === 'backtest' ? 'active' : ''} onClick={() => setActiveTab('backtest')}>
						{backtestTabLabel}
					</button>
				</div>

				{itemType === 'ny_box' ? <NyBoxDetail row={row} activeTab={activeTab} /> : null}
				{itemType === 'fear_greed' ? <FearGreedDetail row={row} activeTab={activeTab} /> : null}
				{itemType === 'support_resistance' ? <SupportResistanceDetail row={row} activeTab={activeTab} /> : null}
			</article>
		</div>
	);
}

function EmptyState({ status, error }) {
	return (
		<div className="empty-state">
			<strong>{status === 'ERROR' ? '데이터를 불러오지 못했습니다.' : '아직 수신된 공개 데이터가 없습니다.'}</strong>
			<p>{status === 'ERROR' ? error || 'public realtime API request failed' : 'RingLevel 공개 데이터 수신 후 이곳에 표시됩니다.'}</p>
		</div>
	);
}

function renderTableHeader(itemType) {
	if (itemType === 'ny_box') {
		return (
			<tr>
				<th>종목</th>
				<th>현재가</th>
				<th>박스 상단</th>
				<th>박스 하단</th>
				<th>현재 위치</th>
				<th>업데이트</th>
			</tr>
		);
	}
	if (itemType === 'fear_greed') {
		return (
			<tr>
				<th>종목</th>
				<th>현재가</th>
				<th>단기</th>
				<th>중기</th>
				<th>장기</th>
				<th>최근 이벤트</th>
			</tr>
		);
	}
	return (
		<tr>
			<th>종목</th>
			<th>현재가</th>
			<th>지지선</th>
			<th>저항선</th>
			<th>현재 위치</th>
			<th>돌파 시간</th>
		</tr>
	);
}

function renderRow(row, itemType, onOpen) {
	const symbol = getSymbol(row);
	if (itemType === 'ny_box') {
		const position = nyBoxPosition(row);
		return (
			<tr key={`${itemType}-${symbol}-${getUpdatedAt(row)}`} onClick={() => onOpen(row)}>
				<td data-label="종목">
					<strong>{getDisplaySymbol(row)}</strong>
					<span>{symbol}</span>
				</td>
				<td data-label="현재가"><PriceWithChange price={row?.currentPrice} pct={row?.currentPriceChange24hPct} /></td>
				<td data-label="박스 상단">{formatPrice(row?.boxTop)}</td>
				<td data-label="박스 하단">{formatPrice(row?.boxBottom)}</td>
				<td data-label="현재 위치"><StatusBadge tone={position.className}>{position.label}</StatusBadge></td>
				<td data-label="업데이트">{formatDateTime(getUpdatedAt(row))}</td>
			</tr>
		);
	}
	if (itemType === 'fear_greed') {
		return (
			<tr key={`${itemType}-${symbol}-${getUpdatedAt(row)}`} onClick={() => onOpen(row)}>
				<td data-label="종목">
					<strong>{getDisplaySymbol(row)}</strong>
					<span>{symbol}</span>
				</td>
				<td data-label="현재가"><PriceWithChange price={row?.currentPrice} pct={row?.currentPriceChange24hPct} /></td>
				<td data-label="단기"><StatusBadge tone={statusTone(row?.shortTrendLabel)}>{row?.shortTrendLabel || '-'}</StatusBadge></td>
				<td data-label="중기"><StatusBadge tone={statusTone(row?.midTrendLabel)}>{row?.midTrendLabel || '-'}</StatusBadge></td>
				<td data-label="장기"><StatusBadge tone={statusTone(row?.longTrendLabel)}>{row?.longTrendLabel || '-'}</StatusBadge></td>
				<td data-label="최근 이벤트">공포 {row?.fearStatusLabel || '-'} · 탐욕 {row?.greedStatusLabel || '-'}</td>
			</tr>
		);
	}
	const support = publicSupport(row);
	const resistance = publicResistance(row);
	return (
		<tr key={`${itemType}-${symbol}-${getUpdatedAt(row)}`} onClick={() => onOpen(row)}>
			<td data-label="종목">
				<strong>{getDisplaySymbol(row)}</strong>
				<span>{symbol}</span>
			</td>
			<td data-label="현재가"><PriceWithChange price={getPrice(row)} pct={row?.priceChange24hPct} /></td>
			<td data-label="지지선">{formatPrice(support?.mid)}</td>
			<td data-label="저항선">{formatPrice(resistance?.mid)}</td>
			<td data-label="현재 위치"><StatusBadge tone={statusTone(row?.userPriceState)}>{row?.userPriceState || '-'}</StatusBadge></td>
			<td data-label="돌파 시간">{formatDateTime(row?.breakoutAt || row?.confirmedBreakAt || getUpdatedAt(row))}</td>
		</tr>
	);
}

function RealtimeDataPage() {
	const [itemType, setItemType] = useState('ny_box');
	const [timeframe, setTimeframe] = useState('short');
	const [symbolSearch, setSymbolSearch] = useState('');
	const [nyBoxFilter, setNyBoxFilter] = useState(null);
	const [state, setState] = useState({ status: 'LOADING', rows: [], raw: null, error: '' });
	const [selectedRow, setSelectedRow] = useState(null);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			setState((prev) => ({ ...prev, status: 'LOADING', error: '' }));
			const request =
				itemType === 'ny_box'
					? publicRealtime.nyBoxSnapshot()
					: itemType === 'fear_greed'
						? publicRealtime.fearGreedSnapshot({ timeframe })
						: publicRealtime.supportResistanceSnapshot({ timeframe, logic: 'vp' });
			const res = await request;
			if (cancelled) return;
			setState({
				status: res.dataStatus || (res.items?.length ? 'READY' : 'NO_REAL_DATA'),
				rows: res.items || [],
				raw: res.raw,
				error: res.error || ''
			});
		};
		load();
		return () => {
			cancelled = true;
		};
	}, [itemType, timeframe]);

	const config = PUBLIC_ITEM_TYPES.find((item) => item.key === itemType) || PUBLIC_ITEM_TYPES[0];
	const filteredRows = useMemo(() => {
		const search = normalizeSearch(symbolSearch);
		return (state.rows || [])
			.filter((row) => (itemType === 'ny_box' ? matchesNyBoxFilter(row, nyBoxFilter) : true))
			.filter((row) => {
				if (!search) return true;
				return normalizeSearch(getSymbol(row)).includes(search) || normalizeSearch(getDisplaySymbol(row)).includes(search);
			})
			.slice(0, 200);
	}, [itemType, nyBoxFilter, state.rows, symbolSearch]);

	const selectedForChart = selectedRow || filteredRows[0] || null;
	const chartSymbol = chartSymbolFor(selectedForChart);
	const updatedAt = state.raw?.updatedAt || state.raw?.meta?.livePriceUpdatedAtKst || state.raw?.nyBoxCacheMeta?.calculatedAtKst || state.raw?.nyBoxCoverage?.calculatedAtKst;
	const activeSession = state.raw?.meta?.currentSessionLabel || '-';

	return (
		<div className="ring-public-app">
			<div className="app-shell">
				<section className="chart-section">
					<div className="top-strip">
						<div className="brand-block">
							<a className="wordmark-button" href="/realtime-data">QUANTU</a>
							<span>공개 실시간 데이터</span>
						</div>
						<a className="auth-button" href="/login">회원 로그인</a>
					</div>
					<TradingViewWidget symbol={chartSymbol} timeframe={timeframe} />
				</section>

				<section className="controls-section">
					<div className="segmented item-segmented" role="tablist" aria-label="공개 데이터 카테고리">
						{PUBLIC_ITEM_TYPES.map((item) => (
							<button
								key={item.key}
								type="button"
								className={itemType === item.key ? 'active' : ''}
								onClick={() => {
									setItemType(item.key);
									setSelectedRow(null);
									setSymbolSearch('');
									if (item.key === 'fear_greed') setTimeframe('short');
									if (item.key === 'support_resistance') setTimeframe('long');
								}}
							>
								{item.label}
							</button>
						))}
					</div>
				</section>

				<section className="category-intro-section">
					<div className="category-intro-card">
						<p>{config.kicker}</p>
						<h2>{config.title}</h2>
						<strong>{config.lead}</strong>
						<ul>
							{config.help.map((line) => (
								<li key={line}>{line}</li>
							))}
						</ul>
					</div>
				</section>

				<section className="table-section">
					<div className="data-table-card">
						<div className="data-toolbar">
							<div>
								<p className="table-title">{config.label}</p>
								<span>행을 클릭하면 RingLevel 상세 모달, 전략 설명, 관련 백테스트를 확인합니다.</span>
							</div>
							<div className="toolbar-controls">
								<label className="nybox-search">
									<span>Symbol</span>
									<input value={symbolSearch} onChange={(event) => setSymbolSearch(event.target.value)} placeholder="BTCUSDT" />
								</label>
								<label className="nybox-filter-grid">
									<span>Timeframe</span>
									<select value={timeframe} onChange={(event) => setTimeframe(event.target.value)} disabled={itemType === 'ny_box'}>
										{(itemType === 'support_resistance' ? SR_TIMEFRAMES : TIMEFRAMES).map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</label>
							</div>
						</div>

						<div className="nybox-panel">
							<div className="nybox-meta-bar">
								<span>
									Status <strong>{state.status}</strong>
								</span>
								<span>
									Rows <strong>{filteredRows.length.toLocaleString('ko-KR')} / {(state.rows || []).length.toLocaleString('ko-KR')}</strong>
								</span>
								<span>
									Updated <strong>{formatDateTime(updatedAt)}</strong>
								</span>
								<span>
									Session <strong>{activeSession}</strong>
								</span>
							</div>
							{itemType === 'ny_box' ? (
								<div className="filter-chip-row">
									{NYBOX_FILTERS.map((filter) => (
										<button
											key={filter.label}
											type="button"
											className={nyBoxFilter === filter.value ? 'active' : ''}
											onClick={() => setNyBoxFilter(filter.value)}
										>
											{filter.label}
										</button>
									))}
								</div>
							) : null}
						</div>

						{state.status === 'LOADING' ? <div className="modal-loading">불러오는 중</div> : null}
						{state.status !== 'LOADING' && filteredRows.length === 0 ? <EmptyState status={state.status} error={state.error} /> : null}
						{filteredRows.length ? (
							<div className="table-wrap">
								<table className={`public-data-table ${itemType}`}>
									<thead>{renderTableHeader(itemType)}</thead>
									<tbody>{filteredRows.map((row) => renderRow(row, itemType, setSelectedRow))}</tbody>
								</table>
							</div>
						) : null}
					</div>
				</section>
			</div>
			<LevelModal row={selectedRow} itemType={itemType} onClose={() => setSelectedRow(null)} />
		</div>
	);
}

export default RealtimeDataPage;
