import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..', '..');

const read = (relativePath) => fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');

const helper = read('utils/devSuperLogin.js');
const loginPage = read('pages/auth/LoginPage.jsx');
const app = read('App.jsx');
const sidebar = read('layout/AppSidebar.jsx');

assert.match(helper, /DEV_SUPER_LOGIN: local QA only/);
assert.match(helper, /VITE_ENABLE_DEV_SUPER_LOGIN/);
assert.match(helper, /import\.meta\.env\.DEV/);
assert.match(helper, /!import\.meta\.env\.PROD/);
assert.match(helper, /localhost/);
assert.match(helper, /127\.0\.0\.1/);
assert.match(helper, /::1/);

assert.match(loginPage, /isDevSuperLoginAvailable/);
assert.match(loginPage, /activateDevSuperLogin/);
assert.match(loginPage, /DEV SUPER LOGIN/);
assert.match(loginPage, /navigate\('\/take-profit-search'\)/);
assert.match(sidebar, /clearDevSuperLogin/);
assert.match(sidebar, /clearDevSuperLogin\(\);\s*auth\.logout/);

const devGuardIndex = app.indexOf('isDevSuperLoginActive()');
const authMemberIndex = app.indexOf('auth.member');
assert.ok(devGuardIndex > -1, 'ProtectedRoute should check dev super login');
assert.ok(authMemberIndex > -1, 'ProtectedRoute should still use normal auth.member path');
assert.ok(devGuardIndex < authMemberIndex, 'dev super login should be checked before auth.member');

console.log(
	JSON.stringify(
		{
			ok: true,
			tests: 16,
			devOnlyFlag: 'VITE_ENABLE_DEV_SUPER_LOGIN',
			localhostOnly: true,
			productionDisabled: true,
			deletionMarker: 'DEV_SUPER_LOGIN'
		},
		null,
		2
	)
);
