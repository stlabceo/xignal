# 2-UID Production-Ready Onboarding + MyPage API Connection + PID Create/ON Readiness

1. final classification: TWO_UID_ONBOARDING_READY_WITH_API_KEY_USER_INPUT_REQUIRED
2. baseline clean gate: PASS
3. convergence commit verified: b580694 present
4. new UID: 149
5. signup/login: PASS
6. API key registration: route/display PASS, real key input required
7. Binance signed GET/futures read: UID147 control PASS, UID149 pending user key input
8. My Page readiness: PASS, no fake OK for missing credentials
9. admin UID observability: PASS
10. new UID PID create: PASS
11. new UID PID ON/OFF: PASS, final enabled=N
12. cross-UID isolation: PASS
13. user/admin regression: PASS
14. stats regression: PASS
15. validation: node --check PASS, frontend build PASS
16. run-all-live-readonly: PASS
17. git commit: pending at report creation
18. next step: user enters UID149 Binance API key/secret, then rerun signed GET/futures read readiness

## Executive Summary

The second UID onboarding flow is production-shaped and ready up to the point where a real Binance API key/secret must be provided by the user. I created UID149 through the user registration/login flow, verified My Page readiness, verified secret masking, created one signal PID and one grid PID under UID149, tested ON/OFF only for those new PIDs, and returned both to enabled=N.

No Binance order/create/cancel/close/protection action was executed. No UID147 row was modified. No matched webhook was sent.

Because no real UID149 Binance API key/secret was provided, the final classification is not full live-readiness. The UI/API correctly shows missing credentials instead of pretending the account is connected.

## Phase 0. Clean Baseline

| item | expected | actual | verdict |
|---|---|---|---|
| b580694 commit exists | YES | YES | PASS |
| qa-config.local staged | NO | NO | PASS |
| Binance PUMP/XRP flat | YES | qty 0, openOrders 0, openAlgoOrders 0 | PASS |
| local openQty 0 | YES | PUMP/XRP local openQty 0 | PASS |
| active reservation 0 | YES | 0 | PASS |
| run-all-live-readonly baseline | PASS | PASS | PASS |
| runtime mode | READ_ONLY_WRITE_DISABLED | QA_DISABLE_BINANCE_WRITES=1 runtime restarted | PASS |
| QA_DISABLE_BINANCE_WRITES | 1 | 1 | PASS |

Note: UID147 currently has 10 signal and 6 grid strategies enabled in DB. This task did not change them; live-write-mode remained disabled.

## Phase 1. Flow Inventory And Fixes

| flow | route/file | current behavior | deployable? | gap | fix |
|---|---|---|---|---|---|
| signup | `/user/reg1`, `/user/reg2`, `/user/code`, `/user/reg` | real route available | YES | smoke payload initially omitted password for reg2 | corrected route smoke PASS |
| login | `/user/admin/login` | token issued | YES | none | none |
| API key registration | `/admin/member/keys` | stores key/secret | PARTIAL | client member API exposed raw secret before fix | sanitized `/admin/member` response |
| Binance read verification | `/admin/member/keys/validate`, `/admin/account/readiness` | signed GET validation used when credentials exist | YES | readiness could rely on runtime health only | added API validation evidence |
| My Page readiness | `account-readiness.js`, `Mypage.jsx` | evidence-based labels | YES | secret display and vague copy | masked key, secret never re-exposed, readiness copy cleaned |
| signal PID create | `/admin/live/add` | uid-scoped, default enabled=N | YES | none found | verified |
| grid PID create | `/admin/grid/live/add` | uid-scoped, default enabled=N | YES | none found | verified |
| PID ON/OFF | `/admin/live/auto`, `/admin/grid/live/auto` | uid-owned item only | YES | none found for new flat PID | verified |
| admin UID monitor | ops overview/order monitor | UID filter/separation works | YES | response uses `item` array not `items` | verified using actual shape |

