import { Fragment, useEffect, useMemo, useState } from 'react';
import { publicRealtime } from '../../services/publicRealtime';
import nyBoxStrategyBreakoutImage from '../../assets/nybox-strategy/nybox-strategy-breakout.png';
import nyBoxStrategyExitImage from '../../assets/nybox-strategy/nybox-strategy-exit.png';
import nyBoxStrategyIntroWithCopyImage from '../../assets/nybox-strategy/nybox-strategy-intro-with-copy.png';
import nyBoxStrategyOrdersImage from '../../assets/nybox-strategy/nybox-strategy-orders.png';
import nyBoxStrategySessionBoxImage from '../../assets/nybox-strategy/nybox-strategy-session-box.png';
import nyBoxStrategyStrengthsImage from '../../assets/nybox-strategy/nybox-strategy-strengths.png';
import './realtimeDataPage.css';

const PUBLIC_LAUNCH_CATEGORY_VISIBILITY = {
	ny_box: true,
	fear_greed: true,
	support_resistance: false
};

const PUBLIC_ITEM_CONFIGS = [
	{
		key: 'ny_box',
		label: '뉴욕박스',
		kicker: '뉴욕 박스',
		title: '뉴욕 세션 기준 박스와 현재 위치',
		lead: '전일 뉴욕 세션에서 만들어진 상단과 하단을 기준으로 현재 가격이 박스 안, 상단 돌파, 하단 이탈 중 어디에 있는지 확인합니다.',
		help: []
	},
	{
		key: 'fear_greed',
		label: '공포/탐욕',
		kicker: '시장 심리',
		title: '단기·중기·장기 공포/탐욕 이벤트',
		lead: '가격 흐름에서 공포와 탐욕 이벤트가 발생했는지, 그리고 해소됐는지를 기간별로 보여줍니다.',
		help: [
			'단기, 중기, 장기 기간을 나누어 시장 심리 변화를 비교합니다.',
			'상세 모달은 기간별 이벤트, 발생 가격, 해소 가격을 detail API 기준으로 표시합니다.',
			'ATF+VIXFIX 백테스트는 매수/매도 방향을 분리해서 보여줍니다.'
		]
	},
	{
		key: 'support_resistance',
		label: '지지/저항선',
		kicker: '가격대 분석',
		title: '볼륨 프로파일 기반 지지선과 저항선',
		lead: '현재가는 어느 지지선과 저항선 사이에 있는지 공개 데이터로 확인합니다.',
		help: [
			'이 카테고리는 RingLevel 최신 publicLaunch 기준에서 아직 공개 비활성입니다.',
			'코드와 API는 남아 있지만 공개 화면에는 노출하지 않습니다.',
			'공개 전환 시 별도 QA 후 켜야 합니다.'
		]
	}
];

const PUBLIC_ITEM_TYPES = PUBLIC_ITEM_CONFIGS.filter((item) => PUBLIC_LAUNCH_CATEGORY_VISIBILITY[item.key]);

const NY_BOX_STRATEGY_IMAGES = [
	{
		label: '전략 개요',
		src: nyBoxStrategyIntroWithCopyImage,
		alt: '뉴욕 세션 고점과 저점을 기준으로 아시아 세션 가격 횡보를 설명하는 NY Box 전략 개요',
		description: '뉴욕 세션에서 만들어진 고점과 저점이 다음 아시아 세션의 기준 박스가 됩니다. 가격이 이 박스 안에서 횡보할 때 Grid 전략 후보로 봅니다.'
	},
	{
		label: '세션 박스',
		src: nyBoxStrategySessionBoxImage,
		alt: '뉴욕 세션 고점과 저점이 아시아 세션 기준 박스로 이어지는 구조',
		description: '박스 상단은 직전 뉴욕 세션의 고점, 박스 하단은 직전 뉴욕 세션의 저점입니다. 현재가는 이 상단·하단 대비 위치로 해석합니다.'
	},
	{
		label: '돌파 기준',
		src: nyBoxStrategyBreakoutImage,
		alt: '중심선을 기준으로 숏과 롱 신호가 반복되는 돌파 기준',
		description: '가격이 박스 내부에서 왕복하면 Grid 후보가 유지됩니다. 상단 돌파나 하단 이탈이 확인되면 신규 Grid 운용보다 종료·관망 판단이 우선입니다.'
	},
	{
		label: '주문 구조',
		src: nyBoxStrategyOrdersImage,
		alt: '상단과 하단 목표선을 기준으로 롱과 숏 Grid 주문이 교차하는 구조',
		description: 'Grid는 박스 안 왕복성을 전제로 양방향 가격 이동을 공략합니다. 실제 주문 설정은 로그인 후 보호된 Bot 설정 화면에서만 진행됩니다.'
	},
	{
		label: 'Grid Exit',
		src: nyBoxStrategyExitImage,
		alt: '가격이 박스 밖으로 벗어나면 Grid 전략이 종료되는 구조',
		description: '가격이 박스 운용 범위를 벗어나면 Grid Exit 판단 대상입니다. 공개 화면은 상태 설명만 제공하며 주문이나 포지션을 만들지 않습니다.'
	},
	{
		label: '강점',
		src: nyBoxStrategyStrengthsImage,
		alt: '박스 상하단 안정성, 뉴욕 세션 변동성 감소, 아시아 장초반 변동성, 가격 왕복성 등 전략 강점',
		description: '뉴욕 세션 후반 박스 안정성, 아시아 장초반 변동성, 가격 왕복성이 함께 확인될수록 Grid 참고 가치가 높아집니다.'
	}
];

const FUTURES_TO_DISPLAY_BASE = {
	'1000000BOB': 'BOB',
	'1000000MOG': 'MOG',
	'1000BONK': 'BONK',
	'1000CAT': 'CAT',
	'1000CHEEMS': 'CHEEMS',
	'1000FLOKI': 'FLOKI',
	'1000LUNC': 'LUNC',
	'1000PEPE': 'PEPE',
	'1000RATS': 'RATS',
	'1000SATS': 'SATS',
	'1000SHIB': 'SHIB',
	'1000XEC': 'XEC'
};

const KOREAN_ASSET_NAMES = {
	'0G': '제로지',
	'1INCH': '1인치네트워크',
	'1MBABYDOGE': '밀리베이비도지',
	'2Z': '더블제로',
	BTC: '비트코인',
	ETH: '이더리움',
	BNB: '비앤비',
	SOL: '솔라나',
	XRP: '리플',
	DOGE: '도지코인',
	ADA: '에이다',
	TRX: '트론',
	LINK: '체인링크',
	AVAX: '아발란체',
	BCH: '비트코인캐시',
	DOT: '폴카닷',
	LTC: '라이트코인',
	APT: '앱토스',
	ARB: '아비트럼',
	SUI: '수이',
	ICP: '인터넷컴퓨터',
	ETC: '이더리움클래식',
	FIL: '파일코인',
	ATOM: '코스모스',
	OP: '옵티미즘',
	INJ: '인젝티브',
	NEAR: '니어프로토콜',
	UNI: '유니스왑',
	PEPE: '페페',
	SHIB: '시바이누',
	BONK: '봉크',
	WLD: '월드코인',
	AAVE: '에이브',
	ALGO: '알고랜드',
	APE: '에이프코인',
	AR: '알위브',
	AXS: '엑시인피니티',
	CHZ: '칠리즈',
	COMP: '컴파운드',
	CRV: '커브',
	DYDX: '디와이디엑스',
	ENA: '에테나',
	FET: '페치에이아이',
	GALA: '갈라',
	HBAR: '헤데라',
	IMX: '이뮤터블엑스',
	JUP: '주피터',
	KAS: '카스파',
	MKR: '메이커',
	OM: '만트라',
	ONDO: '온도',
	PENDLE: '펜들',
	POL: '폴리곤',
	RENDER: '렌더',
	SEI: '세이',
	STX: '스택스',
	TAO: '비텐서',
	TIA: '셀레스티아',
	VET: '비체인',
	XLM: '스텔라루멘',
	XMR: '모네로',
	ZEC: '지캐시'
};

const digitNames = {
	0: '제로',
	1: '원',
	2: '투',
	3: '쓰리',
	4: '포',
	5: '파이브',
	6: '식스',
	7: '세븐',
	8: '에이트',
	9: '나인'
};

const letterNames = {
	A: '에이',
	B: '비',
	C: '씨',
	D: '디',
	E: '이',
	F: '에프',
	G: '지',
	H: '에이치',
	I: '아이',
	J: '제이',
	K: '케이',
	L: '엘',
	M: '엠',
	N: '엔',
	O: '오',
	P: '피',
	Q: '큐',
	R: '알',
	S: '에스',
	T: '티',
	U: '유',
	V: '브이',
	W: '더블유',
	X: '엑스',
	Y: '와이',
	Z: '지'
};

const romanChunks = [
	['BABYDOGE', '베이비도지'],
	['BANANA', '바나나'],
	['CHEEMS', '치임스'],
	['ALICE', '앨리스'],
	['AUDIO', '오디오'],
	['FLOKI', '플로키'],
	['BONK', '봉크'],
	['PEPE', '페페'],
	['SHIB', '시바'],
	['DOGE', '도지'],
	['CAT', '캣'],
	['RATS', '랫츠'],
	['SATS', '사츠'],
	['AI', '에이아이']
];

