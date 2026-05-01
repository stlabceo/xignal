# P0 Live QA Failure: Protection/Residual/Stats/Reboot

## Header

| item | value |
|---|---|
| final classification | P0_LIVEQA_FAILURE_ROOT_CAUSE_FIXED_WAITING_FOR_USER_CLEANUP |
| current Binance risk | FLAT after user web cleanup at 2026-05-01 10:34:02 KST |
| current local stale | YES: XRPUSDT LONG pid 991501 local open 18.2, XRPUSDT SHORT pid 991749 local open 18.3, stale active reservations |
| initial unprotected exposures | XRPUSDT LONG 3.4 no Close Long protection; PUMPUSDT SHORT 14116 no Close Short protection |
| initial protection side/qty mismatch | PUMPUSDT active Close Long protections remained while actual exposure was SHORT |
| current user/admin observability | backend route-only PID 7984, frontend 5173 PID 19496, ngrok intentionally not restored while risk/stale remains |
| Windows reboot evidence | Event 1074 unplanned restart by StartMenuExperienceHost; EventLog 6006/6005 stop/start; last boot 2026-05-01 09:51 KST |
| GRID stats 400 root cause | matrix-only payload could infer best cell but lost TP key; parser now infers TP from matrix key and persists rejected payloads |
| run-all-data-replay | PASS |
| Binance delta during replay | 0 allOrders/userTrades/openOrders/openAlgoOrders/position |
| run-all-live-readonly | FAIL, expected: current local stale after user cleanup |
| user action required | YES: current local stale/reconcile requires separate approval; Live QA must remain stopped |
| git commit | pending selected commit |

## Phase 0. Emergency Containment / Observability Restore

| item | value | verdict |
|---|---|---|
| Windows reboot/update evidence | 2026-05-01 09:51 KST boot; Event 1074 unplanned restart; 6006/6005 stop/start | CONFIRMED |
| backend 3079 alive | PID 7984 | ROUTE_ONLY |
| backend process start time | 2026-05-01 10:35:34 KST | CODE_LOADED |
| frontend 5173 alive | PID 19496 | PASS |
| ngrok public URL | not restored | INTENTIONAL: current live risk/stale |
| ngrok target | none active | SAFE_BLOCKED |
| user stream health | runtime loop disabled | READ_ONLY/ROUTE_ONLY |
| admin page accessible | frontend route responds, auth may require login | PARTIAL_PASS |
| user trading page accessible | frontend route 200 | PASS |

Containment note: an initial 3079 restart was attempted with `PORT=3079` and `RUNTIME_OWNER_PORT=3079`; `QA_DISABLE_BINANCE_WRITES=1` blocked exchange writes, but local recovery code produced local projection logs. It was stopped and replaced by route-only 3079 with `RUNTIME_OWNER_PORT=0`.

## Phase 1. Current Live Risk Capture

Initial API capture before user cleanup:

| symbol | side | Binance qty | local openQty sum | diff | Binance active protection qty | local active reservation qty | owner candidates | verdict |
|---|---:|---:|---:|---:|---:|---:|---|---|
| XRPUSDT | LONG | 3.4 | 18.2 | -14.8 | 0 | 0 | grid pid 991501 | OPEN_EXPOSURE_WITHOUT_EFFECTIVE_PROTECTION |
| XRPUSDT | SHORT | 18.3 | 18.3 | 0 | 18.3 TP + 18.3 STOP | 18.3 TP + 18.3 STOP | signal pid 991749 | OPEN_PROTECTED |
| PUMPUSDT | SHORT | 14116 | 0 | 14116 | 0 | 0 | grid pid 991502 entry order candidate | UNOWNED_EXCHANGE_OPEN_NO_EFFECTIVE_PROTECTION |
| PUMPUSDT | LONG | 0 | 0 | 0 | 14116 + 14188 Close Long | 14116 local active + 14188 local canceled | pid 991502 / 991752 | ORPHAN_PROTECTION / SIDE_MISMATCH |

Post user web cleanup observed at 2026-05-01 10:34:02 KST:

