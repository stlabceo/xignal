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
const takeProfitDataSource = read('data/takeProfitSearchData.js');

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
check(modalSource.includes('orderAmountLabel'), 'modal shows margin x leverage order amount label');
check(!modalSource.includes('switchCategory'), 'modal does not expose broad Grid/Algorithm category tabs');
check(modalSource.includes('handleStrategyChange'), 'modal derives category from strategy selection');
check(modalSource.includes('설치 확인'), 'modal includes install confirmation section');
check(dashboardSource.includes('<BotSetupModal'), 'dashboard reuses common modal');
check(searchSource.includes('<BotSetupModal'), 'TP search reuses common modal');
check(!searchSource.includes('const AddBotModal'), 'TP search removed duplicate add modal');
check(dashboardSource.includes('실시간 손익'), 'dashboard renames recent event column to live PnL');
check(dashboardSource.includes('On/Off'), 'dashboard renames management column to On/Off');
check(dashboardSource.includes('formatCompactAmount(margin)}$ X ${formatCompactAmount(leverage)'), 'dashboard formats trade amount as margin x leverage');
check(dashboardSource.includes("recentEvent: position ? formatSignedAmount(position.pnl, ' USDT') : 'Ready'"), 'dashboard live PnL omits LONG/SHORT position text');
check(!dashboardSource.includes('최근 이벤트'), 'dashboard no longer labels live PnL as recent event');
check(dashboardSource.includes('{row.strategyName}</span>'), 'dashboard bot name chip renders strategy name');
check(dashboardSource.includes('<p className="text-sm font-semibold text-[#2563EB]">{bot.strategyName}</p>'), 'detail modal header renders strategy name');
check(!dashboardSource.includes('Technical category'), 'detail modal does not reintroduce Algorithm/Grid category as a displayed setting');
check(!dashboardSource.includes("import { filterTakeProfitRows, normalizeQbtStats, qbtStatsFixture }"), 'detail modal does not use local QBT fixture as production backtest');
check(modalSource.includes("import { publicBacktest } from '../../services/publicBacktest'"), 'setup modal reads Ring Levels public backtest API');
check(searchSource.includes("import { publicBacktest } from '../../services/publicBacktest'"), 'TP search reads Ring Levels public backtest API');
check(dashboardSource.includes('publicBacktest.detail'), 'detail modal uses Ring Levels public detail API');
check(!dashboardSource.includes('trading.getBacktestStats'), 'detail modal no longer uses admin backtest stats API');
check(!modalSource.includes('qbtStatsFixture'), 'setup modal does not use local QBT fixture as production backtest');
check(!searchSource.includes('qbtStatsFixture'), 'TP search does not use local QBT fixture as production backtest');
check(dashboardSource.includes('normalizeBacktestStrategyKey'), 'detail modal separates displayed strategy name from backtest query key');
check(dashboardSource.includes('TRACK_RECORD_PERIODS'), 'detail modal has track record period filters');
check(dashboardSource.includes('조건 수정 API 연결 필요'), 'detail modal disables edit until safe API wiring');
check(dashboardSource.includes('formatSplitTakeProfit'), 'detail modal renders split take profit from real fields');
check(dashboardSource.includes('formatStopLossTime'), 'detail modal renders time stop from real fields');
check(takeProfitDataSource.includes("NY_QUIET_CLOSE_ASIA_BOX: 'NY Quiet Close Asia Box Grid'"), 'NYBOX label uses real strategy display name');

console.log(JSON.stringify({ status: 'PASS', tests }));
