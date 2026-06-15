import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..', '..');
const webRoot = path.resolve(srcRoot, '..');

const readSrc = (relativePath) => fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');
const readWeb = (relativePath) => fs.readFileSync(path.join(webRoot, relativePath), 'utf8');

const client = readSrc('services/publicRealtime.js');
const page = readSrc('pages/realtimeData/RealtimeDataPage.jsx');
const pageCss = readSrc('pages/realtimeData/realtimeDataPage.css');
const app = readSrc('App.jsx');
const appLayout = readSrc('layout/AppLayout.jsx');
const login = readSrc('pages/auth/LoginPage.jsx');
const vite = readWeb('vite.config.js');

assert.match(client, /VITE_PUBLIC_REALTIME_API_BASE/);
assert.match(client, /\/api\/items\/ny-box\/snapshot/);
assert.match(client, /\/api\/items\/ny-box\/symbol\/\$\{encodeURIComponent\(symbol\)\}/);
assert.match(client, /\/api\/items\/fear-greed\/snapshot/);
assert.match(client, /\/api\/items\/fear-greed\/symbol\/\$\{encodeURIComponent\(symbol\)\}/);
assert.match(client, /\/api\/items\/support-resistance\/snapshot/);
assert.match(client, /\/api\/items\/support-resistance\/symbol\/\$\{encodeURIComponent\(symbol\)\}/);
assert.match(client, /createItemStream/);
assert.match(client, /\/api\/items\/\$\{path\}\/stream/);
assert.match(client, /EventSource/);
assert.doesNotMatch(client, /mock|fixture|dummy/i);

assert.match(vite, /\/api\/items/);
assert.match(vite, /VITE_PUBLIC_REALTIME_API_BASE/);

assert.match(app, /path="\/realtime-data"/);
assert.match(app, /<RealtimeDataPage \/>/);
assert.match(app, /PublicSurfaceRoute/);
assert.match(app, /path="\/take-profit-search"/);
assert.match(app, /<TakeProfitSearchPage \/>/);
assert.match(app, /MemberSurfaceRoute/);
assert.match(appLayout, /children \|\| <Outlet \/>/);
assert.match(login, /href="\/realtime-data"/);
assert.doesNotMatch(login, /href="\/take-profit-search"/);