| symbol | side | Binance qty | openOrders | openAlgoOrders | local openQty sum | active reservations | verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| PUMPUSDT | LONG | 0 | 0 | 0 | 0 | stale local PUMP LONG reservation pid 991502 | LOCAL_STALE |
| PUMPUSDT | SHORT | 0 | 0 | 0 | 0 | 0 | BINANCE_FLAT |
| XRPUSDT | LONG | 0 | 0 | 0 | 18.2 | 0 | LOCAL_OPEN_BINANCE_FLAT |
| XRPUSDT | SHORT | 0 | 0 | 0 | 18.3 | stale local TP/STOP pid 991749 | LOCAL_OPEN_BINANCE_FLAT |

## Phase 2. Exposure Ownership Mapping

| exposure | Binance qty | inferred PID | category | source entry clientOrderId | source orderId | source tradeIds | local openQty | diff | ownership verdict |
|---|---:|---:|---|---|---|---|---:|---:|---|
| XRPUSDT LONG residual | 3.4 | 991501 | grid | GENTRY_L_147_991501_48607202 | 147835559342 | allOrders/userTrades window | 18.2 | -14.8 | OWNER_QTY_MISMATCH; unprotected |
| XRPUSDT SHORT | 18.3 | 991749 | signal | NEW_147_991749 | 147846553633 | allOrders/userTrades window | 18.3 | 0 | owned/protected before user cleanup |
| PUMPUSDT SHORT | 14116 | 991502 candidate | grid | GENTRY_S_147_991502_48608106 | 4294693256 | allOrders/userTrades window | 0 | 14116 | UNOWNED_EXPOSURE |

Key cause: four GMANUAL close orders from pid 991500 reduced the aggregate XRPUSDT LONG bucket even though the remaining owner was pid 991501. Binance hedge position is aggregate by symbol/positionSide, so per-PID reduceOnly market close must fail closed when more than one local PID owns the same symbol/side.

## Phase 3. Protection Matrix Reconstruction

| pid | category | symbol | side | local openQty | Binance qty | expected TP side/qty | expected STOP side/qty | actual Binance TP side/qty | actual Binance STOP side/qty | local reservation match | verdict |
|---:|---|---|---|---:|---:|---|---|---|---|---|---|
| 991501 | grid | XRPUSDT | LONG | 18.2 | 3.4 | SELL/LONG/3.4 | SELL/LONG/3.4 | none | none | none | PID_OPEN_NO_EFFECTIVE_PROTECTION |
| 991749 | signal | XRPUSDT | SHORT | 18.3 | 18.3 | BUY/SHORT/18.3 | BUY/SHORT/18.3 | BUY/SHORT/18.3 | BUY/SHORT/18.3 | yes | OPEN_PROTECTED |
| 991502 | grid | PUMPUSDT | SHORT | 0 | 14116 | BUY/SHORT/14116 | BUY/SHORT/14116 | none | none | none | UNOWNED_EXCHANGE_OPEN_NO_EFFECTIVE_PROTECTION |
| 991502 | grid | PUMPUSDT | LONG | 0 | 0 | none | none | none | SELL/LONG/14116 | local active but flat | ORPHAN_PROTECTION |
| 991752 | signal | PUMPUSDT | LONG | 0 | 0 | none | none | none | SELL/LONG/14188 | local canceled but Binance active initially | LOCAL_CANCELED_BUT_BINANCE_ACTIVE / ORPHAN_PROTECTION |

## Phase 4. Timeline From Last Clean Baseline

