# Internal Execution Event Smoke Test

## Goal

`/api/v1/internal/execution-events` ingress의 validation, referential policy, 그리고 `notification_errors`의 DB-level concurrency guarantee를 로컬에서 검증한다.

## Important Note

병렬 입력 검증은 최신 코드가 반영된 서버에서만 수행해야 한다. 기존에 떠 있던 예전 dev 서버가 있으면 다른 포트로 새로 띄운 뒤 그 포트만 사용한다.

예:

```powershell
$env:PORT="3001"
npm.cmd --workspace apps/backend run dev
```

이 문서의 병렬 smoke 예제는 `http://localhost:3001` 기준이다.

## Validation Layers

### Payload Validation

| Case | Status |
| --- | --- |
| malformed JSON | `400` |
| missing required field | `422` |
| invalid `context` | `422` |
| invalid `eventType` format | `422` |
| invalid `occurredAt` | `422` |
| invalid `executionUnitId` type | `422` |

### Referential Validation

| Case | Status |
| --- | --- |
| nonexistent `executionUnitId` | `404` |
| context mismatch | `409` |
| inactive unit | `409` |
| deleted unit | `409` |

## Concurrency Guarantee Targets

현재 기준선에서는 transaction layer가 deadlock / lock wait timeout에 대해 제한적 retry를 수행한다. 따라서 병렬 입력 smoke는 "deadlock 없이 통과" 자체도 성공 기준에 포함한다.

### 1. Same `dedupe_key` parallel `order_failed`

입력:

- same `executionUnitId`
- same `context`
- same `errorCode`
- same `severity`
- same `source category`
- 거의 동시에 2건

기대 결과:

- `notification_errors` row 수 = 1
- unresolved row 수 = 1
- `occurrence_count = 2`
- `error_instance_seq = 1`

실패 징후:

- row가 2개 생김
- unresolved row가 2개 생김
- `occurrence_count = 1`이 유지됨

### 2. `resolve` vs `recurrence` race

사전 상태:

- unresolved error row 1개 존재

병렬 입력:

- `error_resolved` 1건
- same `dedupe_key` `order_failed` recurrence 1건

허용되는 최종 상태는 2개뿐이다.

1. recurrence가 먼저 잡고 resolve가 닫음
   결과:
   - row 수 = 1
   - `occurrence_count = 2`
   - row는 resolved

2. resolve가 먼저 닫고 recurrence가 새 instance 생성
   결과:
   - row 수 = 2
   - 첫 row `resolved_at` not null
   - 둘째 row `error_instance_seq = 2`
   - unresolved row는 최대 1개

실패 징후:

- duplicate unresolved row 발생
- 같은 `dedupe_key`에 unresolved seq가 2개 이상 생김

## Reset SQL

```sql
DELETE FROM execution_unit_summaries WHERE execution_unit_id = 9001;
DELETE FROM execution_unit_runtime_states WHERE execution_unit_id = 9001;
DELETE FROM notification_errors WHERE execution_unit_id = 9001;
DELETE FROM execution_events WHERE execution_unit_id = 9001;
UPDATE execution_units
SET context = 'live',
    status = 'active',
    activation_status = 'active',
    is_deleted = 0
WHERE id = 9001;
```

## Verification SQL

```sql
SELECT id, dedupe_key, error_instance_seq, occurrence_count, resolved_at, first_occurred_at, last_occurred_at
FROM notification_errors
WHERE execution_unit_id = 9001
ORDER BY error_instance_seq ASC;
```

## Parallel Input Example

same `dedupe_key`를 만들기 위한 2개 payload:

```json
{
  "eventId": 101,
  "executionUnitId": 9001,
  "context": "live",
  "eventType": "order_failed",
  "eventStatus": "error",
  "eventSource": "parallel-worker-a",
  "occurredAt": "2026-04-05T21:00:00.000Z",
  "errorCode": "SMOKE_CONCURRENCY",
  "errorSourceCategory": "exchange",
  "notificationSeverity": "error",
  "message": "Concurrent order failure A"
}
```

```json
{
  "eventId": 102,
  "executionUnitId": 9001,
  "context": "live",
  "eventType": "order_failed",
  "eventStatus": "error",
  "eventSource": "parallel-worker-b",
  "occurredAt": "2026-04-05T21:00:00.100Z",
  "errorCode": "SMOKE_CONCURRENCY",
  "errorSourceCategory": "exchange",
  "notificationSeverity": "error",
  "message": "Concurrent order failure B"
}
```

기대 `notification_errors`:

| Row | `dedupe_key` | `error_instance_seq` | `occurrence_count` | `resolved_at` |
| --- | --- | --- | --- | --- |
| 1 | `9001|live|SMOKE_CONCURRENCY|error|exchange` | 1 | 2 | `NULL` |

## Referential Validation Example

### Nonexistent Execution Unit

```json
{
  "eventId": 0,
  "executionUnitId": 999999,
  "context": "live",
  "eventType": "order_failed",
  "eventStatus": "error",
  "eventSource": "referential-test",
  "occurredAt": "2026-04-05T20:00:00.000Z"
}
```

Expected: `404`

### Context Mismatch

```json
{
  "eventId": 0,
  "executionUnitId": 9001,
  "context": "test",
  "eventType": "order_failed",
  "eventStatus": "error",
  "eventSource": "referential-test",
  "occurredAt": "2026-04-05T20:01:00.000Z"
}
```

Expected: `409`

## No-Write Rule

payload validation 실패와 referential validation 실패는 아래 테이블에 어떤 row도 남기면 안 된다.

- `execution_events`
- `notification_errors`
- `execution_unit_runtime_states`
- `execution_unit_summaries`

## Optional Integration Smoke Test

```bash
RUN_DB_SMOKE_TEST=1 npm --workspace apps/backend run test:smoke
```
