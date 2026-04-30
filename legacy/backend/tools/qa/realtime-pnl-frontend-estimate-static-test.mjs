import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const helperPath = path.join(repoRoot, 'legacy/frontend/Xignal/web/src/pages/trading/estimatedPnl.js');
const {
  buildEstimatedUnrealizedPnl,
  estimateGridUnrealizedPnl,
  estimateUnrealizedPnl,
} = await import(pathToFileURL(helperPath).href);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const closeEnough = (actual, expected, epsilon = 1e-10) => Math.abs(Number(actual) - Number(expected)) <= epsilon;

const inputRow = {
  positionSide: 'LONG',
  openQty: '18.1',
  avgEntryPrice: '1.382',
  untouched: true,
};
const inputSnapshot = JSON.stringify(inputRow);
const longEstimate = buildEstimatedUnrealizedPnl({ ...inputRow, markPrice: '1.385' });
assert(longEstimate.status === 'ESTIMATED', 'LONG estimate should be available');
assert(closeEnough(longEstimate.value, (1.385 - 1.382) * 18.1), 'LONG estimate value mismatch');
assert(JSON.stringify(inputRow) === inputSnapshot, 'estimated PnL helper must not mutate backend row');

const shortValue = estimateUnrealizedPnl({
  positionSide: 'SHORT',
  openQty: '10',
  avgEntryPrice: '2.50',
  markPrice: '2.40',
});
assert(closeEnough(shortValue, 1), 'SHORT estimate value mismatch');

const flatEstimate = buildEstimatedUnrealizedPnl({
  positionSide: 'LONG',
  openQty: '0',
  avgEntryPrice: '1.0',
  markPrice: '1.1',
});
assert(flatEstimate.status === 'FLAT' && flatEstimate.value === null, 'flat row should not produce estimated PnL');

const noPriceEstimate = buildEstimatedUnrealizedPnl({
  positionSide: 'LONG',
  openQty: '5',
  avgEntryPrice: '1.0',
  markPrice: null,
});
assert(noPriceEstimate.status === 'PRICE_UNAVAILABLE', 'missing price should report PRICE_UNAVAILABLE');

const noEntryEstimate = buildEstimatedUnrealizedPnl({
  positionSide: 'LONG',
  openQty: '5',
  avgEntryPrice: null,
  markPrice: '1.0',
});
assert(noEntryEstimate.status === 'ENTRY_PRICE_UNAVAILABLE', 'missing avg entry should report ENTRY_PRICE_UNAVAILABLE');

const pidA = buildEstimatedUnrealizedPnl({
  positionSide: 'LONG',
  openQty: '18.1',
  avgEntryPrice: '1.382',
  markPrice: '1.385',
});
const pidB = buildEstimatedUnrealizedPnl({
  positionSide: 'LONG',
  openQty: '3.7',
  avgEntryPrice: '1.381',
  markPrice: '1.385',
});
assert(pidA.value > 0 && pidB.value > 0, 'same symbol/side multi-PID estimates should be independently positive');

const gridEstimate = estimateGridUnrealizedPnl(
  {
    longQty: '2',
    longEntryPrice: '100',
    shortQty: '3',
    shortEntryPrice: '110',
  },
  '105'
);
assert(gridEstimate.status === 'ESTIMATED', 'grid estimate should combine long and short legs');
assert(closeEnough(gridEstimate.value, 25), 'grid estimate value mismatch');

const forbiddenFiles = [
  'legacy/backend/track-record-aggregator.js',
  'legacy/backend/revenue-aggregator.js',
  'legacy/backend/routes/admin.js',
  'legacy/frontend/Xignal/web/src/pages/tradingHistory/TradeHistoryPage.jsx',
  'legacy/frontend/Xignal/web/src/pages/admin/AdminConsole.jsx',
];

const leaks = [];
for (const relativePath of forbiddenFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    const source = await fs.readFile(absolutePath, 'utf8');
    if (source.includes('estimatedUnrealizedPnl') || source.includes('FRONTEND_MARK_PRICE_ESTIMATE')) {
      leaks.push(relativePath);
    }
  } catch {
    // Some optional aggregation files do not exist in older branches.
  }
}
assert(leaks.length === 0, `estimated PnL leaked into canonical surfaces: ${leaks.join(', ')}`);

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      cases: [
        'LONG estimated PnL',
        'SHORT estimated PnL',
        'flat row',
        'price unavailable',
        'avgEntry missing',
        'same symbol/side multi-PID mock rows',
        'grid long+short estimate',
        'helper does not mutate backend row object',
        'Track Record/Revenue/Admin canonical leak check',
      ],
    },
    null,
    2
  )
);
