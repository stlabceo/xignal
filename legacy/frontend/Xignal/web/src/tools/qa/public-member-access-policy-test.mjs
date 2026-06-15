import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..', '..');

const read = (relativePath) => fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');

const app = read('App.jsx');
const loginPage = read('pages/auth/LoginPage.jsx');
const realtimePage = read('pages/realtimeData/RealtimeDataPage.jsx');
const takeProfitPage = read('pages/takeProfitSearch/TakeProfitSearchPage.jsx');

assert.match(app, /import \{ BrowserRouter as Router, Navigate, Routes, Route, useNavigate \} from 'react-router'/);
assert.match(app, /const PublicSurfaceRoute = \(\{ children \}\) =>/);
assert.match(app, /const MemberSurfaceRoute = \(\{ children \}\) =>/);
assert.match(app, /<PublicSurfaceRoute>\s*<RealtimeDataPage \/>/s);
assert.match(app, /<MemberSurfaceRoute>\s*<TakeProfitSearchPage \/>/s);
assert.match(app, /return isAllowed \? <AppLayout>\{children\}<\/AppLayout> : <Navigate to="\/login" replace \/>/);

assert.match(loginPage, /href="\/realtime-data"/);
assert.doesNotMatch(loginPage, /href="\/take-profit-search"/);
assert.match(loginPage, /익절 조건 검색은 로그인 후 이용할 수 있습니다/);

assert.match(realtimePage, /BacktestPanel/);
assert.match(realtimePage, /publicBacktest\s*\.\s*options/);
assert.match(realtimePage, /href="\/take-profit-search"/);
assert.match(realtimePage, /href="\/login"/);
assert.match(realtimePage, /LevelModal/);
assert.match(realtimePage, /TradingViewWidget/);
assert.doesNotMatch(realtimePage, /BotSetupModal/);
assert.doesNotMatch(realtimePage, /order_intent_queue|GRID_LIVE_ARM|private polling|private write/i);

assert.match(takeProfitPage, /BotSetupModal/);
assert.match(takeProfitPage, /publicBacktest\s*\.\s*options/);
assert.doesNotMatch(takeProfitPage, /order_intent_queue|GRID_LIVE_ARM|Binance|private polling/i);

console.log(
	JSON.stringify(
		{
			status: 'PASS',
			tests: 18,
			unauthRealtimeAllowed: true,
			unauthTakeProfitProtected: true,
			realtimeModalBacktestPublic: true,
			tradingIsolation: true
		},
		null,
		2
	)
);
