# P0 My Page API Credential Save E2E Failure Fix

1. final classification: `MYPAGE_API_KEY_SAVE_E2E_PASS_API_KEY_ROTATION_RECOMMENDED`
2. why previous deployable onboarding PASS was invalidated: 실제 브라우저 My Page에서 API credential 저장이 완료되지 않고 버튼이 `저장 중...` 상태에 고착되었으며, 검증 실패 메시지가 mojibake로 표시되었습니다.
3. observed user failure: `/mypage` API Key / Secret Key 저장 클릭 후 미등록 상태 유지, validate 클릭 시 깨진 문자열 표시.
4. save route root cause: `admin_member.appSecret`은 `char(64)`인데 `credentialSecrets.protectSecret()`의 `enc:v1:*` 값이 64자를 초과하여 DB update가 500으로 실패했습니다.
5. validate route root cause: `coin.validateMemberApiKeys()`가 legacy mojibake 메시지와 node-binance 검증 경로를 사용했고, 구조화된 `messageKo`/timeout 응답을 보장하지 않았습니다.
6. mojibake root cause: `Mypage.jsx`, `account-readiness.js`, validate fallback 경로에 깨진 한글 문자열이 사용자 표시 문자열로 남아 있었습니다.
7. security/redaction result: API key는 저장 후 masked 표시만 반환, Secret Key는 응답/화면/콘솔 로그에 원문 미노출, admin/member 및 user/member 응답에서 raw `appSecret`/`password` 필드 미포함.
8. frontend fix: My Page save/validate/hedge actions를 async `try/catch/finally`로 정리하여 모든 성공/실패/예외 경로에서 loading state를 복구합니다. 사용자 메시지는 `messageKo` 우선, mojibake 감지 시 안전한 한국어 fallback을 표시합니다.
9. backend fix: `/user/api/account/binance-keys`는 user-scoped 저장 후 구조화 JSON을 반환합니다. 저장은 빠르게 종료하고, 검증은 `/validate`로 분리했습니다. `/clear`는 user-scoped credential 원상복구/삭제용 확인 문구 기반 경로로 추가했습니다.
10. browser E2E: 기존 DEV 테스트 UID 1에서 dummy credential로 실제 My Page 저장을 수행했습니다. 저장 성공 메시지 표시, 버튼 복구, masked key 표시, raw key/secret 미표시, validate 구조화 실패 메시지 표시, mojibake 없음 확인 후 credential을 user-scoped clear route로 원상복구했습니다.
11. validation:
    - `node --check legacy/backend/routes/users.js`: PASS
    - `node --check legacy/backend/account-readiness.js`: PASS
    - `node --check legacy/backend/coin.js`: PASS
    - `node --check legacy/frontend/Xignal/web/src/services/auth.js`: PASS
    - `npm run build` in `legacy/frontend/Xignal/web`: PASS
    - save API smoke: PASS, status 200, raw key echo false, raw secret echo false
    - validate missing/invalid smoke: PASS, structured `messageKo`, mojibake false
    - user-scoped spoofing negative: PASS, body uid ignored
    - admin/member sanitization: PASS
    - browser console raw key/secret check: PASS
12. run-all-live-readonly: PASS, `QA_READONLY_2026-05-01T06-23-56-895Z`, report `qa-live-readonly-report-2026-05-01T06-23-58-335Z`.
13. git commit: pending at report generation.
14. user next step: 사용자는 스크린샷에 노출된 Binance API Key를 폐기/재발급한 뒤 새 Key/Secret을 My Page에 입력하고 `API 연결 검증`을 누르면 됩니다.
15. recommendation on exposed API key rotation: 기존 노출 Key는 재사용하지 말고 Binance에서 삭제 또는 rotate 권장.

## Evidence Tables

| check | expected | actual | verdict |
|---|---|---|---|
| UID147 Binance/local clean gate | PASS | run-all-live-readonly PASS | PASS |
| runtime mode | READ_ONLY_WRITE_DISABLED | 3079 restarted with `QA_DISABLE_BINANCE_WRITES=1`, `BINANCE_LIVE_WRITES_ENABLED=0` | PASS |
| save click | completes | Browser E2E save success message visible | PASS |
| save button state | returns from saving | `API 키 저장` button restored, `저장 중...` count 0 | PASS |
| registered key display | masked | masked/registered display, raw key not visible | PASS |
| secret display | not raw | raw secret not visible | PASS |
| readiness refresh | updates | My Page refreshed and later showed 미등록 after clear | PASS |
| validate click | structured response | Korean structured error displayed for invalid key | PASS |
| Korean message | not mojibake | mojibake false in DOM/API checks | PASS |
| valid key path | ready | not executed with a real key because exposed key should be rotated | USER_INPUT_REQUIRED_FOR_FINAL_SIGNED_GET |

## Codex Did Not Do

- Binance 주문 생성 안 함
- Binance 주문 취소 안 함
- Binance 포지션 청산 안 함
- 보호주문 생성 안 함
- 실제 전략 매칭 webhook 전송 안 함
- TradingView alert 수정 안 함
- 기존 UID147 전략 ON/OFF 변경 안 함
- 기존 UID147 PID enabled 값 변경 안 함
- 추가 production 사용자 임의 생성 안 함
- 추가 production PID 임의 생성 안 함
- raw SQL production patch 안 함
- DB schema 변경 안 함
- stored procedure 변경 안 함
- live-write-mode 전환 안 함
- QA_DISABLE_BINANCE_WRITES 해제 안 함
- push 안 함
- API secret 원문 로그/보고/화면 노출 안 함
- API key 원문 보고서 반복 기재 안 함
