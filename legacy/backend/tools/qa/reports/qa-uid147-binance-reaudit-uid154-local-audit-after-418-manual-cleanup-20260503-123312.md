# REOPEN AGAIN: UID147 Binance Reaudit + UID154 Local-Only Audit

1. final classification: `UID147_FULL_BINANCE_REAUDIT_AND_UID154_LOCAL_AUDIT_PASS_AFTER_MANUAL_CLEANUP`
2. why previous audit failed: previous audit stopped under Binance HTTP 418, so W1 Binance evidence was incomplete.
3. user manual cleanup recap: user manually closed all positions, canceled protections/limit orders, and turned all PIDs OFF.
4. new IP / API access scope: UID147/tmdtka1 only was probed with Binance API; UID154/jhkim private API calls were kept at 0.
5. account/UID mapping: tmdtka1=UID147, jhkim=UID154, UID149 remains quarantined Codex-created artifact.
6. analysis windows W0/W1/W2: W0 starts 2026-05-02 00:00 KST; W1 is the 2UID live QA window until manual cleanup/OFF; W2 is post-cleanup to now.
7. endpoint call count: public 1; UID147 private 10 total; UID154 private 0.
8. rate guard/circuit breaker: mock 429 and mock 418 tests passed.
9. all PID OFF verification: UID147 signal/grid enabled 0/0, UID154 signal/grid enabled 0/0.
10. UID147 Binance API probe: signed probe PASS; PUMP/XRP positionRisk all 0; openOrders 0; openAlgoOrders 0.
11. UID147 W1 Binance lifecycle: W1 UID147 signal/grid lifecycle was reconstructed from webhook target log, Binance allOrders/userTrades, local ledger/snapshot/reservation.
12. UID147 post-cleanup clean/convergence: PID991503 stale `GRID_TP` reservation `GTP_L_147_991503_09952706` was Binance `FILLED`; tradeIds `220347363/220347364` were already in ledger; local reservation was terminalized to `FILLED` without ledger/PnL mutation.
13. UID154 local-only lifecycle: UID154 was audited from local webhook/ledger/snapshot/reservation/runtime evidence only; Binance verification remains unavailable by policy.
14. UID154 Binance verification limitation: no UID154 signed/account/order/trade/position private calls were made, so this is not Binance-source PASS for UID154.
15. webhook summary: UID147/UID154 webhook target logs are UID/PID-scoped; no cross-UID target leak was found in the W0 target summary.
16. order/fill summary: UID147 W1 trade evidence reconciles after PID991503 extra order evidence; UID154 local ledger contains owner-scoped entry/exit evidence but is Binance-unverified.
17. protection matrix: current local active reservations are 0 for UID147 and UID154 after convergence; UID147 Binance active orders/protections are 0.
18. split TP lifecycle: UID147 split/TP fill evidence has tradeId-backed local rows where Binance orders existed; no current orphan remains.
19. grid lifecycle: UID147 grid one-leg/sibling/GMANUAL/GRID_TP/GRID_STOP flows reconstructed; UID154 grid lifecycle is local-only.
20. Track Record / PID table / Admin projection: current ongoing should be empty because all PIDs are OFF and local open snapshots are 0; historical sourceTradeId-null truth-sync rows must stay evidence-limited, not fake Binance PnL.
21. Grid stats 400 root cause/fix: actual rejected TradingView payloads with `.4`/`.5` TP keys and null no-data period now validate; ids 8,9,10,11,12,13,15 produce metrics=60 and bestcases=5. Empty-matrix id 7 remains correctly invalid.
22. a703c6c/a102eb3 canonical review: `a703c6c` remains canonical with this follow-up because failed reads are not flat; `a102eb3` read guard/stats tolerance is canonical-safe.
23. validation: node --check PASS for modified backend files; read-guard static test PASS; stats parser actual payload test PASS.
24. git status: source files modified this run are `legacy/backend/pid-position-ledger.js` and `legacy/backend/coin.js`; report files added; no push.
25. exact user action required: no immediate Binance/local cleanup action required from current evidence. UID154 full Binance-source audit needs an IP/key context where jhkim API is permitted.
26. next step: keep all PIDs OFF until the next explicit Live QA setup.

## Key Tables

| account | uid | API mode | current local open snapshots | current active reservations | enabled signal/grid | verdict |
|---|---:|---|---:|---:|---|---|
| tmdtka1 | 147 | Binance full low-rate | 0 | 0 | 0/0 | PASS after PID991503 convergence |
| jhkim | 154 | local-only | 0 | 0 | 0/0 | LOCAL_LIFECYCLE_OK_BINANCE_UNVERIFIED |
| Codex artifact | 149 | not used | n/a | n/a | n/a | quarantined |

| endpoint | uid/account | calls | verdict |
|---|---|---:|---|
| public time | public | 1 | PASS |
| account | UID147 | 1 | PASS |
| positionRisk | UID147 | 1 | PASS |
| openOrders | UID147 | 1 | PASS |
| openAlgoOrders | UID147 | 1 | PASS |
| allOrders | UID147 | 3 | PASS |
| userTrades | UID147 | 3 | PASS |
| any private endpoint | UID154 | 0 | PASS |

| convergence item | evidence | action | verdict |
|---|---|---|---|
| UID147 PID991503 `GTP_L_147_991503_09952706` | Binance order `4254544316` FILLED; tradeIds `220347363/220347364`; ledger already recorded | reservation `PARTIAL` -> `FILLED`, filledQty `13668` -> `14318`; no ledger/PnL mutation | PASS |
| UID154 PID992319 `GTP_L_154_992319_23213146` | local owner-close `GMANUAL_L_154_992319_59210170`; ledger exit tradeId `3099498040`; openQtyAfter 0; user reports protections canceled | stale TP reservation `CANCEL_PENDING` -> `CANCELED`; no UID154 Binance private call | PASS_LOCAL_ONLY |

## Category Mapping

| category | affected uid/pid | evidence | severity | user action required? | fix required? |
|---|---|---|---|---|---|
| BINANCE_418_READ_LIMIT | both during prior audit | previous audit blocked by 418 | P0 | no current action | guard verified |
| QA_PRIVATE_API_RATE_GUARD_GAP | QA harness | fixed in `a102eb3`; mock 429/418 PASS | P0 | no | no |
| UID154_BINANCE_API_UNAVAILABLE | UID154 | current IP policy prohibits UID154 private API | P1 limitation | only if full Binance-source audit desired | no |
| PROTECTION_RESIZE_OR_ORPHAN_CLEANUP_FAILURE | UID147 PID991503, UID154 PID992319 | stale local reservations after closed exposure | P1 projection/local stale | no after convergence | fixed |
| GRID_STATS_400_CONTRACT | stats route | actual rejected payloads now parser-valid except intentionally empty matrix | P1 | no | fixed |

## Codex did-not-do confirmation

- Binance 주문 생성 안 함
- Binance 주문 취소 안 함
- Binance 포지션 청산 안 함
- Binance 보호주문 생성 안 함
- matched webhook 전송 안 함
- TradingView alert 수정 안 함
- 전략 ON/OFF 변경 안 함
- PID enabled 변경 안 함
- live-write-mode 전환 안 함
- QA_DISABLE_BINANCE_WRITES 해제 안 함
- raw SQL production patch 안 함
- DB schema 변경 안 함
- stored procedure 변경 안 함
- run-all-data-replay 실행 안 함
- cleanup 실행 안 함
- push 안 함
- API key/secret/password/ngrok token 원문 로그/보고 안 함
