# My Page User Stream Readiness Display Fix

1. final classification: MYPAGE_USER_STREAM_READINESS_DISPLAY_PASS
2. current runtime mode: READ_ONLY_WRITE_DISABLED
3. QA_DISABLE_BINANCE_WRITES: 1
4. live-write enabled: NO
5. User Stream root cause: My Page rendered raw `/admin/runtime/binance/health` status directly, so internal `DISCONNECTED` was treated as a user-facing abnormal state.
6. backend semantics: `/user/api/account/readiness` now returns `userStream.status`, `label`, `severity`, `requiredNow`, raw runtime trace, and enabled strategy counts.
7. user-facing display: My Page and Account Snapshot now prefer `readiness.userStream` over raw runtime health.
8. admin observability: `/admin/runtime/binance/health` still exposes raw internal stream state for operators.
9. final user-facing state under current mode: `STREAM_NOT_REQUIRED_READONLY` / `read-only 모드: 수신 대기` / `requiredNow=false`.
10. run-all-live-readonly: PASS
11. git commit: pending at report write time

## Current Status Evidence

| check | value | verdict |
|---|---|---|
| current 3079 PID | 3360 | PASS |
| current runtime mode | READ_ONLY_WRITE_DISABLED | PASS |
| QA_DISABLE_BINANCE_WRITES | 1 | PASS |
| BINANCE_LIVE_WRITES_ENABLED | 0 | PASS |
| UID147 API connection | OK | PASS |
| UID147 enabled strategy count | signal 10 / grid 6 | observed |
| UID147 raw internal stream | DISCONNECTED, no listenKey | admin-visible only |
| UID147 stream required now? | NO | PASS |
| UID147 user-facing stream | read-only 모드: 수신 대기 | PASS |
| UID1/UID149 no-key stream | API 등록 후 확인 | PASS |

## User Stream State Policy

| state | backend code | user label | severity | abnormal count? |
|---|---|---|---|---|
| API key missing | API_KEY_MISSING | API 등록 후 확인 | INFO | no |
| API read OK + live disabled | API_READ_OK_LIVE_DISABLED | 실거래 시작 전 대기 | INFO | no |
| read-only runtime | STREAM_NOT_REQUIRED_READONLY | read-only 모드: 수신 대기 | INFO | no |
| stream connected | STREAM_CONNECTED | 연결 정상 | OK | no |
| reconnecting | STREAM_RECONNECTING | 재연결 중 | WARN | yes, only when stream is required |
| required but disconnected | STREAM_DISCONNECTED_REQUIRED | 실시간 주문 이벤트 수신 끊김 | CRITICAL | yes |
| listenKey/auth error | STREAM_AUTH_ERROR | API 권한 확인 필요 | CRITICAL | yes |

## Browser/API Smoke

| check | expected | actual | verdict |
|---|---|---|---|
| UID1 no-key readiness API | API_KEY_MISSING, requiredNow=false | API 등록 후 확인 | PASS |
| UID149 artifact no-key readiness API | API_KEY_MISSING, requiredNow=false | API 등록 후 확인 | PASS |
| UID147 readiness API | STREAM_NOT_REQUIRED_READONLY, requiredNow=false | read-only 모드: 수신 대기 | PASS |
| admin raw health | raw DISCONNECTED visible to admin | DISCONNECTED / 연결 끊김 | PASS |
| My Page User Stream | no red DISCONNECTED | read-only 모드: 수신 대기 | PASS |
| My Page Account Snapshot badge | no raw 연결 끊김 | read-only 모드: 수신 대기 | PASS |

## Validation

| validation | result | note |
|---|---|---|
| node --check account-readiness.js | PASS | syntax OK |
| node --check routes/users.js | PASS | unchanged route syntax OK |
| frontend build | PASS | Vite build PASS |
| browser smoke | PASS | UID147 My Page shows read-only wait, no raw DISCONNECTED |
| API smoke | PASS | userStream payload present and semantic |
| run-all-live-readonly | PASS | report `qa-live-readonly-report-2026-05-01T06-51-20-371Z` |

## Codex Did Not Do

- Binance 주문 생성 안 함
- Binance 주문 취소 안 함
- Binance 포지션 청산 안 함
- 보호주문 생성 안 함
- 실제 전략 매칭 webhook 전송 안 함
- TradingView alert 수정 안 함
- live-write-mode 전환 안 함
- QA_DISABLE_BINANCE_WRITES 해제 안 함
- 기존 UID147 전략 ON/OFF 변경 안 함
- 신규 UID 전략 ON/OFF 변경 안 함
- raw SQL production patch 안 함
- DB schema 변경 안 함
- stored procedure 변경 안 함
- push 안 함
- API key/secret 원문 로그/보고 안 함
