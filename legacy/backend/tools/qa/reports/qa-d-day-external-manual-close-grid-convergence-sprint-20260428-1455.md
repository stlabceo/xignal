# D-day external/manual Binance liquidation convergence sprint

## Executive summary

Final classification: **FIX_PASS_READY_FOR_18H_LIVE_QA**

사용자 지적대로 문제를 PID18로 축소하지 않고, **사용자가 Binance에서 먼저 전부 시장가 청산한 뒤 사용자 화면에서 OFF했을 때 signal은 READY로 보였지만 grid는 보유중으로 남았던 흐름**을 기준 사건으로 보수적으로 다뤘습니다.

현재 uid=147 기준 Binance PUMPUSDT/XRPUSDT position/openOrders/openAlgoOrders는 모두 0이고, local OPEN snapshot과 active reservation도 0입니다. 현재 live-readonly는 PASS입니다.

## Schedule / Live QA non-interference

| item | result |
|---|---|
| Live QA mutation avoided | PASS |
| Binance order/create/cancel/close/protection mutation by Codex | NONE |
| actual strategy-matching webhook | NONE |
| receive-only unmatched smoke | PASS |
| final readiness before 16:00 KST | PASS |

## Current Binance clean gate

| symbol | side | Binance qty | openOrders | openAlgoOrders | verdict |
|---|---:|---:|---:|---:|---|
| PUMPUSDT | LONG | 0 | 0 | 0 | PASS |
| PUMPUSDT | SHORT | 0 | 0 | 0 | PASS |
| XRPUSDT | LONG | 0 | 0 | 0 | PASS |
| XRPUSDT | SHORT | 0 | 0 | 0 | PASS |

Manual close evidence observed after 10:00 KST included `web_*` MARKET reduceOnly closes for PUMP LONG, PUMP SHORT, XRP SHORT, and XRP LONG around **2026-04-28 14:07:10 KST**.

## Current local stale PID discovery

| category | result |
|---|---|
| local OPEN snapshots | 0 |
| active local reservations | 0 |
| signal rows | enabled=N / READY / r_qty=0 for checked target rows |
| grid rows | enabled=N / WAITING_WEBHOOK or MANUAL_OFF / IDLE legs / qty=0 for checked target rows |
| controlled live convergence | NOT EXECUTED |

Controlled live convergence was not executed because the current live state was already clean.

## Root cause classification

| root candidate | result | evidence / fix |
|---|---|---|
| GRID_EXTERNAL_MANUAL_CLOSE_RECOVERY_MISSING | YES | Added actual `web_*` manual close recovery when single-owner safe |
| GRID_LEG_STATE_NOT_SYNCED_AFTER_EXTERNAL_CLOSE | YES | Recovered fill now syncs grid leg snapshot and row convergence |
| GRID_SNAPSHOT_SYNC_MISSING_AFTER_EXTERNAL_CLOSE | YES | `applyExitFill` + `syncGridLegSnapshot` used for actual recovery |
| GRID_RESERVATION_FINALIZATION_MISSING_AFTER_EXTERNAL_CLOSE | YES | Reservation-owned CANCELED order now finalizes local reservation when Binance allOrders confirms CANCELED |
| EXTERNAL_CLOSE_TRADE_ATTRIBUTION_AMBIGUOUS | YES_RISK | Multi-PID same symbol/side now blocks automatic flatten |
| SIGNAL_EXTERNAL_MANUAL_CLOSE_PATH_WORKING | YES_WITH_LIMIT | Signal exchange-flat correction path works; actual `web_*` attribution is still only safe when owner evidence is available |

## Modified files/functions

| file | change |
|---|---|
| `legacy/backend/coin.js` | grid external manual close recovery helper; grid reservation-owned canceled finalization |
| `legacy/backend/grid-engine.js` | block exchange-flat flatten when owner ambiguous or active protection remains; skip irrelevant no-local/no-protection leg |
| `legacy/backend/tools/qa/qa-scenarios.js` | external/manual close replay scenarios |
| `legacy/backend/tools/qa/data-replay-external-manual-close-convergence.js` | targeted replay runner |
| `legacy/backend/tools/qa/run-all-data-replay.js` | added external/manual close scenario group |
| `legacy/backend/tools/qa/QA_ACCEPTANCE_MATRIX.md` | added acceptance rows |

## External manual close convergence implementation

The grid recovery path now prefers actual exchange evidence:

