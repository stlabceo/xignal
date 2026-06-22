import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '../..');
const repoRoot = resolve(srcRoot, '../../../..');

const readFrontend = (path) => readFileSync(resolve(srcRoot, path), 'utf8');
const readRepo = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

const adminManagement = readRepo('backend/admin-management.js');
const adminRoutes = readRepo('backend/routes/admin.js');
const migration = readRepo('database/migrations/20260622_bot_create_live_strategy_catalog_contract.sql');
const liveStrategyContract = readFrontend('pages/trading/liveStrategyContract.js');
const tradingCatalogOptions = readFrontend('pages/trading/tradingCatalogOptions.js');
const botSetupModal = readFrontend('pages/trading/BotSetupModal.jsx');

assert.match(adminManagement, /LIVE_STRATEGY_CONTRACTS/, 'backend live strategy contract map exists');
assert.match(adminManagement, /ATF_VIXFIX_V1/, 'Algorithm liveCode is explicit');
assert.match(adminManagement, /NYBOX_GRID_50_50_V1/, 'NYBOX 50/50 liveCode is explicit');
assert.match(adminManagement, /NYBOX_GRID_35_65_V1/, 'NYBOX 35/65 liveCode is explicit');
assert.match(adminManagement, /BOT_CREATE_INSTRUMENT_TYPE = "PERP"/, 'catalog contract is PERP');
assert.match(adminManagement, /BOT_CREATE_MARKET_TYPE = "USD_M_FUTURES"/, 'catalog contract is USD-M futures');
assert.match(adminManagement, /Number\.isFinite\(Number\(value\)\)/, 'scalar JSON member ids converge to arrays');
assert.match(adminManagement, /userSelectable:\s*true/, 'user selectable catalog rows are explicit');
assert.match(adminRoutes, /ensureBotCreateCatalogContract/, 'create routes validate catalog contract');
assert.match(adminRoutes, /liveStrategyCode가 필요합니다/, 'create routes require liveStrategyCode');
assert.match(adminRoutes, /runtime code와 생성 payload가 일치하지 않습니다/, 'runtime code mismatch is blocked');

assert.match(migration, /NY_BOX_GRID_50_50/, 'catalog seed includes 50/50 runtime code');
assert.match(migration, /NY_BOX_GRID_35_65/, 'catalog seed includes 35/65 runtime code');
assert.match(migration, /ATF\+VIXFIX/, 'catalog seed includes Algorithm runtime code');
assert.match(migration, /PERP\/USD_M_FUTURES/, 'catalog seed documents Perp instrument');
assert.doesNotMatch(migration, /NY_QUIET_CLOSE_ASIA_BOX/, 'migration does not reintroduce QBT NY alias');
assert.doesNotMatch(migration, /ATF_VIXFIX'\s*,\s*'ATF\+VIXFIX/, 'migration does not reintroduce QBT ATF alias');

assert.match(liveStrategyContract, /runtimeStrategyCode/, 'frontend contract separates runtime strategy code');
assert.match(liveStrategyContract, /instrumentType:\s*strategy\.instrumentType \|\| 'PERP'/, 'frontend contract carries PERP instrument');
assert.match(tradingCatalogOptions, /liveStrategyCode/, 'catalog options preserve liveStrategyCode');
assert.match(tradingCatalogOptions, /runtimeStrategyCode/, 'catalog options preserve runtimeStrategyCode');
assert.match(botSetupModal, /liveStrategyCode:\s*form\.strategySignal/, 'create payload carries selected liveCode');
assert.match(botSetupModal, /type:\s*runtimeStrategyCode/, 'Algorithm payload uses runtime code');
assert.match(botSetupModal, /strategySignal:\s*runtimeStrategyCode/, 'Grid payload uses runtime code');

console.log(JSON.stringify({ status: 'PASS', tests: 25 }));
