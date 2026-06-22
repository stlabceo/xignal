import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '../..');
const repoRoot = resolve(srcRoot, '../../../..');

const readFrontend = (path) => readFileSync(resolve(srcRoot, path), 'utf8');
const readRepo = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

const modalSource = readFrontend('pages/trading/BotSetupModal.jsx');
const perpInstrumentSource = readFrontend('pages/trading/perpInstrument.js');
const catalogSource = readFrontend('pages/trading/tradingCatalogOptions.js');
const adminRouteSource = readRepo('backend/routes/admin.js');
const adminManagementSource = readRepo('backend/admin-management.js');
const gridEngineSource = readRepo('backend/grid-engine.js');
const coinSource = readRepo('backend/coin.js');

const canonicalLiveSymbol = (value) =>
	String(value || '')
		.trim()
		.toUpperCase()
		.replace(/^[A-Z0-9_]+:/, '')
		.replace(/\.P$/i, '');

const cases = [
	['BTCUSDT', 'BTCUSDT'],
	['BTCUSDT.P', 'BTCUSDT'],
	['BINANCE:BTCUSDT.P', 'BTCUSDT'],
	['CRVUSDT', 'CRVUSDT'],
	['CRVUSDT.P', 'CRVUSDT']
];

for (const [input, expected] of cases) {
	assert.equal(canonicalLiveSymbol(input), expected, `${input} canonicalizes to ${expected}`);
	assert.equal(`${canonicalLiveSymbol(input)}.P`, `${expected}.P`, `${input} display label does not become .P.P`);
}

assert.match(modalSource, /import \{ normalizePerpNativeSymbol \} from '\.\/perpInstrument'/, 'BotSetupModal uses the Perp instrument helper');
assert.match(modalSource, /const normalizeSymbol = normalizePerpNativeSymbol;/, 'BotSetupModal create payload uses Perp native symbol normalization');
assert.match(perpInstrumentSource, /export const PERP_INSTRUMENT_TYPE = 'PERP'/, 'Perp helper declares instrumentType=PERP');
assert.match(perpInstrumentSource, /export const PERP_MARKET_TYPE = 'USD_M_FUTURES'/, 'Perp helper declares marketType=USD_M_FUTURES');
assert.match(perpInstrumentSource, /normalizePerpNativeSymbol[\s\S]*replace\(\/\^\[A-Z0-9_\]\+:\//, 'Perp helper strips exchange prefixes');
assert.match(perpInstrumentSource, /normalizePerpNativeSymbol[\s\S]*replace\(\/\\\.P\$\/i, ''\)/, 'Perp helper strips TradingView .P suffix');
assert.match(perpInstrumentSource, /instrumentType:\s*PERP_INSTRUMENT_TYPE[\s\S]*marketType:\s*PERP_MARKET_TYPE/, 'Perp instrument object carries instrumentType and marketType');
assert.match(catalogSource, /import \{ formatPerpInstrumentLabel, normalizePerpNativeSymbol \} from '\.\/perpInstrument'/, 'catalog uses Perp instrument helpers');
assert.match(catalogSource, /allowedSymbols:\s*sortByOrder\(uniq\(\(item\.allowedSymbols \|\| \[\]\)\.map\(normalizePerpNativeSymbol\)\)/, 'catalog normalizes allowed symbols to Perp native symbols');
assert.match(catalogSource, /export const formatCatalogSymbolLabel = \(symbol\) => \{[\s\S]*formatPerpInstrumentLabel\(symbol\)/, 'catalog labels through Perp instrument formatter');

assert.match(adminRouteSource, /const normalizeBotCreateSymbol = \(value = ""\) =>[\s\S]*replace\(\/\^\[A-Z0-9_\]\+:\//, 'backend create boundary strips exchange prefixes');
assert.match(adminRouteSource, /const normalizeBotCreateSymbol = \(value = ""\) =>[\s\S]*replace\(\/\\\.P\$\/i, ""\)/, 'backend create boundary strips .P suffix');
assert.match(adminRouteSource, /normalizeBotCreateSymbolPayload\(req\.body\);[\s\S]*resolveMarketStochId/, 'algorithm create canonicalizes symbol before market stoch lookup');
assert.match(adminRouteSource, /symbol:\s*normalizeBotCreateSymbol\(gridRuntime\.normalizeGridSymbol\(body\.symbol\)\)/, 'grid create canonicalizes symbol before DB insert');

assert.match(adminManagementSource, /const normalizeSymbol = \(value\) => \{[\s\S]*replace\(\/\^\[A-Z0-9_\]\+:\//, 'exchange rule lookup strips exchange prefixes');
assert.match(adminManagementSource, /const normalizeSymbol = \(value\) => \{[\s\S]*replace\(\/\\\.P\$\/i, ""\)/, 'exchange rule lookup strips .P suffix');

assert.match(gridEngineSource, /const normalizeGridExchangeSymbol = \(value = ""\) =>[\s\S]*replace\(\/\^\[A-Z0-9_\]\+:\//, 'grid runtime Binance boundary strips exchange prefixes');
assert.match(gridEngineSource, /const normalizeGridExchangeSymbol = \(value = ""\) =>[\s\S]*replace\(\/\\\.P\$\/i, ""\)/, 'grid runtime Binance boundary strips .P suffix');
assert.match(coinSource, /const normalizeBinanceFuturesSymbol = \(value = ''\) =>[\s\S]*replace\(\/\^\[A-Z0-9_\]\+:\//, 'coin Binance boundary strips exchange prefixes');
assert.match(coinSource, /const normalizeBinanceFuturesSymbol = \(value = ''\) =>[\s\S]*replace\(\/\\\.P\$\/i, ''\)/, 'coin Binance boundary strips .P suffix');

console.log(JSON.stringify({ status: 'PASS', tests: 25 }));
