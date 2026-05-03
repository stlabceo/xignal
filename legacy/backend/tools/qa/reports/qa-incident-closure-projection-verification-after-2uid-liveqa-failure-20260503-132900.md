# Incident Closure Report + Projection Verification After 2UID Live QA Failure

1. final classification: `INCIDENT_CLOSURE_PASS_BUT_UID154_BINANCE_UNVERIFIED`
2. reason: UID147/tmdtka1 W1은 기존 low-rate Binance evidence로 닫혔고, UID154/jhkim은 정책상 Binance private API를 호출하지 않아 local-only 한계를 명시한다.
3. current cleanup state: UID147/UID154 local open snapshot 0, active reservation 0, all PID OFF 확인. UID147은 post-cleanup Binance flat/openOrders 0/openAlgoOrders 0 evidence가 있다.
4. fixes applied in this closure: Track Record current issue projection, PID table/Track Record labels, Grid stats rejected payload backfill.
5. validation: node --check PASS, frontend build PASS, read guard static PASS, stats/Track Record in-memory API smoke PASS.

## 1. 사고 요약

| 문제 카테고리 | 사용자에게 보인 증상 | 실제 affected UID/PID | 직접 원인 | 코드/하네스 원인 | 적용된 수정 | 검증 근거 | 남은 한계 |
|---|---|---|---|---|---|---|---|
| BINANCE_418_RATE_LIMIT_ACCIDENT | Live QA 전수조사가 418로 중단됨 | QA read harness / UID147+UID154 audit | 429 이후 즉시 멈추지 못하고 private read가 이어짐 | PID별/반복 signed read를 bulk/cache/circuit breaker 없이 수행 | `a102eb3` read guard: endpoint counter, UID/window cache, 429 backoff, 418 circuit breaker, Retry-After respect | `binance-read-guard-static-test PASS`, UID147 prior low-rate call count public 1/private 10, UID154 private 0 | cooling 중 반복 live-readonly/PID별 read 금지 |
| EXCHANGE_READ_FAILURE_INTERPRETED_AS_FLAT | read 실패 상태가 flat처럼 보일 수 있었음 | truth sync/projection | read failure와 confirmed flat이 분리되지 않음 | 실패 read 결과가 local mutation path로 흘러갈 위험 | `a703c6c`: failed read에서는 ledger/snapshot/reservation 변경 금지 | 정본 리뷰 `CANONICAL_SAFE` | read 실패 시 full PASS 금지 |
| UID147_PID991503_GRID_TP_STALE_RESERVATION | PID991503 GRID_TP PARTIAL reservation mismatch | UID147 PID991503 `GTP_L_147_991503_09952706` | Binance order `4254544316`은 FILLED였지만 local reservation projection이 stale | exchange evidence already-ledgered 상태를 안전히 terminalize하는 helper 부재 | `4f03512`: `markReservationFilledFromExchangeEvidence`, no ledger/PnL mutation | tradeIds `220347363/220347364` already in ledger, active reservation 0 | 없음 |
| UID154_PID992319_LOCAL_ONLY_STALE_TP | jhkim stale TP가 남아 보임 | UID154 PID992319 `GTP_L_154_992319_23213146` | local owner-close evidence 후 stale TP terminalization 필요 | UID154 private API 금지 상태에서 local-only owner-close path 필요 | `4f03512`: `terminalizeStaleReservationsAfterOwnerClose` | `GMANUAL_L_154_992319_59210170`, exit tradeId `3099498040`, openQtyAfter 0, active reservation 0 | Binance-source PASS 아님 |
| TRACK_RECORD_AND_PID_TABLE_PROJECTION | 0.00 반복, 진행중 누락처럼 보임, 확인필요 과다, 가격/문구 혼란 | UID147/UID154 user/admin projection | resolved historical issue label이 completed row에 남음 | Track Record list가 `needsReview=false`인 row에도 process issue label을 재사용 | `routes/admin.js`에서 actionable review가 아니면 issueLabel 제거, completed는 `성과 기록`; frontend null 수익률은 `계산 불가` | API smoke: UID147 completed 25/active 0/review 0, UID154 completed 15/active 0/review 0, first completed issueLabel null | browser visual smoke는 IAB backend 미가용으로 대체 검증 |
| GRID_STATS_400_CONTRACT | Grid stats 400, latest/rankings stale | `strategy_stats_raw` ids 8,9,10,11,12,13,15 | `.4/.5` TP key, null no-data period를 parser가 거부 | parser tolerance 부족 + rejected rows stats-only backfill 부재 | `a102eb3` parser tolerance + `backfill-grid-stats-rejected-raw.js` | 각 id metrics=60/bestcases=5, latest status 200 rows 10, rankings status 200 rows 6 | id 7은 empty matrix라 정상 reject |

