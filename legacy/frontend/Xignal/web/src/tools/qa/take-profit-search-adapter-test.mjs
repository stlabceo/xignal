import assert from 'node:assert/strict';
import {
	filterTakeProfitRows,
	normalizeQbtStats,
	qbtStatsFixture
} from '../../data/takeProfitSearchData.js';

const rows = normalizeQbtStats(qbtStatsFixture);

assert.ok(rows.length >= 7, 'QBT fixture normalizes to searchable rows');
assert.ok(rows.some((row) => row.strategyId === 'ATF_VIXFIX' && row.direction === 'BUY' && row.directionLabel === '매수'));
assert.ok(rows.some((row) => row.strategyId === 'ATF_VIXFIX' && row.direction === 'SELL' && row.directionLabel === '매도'));
assert.ok(rows.some((row) => row.strategyId === 'NY_QUIET_CLOSE_ASIA_BOX' && row.direction === 'BOTH' && row.directionLabel === '양방향'));

const strictRows = filterTakeProfitRows(rows, {
	strategyId: 'NY_QUIET_CLOSE_ASIA_BOX',
	period: '3m',
	minWinrate: 55,
	minReturn: 15
});
assert.equal(strictRows.length, 1, 'filters apply symbol/strategy/period/min thresholds');
assert.equal(strictRows[0].symbol, 'SOLUSDT.P');

const sortedRows = filterTakeProfitRows(rows, { period: 'all' });
for (let index = 1; index < sortedRows.length; index += 1) {
	assert.ok(
		Number(sortedRows[index - 1].netPnlPct || 0) >= Number(sortedRows[index].netPnlPct || 0),
		'rows sort by netPnlPct descending'
	);
}

assert.ok(rows.every((row) => row.sourceDataset === 'public_backtest'), 'rows remain public_backtest only');

console.log(JSON.stringify({ status: 'PASS', tests: 8, rows: rows.length }));
