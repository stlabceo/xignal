# APPROVED Local Stale Controlled Convergence after User Binance Cleanup 2026-05-01

1. final classification: `LOCAL_STALE_CONVERGENCE_PASS_CLEAN_GATE_RESTORED`
2. approval phrase: `APPROVE_LOCAL_STALE_CONVERGENCE_UID147_AFTER_USER_BINANCE_CLEANUP_20260501`
3. current Binance before: PUMPUSDT/XRPUSDT position/order/algo flat
4. local stale before: PID 991501 XRPUSDT LONG, PID 991749 XRPUSDT SHORT, PID 991502 stale GRID_STOP reservation, PID 991749 stale TP/STOP reservations
5. actual fill recoveries: PID 991749 tradeId 3098434938, PID 991501 tradeId 3098434937
6. controlled corrections: PID 991501 remaining 14.8 local stale flattened with realizedPnl=0 and no sourceTradeId/sourceOrderId
7. stale reservations finalized: PID 991749 TP/STOP reservations 2, PID 991502 GRID_STOP reservation 1
8. local state after: local openQty 0, active reservations 0
9. duplicate/PnL integrity: sourceTradeId counts 1/1, correction realizedPnl 0, no duplicate sourceOrderId
10. targeted replay: PASS
11. run-all-data-replay: PASS
12. Binance delta: 0
13. run-all-live-readonly: PASS
14. restart/smoke: restart not required; runtime order path unchanged; no matched webhook
15. git commit: selected local commit planned for convergence tool/replay/report
16. next step: read-only holding state; Live QA still requires separate live-write approval

## Phase 0. Pre-Convergence Safety Gate

| symbol | side | Binance qty | openOrders | openAlgoOrders | local openQty sum | active reservations | verdict |
|---|---|---:|---:|---:|---:|---:|---|
| PUMPUSDT | LONG | 0 | 0 | 0 | 0 | 14116 | LOCAL_STALE_RESERVATION |
| PUMPUSDT | SHORT | 0 | 0 | 0 | 0 | 0 | CLEAN |
| XRPUSDT | LONG | 0 | 0 | 0 | 18.2 | 0 | LOCAL_STALE_OPEN |
| XRPUSDT | SHORT | 0 | 0 | 0 | 18.3 | 36.6 | LOCAL_STALE_OPEN_AND_RESERVATION |

| item | verdict |
|---|---|
| Binance current risk | FLAT |
| Local stale | YES before convergence |
| local stale PID list | 991501, 991749, 991502 |
| local stale requires controlled convergence? | YES |
| Codex executed convergence? | YES, under explicit approval phrase and local-only helper |

## Phase 1. Exact Stale Inventory

| stale PID | category | symbol | side | local openQty | Binance qty | stale reservation | owner evidence | convergence type |
|---:|---|---|---|---:|---:|---|---|---|
| 991501 | grid | XRPUSDT | LONG | 18.2 | 0 | none active | final cleanup fill 3.4 only; prior 14.8 not owner-clear | PARTIAL_AND_REQUIRES_REVIEW |
| 991749 | signal | XRPUSDT | SHORT | 18.3 | 0 | TP/STOP total 36.6 | web cleanup order/trade owner-clear | OWNER_CLEAR_ACTUAL_FILL_RECOVERY |
| 991502 | grid | PUMPUSDT | LONG | 0 | 0 | GRID_STOP qty 14116 | Binance openAlgoOrders 0, exchange flat | STALE_RESERVATION_ONLY |
| 991749 | signal | XRPUSDT | SHORT | 0 after recovery | 0 | TP/STOP total 36.6 | sibling reservations after owner close | STALE_RESERVATION_FINALIZATION |

## Phase 2. Attribution Decision

| stale PID | orderId | clientOrderId | tradeIds | qty | side/positionSide | reduceOnly | attribution | action |
|---:|---|---|---|---:|---|---|---|---|
| 991749 | 147883985484 | web_ec6JjjyTRmBZCdEB8VNW | 3098434938 | 18.3 | BUY / SHORT close | true | OWNER_CLEAR | actual external/manual close fill recovery |
| 991501 | 147883985483 | web_fJW6ZgN65aViY3gaGkCj | 3098434937 | 3.4 | SELL / LONG close | true | PARTIAL_CLEAR | actual fill recovery only for 3.4 |
| 991501 | none | none | none | 14.8 | exchange-flat local stale | n/a | AMBIGUOUS_REMAINDER | controlled local stale flatten, realizedPnl=0 |
| 991502 | none | GSTOP_L_147_991502_48618296 | none | 14116 | local reservation only | n/a | STALE_RESERVATION_ONLY | local terminalization only |
| 991749 | none | PROFIT_147_991749_147846553633 / STOP_147_991749_147846553633 | none | 36.6 total | sibling reservations | n/a | STALE_RESERVATION_AFTER_CLOSE | local terminalization only |

## Phase 3. Controlled Convergence Actions

