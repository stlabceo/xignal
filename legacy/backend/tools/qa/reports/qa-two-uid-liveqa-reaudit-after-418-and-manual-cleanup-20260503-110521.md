# REOPEN 2UID Live QA Reaudit After 418 + Manual Cleanup

1. final classification: `TWO_UID_LIVEQA_REAUDIT_BLOCKED_BY_BINANCE_418`
2. why previous audit was incomplete: run-all-live-readonly failed, signed reads hit HTTP 418, and W1 Binance order/trade/protection evidence was not closed.
3. user manual cleanup recap: user manually closed positions and turned all UID147/UID154 PIDs OFF; DB confirms enabled counts are 0/0 for both UIDs.
4. web login vs API recovery verdict: web login is not API recovery; public `GET /fapi/v1/time` returned HTTP 418 at 2026-05-03 11:05:21 KST.
5. 429/418 timeline: no local 429 line found; local 418 evidence at `backend-3079-livewrite-approved.log` lines 511254-511255 from `/fapi/v3/account` account risk reads.
6. Retry-After / wait-until: no Retry-After header was captured in available logs; private reads are paused until a future single public probe passes.
7. API probe result: public probe 1 call = HTTP 418; UID147/UID154 signed probes not run by design.
8. endpoint call count: this reopen made 1 public Binance call and 0 private Binance calls.
9. rate guard/circuit breaker: implemented and mock-tested for 429 backoff and 418 global circuit breaker.
10. account/UID mapping: tmdtka1=UID147, jhkim=UID154, UID149 remains Codex-created artifact and was not used.
11. all PID OFF verification: UID147 signal/grid enabled count 0/0; UID154 signal/grid enabled count 0/0.
12. W0/W1/W2 analysis windows: W0 2026-05-02 00:00 KST-now, W1 2026-05-02 10:30 KST to 2026-05-03 10:24 KST, W2 2026-05-03 10:24 KST-now.
13. ON strategy inventory during W1: UID147 signal 991744-991753 and grid 991499-991504; UID154 signal 992565-992572 and grid 992316-992319.
14. webhook summary: DB shows matched target webhooks for active UID147/UID154 signal/grid PIDs; unmatched smoke/no-match payloads were not processed as strategies.
15. order/fill summary: local ledger reconstructs entries/exits, but Binance allOrders/userTrades cross-check is blocked by active 418.
16. protection matrix: current Binance active protection cannot be read; local still has UID147 PID991503 `GRID_TP PARTIAL` reservation `GTP_L_147_991503_09952706`.
17. split TP lifecycle: local ledger evidence exists, but trade-unit cross-check remains blocked by 418.
18. grid lifecycle: grid rows are now OFF/IDLE after manual OFF; PID991503 still needs API recheck/controlled local terminalization decision.
19. manual cleanup / local convergence: no convergence executed because Binance evidence is unavailable under 418.
20. UID147 verdict: OFF confirmed, local openQty 0, but stale PID991503 reservation remains review-needed until API evidence.
21. UID154 verdict: OFF confirmed, local openQty 0, no active reservation found in DB.
22. Track Record / PID table / Admin projection: cycles with `entryFillCount > exitFillCount` must not be shown as clean completed fake 0.00% until Binance exit evidence is confirmed.
23. Grid stats 400 root cause/fix: parser now accepts `.4`/`.5` TP keys and present-null no-data metrics; latest 7 rejected payloads now validate to 60 metric rows and 5 bestcase rows.
24. a703c6c canonical review: no direct truth-sync-on-read-failure regression found; current reopen adds the missing rate guard/circuit breaker.
25. validation: `node --check` PASS, guard static test PASS, Grid stats actual payload parser smoke PASS.
26. git status: selected commit pending; no push, no qa-config staging, no secret staging.
27. exact user action required: keep API-heavy reads paused until public Binance probe no longer returns 418; then run guarded low-rate clean gate and terminalize PID991503 local reservation only with Binance evidence.
28. next step: after 418 clears, perform one guarded public probe, one UID147 signed probe, one UID154 signed probe, then a cached low-rate clean gate.

## Did Not Do

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