| time KST | pid | category | event | orderId/clientOrderId | qty | local effect | Binance effect | protection effect | verdict |
|---|---:|---|---|---|---:|---|---|---|---|
| 2026-04-30 20:15 | 991752 | signal | PUMP LONG entry | 4294585691 / NEW_147_991752 | 14188 | local signal long | Binance LONG opened | later stop remained stale | PROTECTION_ORPHAN_LATER |
| 2026-04-30 20:30 | 991501 | grid | XRP LONG entry | 147835559342 / GENTRY_L_147_991501_48607202 | 18.2 | local grid long | Binance LONG opened | no effective final protection after shrink | RISK_SOURCE |
| 2026-04-30 20:30 | 991502 | grid | PUMP LONG entry | 4294693225 / GENTRY_L_147_991502_48607828 | 14116 | local grid long | Binance LONG opened | stop remained stale after TP | ORPHAN_LATER |
| 2026-05-01 03:17 | 991502 | grid | PUMP SHORT entry | 4294693256 / GENTRY_S_147_991502_48608106 | 14116 | no local ownership projection | Binance SHORT opened | no Close Short protection | P0_UNPROTECTED |
| 2026-05-01 08:48 | 991502 | grid | PUMP LONG TP fill | 4298510393 / GTP_L_147_991502_48618215 | 14116 | local did not converge fully | Binance LONG closed | sibling stop remained | ORPHAN_PROTECTION |
| 2026-05-01 08:48 | 991752 | signal | PUMP LONG TP fill | 4298513216 / PROFIT_147_991752_4294585691 | 14188 | local canceled stale mismatch | Binance LONG closed | stop remained | ORPHAN_PROTECTION |
| 2026-05-01 pre-capture | 991500 | grid | repeated GMANUAL LONG closes | 147835692471/147835693922/147835694912/147835698275 | 14.8 total | pid mismatch | reduced aggregate XRP LONG | residual 3.4 unprotected | RESIDUAL |
| 2026-05-01 09:51 | n/a | system | Windows reboot | Event 1074/6006/6005 | n/a | backend/frontend/ngrok down | observability outage | no protection check loop | BOOT_RESTART_OBSERVABILITY_OUTAGE |
| 2026-05-01 10:34:02 | user | web | user cleanup | web_* orders 147883985483/147883985484/4299263183 | XRP 3.4, XRP 18.3, PUMP 14116 | local stale remains | Binance flat | openAlgoOrders 0 | USER_WEB_CLEANUP |

## Phase 5. Root Cause Classification

| category | recurrence? | exact evidence | root function/path | fix required |
|---|---|---|---|---|
| OPEN_EXPOSURE_WITHOUT_EFFECTIVE_PROTECTION | YES | XRP LONG 3.4, PUMP SHORT 14116 had no effective TP/STOP | `qa-live`, admin monitor, protection lifecycle projection | live-readonly/admin now fail on PID/unowned open with no protection |
| RESIDUAL_OR_UNOWNED_EXPOSURE_AFTER_PARTIAL_OR_SHRINK | YES | XRP residual after GMANUAL pid 991500 closes; PUMP SHORT local flat | `closeGridLegMarketOrder`, snapshot/protection recovery | fail close when same symbol/side has ambiguous PID owners |
| PROTECTION_SIDE_OR_QTY_MISMATCH | YES | PUMP SHORT had Close Long SELL protections only | `qa-live`, admin monitor protection matching | side/positionSide/qty matrix enforced |
| PROTECTION_RESIZE_OR_ORPHAN_CLEANUP_FAILURE | YES | PUMP Long STOPs remained after long flat; local canceled but Binance active | reservation recovery/user stream convergence | live-readonly/admin mark orphan/local-canceled-active as CRITICAL |
| FILL_UNIT_IDENTITY_OR_DEDUPE_REGRESSION | YES | prior repeated category; current residual came from trade-unit close attribution gap | ledger fill identity + close ownership | existing tradeId dedupe retained; close ownership guard added |
| BOOT_RESTART_OBSERVABILITY_OUTAGE | YES | Windows reboot stopped backend/frontend/ngrok | `seon.startRuntime` boot path | boot safety gate added before runtime loop |
| GRID_STATS_JSON_CONTRACT_MISMATCH | YES | real 400 not persisted pre-fix; matrix-only TP inference bug reproduced | `stats/grid-stats-ingest.js`, `routes/stats.js` | tolerant parser + validate route + rejected raw persistence |
| ADMIN_MONITOR_FALSE_OK_OR_FALSE_NORMAL | YES | initial admin needed to distinguish current risk vs resolved issue; false XRP short oversized fixed | `admin-order-monitor.js` | Binance-sourced symbols and max protection qty per side |
| USER_TABLE_LIVE_DATA_MISMATCH | YES | current local stale would otherwise look normal if not surfaced | user/admin projection via live-readonly/admin monitor | current risk board shows CRITICAL local-open/binance-flat |

