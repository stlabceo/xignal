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
const app = readSrc('App.jsx');
const appLayout = readSrc('layout/AppLayout.jsx');
const appSidebar = readSrc('layout/AppSidebar.jsx');
const login = readSrc('pages/auth/LoginPage.jsx');
const vite = readWeb('vite.config.js');

assert.match(client, /VITE_PUBLIC_REALTIME_API_BASE/);
assert.match(client, /\/api\/items\/ny-box\/snapshot/);
assert.match(client, /\/api\/items\/fear-greed\/snapshot/);
assert.match(client, /\/api\/items\/support-resistance\/snapshot/);
assert.doesNotMatch(client, /mock|fixture|dummy/i);

assert.match(vite, /\/api\/items/);
assert.match(vite, /VITE_PUBLIC_REALTIME_API_BASE/);

assert.match(app, /path="\/realtime-data"/);
assert.match(app, /<RealtimeDataPage \/>/);
assert.match(app, /PublicSurfaceRoute/);
assert.match(app, /<AppLayout>\{children\}<\/AppLayout>/);
assert.match(app, /path="\/take-profit-search"/);
assert.match(app, /<TakeProfitSearchPage \/>/);
assert.match(appLayout, /children \|\| <Outlet \/>/);
assert.match(appSidebar, /실시간 데이터/);

assert.match(login, /\/realtime-data/);
assert.match(login, /실시간 데이터 보기/);

assert.match(page, /publicRealtime\.nyBoxSnapshot/);
assert.match(page, /publicRealtime\.fearGreedSnapshot/);
assert.match(page, /publicRealtime\.supportResistanceSnapshot/);
assert.match(page, /publicBacktest\s*\.\s*options/);
assert.doesNotMatch(page, /order_intent_queue|GRID_LIVE_ARM|Binance|private polling/i);

console.log(
	JSON.stringify(
		{
			status: 'PASS',
			tests: 21,
			noDummy: true,
			tradingIsolation: true,
			route: '/realtime-data'
		},
		null,
		2
	)
);