## 2. Lifecycle 결론

| lifecycle 영역 | UID147 Binance-source 결론 | UID154 local-only 결론 | 문제 여부 | 남은 한계 |
|---|---|---|---|---|
| webhook matching | W1 target log 기준 UID/PID scoped, cross-UID leak 없음 | local target log 기준 UID/PID scoped | 현재 문제 없음 | UID154는 Binance-side effect 미검증 |
| entry order | UID147 allOrders/userTrades/local ledger 재구성 완료 | local runtime/ledger evidence 중심 | 현재 문제 없음 | UID154 Binance-source order 확인 불가 |
| entry fill / tradeId ledger | PID991503 포함 tradeId ledger gap 닫힘 | local ledger rows 기준 owner-scoped | 현재 문제 없음 | sourceTradeId-null truth-sync row는 evidence-limited |
| protection creation | post-cleanup active protection/reservation 0, PID991503 stale resolved | local active reservation 0, PID992319 stale resolved | 현재 문제 없음 | UID154 historical protection은 local-only |
| split TP / partial close | tradeId-backed rows 보존, current orphan 없음 | local-only projection, current orphan 없음 | 현재 문제 없음 | UID154 Binance-source partial proof 없음 |
| grid regime lifecycle | one-leg/sibling/GMANUAL/GRID_TP/GRID_STOP flow closed, PID991503 resolved | local grid lifecycle closed, PID992319 resolved | 현재 문제 없음 | UID154 local-only |
| manual cleanup / close | user cleanup 후 UID147 Binance/local clean | user cleanup 보고 + local clean | current blocker 없음 | UID154 exchange proof 없음 |
| final local convergence | open snapshot 0, active reservation 0, all PID OFF | open snapshot 0, active reservation 0, all PID OFF | PASS | 없음 |

## 3. 사용자 지적 화면 문제 검증

| 문제 | tmdtka1/UID147 결과 | jhkim/UID154 결과 | 수정 여부 | 검증 방식 | verdict |
|---|---|---|---|---|---|
| 현재 추정 손익 가격 수신중 | 현재 all OFF/open 0이라 active 추정 row 없음. label은 `가격 수신중` 정상화 | 동일 | 수정 | frontend build + helper/code review | PASS |
| 가격 source가 public feed인지 | `trading.livePrice` + `estimatedPnl.js` public price map 기반 | 동일 | 기존 유지 | code review | PASS |
| 승/패 | completed summary win/loss 집계 반환 | completed summary win/loss 집계 반환 | 라벨 정리 | API smoke | PASS |
| 최근거래 | PID table label 정상화 | 동일 | 수정 | frontend build | PASS |
| Track Record 완료 기간 필터 | `sDate/eDate` query 전달 및 backend date range 적용; 날짜 변경 시 page reset/refetch | 동일 | 보강 | code review + API smoke | PASS |
| 완료 수익률 0.00 반복 | 실 PnL row는 non-zero returnPct 반환; denominator null이면 `계산 불가` 표시 | non-zero 예: PID992570 returnPct 0.55032 | 수정 | API smoke + frontend build | PASS |
| 진행중 탭 | active 0이 정상, 현재 all OFF/open 0 | active 0이 정상 | 확인 | API smoke | PASS |
| 확인필요 탭 | review 0, resolved issue는 issueLabel null | review 0, resolved issue는 issueLabel null | 수정 | API smoke | PASS |
| 관리자 주문 로그 false abnormal | Track Record list에서 non-actionable completed issueLabel 제거 | 동일 | 수정 | API smoke | PASS |
| Grid stats 표시 | latest rows 10, rankings rows 6, May 3 rows returned | 공통 stats | 수정/backfill | stats API smoke | PASS |

## 4. Commit 정본 리뷰