## Phase 6. Current Live Risk Decision

| current risk | affected exposure | Binance qty | protection status | user action required? | reason |
|---|---|---:|---|---|---|
| initial unprotected exposure | XRPUSDT LONG | 3.4 | none | already manually closed by user | confirmed web order 147883985483 |
| initial unprotected exposure | PUMPUSDT SHORT | 14116 | none | already manually closed by user | confirmed web order 4299263183 |
| current local stale | XRPUSDT LONG pid 991501 | 0 Binance / 18.2 local | local open, no Binance | YES | requires separate approved local reconciliation/cleanup |
| current local stale | XRPUSDT SHORT pid 991749 | 0 Binance / 18.3 local | local active TP/STOP missing on Binance | YES | requires separate approved local reconciliation/cleanup |
| enabled strategies | signal 10, grid 6 | flat | n/a | YES | Live-write must remain disabled until stale state is reconciled and user whitelist re-approved |

## Phase 7. Code Fixes: Protection Lifecycle Hardening

| fix | file | status |
|---|---|---|
| block grid market close when same uid/symbol/side has multiple local open PID owners | `legacy/backend/coin.js` | implemented |
| sync grid leg snapshot before recovered entry fill protection creation decision | `legacy/backend/grid-engine.js` | implemented |
| include Binance-position symbols in admin current risk even when local symbol list misses them | `legacy/backend/admin-order-monitor.js` | implemented |
| use max single protection qty instead of TP+STOP aggregate sum to avoid false oversized | `legacy/backend/admin-order-monitor.js` | implemented |
| flag exchange-only unowned open exposure in live-readonly | `legacy/backend/tools/qa/qa-live.js` | implemented |
| tighten oversized protection tolerance to 0.1% | `legacy/backend/tools/qa/qa-live.js` | implemented |
| boot safety gate blocks runtime loop before `coin.init` if admin current risk exists | `legacy/backend/seon.js` | implemented |

## Phase 8. Code Fixes: GRID Stats JSON 400

| check | old behavior | fix | verdict |
|---|---|---|---|
| actual Pine-like matrix payload accepted | 400 if bestcase omitted and TP only existed as matrix key | infer bestcase TP from matrix key | PASS |
| TP key 1 vs 1.0 | partial/tight | `normalizeTpKey` accepts 1/1.0/string variants | PASS |
| symbol normalization | supported partly | `BINANCE:PUMPUSDT.P`, `PUMPUSDT.P`, `PUMPUSDT` -> `PUMPUSDT` | PASS |
| timeframe normalization | supported partly | `60`, `60MIN`, `1H` -> `1H`; `120`, `2H` -> `2H` | PASS |
| invalid payload 400 reason | vague/no raw persistence | field-specific errors and `rejectedRawId` | PASS |
| rejected payload persistence | none before fix | rejected row id 7 in `strategy_stats_raw` | PASS |
| trading table mutation | none expected | verified delta 0 | PASS |

Actual pre-fix 400 raw payload was not recoverable because the route returned before persistence and no route access-log captured the body. This is now closed for future payloads via `/user/api/stats/grid/validate` and rejected raw persistence in stats-only storage.

## Phase 9. Targeted Replay Results

| targeted scenario | expected | actual | status |
|---|---|---|---|
| current XRP LONG 3.4 residual without protection | PID_OPEN_NO_EFFECTIVE_PROTECTION | detected | PASS |
| PUMP SHORT with Close Long/wrong-side protection | UNOWNED_EXCHANGE_OPEN_NO_EFFECTIVE_PROTECTION + orphan long protection | detected | PASS |
| protection qty mismatch after partial/shrink | PROTECTION_QTY_MISMATCH/OVERSIZED | detected | PASS |
| same symbol/side aggregate protection cannot mask PID missing protection | affected PID FAIL | detected | PASS |
| entry filled but TP/STOP not confirmed | PROTECTION_PENDING_RISK style unprotected detection | detected as PID_OPEN_NO_EFFECTIVE_PROTECTION | PASS |
| Windows reboot startup with existing risk | BOOT_RECOVERING -> RECONCILING, runtime loop blocked | boot gate returns `BOOT_RECOVERY_BLOCKED_BY_CURRENT_RISK` | PASS |
| GRID stats Pine payload 400 regression | accepted or field-specific validation | validate route 200 for full matrix; invalid returns field reasons | PASS |
| Admin monitor current risk | current CRITICAL > 0 when risk/stale exists | currentCriticalCount 2 after cleanup local stale | PASS |
| User/admin current risk not hidden | not normal | live-readonly FAIL and admin CRITICAL | PASS |

