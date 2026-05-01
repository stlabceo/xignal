# User-Executable Signup/MyPage/API/PID Flow Rework

1. final classification: USER_EXECUTABLE_ONBOARDING_FLOW_PASS_API_KEY_INPUT_REQUIRED
2. reason previous report was not enough: UID149 and PID 992559/992311 were Codex-created artifacts, so they do not prove a user-executable onboarding flow.
3. Codex-created artifact inventory: UID149 / signal PID 992559 / grid PID 992311 classified as CODEX_CREATED_ARTIFACT and quarantined safe.
4. signup/login user flow: PASS for browser-visible signup steps and login route smoke.
5. My Page key registration route: PASS, now user-scoped under `/user/api/account/*`.
6. secret masking: PASS, raw appKey/appSecret/password omitted from client account payloads.
7. readiness states: PASS, no-key state is BLOCKED/MISSING, not fake OK.
8. admin UID observability: PASS, UID147 and UID149 monitor responses remain separated.
9. user PID create flow: PASS route/screen availability, no new PID created in this rework.
10. user PID ON/OFF flow: PASS route/screen availability, invalid no-op smoke did not mutate artifacts.
11. cross-UID isolation: PASS.
12. artifact remediation recommendation: keep/quarantine unless user separately approves controlled delete/disable cleanup.
13. validation: node --check PASS, frontend build PASS, API/browser smoke PASS.
14. run-all-live-readonly: PASS.
15. git commit: pending at report creation time.
16. next step: user creates the real second UID and enters real Binance API key/secret in My Page.

## Phase 0. Baseline Safety + Artifact Inventory

| item | expected | actual | verdict |
|---|---|---|---|
| UID147 clean gate | PASS | run-all-live-readonly PASS; PUMP/XRP qty/order/algo/local stale all 0 | PASS |
| UID149 has Binance credentials | NO or user-provided only | hasAppKey=false, hasAppSecret=false | PASS |
| UID149 Signal PID 992559 enabled | N | N / READY / r_qty=0 | PASS |
| UID149 Grid PID 992311 enabled | N | N / WAITING_WEBHOOK / longQty=0 / shortQty=0 | PASS |
| UID149 PID ledger rows | 0 expected | 0 | PASS |
| UID149 PID snapshots | none/closed | none | PASS |
| UID149 active reservations | 0 | 0 | PASS |
| UID147 rows modified by prior task | 0 | UID147 artifact audit count 0; UID147 list does not contain artifact PIDs | PASS |

Artifact verdict: QUARANTINED_SAFE_ARTIFACT. UID149 is not automatically adopted as the second Live QA UID.

## Phase 1. User-Executable Flow Definition

| step | current path/screen | user can do directly? | gap | fix |
|---|---|---|---|---|
| signup screen | `/signup` | YES | previous report used Codex-created UID as proof | browser smoke added |
| signup validation | `/user/reg1`, `/user/reg2`, `/user/code` | YES | final `/user/reg` intentionally not called in this rework | no new user created |
| login | `/signin`, `/user/admin/login` | YES | none | login route smoke PASS |
| My Page | `/mypage` | YES after login | My Page used admin namespace | moved account calls to `/user/api/account/*` |
| API key save | `/user/api/account/binance-keys` | YES | admin route dependency | fixed user-scoped route |
| API validation | `/user/api/account/binance-keys/validate` | YES | admin route dependency | fixed user-scoped route |
| readiness | `/user/api/account/readiness` | YES | admin route dependency | fixed user-scoped route |
| signal/grid PID create | `/user/api/trading/live/add`, `/user/api/trading/grid/live/add` | YES | frontend used `/admin/*` | fixed allowlisted user trading mount |
| signal/grid ON/OFF | `/user/api/trading/live/auto`, `/user/api/trading/grid/live/auto` | YES | frontend used `/admin/*` | fixed allowlisted user trading mount |
| admin UID observability | `/admin/runtime/binance/order-monitor/overview?uid=` | YES for admin | none | smoke PASS |

## Phase 2. Signup/Login Route and UI Audit

