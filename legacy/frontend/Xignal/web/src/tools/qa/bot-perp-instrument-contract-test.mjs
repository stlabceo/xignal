import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '../..');

const read = (path) => readFileSync(resolve(srcRoot, path), 'utf8');

const helperSource = read('pages/trading/perpInstrument.js');
const modalSource = read('pages/trading/BotSetupModal.jsx');
const catalogSource = read('pages/trading/tradingCatalogOptions.js');
const strategySearchSource = read('pages/strategySearch/StrategySearchPage.jsx');
const takeProfitSource = read('pages/takeProfitSearch/TakeProfitSearchPage.jsx');
const publicBacktestSource = read('services/publicBacktest.js');

let tests = 0;
const check = (condition, message) => {
	tests += 1;
	assert.ok(condition, message);
};

check(helperSource.includes("PERP_VENUE = 'BINANCE'"), 'PERP contract fixes venue as Binance');
check(helperSource.includes("PERP_INSTRUMENT_TYPE = 'PERP'"), 'PERP contract fixes instrument type');
check(helperSource.includes("PERP_MARKET_TYPE = 'USD_M_FUTURES'"), 'PERP contract fixes market type');
check(!helperSource.includes("'SPOT'") && !helperSource.includes('"SPOT"'), 'PERP helper never creates spot instrument context');
check(helperSource.includes("replace(/^[A-Z0-9_]+:/, '')"), 'PERP helper strips exchange prefixes such as BINANCE:');
check(helperSource.includes("replace(/\\.P$/i, '')"), 'PERP helper strips TradingView perpetual suffix');
check(helperSource.includes('displaySymbol: nativeSymbol'), 'PERP helper displays canonical native symbol');
check(helperSource.includes('displayName: nativeSymbol ? `${assetName} Perp`'), 'PERP helper displays user-facing Perp label');
check(helperSource.includes('backtestQuerySymbol: nativeSymbol'), 'PERP helper defines backtest query symbol separately');
check(helperSource.includes('liveBotSymbol: nativeSymbol'), 'PERP helper defines live Bot symbol separately');

check(modalSource.includes('normalizeSymbol = normalizePerpNativeSymbol'), 'Bot setup uses live PERP symbol normalization');
check(modalSource.includes('symbol: normalizeSymbol(form.symbol)'), 'Bot create payload sends canonical symbol');
check(!/venue|instrumentType|marketType/.test(modalSource.match(/const makeAlgorithmPayload[\s\S]*?const makeGridPayload/)?.[0] || ''), 'Algorithm payload does not add unsupported instrument fields');
check(!/venue|instrumentType|marketType/.test(modalSource.match(/const makeGridPayload[\s\S]*?const isSuccessfulCreateResponse/)?.[0] || ''), 'Grid payload does not add unsupported instrument fields');

check(catalogSource.includes('formatPerpInstrumentLabel(symbol)'), 'Dashboard catalog symbol labels use PERP display label');
check(catalogSource.includes('normalizePerpNativeSymbol'), 'Dashboard catalog allowed symbols normalize to native symbols');
check(strategySearchSource.includes('buildPerpInstrument(symbol'), 'Strategy search symbol picker builds PERP instrument labels');
check(takeProfitSource.includes('formatPerpInstrumentLabel(row.symbol)'), 'TP search table hides raw .P suffix behind PERP label');
check(publicBacktestSource.includes('normalizePublicBacktestSymbol'), 'public backtest keeps its own query symbol normalization');
check(!takeProfitSource.includes('BTCUSDT.P"') && !takeProfitSource.includes("BTCUSDT.P'"), 'TP search UI does not emphasize raw .P in placeholders');

console.log(JSON.stringify({ status: 'PASS', tests }));