## Phase 10. Full Validation

| check | result | note |
|---|---|---|
| node --check modified backend/QA files | PASS | all modified JS passed |
| frontend build | PASS | Vite build PASS |
| targeted replay | PASS | protection matrix, grid stats parser, cross-PID ownership |
| run-all-data-replay | PASS | report `qa-report-2026-05-01T01-39-38-205Z` |
| Binance delta during replay | 0 | allOrders/userTrades/openOrders/openAlgoOrders/position |
| run-all-live-readonly | FAIL | expected due current local stale after user web cleanup |
| if FAIL, fail reason | LOCAL_OPEN_BINANCE_FLAT and LOCAL_ACTIVE_MISSING_ON_BINANCE | local cleanup/reconcile not permitted in this task |

## Phase 11. Restart / Smoke

| item | value | verdict |
|---|---|---|
| old PID | 21736 live-write before reboot; 11212/20764 route-only during work | stopped/replaced |
| new PID | 7984 | PASS |
| runtime mode | READ_ONLY_WRITE_DISABLED / route-only, `RUNTIME_OWNER_PORT=0`, `QA_DISABLE_BINANCE_WRITES=1` | PASS |
| user/admin accessible | frontend 5173 up; backend 3079 route-only up | PASS |
| ngrok target | not restored | intentionally blocked while stale/risk remains |
| unmatched smoke | signal route returned false; grid route logged invalid payload ignored | matched=0 / processed=0 |
| Binance delta | 0 | no Codex exchange mutation |

## Evidence Files

| evidence | path |
|---|---|
| initial current capture | `legacy/backend/tools/qa/reports/tmp-p0-liveqa-failure-current-capture-20260501.json` |
| runtime events | `legacy/backend/tools/qa/reports/tmp-p0-liveqa-runtime-events-20260501.json` |
| ledger events | `legacy/backend/tools/qa/reports/tmp-p0-liveqa-ledger-events-20260501.json` |
| reservations | `legacy/backend/tools/qa/reports/tmp-p0-liveqa-reservations-20260501.json` |
| strategy rows | `legacy/backend/tools/qa/reports/tmp-p0-liveqa-strategy-rows-20260501.json` |
| user cleanup capture | `legacy/backend/tools/qa/reports/tmp-p0-liveqa-post-user-cleanup-capture-20260501.json` |
| replay before/after | `legacy/backend/tools/qa/reports/tmp-p0-liveqa-data-replay-before2-20260501.json`, `tmp-p0-liveqa-data-replay-after2-20260501.json` |

## Codex Did-Not-Do Confirmation

| prohibited action | evidence checked | result |
|---|---|---|
| Binance order create | allOrders before/after replay delta 0; route-only runtime; no POST order calls | YES |
| Binance order cancel | openOrders/openAlgoOrders before/after replay delta 0; no cancel API call | YES |
| Binance position close | userTrades delta during replay 0; web cleanup clientOrderIds are `web_*`, not Codex | YES |
| protection create | openAlgoOrders delta 0 during replay; route-only restart | YES |
| real strategy matching webhook | only unmatched/invalid local smoke; matched=0/processed=0 | YES |
| TradingView alert modified | no browser/TV mutation performed | YES |
| strategy ON/OFF changed | DB SELECT only; no enabled mutation | YES |
| raw SQL production patch | no UPDATE/DELETE/ALTER executed | YES |
| DB schema/stored procedure changed | none | YES |
| push | no push executed | YES |

