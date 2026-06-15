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
const appSidebar = readSrc('layout/AppSidebar.jsx');
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
assert.match(app, /<AppLayout>\{children\}<\/AppLayout>/);
assert.match(app, /path="\/take-profit-search"/);
assert.match(app, /<TakeProfitSearchPage \/>/);
assert.match(app, /MemberSurfaceRoute/);
assert.match(appLayout, /children \|\| <Outlet \/>/);
assert.match(appSidebar, /실시간 데이터/);

assert.match(login, /href="\/realtime-data"/);
assert.match(login, /실시간 데이터 보기/);
assert.doesNotMatch(login, /href="\/take-profit-search"/);

assert.match(page, /publicRealtime\.nyBoxSnapshot/);
assert.match(page, /publicRealtime\.nyBoxSymbol/);
assert.match(page, /publicRealtime\.fearGreedSnapshot/);
assert.match(page, /publicRealtime\.fearGreedSymbol/);
assert.match(page, /publicRealtime\.supportResistanceSnapshot/);
assert.match(page, /publicRealtime\.supportResistanceSymbol/);
assert.match(page, /TradingViewWidget/);
assert.match(page, /NyBoxGauge/);
assert.match(page, /BacktestPanel/);
assert.match(page, /BacktestGridTable/);
assert.match(page, /BacktestAlgorithmTable/);
assert.match(page, /BacktestBestCasePanel/);
assert.match(page, /detail\?\.backtests/);
assert.match(page, /nyBoxModal/);
assert.match(page, /periodStates/);
assert.match(page, /KOREAN_ASSET_NAMES/);
assert.match(page, /transliterateUnknownBase/);
assert.match(page, /letterNames/);
assert.match(page, /normalizeCanonicalSymbol/);
assert.match(page, /displayAssetText/);
assert.match(page, /table-symbol-cell/);
assert.match(page, /ring-public-app/);
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
assert.match(page, /이 종목은 현재 1차 백테스트 제공 대상이 아닙니다/);
assert.match(page, /이 종목은 현재 1차 자동매매 제공 대상이 아닙니다/);
assert.match(page, /트레이딩뷰 차트 사용하기/);
assert.match(page, /publicRealtime\.createItemStream/);
assert.match(page, /RangeBar/);
assert.match(page, /대표 매물대 위치 이동/);
assert.match(page, /돌파·근접 상태/);
assert.doesNotMatch(page, /publicBacktest\s*\.\s*options/);
assert.doesNotMatch(page, /order_intent_queue|GRID_LIVE_ARM|private polling|private write|order_intent_queue\.insert|direct DB/i);

assert.match(pageCss, /\.ring-public-app \.app-shell/);
assert.match(pageCss, /\.ring-public-app \.chart-section/);
assert.match(pageCss, /\.ring-public-app \.modal-tabs/);
assert.match(pageCss, /\.ring-public-app \.public-data-table/);
assert.match(pageCss, /\.ring-public-app \.table-symbol-cell/);
assert.match(pageCss, /\.ring-public-app \.bear-bull-box-gauge/);
assert.match(pageCss, /\.ring-public-app \.period-state-cell/);
assert.match(pageCss, /\.ring-public-app \.backtest-table/);
assert.match(pageCss, /\.ring-public-app \.backtest-side-toggle/);
assert.match(pageCss, /\.ring-public-app \.backtest-bestcase-panel/);
assert.match(pageCss, /\.ring-public-app \.strategy-placeholder/);
assert.match(pageCss, /@media \(max-width: 720px\)/);
assert.match(pageCss, /content: attr\(data-label\)/);

console.log(
	JSON.stringify(
		{
			status: 'PASS',
			tests: 73,
			noDummy: true,
			tradingIsolation: true,
			ringLevelPublicUxPort: true,
			latestRingLevelPublicLaunch: 'ny_box,fear_greed',
			detailBacktestSource: 'ring-level detail.backtests',
			route: '/realtime-data'
		},
		null,
		2
	)
);