const STABLE_OR_PEGGED_BASE_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDE', 'USDS', 'USDD', 'PYUSD', 'USD1', 'USDG', 'RLUSD', 'EURC', 'FRAX', 'GUSD', 'LUSD', 'USDP', 'EURS', 'AEUR', 'BUSD', 'BFUSD', 'XAUT', 'PAXG', 'XAU', 'STABLE']);

const PUBLIC_PRIORITY = {
	BTC: 1,
	ETH: 2,
	BNB: 4,
	SOL: 5,
	XRP: 6,
	DOGE: 8,
	ADA: 9,
	TRX: 10,
	WBTC: 11,
	LINK: 12,
	AVAX: 13,
	SHIB: 14,
	DOT: 15,
	BCH: 16,
	NEAR: 17,
	UNI: 18,
	LTC: 19,
	APT: 20,
	ICP: 21,
	ETC: 22,
	ARB: 23,
	PEPE: 24,
	FIL: 25,
	ATOM: 26,
	SUI: 27,
	OP: 28,
	IMX: 29,
	INJ: 30,
	XLM: 31,
	HBAR: 32,
	AAVE: 33,
	ONDO: 34,
	JUP: 35,
	RUNE: 36,
	GRT: 37,
	MKR: 38,
	ENA: 39,
	RENDER: 40,
	FET: 41,
	ALGO: 42,
	VET: 43,
	KAITO: 44,
	WLD: 45,
	SEI: 46,
	TIA: 47,
	ZEC: 48,
	PUMP: 49
};

const TIMEFRAMES = [
	{ value: 'short', label: '단기', windowLabel: '1일' },
	{ value: 'mid', label: '중기', windowLabel: '7일' },
	{ value: 'long', label: '장기', windowLabel: '30일' }
];

const SR_TIMEFRAMES = [
	...TIMEFRAMES,
	{ value: '15', label: '15분' },
	{ value: '60', label: '1시간' }
];

