const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const appSource = read('backend/app.js');
const authRouteSource = read('backend/routes/auth.js');
const authServiceSource = read('backend/auth-service.js');
const registerSource = read('frontend/Xignal/web/src/pages/auth/RegisterPage.jsx');
const loginSource = read('frontend/Xignal/web/src/pages/auth/LoginPage.jsx');
const googleButtonSource = read('frontend/Xignal/web/src/pages/auth/AuthGoogleButton.jsx');
const verifyEmailCodeSource = read('frontend/Xignal/web/src/pages/auth/VerifyEmailCodePage.jsx');
const authMvpSource = read('frontend/Xignal/web/src/services/authMvp.js');
const appFrontendSource = read('frontend/Xignal/web/src/App.jsx');
const migrationSource = read('backend/database/migrations/20260614_auth_register_login_mvp.sql');
const emailCodeMigrationSource = read('backend/database/migrations/20260614_auth_email_code_attempt_count.sql');

const forbiddenBackendImports = [
  'order-intent-queue',
  'GRID_LIVE_ARM',
  'grid-runtime',
  'grid-engine',
  'seon',
  'coin.js',
  'pid-position-ledger',
  'position-ownership',
  'live_play_list',
  'test_play_list',
];

const sourceBundle = [authRouteSource, authServiceSource].join('\n');
for (const forbidden of forbiddenBackendImports) {
  assert.ok(!sourceBundle.includes(forbidden), `auth backend must not import or reference ${forbidden}`);
}

assert.ok(appSource.includes("app.use('/api/auth', authRouter);"), 'app mounts /api/auth router');
assert.ok(authRouteSource.includes("router.post('/register'"), 'register endpoint exists');
assert.ok(authRouteSource.includes("router.get('/verify-email'"), 'verify email endpoint exists');
assert.ok(authRouteSource.includes("router.post('/verify-email-code'"), 'verify email code endpoint exists');
assert.ok(authRouteSource.includes("router.post('/resend-verification'"), 'resend endpoint exists');
assert.ok(authRouteSource.includes("router.post('/resend-verification-code'"), 'resend email code endpoint exists');
assert.ok(authRouteSource.includes("router.post('/google'"), 'google endpoint exists');
assert.ok(authRouteSource.includes("router.post('/login'"), 'login endpoint exists');
assert.ok(authRouteSource.includes("router.get('/me'"), 'me endpoint exists');
assert.ok(authRouteSource.includes("router.post('/logout'"), 'logout endpoint exists');

assert.ok(!registerSource.includes('label="ID"'), 'register does not expose ID field');
assert.ok(registerSource.includes('label="E-mail"'), 'register has E-mail field');
assert.ok(registerSource.includes('label="PW"'), 'register has PW field');
assert.ok(registerSource.includes('resolveRegisteredEmail'), 'register normalizes returned email string');
assert.ok(registerSource.includes("typeof value === 'string'"), 'register rejects object email payloads');
assert.ok(!registerSource.includes('label="이름"'), 'register does not collect name');
assert.ok(!registerSource.includes('label="전화번호"'), 'register does not collect phone');
assert.ok(!registerSource.includes('label="SMS"'), 'register does not collect SMS');
assert.ok(!registerSource.includes('label="인증번호"'), 'register does not collect email code input');
assert.ok(!registerSource.includes('label="생년월일"'), 'register does not collect birthday');
assert.ok(!registerSource.includes('label="주소"'), 'register does not collect address');

assert.ok(loginSource.includes('label="E-mail"'), 'login has E-mail field');
assert.ok(!loginSource.includes('ID 또는 E-mail'), 'login does not expose ID fallback label');
assert.ok(loginSource.includes('label="PW"'), 'login has PW field');
assert.ok(!loginSource.includes('label="이름"'), 'login does not collect name');
assert.ok(!loginSource.includes('label="전화번호"'), 'login does not collect phone');
assert.ok(loginSource.includes("EMAIL_NOT_VERIFIED"), 'login redirects unverified users to code verification');