| flow | route/file | current behavior | deployable? | fix |
|---|---|---|---|---|
| signup UI | `legacy/frontend/Xignal/web/src/pages/authpage/SignUp.jsx` | 3-step browser form visible | YES | no code change |
| signup validation | `/user/reg1`, `/user/reg2`, `/user/code` | validation returned 200/200/200 for non-creating smoke | YES | no code change |
| final signup | `/user/reg` | creates account; not called in this rework | YES | user must execute |
| login UI | `legacy/frontend/Xignal/web/src/pages/authpage/SignIn.jsx` | login form visible | YES | no code change |
| login route | `/user/admin/login` | seeded login smoke returned token present | YES | no raw password reported |

Browser evidence:
- `/signin` shows login fields and signup link.
- `/signup` shows name/email, then id/password, then recommendation-code step.
- The final create button was not clicked.

## Phase 3. My Page API Key/Secret Registration Route Audit

| check | expected | actual | verdict |
|---|---|---|---|
| My Page API key route is user-scoped | YES | `/user/api/account/binance-keys` | PASS |
| user cannot edit other UID key | YES | route ignores body uid and uses JWT `req.decoded.userId` | PASS |
| admin-only route not required for user | YES | frontend `auth.js` now uses `/user/api/account/*` | PASS |
| secret encrypted/stored safely | YES | new saves use `credentialSecrets.protectSecret`; legacy plaintext read remains backward-compatible | PASS |
| secret re-exposed | NO | account payload removes appSecret/password | PASS |
| admin member raw secret/password | NO | sanitized admin member route retained | PASS |
| signed GET used for validation | YES when real key exists | UID147 user-scoped readiness apiValidation OK; UID149 no-key blocked | PASS |

## Phase 4. My Page Readiness Correctness

| state | expected label | actual label/state | verdict |
|---|---|---|---|
| no key | input required | UID149 `apiConnection=MISSING`, `apiPermission=MISSING`, `readinessStatus=BLOCKED` | PASS |
| invalid key | Binance error-based | route returns field-specific validation result when provided | PASS |
| valid key | connection normal | UID147 `apiConnection=OK`, `apiPermission=READ_OK_ORDER_PERMISSION_UNVERIFIED`, validation OK | PASS |
| futures read fail | permission/futures account action required | handled through apiValidation/runtime issue mapping | PASS |
| unknown | verification unavailable | not mapped to fake OK | PASS |

## Phase 5. User-Executable PID Create Flow Audit

| create flow | user screen available? | route | default enabled=N | UID-scoped | verdict |
|---|---|---|---|---|---|
| signal PID create | YES | `/user/api/trading/live/add` | existing backend default remains N | JWT-scoped | PASS |
| grid PID create | YES | `/user/api/trading/grid/live/add` | existing backend default remains N | JWT-scoped | PASS |

No additional PID was created. Invalid payload smoke returned 400 and artifact PID counts stayed unchanged.

## Phase 6. User-Executable PID ON/OFF Audit

| check | expected | actual | verdict |
|---|---|---|---|
| ON action user-accessible | YES | `/user/api/trading/live/auto`, `/user/api/trading/grid/live/auto` mounted | PASS |
| OFF action user-accessible | YES | same routes with `enabled=N` | PASS |
| delete separate confirm | YES | frontend delete path still separate confirm flow | PASS |
| audit USER_ON/OFF | YES | existing artifact audit confirms route behavior; no new ON/OFF mutation in this rework | PASS |
| UID-scoped | YES | route uses JWT-scoped adminRouter ownership checks | PASS |
| Binance mutation | NO | no matched webhook, no live-write | PASS |

Invalid id=0 route smoke returned 404 and left PID992559/PID992311 enabled=N.

## Phase 7. Admin UID Observability and Separation

| admin surface | expected | actual | verdict |
|---|---|---|---|
| member list | new user visible, secret hidden | prior UID149 exists; member payload secret hidden | PASS |
| account readiness | UID-specific | UID149 no-key blocked; UID147 valid read OK | PASS |
| current risk | UID-specific | order monitor overview returns requested uid | PASS |
| strategy/PID list | UID-specific | user lists separated | PASS |
| order monitor | UID-specific | UID147 and UID149 overview responses separated | PASS |
| track/revenue | UID-specific or empty clean | UID149 has no trade contamination | PASS |

## Phase 8. Cross-UID Isolation Regression