const NYBOX_FILTERS = [
	{ value: null, label: '전체' },
	{ value: 'break_above', label: '상단 돌파' },
	{ value: 'inside_box', label: '박스 안' },
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
		description: '박스 상단과 하단을 기준으로 양방향 Grid 조건을 참고합니다.'
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
		description: '현재 공개 백테스트 계약과 직접 연결된 전략은 없습니다.'
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

const formatKstMonthDayTime = (value) => {
	if (!value) return '-';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString('ko-KR', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
};

const getSymbol = (row) => row?.symbol || row?.baseAsset || '-';

function normalizeCanonicalSymbol(symbol) {
	const value = String(symbol || '').trim().toUpperCase();
	if (!value || value === '-') return '';
	const withoutExchange = value.includes(':') ? value.split(':').pop() || value : value;
	return withoutExchange.replace(/\.P$/i, '');
}

function baseAssetFromSymbol(symbol, baseAsset) {
	const rawBase = String(baseAsset || '').trim().toUpperCase();
	const raw = rawBase || normalizeCanonicalSymbol(symbol).replace(/USDT$/i, '');
	return FUTURES_TO_DISPLAY_BASE[raw] || raw;
}

const getDisplaySymbol = (row) => baseAssetFromSymbol(getSymbol(row), row?.baseAsset) || '-';
const getPrice = (row) => row?.currentPrice ?? row?.price ?? null;
const getUpdatedAt = (row) => row?.updatedAt || row?.calculatedAtKst || row?.lastUpdatedAt || null;
const publicSupport = (row) => (row?.supportProvenance?.source === 'vp' ? row?.support : null);
const publicResistance = (row) => (row?.resistanceProvenance?.source === 'vp' ? row?.resistance : null);

function isStableLikeBaseAsset(baseAsset) {
	const base = String(baseAsset || '').trim().toUpperCase();
	return Boolean(base && (STABLE_OR_PEGGED_BASE_ASSETS.has(base) || base.includes('STABLE')));
}

function isInvalidPublicSymbol(symbol) {
	const normalized = normalizeCanonicalSymbol(symbol);
	return !/^[A-Z0-9]+USDT$/.test(normalized);
}

function transliterateUnknownBase(baseAsset) {
	let source = String(baseAsset || '').toUpperCase();
	let result = '';
	while (source.length > 0) {
		const chunk = romanChunks.find(([token]) => source.startsWith(token));
		if (chunk) {
			result += chunk[1];
			source = source.slice(chunk[0].length);
			continue;
		}
		const char = source[0];
		result += digitNames[char] || letterNames[char] || char;
		source = source.slice(1);
	}
	return result || '-';
}

function getKoreanAssetName(symbol, baseAsset) {
	const displayBase = baseAssetFromSymbol(symbol, baseAsset);
	return KOREAN_ASSET_NAMES[displayBase] || transliterateUnknownBase(displayBase);
}

function getDisplaySymbolLabel(symbol, baseAsset) {
	const displayBase = baseAssetFromSymbol(symbol, baseAsset);
	const ticker = normalizeCanonicalSymbol(symbol) || (displayBase ? `${displayBase}USDT` : '');
	const primaryName = getKoreanAssetName(symbol, baseAsset);
	return {
		primaryName: primaryName || displayBase || '-',
		secondarySymbol: ticker || displayBase || '-',
		displayBase
	};
}

function displayAssetText(symbol, baseAsset) {
	const label = getDisplaySymbolLabel(symbol, baseAsset);
	return `${label.primaryName} (${label.secondarySymbol})`;
}

function isPublicVisibleRow(row) {
	const label = getDisplaySymbolLabel(row?.symbol, row?.baseAsset);
	const rawBase = String(row?.baseAsset || normalizeCanonicalSymbol(row?.symbol).replace(/USDT$/i, '')).toUpperCase();
	if (!label.displayBase || isInvalidPublicSymbol(row?.symbol)) return false;
	if (isStableLikeBaseAsset(rawBase) || isStableLikeBaseAsset(label.displayBase)) return false;
	return true;
}

function sortByPublicPriority(rows) {
	return [...rows].sort((a, b) => {
		const aLabel = getDisplaySymbolLabel(a?.symbol, a?.baseAsset);
		const bLabel = getDisplaySymbolLabel(b?.symbol, b?.baseAsset);
		const aRankValue = a?.marketCapRank === null || a?.marketCapRank === undefined || a?.marketCapRank === '' ? null : Number(a.marketCapRank);
		const bRankValue = b?.marketCapRank === null || b?.marketCapRank === undefined || b?.marketCapRank === '' ? null : Number(b.marketCapRank);
		const aRank = Number.isFinite(aRankValue) ? aRankValue : (PUBLIC_PRIORITY[aLabel.displayBase] ?? Infinity);
		const bRank = Number.isFinite(bRankValue) ? bRankValue : (PUBLIC_PRIORITY[bLabel.displayBase] ?? Infinity);
		if (aRank !== bRank) return aRank - bRank;
		const aCapValue = a?.marketCapUsd === null || a?.marketCapUsd === undefined || a?.marketCapUsd === '' ? null : Number(a.marketCapUsd);
		const bCapValue = b?.marketCapUsd === null || b?.marketCapUsd === undefined || b?.marketCapUsd === '' ? null : Number(b.marketCapUsd);
		const aCap = Number.isFinite(aCapValue) ? aCapValue : null;
		const bCap = Number.isFinite(bCapValue) ? bCapValue : null;
		if (aCap !== null && bCap === null) return -1;
		if (aCap === null && bCap !== null) return 1;
		if (aCap !== null && bCap !== null && aCap !== bCap) return bCap - aCap;
		return aLabel.displayBase.localeCompare(bLabel.displayBase);
	});
}

function isMarketCapTop100Candidate(row) {
	const label = getDisplaySymbolLabel(row?.symbol, row?.baseAsset);
	const rank = Number.isFinite(Number(row?.marketCapRank)) ? Number(row.marketCapRank) : null;
	if (rank !== null && rank > 0 && rank <= 100) return true;
	return label.displayBase in PUBLIC_PRIORITY;
}

function isAutoTradeEligible(row) {
	return Boolean(row && isPublicVisibleRow(row) && isMarketCapTop100Candidate(row));
}

function isBacktestEligible(row) {
	return Boolean(row && isPublicVisibleRow(row) && isMarketCapTop100Candidate(row));
}

function isCompleteNyBoxRow(row) {
	return Number.isFinite(Number(row?.currentPrice)) && Number.isFinite(Number(row?.boxTop)) && Number.isFinite(Number(row?.boxBottom));
}

function isCompleteFearGreedRow(row) {
	return Boolean(getDisplaySymbolLabel(row?.symbol, row?.baseAsset).primaryName) && Number.isFinite(Number(row?.currentPrice));
}

function isCompleteSupportRow(row) {
	return Number(getPrice(row)) > 0 && Boolean(publicSupport(row)) && Boolean(publicResistance(row));
}

function isCompletePublicRow(row, itemType) {
	if (itemType === 'ny_box') return isCompleteNyBoxRow(row);
	if (itemType === 'fear_greed') return isCompleteFearGreedRow(row);
	if (itemType === 'support_resistance') return isCompleteSupportRow(row);
	return true;
}

function nyBoxPosition(row) {
	const position = row?.currentBoxPosition;
	const label = row?.currentBoxPositionLabel || position || '-';
	if (position === 'ABOVE_BOX' || position === 'BREAK_ABOVE') {
		return { label: label === 'ABOVE_BOX' || label === 'BREAK_ABOVE' ? '상단박스 돌파' : label, className: 'box-upper' };
	}
	if (position === 'BELOW_BOX' || position === 'BREAK_BELOW') {
		return { label: label === 'BELOW_BOX' || label === 'BREAK_BELOW' ? '하단박스 돌파' : label, className: 'box-lower' };
	}
	if (position === 'INSIDE_BOX') return { label: label === 'INSIDE_BOX' ? '박스 안' : label, className: 'box-inside' };
	return { label, className: 'muted' };
}

function nyBoxPositionDisplay(row, modal) {
	const position = row?.currentBoxPosition;
	const apiLabel = modal?.currentBoxPositionModalLabel || row?.currentBoxPositionLabel;
	if (position === 'ABOVE_BOX' || position === 'BREAK_ABOVE') return { label: apiLabel || '상단돌파', tone: 'up' };
	if (position === 'BELOW_BOX' || position === 'BREAK_BELOW') return { label: apiLabel || '하단돌파', tone: 'down' };
	if (position === 'INSIDE_BOX') return { label: apiLabel || '박스안', tone: 'box-inside' };
	return { label: apiLabel || position || '-', tone: 'muted' };
}

function percentTone(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 'neutral';
	if (numeric > 0) return 'up';
	if (numeric < 0) return 'down';
	return 'neutral';
}

function nyBoxSection(modal, category) {
	return (modal?.sections || []).find((section) => section.category === category) || null;
}

function nyBoxSectionValue(modal, category, label, fallback = '-') {
	const section = nyBoxSection(modal, category);
	const row = (section?.rows || []).find((item) => item.dataLabel === label);
	return row?.value ?? fallback;
}

function DeltaValue({ value, delta, summary }) {
	const tone = percentTone(delta);
	const showDelta = Number.isFinite(Number(delta)) || summary;
	return (
		<span className={`value-with-delta tone-${tone}`}>
			<span>{value ?? '-'}</span>
			{showDelta ? <em className={`delta-pill ${tone}`}>{summary || formatPercent(delta, 2, true)}</em> : null}
		</span>
	);
}

function buildNyBoxOverviewSections(state, modal) {
	const position = nyBoxPositionDisplay(state, modal);
	const currentRows = [
		{ label: '가격', value: modal?.currentPriceLabel || formatPrice(state?.currentPrice) },
		{
			label: '현재 상태',
			valueNode: <span className={`position-pill ${position.tone}`}>{position.label}</span>,
			tone: position.tone
		}
	];
	return [
		{
			title: '현재가',
			description: '현재 가격과 뉴욕 박스 기준 위치입니다.',
			rows: currentRows
		},
		{
			title: '뉴욕 박스',
			description: '최근 완료된 뉴욕 세션의 고점과 저점으로 만든 박스입니다.',
			rows: [
				{ label: '상단', value: nyBoxSectionValue(modal, '뉴욕 박스', '상단', formatPrice(state?.boxTop)) },
				{ label: '하단', value: nyBoxSectionValue(modal, '뉴욕 박스', '하단', formatPrice(state?.boxBottom)) },
				{ label: '폭', value: nyBoxSectionValue(modal, '뉴욕 박스', '폭', formatPercent(state?.boxWidthPct)) }
			]
		},
		{
			title: '뉴욕 세션 가격',
			description: '뉴욕 세션의 시작 가격과 종료 가격 변화입니다.',
			rows: [
				{ label: '시가', value: nyBoxSectionValue(modal, '뉴욕 세션 가격', '시가') },
				{
					label: '종가',
					valueNode: <DeltaValue value={nyBoxSectionValue(modal, '뉴욕 세션 가격', '종가')} delta={modal?.nySessionChangePct} summary={modal?.nySessionChangeSummary} />,
					tone: percentTone(modal?.nySessionChangePct)
				},
				{ label: '가격 변화', value: nyBoxSectionValue(modal, '뉴욕 세션 가격', '가격 변화'), tone: percentTone(modal?.nySessionChangePct) }
			]
		},
		{
			title: '뉴욕 세션 고점',
			description: '뉴욕 세션 초반과 후반의 고점 이동입니다.',
			rows: [
				{ label: '장초반 고점', value: nyBoxSectionValue(modal, '뉴욕 세션 고점', '장초반 고점') },
				{
					label: '장후반 고점',
					valueNode: <DeltaValue value={nyBoxSectionValue(modal, '뉴욕 세션 고점', '장후반 고점')} delta={modal?.highMovePct} summary={modal?.highMoveSummary} />,
					tone: percentTone(modal?.highMovePct)
				},
				{ label: '고점 이동', value: nyBoxSectionValue(modal, '뉴욕 세션 고점', '고점 이동'), tone: percentTone(modal?.highMovePct) }
			]
		},
		{
			title: '뉴욕 세션 저점',
			description: '뉴욕 세션 초반과 후반의 저점 이동입니다.',
			rows: [
				{ label: '장초반 저점', value: nyBoxSectionValue(modal, '뉴욕 세션 저점', '장초반 저점') },
				{
					label: '장후반 저점',
					valueNode: <DeltaValue value={nyBoxSectionValue(modal, '뉴욕 세션 저점', '장후반 저점')} delta={modal?.lowMovePct} summary={modal?.lowMoveSummary} />,
					tone: percentTone(modal?.lowMovePct)
				},
				{ label: '저점 이동', value: nyBoxSectionValue(modal, '뉴욕 세션 저점', '저점 이동'), tone: percentTone(modal?.lowMovePct) }
			]
		}
	].filter((section) => section.rows.some((row) => row.valueNode || (row.value !== null && row.value !== undefined && row.value !== '-')));
}

function matchesNyBoxFilter(row, filter) {
	if (!filter) return true;
	const position = row?.currentBoxPosition;
	if (filter === 'break_above') return position === 'ABOVE_BOX' || position === 'BREAK_ABOVE';
	if (filter === 'break_below') return position === 'BELOW_BOX' || position === 'BREAK_BELOW';
	if (filter === 'inside_box') return position === 'INSIDE_BOX';
	return true;
}

function statusTone(text) {
	const value = String(text || '');
	if (value.includes('상승') || value.includes('돌파') || value.includes('탐욕') || value.includes('상단')) return 'up';
	if (value.includes('하락') || value.includes('이탈') || value.includes('공포') || value.includes('하단')) return 'down';
	if (value.includes('박스') || value.includes('정상')) return 'box-inside';
	return 'muted';
}

function srDisplayState(row) {
	return publicSupport(row) && publicResistance(row) ? row?.userPriceState || '-' : '-';
}

function formatElapsedBreakoutTime(value) {
	if (!value) return '-';
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return String(value);
	const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
	if (elapsedMinutes < 1) return '방금 전';
	if (elapsedMinutes < 60) return `${elapsedMinutes}분 전`;
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) return `${elapsedHours}시간 전`;
	return `${Math.floor(elapsedHours / 24)}일 전`;
}

function breakoutTime(row) {
	const state = srDisplayState(row);
	if (state === '저항선 상승 돌파 발생' || state === '지지선 하락 돌파 발생') {
		return formatElapsedBreakoutTime(row?.breakoutDetectedAt || row?.breakoutAt || row?.confirmedBreakAt);
	}
	return '-';
}

function latestFearGreedEvent(row = {}) {
	if (row.sourceStatus === 'INSUFFICIENT_DATA') return { state: '수집 중', occurredAt: null };
	const parseEventTime = (value) => {
		const timestamp = value ? Date.parse(value) : null;
		return Number.isFinite(timestamp) ? timestamp : null;
	};
	const resolved = (flag, label) => flag === true || label === '해소';
	const fearTime = parseEventTime(row.fearStartedAt);
	const greedTime = parseEventTime(row.greedStartedAt);
	const fearActive = row.fearActive === true || (fearTime !== null && !resolved(row.fearResolved, row.fearResolvedLabel));
	const greedActive = row.greedActive === true || (greedTime !== null && !resolved(row.greedResolved, row.greedResolvedLabel));
	if (!fearActive && !greedActive) return { state: '정상', occurredAt: null };
	if (fearActive && (!greedActive || (fearTime ?? 0) >= (greedTime ?? 0))) {
		return { state: '공포', occurredAt: row.fearStartedAt || null };
	}
	return { state: '탐욕', occurredAt: row.greedStartedAt || null };
}

function formatFearGreedRelativeTime(value, nowMs = Date.now()) {
	const timestamp = value ? Date.parse(value) : null;
	if (!Number.isFinite(timestamp)) return '-';
	const elapsedMinutes = Math.max(0, Math.floor((nowMs - timestamp) / 60000));
	if (elapsedMinutes < 1) return '방금 전';
	if (elapsedMinutes < 60) return `${elapsedMinutes}분 전`;
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) return `${elapsedHours}시간 전`;
	return `${Math.floor(elapsedHours / 24)}일 전`;
}