## Phase 2. Second UID

| item | value | verdict |
|---|---|---|
| new user created? | YES | PASS |
| new UID | 149 | PASS |
| login success | HTTP 200/token issued | PASS |
| session/token valid | user API routes accepted token | PASS |
| My Page reachable | API/readiness reachable | PASS |
| Trading page reachable | signal/grid list APIs reachable | PASS |
| Track Record reachable | `/admin/live/track-record/runtime/recent` HTTP 200 | PASS |

Additional route smoke: corrected signup validation smoke returned reg1=200, reg2=200, code=200.

## Phase 3. API Key And Binance Readiness

| check | expected | actual | verdict |
|---|---|---|---|
| API key stored | user input required | not stored for UID149 | WAITING_USER_INPUT |
| secret re-exposed | NO | `/admin/member` has no appKey/appSecret/password fields | PASS |
| signed GET | PASS after real key | pending UID149 key input | WAITING_USER_INPUT |
| futures account read | PASS after real key | pending UID149 key input | WAITING_USER_INPUT |
| permission status | evidence-based | UID149 shows API_KEY_MISSING; UID147 control shows OK | PASS |
| IP restriction | evidence-based | no fake error for UID149; UID147 validation OK | PASS |
| investment-ready USDT | displayed | readiness returns balance only when snapshot exists | PASS |
| hedge mode status | displayed | present | PASS |
| hedge mode auto flow | present | endpoint present | PASS |
| hedge write under read-only | blocked | blockedByWriteGuard=true | PASS |

UID147 control readiness: apiConnection=OK, apiPermission=READ_OK_ORDER_PERMISSION_UNVERIFIED, apiValidationOk=true, readinessStatus=READY.

UID149 readiness: apiConnection=MISSING, apiPermission=MISSING, issues=API_KEY_MISSING and ACCOUNT_SNAPSHOT_MISSING. This is correct until the user enters real Binance credentials.

## Phase 4. Admin UID Observability

| admin surface | UID147 visible | new UID visible | separated by UID? | verdict |
|---|---|---|---|---|
| account connection | YES | YES | YES | PASS |
| current risk board | YES | YES | YES | PASS |
| order cycles | YES | YES | YES | PASS |
| protection matrix | YES | YES | YES | PASS |
| issue center | YES | YES | YES | PASS |
| raw Binance orders | YES | YES | YES | PASS |
| strategy control history | YES | YES | YES | PASS |

Evidence: ops users overview HTTP 200 includes UID147 and UID149; order monitor overview for UID149 and UID147 both HTTP 200 and returned distinct `uid` values.

## Phase 5. New UID PID Create

| created PID | UID | category | strategy | symbol | timeframe | enabled | status/regime | snapshot | reservation | ledger | verdict |
|---:|---:|---|---|---|---|---|---|---|---:|---:|---|
| 992559 | 149 | signal | SQZ+GRID+BREAKOUT / SQZGBRK | PUMPUSDT | 5 | N | READY | 0 open | 0 | 0 | PASS |
| 992311 | 149 | grid | SQZ+GRID | PUMPUSDT | 1H | N | WAITING_WEBHOOK | 0 open | 0 | 0 | PASS |

## Phase 6. New UID PID ON/OFF

| pid | category | action | expected | actual | verdict |
|---:|---|---|---|---|---|
| 992559 | signal | ON | enabled=Y + audit USER_ON | enabled=Y + USER_ON | PASS |
| 992559 | signal | OFF | enabled=N + audit USER_OFF | enabled=N + USER_OFF | PASS |
| 992311 | grid | ON | enabled=Y + audit USER_ON | enabled=Y + USER_ON | PASS |
| 992311 | grid | OFF | enabled=N + audit USER_OFF | enabled=N + USER_OFF | PASS |

Final state: both UID149 test PIDs are enabled=N. UID147 signal/grid counts and enabled counts were unchanged.