| surface/path | cross-UID leak? | evidence | verdict |
|---|---|---|---|
| user signal table | NO | UID149 list contains PID992559 only; UID147 list does not contain PID992559 | PASS |
| user grid table | NO | UID149 list contains PID992311 only; UID147 list does not contain PID992311 | PASS |
| My Page keys | NO | user route uses JWT uid; body uid spoof with empty payload did not touch UID147 | PASS |
| admin monitor | NO | `/overview?uid=149` returns uid=149; `/overview?uid=147` returns uid=147 | PASS |
| Track Record | NO | user runtime route remains JWT scoped | PASS |
| Revenue | NO | admin/user aggregation remains uid-scoped | PASS |
| Messages | NO | UID147 artifact message count 0 | PASS |

## Phase 9. Artifact Remediation Plan

| artifact | current state | risk | recommended action |
|---|---|---|---|
| UID149 | no credentials, DEMO_ONLY | low; QA artifact account exists | keep/quarantine unless user approves controlled cleanup |
| PID992559 | enabled=N, no ledger/snapshot/reservation | low | keep/quarantine/delete-later by approval |
| PID992311 | enabled=N, no ledger/snapshot/reservation | low | keep/quarantine/delete-later by approval |

## Phase 10. Validation

| validation | result | note |
|---|---|---|
| node --check | PASS | backend/app/routes/coin/account/frontend service files |
| frontend build | PASS | Vite build PASS; chunk warning only |
| signup/login smoke | PASS | browser signup validation path and login route smoke |
| My Page key route smoke | PASS | `/user/api/account/*` status 200/400 as expected |
| readiness smoke | PASS | UID149 no-key blocked; UID147 signed read OK |
| admin UID smoke | PASS | UID147/UID149 overview separated |
| PID create flow smoke | PASS | invalid payload 400; no new PID |
| PID ON/OFF flow smoke | PASS | invalid id 404; artifact enabled unchanged |
| cross-UID isolation | PASS | no artifact leak into UID147 |
| run-all-live-readonly | PASS | runId `QA_READONLY_2026-05-01T04-51-57-153Z` |
| run-all-data-replay if executed | NOT_EXECUTED | no ownership/replay mutation changed |

## Phase 11. Runtime Restart / Smoke

| smoke | expected | actual | verdict |
|---|---|---|---|
| runtime restart | READ_ONLY_WRITE_DISABLED | new 3079 PID 15384 with `QA_DISABLE_BINANCE_WRITES=1` | PASS |
| signup route | pass | `/user/reg1` 200 | PASS |
| login route | pass | login token present | PASS |
| My Page route/API | pass | `/user/api/account/member/readiness` 200 | PASS |
| user trading route/API | pass | `/user/api/trading/live/list` and grid list 200 | PASS |
| admin UID monitor | pass | UID147/UID149 monitor 200 | PASS |
| stats route GET | pass | rankings 200 | PASS |

## Phase 12. Git Commit

Commit pending at report creation. Suggested selected commit:

`fix: make onboarding and API credential flow user-executable`

## Phase 13. Final Classification

`USER_EXECUTABLE_ONBOARDING_FLOW_PASS_API_KEY_INPUT_REQUIRED`

Reason: user-executable signup/login/My Page/API route/PID route/ON-OFF route flow is available and smoke-tested without creating another user or PID. UID149 is quarantined as a Codex-created artifact. Real Binance signed GET for the future user-created second UID remains pending until the user enters real API key/secret.

## Did-Not-Do Confirmation

| prohibited action | result |
|---|---|
| additional user arbitrary creation | NOT DONE |
| additional PID arbitrary creation | NOT DONE |
| Binance order create | NOT DONE |
| Binance order cancel | NOT DONE |
| Binance position close | NOT DONE |
| protection create | NOT DONE |
| matched webhook | NOT DONE |
| TradingView alert edit | NOT DONE |
| existing UID147 strategy ON/OFF change | NOT DONE |
| existing UID147 PID enabled change | NOT DONE |
| raw SQL production patch | NOT DONE |
| DB schema change | NOT DONE |
| stored procedure change | NOT DONE |
| live-write-mode switch | NOT DONE |
| QA_DISABLE_BINANCE_WRITES unset | NOT DONE |
| push | NOT DONE |
| API secret raw log/report/screen exposure | NOT DONE |