function fearGreedPeriodDisplay(row) {
	const event = latestFearGreedEvent(row);
	return {
		state: event.state,
		relativeTime: event.state === '정상' || event.state === '수집 중' || event.state === '-' ? '-' : formatFearGreedRelativeTime(event.occurredAt)
	};
}

function buildFearGreedPeriodMapFromRaw(raw, fallbackTimeframe, rows = []) {
	const next = {};
	if (raw?.periodStates) {
		for (const [symbol, periodStates] of Object.entries(raw.periodStates)) {
			for (const period of TIMEFRAMES) {
				const row = periodStates?.[period.value];
				if (!row) continue;
				next[symbol] = {
					...next[symbol],
					[period.value]: fearGreedPeriodDisplay(row)
				};
			}
		}
	}
	if (Object.keys(next).length) return next;
	for (const row of rows || []) {
		next[row.symbol] = {
			...next[row.symbol],
			[fallbackTimeframe]: fearGreedPeriodDisplay(row)
		};
	}
	return next;
}

function fearGreedPeriodState(row, periodMap, timeframe) {
	return periodMap?.[row?.symbol]?.[timeframe] ?? (row?.timeframe === timeframe ? fearGreedPeriodDisplay(row) : { state: '-', relativeTime: '-' });
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

const BACKTEST_PERIOD_ORDER = ['2w', '1m', '2m', '3m', '6m', '1y', 'all'];
const BACKTEST_STATUS_LABELS = {
	OK: '정상',
	NO_PERIOD: '기간 부족',
	NO_REGIME: '레짐 없음',
	NO_CLOSED_REGIME: '종료 레짐 없음',
	NO_TRADED_REGIME: '거래 없음',
	INSUFFICIENT_SAMPLE: '표본 부족',
	CALC_NA: '계산 불가'
};

function periodLabel(period) {
	const labels = {
		'2w': '2주',
		'1m': '1달',
		'2m': '2달',
		'3m': '3달',
		'6m': '6달',
		'1y': '1년',
		all: '전체'
	};
	return labels[String(period || '').toLowerCase()] || String(period || '-');
}

function tpLabel(tp) {
	const numeric = Number(tp);
	if (!Number.isFinite(numeric)) return '-';
	return `${numeric.toFixed(Number.isInteger(numeric) ? 0 : 1)}%`;
}

function formatBacktestPct(value, withSign = false) {
	if (value === null || value === undefined || value === '') return '-';
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	const sign = withSign && numeric > 0 ? '+' : '';
	return `${sign}${numeric.toFixed(1)}%`;
}

function isRealBacktestCell(cell) {
	return Boolean(cell && cell.status === 'OK' && Number.isFinite(Number(cell.winratePct)) && Number.isFinite(Number(cell.netPnlPct)));
}

function backtestWinrateText(cell) {
	if (!isRealBacktestCell(cell)) return '-';
	return formatBacktestPct(cell?.winratePct);
}

function backtestNetPnlText(cell) {
	if (!isRealBacktestCell(cell)) return '-';
	return formatBacktestPct(cell?.netPnlPct, true);
}

function backtestStatusText(cell) {
	return BACKTEST_STATUS_LABELS[cell?.status || 'CALC_NA'] || BACKTEST_STATUS_LABELS.CALC_NA;
}

function backtestCellClass(cell) {
	if (!cell || cell.status !== 'OK' || cell.netPnlPct === null || cell.netPnlPct === undefined) return 'backtest-cell-neutral';
	if (Number(cell.netPnlPct) > 0) return 'backtest-cell-positive';
	if (Number(cell.netPnlPct) < 0) return 'backtest-cell-negative';
	return 'backtest-cell-neutral';
}

function bestBacktestCellKey(matrix, periods, tpList) {
	let best = null;
	for (const period of periods) {
		for (const tp of tpList) {
			const tpKey = String(tp);
			const cell = matrix?.[period]?.[tpKey];
			if (!isRealBacktestCell(cell)) continue;
			const value = Number(cell.netPnlPct);
			if (!best || value > best.value) best = { key: `${period}:${tpKey}`, value };
		}
	}
	return best?.key || null;
}

function backtestPnlCellClass(cell, isBest = false) {
	return `${backtestCellClass(cell)} backtest-pnl-cell${isBest ? ' backtest-cell-best' : ''}`;
}

function isAlgorithmBacktestMatrix(matrix) {
	return Boolean(matrix && typeof matrix === 'object' && 'buy' in matrix && 'sell' in matrix);
}

function displayPeriods(stats) {
	const periods = Array.isArray(stats?.periods) ? stats.periods : [];
	const known = BACKTEST_PERIOD_ORDER.filter((period) => periods.includes(period));
	return known.length > 0 ? known : periods;
}

function gridPeriodHasRealBacktest(matrix, period) {
	return Object.values(matrix?.[period] || {}).some(isRealBacktestCell);
}

function algorithmPeriodHasRealBacktest(matrix, period) {
	return ['buy', 'sell'].some((side) => Object.values(matrix?.[side]?.[period] || {}).some(isRealBacktestCell));
}

function displayRealPeriods(stats) {
	const periods = displayPeriods(stats);
	const matrix = stats?.matrix || {};
	if (isAlgorithmBacktestMatrix(matrix)) return periods.filter((period) => algorithmPeriodHasRealBacktest(matrix, period));
	return periods.filter((period) => gridPeriodHasRealBacktest(matrix, period));
}

function displayTpList(stats) {
	return Array.isArray(stats?.tpListPct) ? stats.tpListPct.map((tp) => Number(tp)).filter((tp) => Number.isFinite(tp)).sort((a, b) => a - b) : [];
}

function displayRealGridTpList(stats, periods) {
	const matrix = stats?.matrix || {};
	return displayTpList(stats).filter((tp) => periods.some((period) => isRealBacktestCell(matrix?.[period]?.[String(tp)])));
}

function isAlgorithmBestCase(bestcase) {
	return Boolean(bestcase && typeof bestcase === 'object' && 'buy' in bestcase && 'sell' in bestcase);
}

function isBestCaseEntry(value) {
	return Boolean(value && typeof value === 'object' && 'status' in value);
}

function emptyBestCaseEntry(period) {
	return {
		period,
		tpPct: null,
		winratePct: null,
		netPnlPct: null,
		status: 'CALC_NA'
	};
}

function bestCaseByPeriod(value, periods) {
	const rows = Object.fromEntries(periods.map((period) => [period, emptyBestCaseEntry(period)]));
	if (isBestCaseEntry(value)) {
		const period = value.period && periods.includes(value.period) ? value.period : periods.includes('all') ? 'all' : periods[0];
		if (period) rows[period] = { ...value, period };
		return rows;
	}
	for (const period of periods) {
		rows[period] = value?.[period] || rows[period];
	}
	return rows;
}

function BacktestBestCaseTable({ title, bestcase, periods }) {
	const rows = bestCaseByPeriod(bestcase, periods);
	const realPeriods = periods.filter((period) => isRealBacktestCell(rows[period]));
	if (!realPeriods.length) {
		return (
			<div className="backtest-bestcase-block">
				<h4>{title}</h4>
				<p className="backtest-real-empty">status=OK 실측 백테스트 값이 없습니다.</p>
			</div>
		);
	}
	return (
		<div className="backtest-bestcase-block">
			<h4>{title}</h4>
			<table className="backtest-bestcase-table">
				<thead>
					<tr>
						<th>기간</th>
						<th>TP</th>
						<th>승률</th>
						<th>수익률</th>
						<th>상태</th>
					</tr>
				</thead>
				<tbody>
					{realPeriods.map((period) => {
						const entry = rows[period];
						return (
							<tr key={period}>
								<td>{periodLabel(period)}</td>
								<td>{entry.tpPct === null ? '-' : tpLabel(entry.tpPct)}</td>
								<td>{backtestWinrateText(entry)}</td>
								<td className={entry.netPnlPct === null || entry.netPnlPct === undefined ? 'backtest-cell-neutral' : Number(entry.netPnlPct) >= 0 ? 'backtest-cell-positive' : 'backtest-cell-negative'}>{backtestNetPnlText(entry)}</td>
								<td>{backtestStatusText(entry)}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function BacktestBestCasePanel({ stats }) {
	const periods = displayRealPeriods(stats);
	const bestcase = stats?.bestcase || {};
	return (
		<div className="backtest-bestcase-panel">
			<h3>BestCase</h3>
			{isAlgorithmBestCase(bestcase) ? (
				<>
					<BacktestBestCaseTable title="매수 BestCase" bestcase={bestcase.buy} periods={periods} />
					<BacktestBestCaseTable title="매도 BestCase" bestcase={bestcase.sell} periods={periods} />
				</>
			) : (
				<BacktestBestCaseTable title="Grid BestCase" bestcase={bestcase} periods={periods} />
			)}
		</div>
	);
}

function normalizeBacktestStrategyType(value) {
	return String(value || '').trim().toLowerCase();
}

function isReadyBacktestForType(item, expectedType) {
	return item?.status === 'READY' && normalizeBacktestStrategyType(item?.strategyType) === expectedType;
}

function BacktestGridTable({ stats }) {
	if (isAlgorithmBacktestMatrix(stats?.matrix)) return null;
	const matrix = stats?.matrix || {};
	const periods = displayRealPeriods(stats);
	const tpList = displayRealGridTpList(stats, periods);
	if (!periods.length || !tpList.length) return <p className="backtest-real-empty">status=OK 실측 백테스트 값이 없습니다.</p>;
	const bestKey = bestBacktestCellKey(matrix, periods, tpList);
	return (
		<div className="backtest-table-wrap">
			<table className="backtest-table">
				<thead>
					<tr>
						<th className="backtest-corner-head" rowSpan={2}>TP</th>
						{periods.map((period) => (
							<th className="backtest-period-head" key={period} colSpan={2}>
								{periodLabel(period)}
							</th>
						))}
					</tr>
					<tr>
						{periods.map((period) => (
							<Fragment key={`${period}-metrics`}>
								<th className="backtest-metric-head">승률</th>
								<th className="backtest-metric-head">수익률</th>
							</Fragment>
						))}
					</tr>
				</thead>
				<tbody>
					{tpList.map((tp) => {
						const tpKey = String(tp);
						return (
							<tr key={tpKey}>
								<td className="backtest-tp-cell">{tpLabel(tp)}</td>
								{periods.map((period) => {
									const cell = matrix?.[period]?.[tpKey];
									const isBest = `${period}:${tpKey}` === bestKey;
									return (
										<Fragment key={period}>
											<td className="backtest-rate-cell" title={backtestStatusText(cell)}>{backtestWinrateText(cell)}</td>
											<td className={backtestPnlCellClass(cell, isBest)} title={isBest ? `최고 수익률 · ${backtestStatusText(cell)}` : backtestStatusText(cell)}>{backtestNetPnlText(cell)}</td>
										</Fragment>
									);
								})}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function BacktestAlgorithmTable({ stats }) {
	const [selectedSide, setSelectedSide] = useState('buy');
	if (!isAlgorithmBacktestMatrix(stats?.matrix)) return null;
	const matrix = stats.matrix;
	const periods = displayRealPeriods(stats);
	const selectedMatrix = matrix[selectedSide] || {};
	const tpList = displayTpList(stats).filter((tp) => periods.some((period) => isRealBacktestCell(selectedMatrix?.[period]?.[String(tp)])));
	if (!periods.length || !tpList.length) return <p className="backtest-real-empty">status=OK 실측 백테스트 값이 없습니다.</p>;
	const bestKey = bestBacktestCellKey(selectedMatrix, periods, tpList);
	return (
		<div className="backtest-algorithm-panel">
			<div className="backtest-side-toggle" role="group" aria-label="백테스트 방향 선택">
				<button type="button" className={selectedSide === 'buy' ? 'active' : ''} onClick={() => setSelectedSide('buy')}>
					매수
				</button>
				<button type="button" className={selectedSide === 'sell' ? 'active' : ''} onClick={() => setSelectedSide('sell')}>
					매도
				</button>
			</div>
			<div className="backtest-table-wrap">
				<table className="backtest-table">
					<thead>
						<tr>
							<th className="backtest-corner-head" rowSpan={2}>TP</th>
							{periods.map((period) => (
								<th className="backtest-period-head" key={period} colSpan={2}>
									{periodLabel(period)}
								</th>
							))}
						</tr>
						<tr>
							{periods.map((period) => (
								<Fragment key={`${selectedSide}-${period}-metrics`}>
									<th className="backtest-metric-head">승률</th>
									<th className="backtest-metric-head">수익률</th>
								</Fragment>
							))}
						</tr>
					</thead>
					<tbody>
						{tpList.map((tp) => {
							const tpKey = String(tp);
							return (
								<tr key={tpKey}>
									<td className="backtest-tp-cell">{tpLabel(tp)}</td>
									{periods.map((period) => {
										const cell = selectedMatrix?.[period]?.[tpKey];
										const isBest = `${period}:${tpKey}` === bestKey;
										return (
											<Fragment key={`${selectedSide}-${period}`}>
												<td className="backtest-rate-cell" title={backtestStatusText(cell)}>{backtestWinrateText(cell)}</td>
												<td className={backtestPnlCellClass(cell, isBest)} title={isBest ? `최고 수익률 · ${backtestStatusText(cell)}` : backtestStatusText(cell)}>{backtestNetPnlText(cell)}</td>
											</Fragment>
										);
									})}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function BacktestPanel({ itemType, backtests }) {
	const strategy = strategyByItemType[itemType] || {};
	const expectedType = itemType === 'ny_box' ? 'grid' : itemType === 'fear_greed' ? 'algorithm' : '';
	const ready = Array.isArray(backtests) ? backtests.find((item) => isReadyBacktestForType(item, expectedType)) : null;
	if (!ready) {
		const missing = Array.isArray(backtests) ? backtests.find((item) => item?.status === 'NO_BACKTEST_DATA') : null;
		return (
			<section className="backtest-section">
				<div className="nybox-backtest-head">
					<div>
						<strong>{strategy.title}</strong>
						<p>{strategy.description}</p>
					</div>
					<StatusBadge tone="muted">NO_REAL_DATA</StatusBadge>
				</div>
				<div className="backtest-footnote">
					<p>아직 수신된 백테스트 데이터가 없습니다.</p>
					<p className="backtest-debug-line">strategy_id: {missing?.strategyId || strategy.strategyId || '-'}</p>
					<p className="backtest-debug-line">symbol: {missing?.symbol || '-'}</p>
					<p className="backtest-debug-line">timeframe: {missing?.timeframe || '-'}</p>
				</div>
			</section>
		);
	}
	return (
		<section className="backtest-section">
			<div className="nybox-backtest-head">
				<div>
					<strong>{ready.stats?.displayName || strategy.title}</strong>
					<p>{strategy.description}</p>
				</div>
			</div>
			{expectedType === 'grid' ? <BacktestGridTable stats={ready.stats} /> : <BacktestAlgorithmTable stats={ready.stats} />}
			<BacktestBestCasePanel stats={ready.stats} />
		</section>
	);
}

function DetailSection({ title, description, rows }) {
	return (
		<div className="zone-list modal-detail-section">
			<div className="nybox-section-header">
				<strong>{title}</strong>
				{description ? <span>{description}</span> : null}
			</div>
			{rows.map((row) => (
				<div className="zone-row nybox-kv-row modal-detail-kv-row" key={`${title}-${row.label}`}>
					<span>{row.label}</span>
					<strong className={row.tone ? `value-tone ${row.tone}` : undefined}>{row.valueNode ?? row.value ?? '-'}</strong>
				</div>
			))}
		</div>
	);
}

function EligibilityNotice({ type }) {
	return (
		<div className="backtest-footnote">
			<p>{type === 'backtest' ? '이 종목은 현재 1차 백테스트 제공 대상이 아닙니다.' : '이 종목은 현재 1차 자동매매 제공 대상이 아닙니다.'}</p>
		</div>
	);
}

function ModalActionRow({ autoTradeEligible = true }) {
	return (
		<div className="modal-cta-row">
			{autoTradeEligible ? (
				<a className="icon-text-button primary" href="/take-profit-search">
					자동매매 하기
				</a>
			) : null}
			<a className="icon-text-button" href="#tradingview-chart">
				트레이딩뷰 차트 사용하기
			</a>
		</div>
	);
}

function NyBoxDetail({ detail, row, activeTab, autoTradeEligible, backtestEligible }) {
	const state = detail?.state || row;
	const modal = detail?.nyBoxModal;
	const [selectedStrategyImageLabel, setSelectedStrategyImageLabel] = useState(NY_BOX_STRATEGY_IMAGES[0].label);
	const selectedStrategyImage = NY_BOX_STRATEGY_IMAGES.find((image) => image.label === selectedStrategyImageLabel) || NY_BOX_STRATEGY_IMAGES[0];
	const overviewSections = buildNyBoxOverviewSections(state, modal);
	const disclaimerStart = modal?.nySessionStartKst || modal?.baselineNySessionDate || '-';
	const disclaimerEnd = modal?.nySessionEndKst || modal?.nyDataCalculatedAtKst || '-';

	useEffect(() => {
		setSelectedStrategyImageLabel(NY_BOX_STRATEGY_IMAGES[0].label);
	}, [state?.symbol]);

	return (
		<>
			{activeTab === 'overview' ? (
				<div className="modal-overview-layout">
					{modal?.isNySessionActive ? (
						<div className="zone-list">
							<div className="zone-row">
								<span>안내</span>
								<strong>{modal.notice || '-'}</strong>
							</div>
						</div>
					) : null}
					{overviewSections.length
						? overviewSections.map((section) => <DetailSection key={section.title} title={section.title} description={section.description} rows={section.rows} />)
						: null}
					<div className="modal-disclaimer">
						<p>한국시간 기준 {disclaimerStart}부터 {disclaimerEnd}까지의 뉴욕 세션 거래 데이터를 기반으로 작성했습니다.</p>
						<p>이 데이터는 정보 제공 목적이며 주문이나 포지션을 만들지 않습니다.</p>
					</div>
				</div>
			) : null}
			{activeTab === 'strategy' ? (
				<div className="nybox-strategy-layout">
					<div className="nybox-strategy-message">
						<strong>뉴욕 박스 그리드 전략</strong>
						<p>
							{modal?.isNySessionActive
								? `현재 뉴욕 세션 데이터가 집계 중입니다. 다음 체크 시각은 ${modal?.nyDataCalculatedAtKst || '-'}입니다.`
								: state?.gridStrategyAvailable
									? `${state?.symbol}은 현재 뉴욕 박스 그리드 참고 조건을 만족합니다.`
									: `${state?.symbol}은 현재 뉴욕 박스 그리드 참고 조건을 만족하지 않습니다.`}
						</p>
						<p>실제 Bot 설치와 주문 설정은 로그인 후 보호된 화면에서만 진행됩니다.</p>
					</div>
					<div className="strategy-visual-layout">
						<div className="strategy-nav strategy-nav-vertical" aria-label="뉴욕 박스 전략 이미지 선택">
							{NY_BOX_STRATEGY_IMAGES.map(({ label }) => (
								<button
									key={label}
									type="button"
									className={label === selectedStrategyImage.label ? 'active' : undefined}
									onClick={() => setSelectedStrategyImageLabel(label)}
								>
									{label}
								</button>
							))}
						</div>
						<div className="strategy-visual-main">
							<figure className="strategy-image-panel">
								<img src={selectedStrategyImage.src} alt={selectedStrategyImage.alt} />
							</figure>
							<div className="strategy-image-description">
								<strong>{selectedStrategyImage.label}</strong>
								<p>{selectedStrategyImage.description}</p>
							</div>
						</div>
					</div>
					{autoTradeEligible ? null : <EligibilityNotice type="autoTrade" />}
					<ModalActionRow autoTradeEligible={autoTradeEligible} />
				</div>
			) : null}
			{activeTab === 'backtest' ? (
				<>
					{backtestEligible ? <BacktestPanel row={state} itemType="ny_box" backtests={detail?.backtests} /> : <EligibilityNotice type="backtest" />}
					{autoTradeEligible ? null : <EligibilityNotice type="autoTrade" />}
					<ModalActionRow autoTradeEligible={autoTradeEligible} />
				</>
			) : null}
		</>
	);
}

function FearGreedDetail({ detail, row, activeTab, autoTradeEligible, backtestEligible }) {
	const baseState = detail?.state || row;
	const [selectedPeriod, setSelectedPeriod] = useState(baseState?.timeframe || 'short');

	useEffect(() => {
		setSelectedPeriod(baseState?.timeframe || 'short');
	}, [baseState?.symbol, baseState?.timeframe]);

	const periodStates = detail?.periodStates || { [baseState?.timeframe || 'short']: baseState };
	const state = periodStates[selectedPeriod] || baseState;
	const selectedPeriodLabel = TIMEFRAMES.find((period) => period.value === selectedPeriod)?.label || '단기';
	const activeState = latestFearGreedEvent(state).state;
	const priceChangeFrom = (eventPrice) => {
		if (!state?.currentPrice || !eventPrice || eventPrice <= 0) return '-';
		return formatPercent(((state.currentPrice - eventPrice) / eventPrice) * 100, 2, true);
	};
	const coverageText = state?.candleCoverage
		? `${state.candleCoverage.candleCount}/${state.candleCoverage.requiredCount}개 ${state.candleCoverage.ready ? '준비됨' : '수집 중'}`
		: state?.sourceStatus === 'INSUFFICIENT_DATA'
			? '수집 중'
			: '준비됨';
	const fearStateText = activeState === '공포' ? '공포' : activeState === '수집 중' ? '수집 중' : activeState === '-' ? '-' : '정상';
	const greedStateText = activeState === '탐욕' ? '탐욕' : activeState === '수집 중' ? '수집 중' : activeState === '-' ? '-' : '정상';

	return (
		<>
			{activeTab === 'overview' ? (
				<div className="modal-overview-layout">
					<div className="modal-period-controls" role="tablist" aria-label="공포/탐욕 기간 선택">
						{TIMEFRAMES.map((period) => (
							<button key={period.value} type="button" className={selectedPeriod === period.value ? 'active' : ''} disabled={!periodStates?.[period.value]} onClick={() => setSelectedPeriod(period.value)}>
								{period.label}
							</button>
						))}
					</div>
					<DetailSection
						title="현재가"
						description="현재 row에 포함된 가격 정보입니다."
						rows={[
							{ label: '종목명', value: displayAssetText(state?.symbol, state?.baseAsset) },
							{ label: '현재가', value: formatPrice(state?.currentPrice) },
							{ label: '24시간 변동률', value: formatPercent(state?.currentPriceChange24hPct, 2, true) },
							{ label: '공포/탐욕 현재 상태', value: activeState },
							{ label: '전략명', value: 'ATF+VIXFIX' },
							{ label: '기준 기간 / 데이터 기준', value: state?.calculationWindow?.label || '-' },
							{ label: '캔들 수집', value: coverageText }
						]}
					/>
					<DetailSection
						title="공포"
						description="공포 이벤트 발생과 해소 기준입니다."
						rows={[
							{ label: '현재 상태', value: fearStateText },
							{ label: '최근 공포 발생 시간', value: formatKstMonthDayTime(state?.fearStartedAt) },
							{ label: '최근 공포 해소 시간', value: formatKstMonthDayTime(state?.fearResolvedAt) },
							{ label: '공포 발생가', value: formatPrice(state?.fearStartedPrice) },
							{ label: '공포 해소가', value: formatPrice(state?.fearResolvedPrice) },
							{ label: '공포 발생가 대비 현재가', value: priceChangeFrom(state?.fearStartedPrice) },
							{ label: '공포 해소가 대비 현재가', value: priceChangeFrom(state?.fearResolvedPrice) }
						]}
					/>
					<DetailSection
						title="탐욕"
						description="탐욕 이벤트 발생과 해소 기준입니다."
						rows={[
							{ label: '현재 상태', value: greedStateText },
							{ label: '최근 탐욕 발생 시간', value: formatKstMonthDayTime(state?.greedStartedAt) },
							{ label: '최근 탐욕 해소 시간', value: formatKstMonthDayTime(state?.greedResolvedAt) },
							{ label: '탐욕 발생가', value: formatPrice(state?.greedStartedPrice) },
							{ label: '탐욕 해소가', value: formatPrice(state?.greedResolvedPrice) },
							{ label: '탐욕 발생가 대비 현재가', value: priceChangeFrom(state?.greedStartedPrice) },
							{ label: '탐욕 해소가 대비 현재가', value: priceChangeFrom(state?.greedResolvedPrice) }
						]}
					/>
					<DetailSection
						title="추세"
						description="ATF 기준 추세 계산 결과입니다."
						rows={[
							{ label: `${selectedPeriodLabel} 추세`, value: state?.sourceStatus === 'INSUFFICIENT_DATA' ? '데이터 수집 중' : state?.currentTrendLabel || '데이터 부족' },
							{ label: 'ATF 기준', value: state?.calculationWindow?.label || '-' }
						]}
					/>
					<div className="modal-disclaimer">
						<p>공포/탐욕 정보는 과도한 가격 변동과 추세 상태를 이해하기 위한 참고 정보입니다.</p>
					</div>
				</div>
			) : null}
			{activeTab === 'strategy' ? (
				<div className="nybox-strategy-layout">
					<div className="nybox-strategy-message">
						<strong>ATF+VIXFIX 전략 참고</strong>
						<p>ATF+VIXFIX는 과도한 공포 또는 탐욕 이벤트가 발생한 뒤 가격 변동이 해소되는 흐름을 확인하는 알고리즘 전략입니다.</p>
						<p>실제 Bot 설치와 주문 설정은 로그인 후 보호된 화면에서만 진행됩니다.</p>
					</div>
					<div className="strategy-placeholder">전략 설명 이미지 영역</div>
					<div className="strategy-nav">
						{['작동원리 1', '작동원리 2', '작동원리 3', '강점', 'Risk'].map((label) => (
							<button key={label} type="button">
								{label}
							</button>
						))}
					</div>
					{autoTradeEligible ? null : <EligibilityNotice type="autoTrade" />}
					<ModalActionRow autoTradeEligible={autoTradeEligible} />
				</div>
			) : null}
			{activeTab === 'backtest' ? (
				<>
					{backtestEligible ? <BacktestPanel row={state} itemType="fear_greed" backtests={detail?.backtests} /> : <EligibilityNotice type="backtest" />}
					{autoTradeEligible ? null : <EligibilityNotice type="autoTrade" />}
					<ModalActionRow autoTradeEligible={autoTradeEligible} />
				</>
			) : null}
		</>
	);
}

function markerPercent(value, min, max) {
	if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 50;
	return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function RangeBar({ markers = [], zones = [] }) {
	const values = [
		...markers.map((marker) => Number(marker.value)),
		...zones.flatMap((zone) => [Number(zone.low), Number(zone.high)])
	].filter(Number.isFinite);
	const min = values.length ? Math.min(...values) : 0;
	const max = values.length ? Math.max(...values) : 1;
	return (
		<div className="range-wrap">
			<div className="range-track">
				{zones.map((zone, index) => (
					<span
						key={`${zone.kind}-${index}`}
						className={`range-zone ${zone.kind}`}
						style={{
							left: `${markerPercent(Number(zone.low), min, max)}%`,
							width: `${Math.max(2, markerPercent(Number(zone.high), min, max) - markerPercent(Number(zone.low), min, max))}%`
						}}
					/>
				))}
				{markers.map((marker) => (
					<span key={`${marker.label}-${marker.value}`} className={`range-marker ${marker.kind}`} style={{ left: `${markerPercent(Number(marker.value), min, max)}%` }}>
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

function formatUsdM(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric < 0) return '-';
	return `$${numeric.toFixed(numeric >= 100 ? 0 : 1)}M`;
}

function zoneText(level, missingText) {
	if (!level) return missingText;
	const parts = [`${formatPrice(level.low)} ~ ${formatPrice(level.high)}`];
	if (level.zoneNotionalUsdM !== undefined) parts.push(`거래대금 ${formatUsdM(level.zoneNotionalUsdM)}`);
	if (level.zoneSharePct !== undefined) parts.push(`전체 비중 ${formatPercent(level.zoneSharePct)}`);
	if (level.shareChangePctPoint !== undefined) parts.push(`전일 대비 ${formatPercent(level.shareChangePctPoint, 2, true)}p`);
	if (level.zoneHeightPct !== undefined) parts.push(`높이 ${formatPercent(level.zoneHeightPct)}`);
	return parts.join(' / ');
}

function movementText(direction, pct) {
	const numeric = Number(pct);
	if (!direction || direction === '비교 불가' || !Number.isFinite(numeric)) return '비교 불가';
	return `${direction} (${formatPercent(numeric, 2, true)})`;
}

function SupportResistanceDetail({ detail, row, activeTab }) {
	const detailState = detail?.state || row;
	const periodStates = detail?.periods || { [detailState?.timeframe || 'long']: detailState };
	const [activePeriod, setActivePeriod] = useState('long');
	const activeState = periodStates?.[activePeriod] || detailState || {};
	const support = publicSupport(activeState);
	const resistance = publicResistance(activeState);
	const currentPrice = getPrice(activeState);
	const markers = [
		support ? { label: '지지 Zone', value: support.mid, kind: 'support' } : null,
		Number.isFinite(Number(currentPrice)) ? { label: '현재가', value: currentPrice, kind: 'price' } : null,
		resistance ? { label: '저항 Zone', value: resistance.mid, kind: 'resistance' } : null
	].filter(Boolean);
	const zones = [support, resistance]
		.filter(Boolean)
		.map((level) => ({
			low: level.low,
			high: level.high,
			kind: Number(level.mid) < Number(currentPrice) ? 'support' : 'resistance'
		}));
	const periodRows = (period) => {
		const state = periodStates?.[period];
		if (!state) {
			return [
				{ label: '지지 Zone', value: '지지 Zone 없음' },
				{ label: '저항 Zone', value: '저항 Zone 없음' },
				{ label: '구간 폭', value: '-' }
			];
		}
		return [
			{ label: '지지 Zone', value: zoneText(publicSupport(state), '지지 Zone 없음') },
			{ label: '저항 Zone', value: zoneText(publicResistance(state), '저항 Zone 없음') },
			{ label: '구간 폭', value: formatPercent(state?.range?.widthPct) }
		];
	};
	const movementRows = TIMEFRAMES.flatMap((period) => {
		const state = periodStates?.[period.value];
		return [
			{ label: `${period.windowLabel} 매물대 이동 [지지선]`, value: state ? movementText(state.supportMovementDirection, state.supportMovementPct) : '비교 불가' },
			{ label: `${period.windowLabel} 매물대 이동 [저항선]`, value: state ? movementText(state.resistanceMovementDirection, state.resistanceMovementPct) : '비교 불가' }
		];
	});
	return (
		<>
			{activeTab === 'overview' ? (
				<div className="modal-overview-layout">
					<div className="modal-period-controls" aria-label="지지선/저항선 상세 기간">
						{TIMEFRAMES.map((period) => (
							<button key={period.value} type="button" className={activePeriod === period.value ? 'active' : ''} onClick={() => setActivePeriod(period.value)}>
								{period.windowLabel}
							</button>
						))}
					</div>
					<RangeBar markers={markers} zones={zones} />
					<DetailSection
						title="현재가"
						description="현재 row에 포함된 가격 정보입니다."
						rows={[
							{ label: '현재가', value: formatPrice(currentPrice) },
							{ label: '현재 상태', value: support && resistance ? activeState?.userPriceState || '-' : '-' }
						]}
					/>
					<DetailSection title="1일 매물대" description="10m 캔들 144개 기준 매물대입니다." rows={periodRows('short')} />
					<DetailSection title="7일 매물대" description="30m 캔들 336개 기준 매물대입니다." rows={periodRows('mid')} />
					<DetailSection title="30일 매물대" description="1h 캔들 720개 기준 매물대입니다." rows={periodRows('long')} />
					<DetailSection title="대표 매물대 위치 이동" description="현재 대표 Zone과 전일 대표 Zone 위치 비교입니다." rows={movementRows} />
					<div className="modal-detail-note">
						<strong>1 day trading tip</strong>
						<p>현재가가 지지 Zone과 저항 Zone 사이에서 어느 쪽에 가까운지 확인하세요. 특정 Zone의 거래대금 비중 변화는 매수 또는 매도 지시가 아닙니다.</p>
					</div>
					<div className="modal-disclaimer">
						<p>기간별 매물대는 과거 공개 거래대금 기준입니다. 지지선 또는 저항선이 이동해도 미래 가격 반응을 보장하지 않습니다.</p>
					</div>
				</div>
			) : null}
			{activeTab === 'strategy' ? (
				<div className="nybox-strategy-layout">
					<div className="nybox-strategy-message">
						<strong>가격대 분석 참고</strong>
						<p>지지선과 저항선은 공개 가격·거래량 데이터에서 추출한 참고 구간입니다.</p>
					</div>
				</div>
			) : null}
			{activeTab === 'backtest' ? <BacktestPanel row={row} itemType="support_resistance" /> : null}
		</>
	);
}

function LevelModal({ row, itemType, detail, loading, error, autoTradeEligible = true, backtestEligible = true, onClose }) {
	const [activeTab, setActiveTab] = useState('overview');
	useEffect(() => {
		setActiveTab('overview');
	}, [itemType, row?.symbol]);

	if (!row && !detail && !loading) return null;
	const config = PUBLIC_ITEM_TYPES.find((item) => item.key === itemType) || PUBLIC_ITEM_TYPES[0];
	const detailState = detail?.state || row;
	const strategyTabLabel = itemType === 'ny_box' ? '뉴욕 박스 그리드 전략' : itemType === 'fear_greed' ? '공포/탐욕 전략' : '지지/저항선 전략';
	const backtestTabLabel = itemType === 'ny_box' ? '뉴욕 박스 그리드 전략 백테스트' : itemType === 'fear_greed' ? '공포/탐욕 백테스트' : '지지/저항선 백테스트';

	return (
		<div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
			<article className="modal" role="dialog" aria-modal="true" aria-label={`${config.label} 상세`} onMouseDown={(event) => event.stopPropagation()}>
				<header className="modal-header">
					<div>
						<p className="modal-kicker">{config.kicker}</p>
						<h2>
							{displayAssetText(detailState?.symbol, detailState?.baseAsset)} · {config.label}
						</h2>
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

				{loading ? <div className="modal-loading">상세 데이터를 불러오는 중입니다.</div> : null}
				{!loading && error ? <div className="empty-state"><strong>상세 데이터를 불러오지 못했습니다.</strong><p>{error}</p></div> : null}
				{!loading && !error && itemType === 'ny_box' ? <NyBoxDetail detail={detail} row={row} activeTab={activeTab} autoTradeEligible={autoTradeEligible} backtestEligible={backtestEligible} /> : null}
				{!loading && !error && itemType === 'fear_greed' ? <FearGreedDetail detail={detail} row={row} activeTab={activeTab} autoTradeEligible={autoTradeEligible} backtestEligible={backtestEligible} /> : null}
				{!loading && !error && itemType === 'support_resistance' ? <SupportResistanceDetail detail={detail} row={row} activeTab={activeTab} /> : null}
			</article>
		</div>
	);
}

function EmptyState({ status, error }) {
	return (
		<div className="empty-state">
			<strong>{status === 'ERROR' ? '데이터를 불러오지 못했습니다.' : '아직 수신된 공개 데이터가 없습니다.'}</strong>
			<p>{status === 'ERROR' ? error || 'public realtime API request failed' : 'RingLevel 공개 데이터가 수신된 뒤 표시됩니다.'}</p>
		</div>
	);
}

function renderTableHeader(itemType) {
	if (itemType === 'ny_box') {
		return (
			<tr>
				<th>종목</th>
				<th>현재가</th>
				<th>박스상단</th>
				<th>박스하단</th>
				<th>현재 위치</th>
			</tr>
		);
	}
	if (itemType === 'fear_greed') {
		return (
			<tr>
				<th>종목</th>
				<th>현재가</th>
				{TIMEFRAMES.map((period) => (
					<th key={period.value}>{period.label}</th>
				))}
			</tr>
		);
	}
	return (
		<tr>
			<th>종목</th>
			<th>현재가</th>
			<th>지지선</th>
			<th>저항선</th>
			<th>돌파·근접 상태</th>
			<th>돌파 발생 시간</th>
		</tr>
	);
}

function renderRow(row, itemType, onOpen, context = {}) {
	const symbol = getSymbol(row);
	const label = getDisplaySymbolLabel(symbol, row?.baseAsset);
	if (itemType === 'ny_box') {
		const position = nyBoxPosition(row);
		return (
			<tr key={`${itemType}-${symbol}-${getUpdatedAt(row)}`} onClick={() => onOpen(row)}>
				<td data-label="종목">
					<span className="table-symbol-cell" title={label.secondarySymbol}>
						<strong>{label.primaryName}</strong>
						<small>{label.secondarySymbol}</small>
					</span>
				</td>
				<td data-label="현재가"><PriceWithChange price={row?.currentPrice} pct={row?.currentPriceChange24hPct} /></td>
				<td data-label="박스상단">{formatPrice(row?.boxTop)}</td>
				<td data-label="박스하단">{formatPrice(row?.boxBottom)}</td>
				<td data-label="현재 위치"><StatusBadge tone={position.className}>{position.label}</StatusBadge></td>
			</tr>
		);
	}
	if (itemType === 'fear_greed') {
		return (
			<tr key={`${itemType}-${symbol}-${getUpdatedAt(row)}`} onClick={() => onOpen(row)}>
				<td data-label="종목">
					<span className="table-symbol-cell" title={label.secondarySymbol}>
						<strong>{label.primaryName}</strong>
						<small>{label.secondarySymbol}</small>
					</span>
				</td>
				<td data-label="현재가"><PriceWithChange price={row?.currentPrice} pct={row?.currentPriceChange24hPct} /></td>
				{TIMEFRAMES.map((period) => {
					const periodDisplay = fearGreedPeriodState(row, context.fearGreedPeriodMap, period.value);
					return (
						<td key={period.value} data-label={period.label}>
							<span className="period-state-cell">
								<StatusBadge tone={statusTone(periodDisplay.state)}>{periodDisplay.state}</StatusBadge>
								<small>{periodDisplay.relativeTime}</small>
							</span>
						</td>
					);
				})}
			</tr>
		);
	}
	const support = publicSupport(row);
	const resistance = publicResistance(row);
	return (
		<tr key={`${itemType}-${symbol}-${getUpdatedAt(row)}`} onClick={() => onOpen(row)}>
			<td data-label="종목">
				<span className="table-symbol-cell" title={label.secondarySymbol}>
					<strong>{label.primaryName}</strong>
					<small>{label.secondarySymbol}</small>
				</span>
			</td>
			<td data-label="현재가"><PriceWithChange price={getPrice(row)} pct={row?.priceChange24hPct} /></td>
			<td data-label="지지선">{formatPrice(support?.mid)}</td>
			<td data-label="저항선">{formatPrice(resistance?.mid)}</td>
			<td data-label="돌파·근접 상태"><StatusBadge tone={statusTone(srDisplayState(row))}>{srDisplayState(row)}</StatusBadge></td>
			<td data-label="돌파 발생 시간">{breakoutTime(row)}</td>
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
	const [detailState, setDetailState] = useState({ loading: false, detail: null, error: '' });

	useEffect(() => {
		let cancelled = false;
		const streamParams = itemType === 'fear_greed' ? { timeframe } : itemType === 'support_resistance' ? { timeframe, logic: 'vp' } : {};
		const applyStreamEvent = (event) => {
			if (cancelled || event?.itemType !== itemType) return;
			if (event.type === 'snapshot' && Array.isArray(event.data)) {
				setState({
					status: event.data.length ? 'READY' : 'NO_REAL_DATA',
					rows: event.data,
					raw: event,
					error: ''
				});
				return;
			}
			if (event.type === 'patch' && event.state?.symbol) {
				setState((prev) => {
					const existingRows = prev.rows || [];
					const index = existingRows.findIndex((row) => row.symbol === event.state.symbol);
					const rows = index >= 0 ? existingRows.map((row, rowIndex) => (rowIndex === index ? event.state : row)) : [event.state, ...existingRows];
					return {
						...prev,
						status: rows.length ? 'READY' : prev.status,
						rows,
						raw: { ...(prev.raw || {}), updatedAt: event.updatedAt || prev.raw?.updatedAt }
					};
				});
			}
		};
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
		const stopStream = publicRealtime.createItemStream(itemType, streamParams, {
			onEvent: applyStreamEvent
		});
		return () => {
			cancelled = true;
			stopStream?.();
		};
	}, [itemType, timeframe]);

	const fearGreedPeriodMap = useMemo(() => buildFearGreedPeriodMapFromRaw(state.raw, timeframe, state.rows), [state.raw, state.rows, timeframe]);
	const config = PUBLIC_ITEM_TYPES.find((item) => item.key === itemType) || PUBLIC_ITEM_TYPES[0];
	const filteredRows = useMemo(() => {
		const search = normalizeSearch(symbolSearch);
		const rows = (state.rows || [])
			.filter(isPublicVisibleRow)
			.filter((row) => isCompletePublicRow(row, itemType))
			.filter((row) => (itemType === 'ny_box' ? matchesNyBoxFilter(row, nyBoxFilter) : true))
			.filter((row) => {
				if (!search) return true;
				return normalizeSearch(getSymbol(row)).includes(search) || normalizeSearch(getDisplaySymbol(row)).includes(search);
			});
		return (itemType === 'ny_box' || itemType === 'fear_greed' ? sortByPublicPriority(rows) : rows).slice(0, 200);
	}, [itemType, nyBoxFilter, state.rows, symbolSearch]);

	const selectedForChart = selectedRow || filteredRows[0] || null;
	const chartSymbol = chartSymbolFor(selectedForChart);
	const openDetail = async (row) => {
		setSelectedRow(row);
		setDetailState({ loading: true, detail: null, error: '' });
		const symbol = getSymbol(row);
		const params = itemType === 'fear_greed' ? { timeframe } : itemType === 'support_resistance' ? { timeframe, logic: 'vp' } : {};
		const res =
			itemType === 'ny_box'
				? await publicRealtime.nyBoxSymbol(symbol, params)
				: itemType === 'fear_greed'
					? await publicRealtime.fearGreedSymbol(symbol, params)
					: await publicRealtime.supportResistanceSymbol(symbol, params);
		if (!res.ok || !res.raw) {
			setDetailState({ loading: false, detail: null, error: res.error || 'detail API request failed' });
			return;
		}
		setDetailState({ loading: false, detail: res.raw, error: '' });
	};

	return (
		<div className="ring-public-app">
			<div className="app-shell">
				<section className="chart-section" id="tradingview-chart">
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
									setDetailState({ loading: false, detail: null, error: '' });
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
								<p className="table-title">전체 {config.label} 표</p>
							</div>
							<div className="toolbar-controls">
								<label className="nybox-search">
									<span>Symbol</span>
									<input value={symbolSearch} onChange={(event) => setSymbolSearch(event.target.value)} placeholder="BTCUSDT" />
								</label>
								{itemType === 'ny_box' ? null : (
									<label className="nybox-filter-grid">
										<span>Timeframe</span>
										<select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
											{(itemType === 'support_resistance' ? SR_TIMEFRAMES : TIMEFRAMES).map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
									</label>
								)}
							</div>
						</div>

						<div className="nybox-panel">
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

						{state.status === 'LOADING' ? <div className="modal-loading">불러오는 중입니다.</div> : null}
						{state.status !== 'LOADING' && filteredRows.length === 0 ? <EmptyState status={state.status} error={state.error} /> : null}
						{filteredRows.length ? (
							<div className="table-wrap">
								<table className={`public-data-table ${itemType}`}>
									<thead>{renderTableHeader(itemType)}</thead>
									<tbody>{filteredRows.map((row) => renderRow(row, itemType, openDetail, { fearGreedPeriodMap }))}</tbody>
								</table>
							</div>
						) : null}
					</div>
				</section>
			</div>
			<LevelModal
				row={selectedRow}
				itemType={itemType}
				detail={detailState.detail}
				loading={detailState.loading}
				error={detailState.error}
				autoTradeEligible={isAutoTradeEligible(selectedRow)}
				backtestEligible={isBacktestEligible(selectedRow)}
				onClose={() => {
					setSelectedRow(null);
					setDetailState({ loading: false, detail: null, error: '' });
				}}
			/>
		</div>
	);
}

export default RealtimeDataPage;
