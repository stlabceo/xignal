import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '../..');

const publicRealtime = readFileSync(resolve(srcRoot, 'services/publicRealtime.js'), 'utf8');
const botSymbolTest = readFileSync(resolve(srcRoot, 'tools/qa/bot-symbol-canonical-contract-test.mjs'), 'utf8');
const perpInstrument = readFileSync(resolve(srcRoot, 'pages/trading/perpInstrument.js'), 'utf8');
const botSetupModal = readFileSync(resolve(srcRoot, 'pages/trading/BotSetupModal.jsx'), 'utf8');

assert.match(perpInstrument, /PERP_INSTRUMENT_TYPE = 'PERP'/, 'shared Perp instrument type is PERP');
assert.match(perpInstrument, /PERP_MARKET_TYPE = 'USD_M_FUTURES'/, 'shared Perp market type is USD-M futures');
assert.match(publicRealtime, /from '\.\.\/pages\/trading\/perpInstrument'/, 'public realtime imports the same Perp contract module');
assert.match(botSetupModal, /from '\.\/perpInstrument'/, 'Bot create modal imports Perp contract module');
assert.match(botSymbolTest, /PERP_MARKET_TYPE/, 'Bot symbol contract test verifies market type');
assert.match(publicRealtime, /normalizePerpNativeSymbol\(symbol\)/, 'public realtime strips .P for native symbol path');
assert.match(botSetupModal, /const normalizeSymbol = normalizePerpNativeSymbol/, 'Bot create strips .P for native symbol payload');
assert.doesNotMatch(publicRealtime, /\.P\.P/, 'public realtime cannot create double .P suffix');
assert.doesNotMatch(botSetupModal, /\.P\.P/, 'Bot create cannot create double .P suffix');

console.log(JSON.stringify({ status: 'PASS', tests: 9 }));