| case | behavior |
|---|---|
| single local grid owner + Binance flat + one matching `web_*` close fill | recover as `GRID_EXTERNAL_MANUAL_CLOSE_FILL` |
| no recoverable trade + Binance flat + no protection + single owner | explicit safe correction flatten |
| multiple local owners same symbol/side | block with `GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED` / `OWNER_AMBIGUOUS` |
| active protection/reservation remains | block with `GRID_EXTERNAL_CLOSE_CORRECTION_FLATTEN_BLOCKED` / `ACTIVE_LOCAL_RESERVATION` |

## New QA Acceptance Matrix scenarios

| scenario | result |
|---|---|
| grid external manual close recovery with attributable fill | PASS |
| grid external manual close correction fallback | PASS |
| grid external manual close ambiguous multi-PID | PASS |
| signal external manual close then user OFF | PASS |
| grid external close with active orphan protection is blocked | PASS |

## Targeted replay result

`node legacy/backend/tools/qa/data-replay-external-manual-close-convergence.js`

| item | result |
|---|---|
| finalStatus | PASS |
| cleanup afterCleanup | 0 |

## run-all-data-replay result

`node legacy/backend/tools/qa/run-all-data-replay.js`

| item | result |
|---|---|
| finalStatus | PASS |
| report | `legacy/backend/tools/qa/reports/qa-report-2026-04-28T05-51-40-518Z.md` |
| cleanup afterCleanup | 0 |

## run-all-live-readonly result

`node legacy/backend/tools/qa/run-all-live-readonly.js --config legacy/backend/tools/qa/qa-config.local.json`

| item | result |
|---|---|
| finalStatus | PASS |
| report | `legacy/backend/tools/qa/reports/qa-live-readonly-report-2026-04-28T05-53-53-259Z.md` |
| aggregate comparison | PASS |
| protection comparison | PASS |
| stale detection | PASS |
| guard blocked | PASS |

## Runtime restart / smoke result

| item | value | verdict |
|---|---|---|
| old 3079 pid | 12572 | restarted |
| new 3079 pid | 7976 | PASS |
| process start KST | 2026-04-28 14:52:37 +09:00 | PASS |
| code loaded | process newer than modified runtime files | PASS |
| ngrok target | http://localhost:3079 | PASS |
| ngrok public URL | https://iguana-cedar-drilling.ngrok-free.dev | PASS |
| runMain health | tick OK | PASS |
| user stream health | connected | PASS |

Receive-only unmatched smoke:

| endpoint | HTTP status | matched/armed | ledger/snapshot/reservation delta | verdict |
|---|---:|---|---:|---|
| local signal `/user/api/hook` | 200 | unmatched response | 0 | PASS |
| local grid `/user/api/grid/hook` | 200 | matched=0 / armed=0 | 0 | PASS |
| ngrok signal `/user/api/hook` | 200 | unmatched response | 0 | PASS |
| ngrok grid `/user/api/grid/hook` | 200 | matched=0 / armed=0 | 0 | PASS |

## Diff scope review

Classification: **DIFF_SCOPE_LARGE_BUT_EXPLAINED**

The working tree already contains a large accumulated `coin.js` diff from prior TIME exit/runtime work. The sprint-reviewed functional runtime scope is limited to:

| area | risk verdict |
|---|---|
| grid external manual close actual fill recovery | PASS by targeted replay |
| grid external close correction fallback | PASS by targeted replay |
| multi-PID ambiguity block | PASS by targeted replay |
| active orphan protection block | PASS by targeted replay |
| grid reservation-owned canceled finalization | PASS by run-all-data-replay |

## Final classification

**FIX_PASS_READY_FOR_18H_LIVE_QA**

Recommendation: Live QA can resume in the 18:00~10:00 window after the user’s own ON/preflight decision. If an external/manual close happens again and active protection or multi-PID ambiguity remains, the system should not silently flatten; it should block/report USER_ACTION_REQUIRED.

## Codex did-not-do confirmation

- Binance 주문 생성 안 함
- Binance 주문 취소 안 함
- Binance 포지션 청산 안 함
- 보호주문 생성 안 함
- 실제 webhook 전송 안 함; receive-only unmatched smoke만 수행
- TradingView alert 수정 안 함
- 전략 ON 변경 안 함
- 전략 설정 변경 안 함
- raw SQL DB patch 안 함
- DB schema 변경 안 함
- migration 적용 안 함
- stored procedure 변경 안 함
- local-only controlled convergence 실행 안 함; 현재 stale state가 없어 필요 없었음
- live recovery/reconcile 임의 실행 안 함