## Phase 7. Cross-UID Isolation

| surface/path | UID predicate present? | cross-UID leak observed? | verdict |
|---|---|---|---|
| user signal table | YES | NO | PASS |
| user grid table | YES | NO | PASS |
| admin current risk | YES | NO | PASS |
| ledger query | YES | NO | PASS |
| snapshot query | YES | NO | PASS |
| reservation query | YES | NO | PASS |
| Track Record | YES | NO | PASS |
| Revenue | per-user grouping | NO | PASS |
| Messages | YES | NO | PASS |

Evidence:
- UID149 user signal list contains PID 992559 only and no UID147 PID.
- UID149 user grid list contains PID 992311 only and no UID147 PID.
- UID147 user signal/grid lists do not contain PID 992559 or 992311.
- DB predicates show PID 992559/992311 owned by UID149, not UID147.
- Strategy control audit for these PIDs exists under targetUserId=149 only.

## Phase 8. Grid Stats Regression

| check | expected | actual | verdict |
|---|---|---|---|
| stats ingest route | mounted | route remains mounted | PASS |
| trading webhook separated | YES | stats route separate from `/user/api/grid/hook` | PASS |
| rankings/latest | works | GET rankings/latest HTTP 200 | PASS |
| stats mutation only | YES | no trading-table path touched | PASS |
| trading table mutation | 0 | no ledger/snapshot/reservation delta in smoke | PASS |

## Phase 9. Validation

| validation | result | note |
|---|---|---|
| node --check | PASS | `account-readiness.js`, `routes/admin.js` |
| frontend build | PASS | `npm run build` |
| targeted tests | PASS | signup/login, MyPage, secret masking, PID create, ON/OFF, UID isolation, admin monitor |
| run-all-live-readonly | PASS | `QA_READONLY_2026-05-01T04-18-17-948Z` |
| run-all-data-replay if executed | NOT_EXECUTED | ownership/replay logic not changed |
| Binance delta if replay executed | N/A | no replay executed |

## Phase 10. Restart / Smoke

| smoke | expected | actual | verdict |
|---|---|---|---|
| backend restart | QA_DISABLE_BINANCE_WRITES=1 | old PID 7984 -> new PID 12296 | PASS |
| login | pass | new UID login PASS | PASS |
| My Page | pass | member/readiness APIs PASS | PASS |
| user trading table | pass | signal/grid list PASS | PASS |
| admin UID monitor | pass | ops overview/order monitor PASS | PASS |
| unmatched signal/grid | matched=0 processed=0 | local unmatched signal/grid matched=0 processed=0 | PASS |
| browser/static | pass | localhost:5173 HTTP 200, signin route browser smoke PASS | PASS |

## Final Classification

TWO_UID_ONBOARDING_READY_WITH_API_KEY_USER_INPUT_REQUIRED

Reason: UID149 onboarding, login, My Page, admin UID monitoring, PID create, PID ON/OFF, final enabled=N, and UID isolation all pass. A real UID149 Binance API key/secret was not provided, so signed GET/futures account read remains intentionally pending. The product does not show fake readiness.

## Codex Did-Not-Do Confirmation

| prohibited action | result |
|---|---|
| Binance order create | NOT DONE |
| Binance order cancel | NOT DONE |
| Binance position close | NOT DONE |
| protection order create | NOT DONE |
| real matched webhook | NOT DONE |
| TradingView alert edit | NOT DONE |
| existing UID147 strategy ON/OFF | NOT DONE |
| existing UID147 PID enabled change | NOT DONE |
| raw SQL production patch | NOT DONE |
| DB schema change | NOT DONE |
| stored procedure change | NOT DONE |
| live-write-mode switch | NOT DONE |
| QA_DISABLE_BINANCE_WRITES unset | NOT DONE |
| push | NOT DONE |
| API secret full value logged/reported | NOT DONE |