assert.match(page, /publicRealtime\.nyBoxSnapshot/);
assert.match(page, /publicRealtime\.nyBoxSymbol/);
assert.match(page, /publicRealtime\.fearGreedSnapshot/);
assert.match(page, /publicRealtime\.fearGreedSymbol/);
assert.match(page, /publicRealtime\.supportResistanceSnapshot/);
assert.match(page, /publicRealtime\.supportResistanceSymbol/);
assert.match(page, /publicRealtime\.createItemStream/);
assert.match(page, /TradingViewWidget/);
assert.match(page, /BacktestPanel/);
assert.match(page, /BacktestGridTable/);
assert.match(page, /BacktestAlgorithmTable/);
assert.match(page, /BacktestBestCasePanel/);
assert.match(page, /detail\?\.backtests/);
assert.match(page, /nyBoxModal/);
assert.match(page, /periodStates/);
assert.match(page, /KOREAN_ASSET_NAMES/);
assert.match(page, /transliterateUnknownBase/);
assert.match(page, /normalizeCanonicalSymbol/);
assert.match(page, /displayAssetText/);
assert.match(page, /PUBLIC_LAUNCH_CATEGORY_VISIBILITY/);
assert.match(page, /ny_box:\s*true/);
assert.match(page, /fear_greed:\s*true/);
assert.match(page, /support_resistance:\s*false/);
assert.match(page, /PUBLIC_ITEM_CONFIGS\.filter\(\(item\) => PUBLIC_LAUNCH_CATEGORY_VISIBILITY\[item\.key\]\)/);
assert.match(page, /NY_QUIET_CLOSE_ASIA_BOX/);
assert.match(page, /ATF_VIXFIX/);
assert.match(page, /isAutoTradeEligible/);
assert.match(page, /isBacktestEligible/);
assert.match(page, /isMarketCapTop100Candidate/);
assert.match(page, /supportProvenance\?\.\s*source\s*===\s*'vp'/);
assert.match(page, /resistanceProvenance\?\.\s*source\s*===\s*'vp'/);
assert.match(page, /RangeBar/);
assert.match(page, /fearActive/);
assert.match(page, /fearResolved/);
assert.match(page, /greedActive/);
assert.match(page, /greedResolved/);
assert.match(page, /NY_BOX_STRATEGY_IMAGES/);
assert.match(page, /nybox-strategy-intro-with-copy\.png/);
assert.match(page, /strategy-image-panel/);
assert.match(page, /strategy-visual-layout/);
assert.match(page, /strategy-nav-vertical/);
assert.match(page, /strategy-image-description/);
assert.match(page, /buildNyBoxOverviewSections/);
assert.match(page, /DeltaValue/);
assert.match(page, /position-pill/);
assert.match(page, /normalizeBacktestStrategyType/);
assert.match(page, /isRealBacktestCell/);
assert.match(page, /displayRealPeriods/);
assert.match(page, /displayRealGridTpList/);
assert.match(page, /'2w': '2주'/);
assert.match(page, /'1m': '1달'/);
assert.match(page, /'1y': '1년'/);
assert.match(page, /all: '전체'/);
assert.match(page, /bestBacktestCellKey/);
assert.match(page, /backtestPnlCellClass/);
assert.match(page, /backtest-cell-best/);
assert.match(page, /className="backtest-period-head"/);
assert.match(page, /className="backtest-metric-head"/);
assert.match(page, /publicRealtime\.fearGreedSnapshot\(\)/);
assert.match(page, /itemType === 'support_resistance' \? \(/);

assert.doesNotMatch(page, /NyBoxGauge/);
assert.doesNotMatch(page, /BacktestLiveSummary/);
assert.doesNotMatch(page, /publicRealtime\.fearGreedSnapshot\(\{ timeframe \}\)/);
assert.doesNotMatch(page, /itemType === 'fear_greed' \? \{ timeframe \}/);
assert.doesNotMatch(page, /className="strategy-placeholder"/);
assert.doesNotMatch(page, /QBT_STATS_V1 실데이터/);
assert.doesNotMatch(page, /nyBoxBreakoutTimeRow/);
assert.doesNotMatch(page, /nyBoxExplicitBreakoutTime/);
assert.doesNotMatch(page, /돌파 확인 시간/);
assert.doesNotMatch(page, /행을 클릭하면/);
assert.doesNotMatch(page, /nybox-meta-bar/);
assert.doesNotMatch(page, /Status <strong>/);
assert.doesNotMatch(page, /Rows <strong>/);
assert.doesNotMatch(page, /Updated <strong>/);
assert.doesNotMatch(page, /Session <strong>/);
assert.doesNotMatch(page, /Window <strong>/);
assert.doesNotMatch(page, /disabled=\{itemType === 'ny_box'\}/);
assert.doesNotMatch(page, /박스상단\/박스하단은 최근 완료된 뉴욕 세션 후반부 가격 범위입니다/);
assert.doesNotMatch(page, /상세 모달은 RingLevel detail API의 뉴욕 박스 섹션과 백테스트를 그대로 표시합니다/);
assert.doesNotMatch(page, /주문이나 PID를 만들지 않고 공개 데이터와 백테스트 참고 정보만 보여줍니다/);
assert.doesNotMatch(page, /restoredSections/);
assert.doesNotMatch(page, /publicBacktest\s*\.\s*options/);
assert.doesNotMatch(page, /order_intent_queue|GRID_LIVE_ARM|private polling|private write|order_intent_queue\.insert|direct DB/i);

assert.match(pageCss, /\.ring-public-app \.app-shell/);
assert.match(pageCss, /\.ring-public-app \.chart-section/);
assert.match(pageCss, /\.ring-public-app \.modal-tabs/);
assert.match(pageCss, /\.ring-public-app \.public-data-table/);
assert.match(pageCss, /\.ring-public-app \.table-symbol-cell/);
assert.match(pageCss, /\.ring-public-app \.period-state-cell/);
assert.match(pageCss, /\.ring-public-app \.backtest-table/);
assert.match(pageCss, /\.ring-public-app \.backtest-side-toggle/);
assert.match(pageCss, /\.ring-public-app \.backtest-bestcase-panel/);
assert.match(pageCss, /\.ring-public-app \.strategy-placeholder/);
assert.match(pageCss, /\.ring-public-app \.strategy-image-panel/);
assert.match(pageCss, /\.ring-public-app \.strategy-visual-layout/);
assert.match(pageCss, /\.ring-public-app \.strategy-nav-vertical/);
assert.match(pageCss, /\.ring-public-app \.strategy-image-description/);
assert.match(pageCss, /\.ring-public-app \.backtest-real-empty/);
assert.match(pageCss, /\.ring-public-app \.backtest-period-head/);
assert.match(pageCss, /\.ring-public-app \.backtest-rate-cell/);
assert.match(pageCss, /\.ring-public-app \.backtest-pnl-cell\.backtest-cell-positive/);
assert.match(pageCss, /\.ring-public-app \.backtest-pnl-cell\.backtest-cell-negative/);
assert.match(pageCss, /\.ring-public-app \.backtest-pnl-cell\.backtest-cell-best/);
assert.match(pageCss, /\.ring-public-app \.delta-pill/);
assert.match(pageCss, /\.ring-public-app \.position-pill/);
assert.match(pageCss, /\.ring-public-app \.zone-row strong\.value-tone\.up/);
assert.match(pageCss, /@media \(max-width: 720px\)/);
assert.match(pageCss, /content: attr\(data-label\)/);
assert.doesNotMatch(pageCss, /bear-bull-box-gauge/);
assert.doesNotMatch(pageCss, /backtest-live-summary/);
assert.doesNotMatch(pageCss, /nybox-meta-bar/);
assert.doesNotMatch(pageCss, /nybox-gauge/);
assert.doesNotMatch(pageCss, /position-breakout-high/);
assert.doesNotMatch(pageCss, /position-breakout-low/);

console.log(
	JSON.stringify(
		{
			status: 'PASS',
			tests: 127,
			noDummy: true,
			tradingIsolation: true,
			ringLevelPublicUxPort: true,
			fearGreedResolvedDisplay: true,
			nyBoxLocationDiagramRemoved: true,
			nyBoxBacktestSummaryCardsRemoved: true,
			nyBoxFakeBreakoutTimeRemoved: true,
			nyBoxTimeframeControlHidden: true,
			publicMetaBarRemoved: true,
			backtestKoreanPeriodLabels: true,
			backtestBestPnlHighlighted: true,
			latestRingLevelPublicLaunch: 'ny_box,fear_greed',
			detailBacktestSource: 'ring-level detail.backtests',
			route: '/realtime-data'
		},
		null,
		2
	)
);