| action | PID | before | after | ledger row | reservation effect | audit/msg | verdict |
|---|---:|---|---|---|---|---|---|
| Owner-clear XRPUSDT SHORT close recovery | 991749 | snapshot OPEN 18.3 | snapshot CLOSED 0, signal READY/r_qty=0 | `SIGNAL_EXTERNAL_MANUAL_CLOSE_FILL`, sourceTradeId 3098434938, realizedPnl 0.00732, fee 0.01249249 | 2 TP/STOP reservations canceled locally | controlled-local-stale-convergence audit/msg | PASS |
| Clear final XRPUSDT LONG 3.4 fill recovery | 991501 | snapshot OPEN 18.2 | snapshot OPEN 14.8 after actual fill | `GRID_EXTERNAL_MANUAL_CLOSE_FILL`, sourceTradeId 3098434937, realizedPnl -0.01938, fee 0.00232083 | none | controlled-local-stale-convergence audit/msg | PASS |
| Ambiguous XRPUSDT LONG remainder flatten | 991501 | snapshot OPEN 14.8 | snapshot CLOSED 0, grid leg IDLE/WAITING_WEBHOOK | `GRID_EXCHANGE_FLAT_LOCAL_STALE_FLATTEN`, source ids null, realizedPnl 0 | none | explicit note: prior aggregate reduction not owner-clear | PASS |
| PUMPUSDT stale GRID_STOP terminalization | 991502 | ACTIVE `GSTOP_L_147_991502_48618296` | CANCELED local terminal state | none | 1 reservation canceled locally | controlled-local-stale-convergence audit/msg | PASS |

## Phase 4. Post-Convergence Verification

| symbol | side | Binance qty | openOrders | openAlgoOrders | local openQty sum | active reservations | verdict |
|---|---|---:|---:|---:|---:|---:|---|
| PUMPUSDT | LONG | 0 | 0 | 0 | 0 | 0 | CLEAN |
| PUMPUSDT | SHORT | 0 | 0 | 0 | 0 | 0 | CLEAN |
| XRPUSDT | LONG | 0 | 0 | 0 | 0 | 0 | CLEAN |
| XRPUSDT | SHORT | 0 | 0 | 0 | 0 | 0 | CLEAN |

Admin monitor post-convergence:

| metric | value |
|---|---:|
| currentCriticalCount | 0 |
| unresolvedWarnCount | 0 |
| currentRiskCount | 0 |
| openIssueCount | 0 |
| normalCycleCount | 48 |

## Phase 5. Duplicate / PnL Integrity

| check | expected | actual | verdict |
|---|---|---|---|
| sourceTradeId 3098434937 count | 1 if recovered | 1 | PASS |
| sourceTradeId 3098434938 count | 1 if recovered | 1 | PASS |
| sourceOrderId 147883985483 count | 1 | 1 | PASS |
| sourceOrderId 147883985484 count | 1 | 1 | PASS |
| correction realizedPnl | 0 | 0 | PASS |
| duplicate ledger | 0 duplicate | 0 duplicate | PASS |
| active reservations | 0 | 0 | PASS |

## Phase 6. Targeted Replay

| scenario | expected | actual | status |
|---|---|---|---|
| PID 991749 owner-clear web cleanup fill recovery | actual fill recovered, snapshot closed, reservations finalized | sourceTradeId preserved, snapshot closed, TP/STOP reservations canceled | PASS |
| PID 991501 partial clear fill + ambiguous remainder correction | 3.4 actual fill preserved; 14.8 correction realizedPnl=0 and no fake sourceTradeId | actual fill and correction split correctly | PASS |
| stale reservation only terminalization | no ledger PnL, reservation inactive, no Binance mutation | GRID_STOP reservation locally terminalized, no ledger PnL | PASS |
| same symbol/side multi-PID owner-clear close remains allowed | no blanket block regression | PID-owned qty clamp allowed, other PID untouched | PASS |
| aggregate-only ambiguous correction remains blocked | only approved controlled path may correct | OWNER_AMBIGUOUS block verified in external manual close replay | PASS |
| admin current risk clears after convergence | CRITICAL 0 | currentCriticalCount 0, openIssueCount 0 | PASS |

## Phase 7. Full Validation

| check | result | note |
|---|---|---|
| node --check | PASS | convergence helper and targeted replay |
| targeted replay | PASS | approved local stale convergence, cross-PID ownership guard, external manual close convergence |
| run-all-data-replay | PASS | QA_REPLAY_MODE=1, QA_DISABLE_BINANCE_WRITES=1 |
| Binance delta during replay | 0 | allOrders/userTrades/openOrders/openAlgoOrders/position delta 0 |
| run-all-live-readonly | PASS | finalStatus PASS |
| cleanup afterCleanup | 0 | targeted QA temp rows cleaned |

## Phase 8. Runtime Restart / Smoke

No runtime route/order-path source was changed by this convergence. The new files are QA/local convergence tooling and targeted replay tooling. A 3079 restart was not required and was not performed. No matched webhook smoke was performed.

## Phase 9. Git

Selected local commit candidate:

`fix: converge local stale after approved Binance cleanup`

Included candidates:

- `legacy/backend/tools/qa/controlled-local-stale-convergence-20260501.js`
- `legacy/backend/tools/qa/data-replay-approved-local-stale-convergence.js`
- this report `.md/.json`

Excluded:

- `qa-config.local.json`
- `.env`
- logs
- tmp evidence JSON
- unrelated dirty files

## Codex Did-Not-Do Confirmation

| prohibited action | result |
|---|---|
| Binance order create | YES, did not do |
| Binance order cancel | YES, did not do |
| Binance position close | YES, did not do |
| protection order create | YES, did not do |
| real strategy matching webhook | YES, did not do |
| TradingView alert edit | YES, did not do |
| strategy ON/OFF change | YES, did not do |
| PID enabled arbitrary change | YES, did not do |
| raw SQL production patch | YES, did not do |
| DB schema change | YES, did not do |
| stored procedure change | YES, did not do |
| live-write-mode switch | YES, did not do |
| QA_DISABLE_BINANCE_WRITES unset | YES, did not do |
| push | YES, did not do |

