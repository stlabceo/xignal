import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');

const modalSource = read('pages/trading/BotSetupModal.jsx');
const dashboardSource = read('pages/trading/TradingPage.jsx');
const searchSource = read('pages/takeProfitSearch/TakeProfitSearchPage.jsx');

let tests = 0;
const check = (condition, message) => {
	tests += 1;
	assert.ok(condition, message);
};

check(modalSource.includes('makeAlgorithmPayloadPreview'), 'modal keeps Algorithm payload preview');
check(modalSource.includes('makeGridPayloadPreview'), 'modal keeps Grid payload preview');
check(modalSource.includes('trading.strategyCatalogOptions'), 'modal reads existing strategy catalog');
check(!modalSource.includes('testDetailUpload('), 'modal does not call test add mutation');
check(!modalSource.includes('liveDetailUpload('), 'modal does not call live add mutation');
check(!modalSource.includes('gridTestDetailUpload('), 'modal does not call grid test add mutation');
check(!modalSource.includes('gridLiveDetailUpload('), 'modal does not call grid live add mutation');
check(!modalSource.includes('order_intent_queue'), 'modal does not reference order_intent_queue');
check(!modalSource.includes('GRID_LIVE_ARM'), 'modal does not reference GRID_LIVE_ARM');
check(modalSource.includes('Grid 전략은 별도 손절값을 입력하지 않습니다'), 'Grid branch explains no stop-loss input');
check(modalSource.includes('분할 익절 설정'), 'Algorithm branch exposes split take profit');
check(modalSource.includes('시간 경과 손절'), 'Algorithm branch exposes time stop');
check(dashboardSource.includes('<BotSetupModal'), 'dashboard reuses common modal');
check(searchSource.includes('<BotSetupModal'), 'TP search reuses common modal');
check(!searchSource.includes('const AddBotModal'), 'TP search removed duplicate add modal');

console.log(JSON.stringify({ status: 'PASS', tests }));