assert.ok(verifyEmailCodeSource.includes('label="E-mail"'), 'verify email code page shows email field');
assert.ok(verifyEmailCodeSource.includes('label="인증번호"'), 'verify email code page has code field');
assert.ok(verifyEmailCodeSource.includes('pattern="[0-9]{6}"'), 'verify email code page requires 6 digits');
assert.ok(verifyEmailCodeSource.includes('onlySixDigits'), 'verify email code page strips non-digits');
assert.ok(verifyEmailCodeSource.includes('resendVerificationCode'), 'verify email code page can resend code');
assert.ok(authMvpSource.includes('/api/auth/verify-email-code'), 'frontend calls verify email code API');
assert.ok(authMvpSource.includes('/api/auth/resend-verification-code'), 'frontend calls resend email code API');

assert.ok(registerSource.includes('AuthGoogleButton'), 'register shows Google button');
assert.ok(loginSource.includes('AuthGoogleButton'), 'login shows Google button');
assert.ok(googleButtonSource.includes('VITE_GOOGLE_AUTH_ORIGIN'), 'Google button supports configured auth origin');
assert.ok(googleButtonSource.includes('127.0.0.1:5174'), 'Google button avoids local 127 origin mismatch');
assert.ok(appFrontendSource.includes('path="/register"'), 'frontend has /register route');
assert.ok(appFrontendSource.includes('path="/login"'), 'frontend has /login route');
assert.ok(appFrontendSource.includes('path="/verify-email"'), 'frontend has /verify-email route');
assert.ok(appFrontendSource.includes('path="/verify-email-code"'), 'frontend has /verify-email-code route');
assert.ok(appFrontendSource.includes('path="/terms"'), 'frontend has /terms route');
assert.ok(appFrontendSource.includes('path="/privacy"'), 'frontend has /privacy route');
assert.ok(appFrontendSource.includes("navigate('/dashboard')") || loginSource.includes("navigate('/dashboard')"), 'login success routes to /dashboard');

for (const required of [
  'email_verified',
  'auth_provider',
  'google_sub',
  'status',
  'auth_email_verification_tokens',
  'token_hash',
  'expires_at',
  'used_at',
  'attempt_count',
]) {
  assert.ok(migrationSource.includes(required), `migration includes ${required}`);
}
assert.ok(emailCodeMigrationSource.includes('attempt_count'), 'incremental email-code migration includes attempt_count');

assert.ok(authServiceSource.includes('hashSha256(validation.password)'), 'register hashes password');
assert.ok(authServiceSource.includes('validateEmailPasswordInput'), 'auth service uses email/password validator');
assert.ok(!authServiceSource.includes('INVALID_LOGIN_ID'), 'auth service no longer validates login id');
assert.ok(authServiceSource.includes('token_hash'), 'verification stores token hash');
assert.ok(authServiceSource.includes('makeEmailCode'), 'auth service generates 6-digit email code');
assert.ok(authServiceSource.includes('hashEmailCode'), 'auth service stores hashed email code');
assert.ok(authServiceSource.includes('verifyEmailCode'), 'auth service verifies email code');
assert.ok(authServiceSource.includes('TOO_MANY_ATTEMPTS'), 'auth service limits code attempts');
assert.ok(authServiceSource.includes('EXPIRED_CODE'), 'auth service distinguishes expired codes');
assert.ok(authServiceSource.includes('AUTH_DEV_EXPOSE_EMAIL_CODE'), 'dev code exposure is explicitly gated');
assert.ok(!authServiceSource.includes('devVerificationUrl = emailResult.verifyUrl'), 'register no longer exposes verification link');
assert.ok(authServiceSource.includes('emailDelivery: emailPayload'), 'register separates email string from delivery payload');
assert.ok(!authServiceSource.includes('email: emailPayload'), 'register must not overwrite email with delivery payload');
assert.ok(!authServiceSource.includes('console.log(process.env.RESEND_API_KEY)'), 'Resend secret is not logged');
assert.ok(!authServiceSource.includes('GOOGLE_CLIENT_SECRET'), 'Google client secret is not used in auth source');

console.log(
  JSON.stringify({
    status: 'PASS',
    tests: 66,
    tradingImports: 0,
    bannedRegisterFields: 0,
    idFields: 0,
    dbDdlInStaticTest: 0,
  })
);
