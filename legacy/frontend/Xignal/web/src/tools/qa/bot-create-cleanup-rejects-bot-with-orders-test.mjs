import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../../../..');
const adminRoutes = readFileSync(resolve(repoRoot, 'backend/routes/admin.js'), 'utf8');

assert.match(adminRoutes, /const loadDraftDependencyCounts = async/, 'cleanup dependency counter exists');
assert.match(adminRoutes, /FROM order_intent_queue/, 'cleanup checks queue rows');
assert.match(adminRoutes, /FROM live_pid_position_ledger/, 'cleanup checks ledger rows');
assert.match(adminRoutes, /FROM live_pid_position_snapshot/, 'cleanup checks snapshot rows');
assert.match(adminRoutes, /FROM live_pid_exit_reservation/, 'cleanup checks reservation rows');
assert.match(adminRoutes, /FROM live_position_bucket_owner/, 'Grid cleanup checks owner rows');
assert.match(adminRoutes, /hasNoDraftDependencies/, 'cleanup requires zero dependencies');
assert.match(adminRoutes, /거래 이력이 있거나 처리 대기 상태가 남아 있는 실거래 전략은 draft cleanup 할 수 없습니다/, 'Algorithm cleanup rejects dirty draft');
assert.match(adminRoutes, /거래 이력이 있거나 처리 대기 상태가 남아 있는 그리드 전략은 draft cleanup 할 수 없습니다/, 'Grid cleanup rejects dirty draft');
assert.match(adminRoutes, /longEntryOrderId/, 'Grid cleanup still checks local order ids');
assert.match(adminRoutes, /shortStopOrderId/, 'Grid cleanup checks stop order ids');
assert.match(adminRoutes, /r_qty/, 'Algorithm cleanup still checks open quantity');

console.log(JSON.stringify({ status: 'PASS', tests: 12 }));