| commit | file | 핵심 변경 | 정본 위험 | verdict |
|---|---|---|---|---|
| `a703c6c` | `coin.js`, `grid-engine.js`, `routes/admin.js`, frontend projection | Binance read failure를 flat truth로 쓰지 않도록 차단 | failed read를 mutation으로 쓰면 위험했으나 현재 차단됨 | CANONICAL_SAFE |
| `a102eb3` | `binance-read-guard.js`, `qa-binance.js`, `grid-stats-ingest.js` | 429/418 guard + stats parser tolerance | guard가 없으면 재발 위험, mock PASS | CANONICAL_SAFE |
| `4f03512` | `pid-position-ledger.js`, `coin.js` | owner-scoped local convergence helper, active mojibake error override | fake fill/PnL만 피하면 안전; 실제로 no ledger/PnL mutation | CANONICAL_SAFE |

## 5. 418 재발 방지

| 항목 | 사고 당시 | 현재 수정 후 |
|---|---|---|
| 429 감지 | 감지 후 즉시 전체 private read가 멈추지 않음 | 429 backoff 상태로 전환 |
| Retry-After 처리 | 확인/존중이 불충분 | Retry-After 파싱 및 wait-until 전 private block |
| 418 발생 시 행동 | audit가 반복 read로 막힘 | 418 circuit breaker가 전체 private read hard block |
| endpoint call counter | endpoint별 보고 부족 | per-run/per-endpoint call count |
| per-UID cache | PID별 read storm 위험 | UID bulk fetch cache |
| allOrders/userTrades cache | symbol/window 중복 호출 위험 | UID+symbol+window 1회 원칙 |
| concurrency limit | 동시 private read 위험 | conservative concurrency |
| price public/private 분리 | price까지 signed read 압박 가능성 | estimated PnL은 public market price path |
| report call count | 불명확 | 보고서 필수 항목 |

## 6. Validation

| validation | result | note |
|---|---|---|
| node --check | PASS | `routes/admin.js`, `backfill-grid-stats-rejected-raw.js`, `pid-position-ledger.js`, `coin.js`, `binance-read-guard.js`, `qa-binance.js`, `grid-stats-ingest.js` |
| frontend build | PASS | `legacy/frontend/Xignal/web npm run build` |
| mock 429/418 guard | PASS | `binance-read-guard-static-test PASS` |
| Grid stats backfill | PASS | ids 8,9,10,11,12,13,15 converted, each metrics=60/bestcases=5 |
| stats API smoke | PASS | latest status 200 rows 10, rankings status 200 rows 6 |
| Track Record API smoke | PASS | UID147 completed 25 active 0 review 0; UID154 completed 15 active 0 review 0 |
| browser smoke | LIMITED | Codex in-app browser backend discovery failed and 3079/5173 were not running; runtime restart was not performed by policy |

## 7. Git 상태

| item | expected | actual | verdict |
|---|---|---|---|
| selected commit only | YES | pending selected commit | PASS_PENDING_COMMIT |
| qa-config.local staged | NO | not staged | PASS |
| secrets staged | NO | none staged | PASS |
| logs/tmp/screenshots staged | NO | not staged | PASS |
| reports included intentionally | YES | final closure report intended | PASS |
| uncommitted source hunks | listed | `routes/admin.js`, 3 frontend projection files, stats backfill tool | PASS |
| push | NO | no push | PASS |

## 8. Final Notes

Exact user action required: 현재 UID147/local evidence 기준 추가 cleanup은 필요하지 않습니다. UID154를 Binance-source까지 완전히 닫으려면 jhkim private API가 허용되는 IP/key 환경에서 별도 low-rate audit이 필요합니다.

Codex did-not-do confirmation:
- Binance 주문 생성 안 함
- Binance 주문 취소 안 함
- Binance 포지션 청산 안 함
- Binance 보호주문 생성 안 함
- matched webhook 전송 안 함
- TradingView alert 수정 안 함
- 전략 ON/OFF 변경 안 함
- PID enabled 변경 안 함
- live-write-mode 전환 안 함
- run-all-data-replay 실행 안 함
- cleanup script 실행 안 함
- raw SQL production patch 안 함
- DB schema 변경 안 함
- stored procedure 변경 안 함
- UID154 Binance private API 호출 안 함
- push 안 함
- API key/secret/password/ngrok token 원문 로그/보고 안 함
