# Observability Runbook

## Purpose

`transaction retry` observability를 운영에서 읽고, 보존하고, 문제 발생 시 재현하는 절차를 정리한다.

## Prerequisites

- 최신 backend가 dedicated port에 떠 있어야 한다.
- `stdout` JSON line이 파일 또는 container log로 보존되고 있어야 한다.
- MySQL 조회가 가능해야 한다.

## Execution Order

1. endpoint snapshot 조회
2. JSON line 로그 보존
3. `notification_errors` 조회
4. 필요 시 별도 포트에서 stress 재현
5. 정상/비정상 기준으로 판정

## Commands

snapshot:

```powershell
Invoke-RestMethod -Method Get -Uri 'http://localhost:3003/api/v1/internal/observability/transaction-retries' | ConvertTo-Json -Depth 6
```

reset:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:3003/api/v1/internal/observability/transaction-retries/reset' | ConvertTo-Json -Compress
```

DB query:

```powershell
docker exec xignal-mysql mysql -uroot -proot xignal -B -N -e "SELECT id, dedupe_key, error_instance_seq, occurrence_count, IFNULL(DATE_FORMAT(resolved_at, '%Y-%m-%d %H:%i:%s.%f'), 'NULL') FROM notification_errors WHERE execution_unit_id = 9001 ORDER BY id ASC;"
```

log file check:

```bash
tail -n 200 /var/log/xignal/backend-jsonl.log
grep '"category":"db.transaction.retry"' /var/log/xignal/backend-jsonl.log | tail -n 20
```

docker log check:

```bash
docker logs xignal-backend --since 10m
```

## Normal Criteria

- `retryCount > 0` 이어도 `failureCount = 0` 이면 정상 범주
- projection 상태와 `notification_errors` 상태가 맞으면 정상

## Abnormal Criteria

- `failureCount > 0`
- duplicate unresolved instance
- projection mismatch
- stress 기대 결과와 실제 DB 결과 불일치

## Follow-Up Action

정상일 때:

1. endpoint snapshot 저장
2. backend log 저장
3. DB query 결과 저장

비정상일 때:

1. 프로세스를 바로 재시작하지 않는다.
2. snapshot, logs, DB query를 먼저 확보한다.
3. dedicated port에서 stress 절차로 재현한다.
4. concurrency issue로 분류하고 release/DB-change 진행을 멈춘다.

## Short Checklists

배포 전:

1. endpoint 접근 확인
2. log retention 확인
3. DB query 가능 확인
4. stress target port 확인

DB 설정 변경 후:

1. schema/seed 재적용 확인
2. endpoint reset 확인
3. log retention 유지 확인

장애 분석 시:

1. restart 전 snapshot 저장
2. JSON logs 저장
3. DB query 저장
4. 필요 시 별도 포트 재현

활성화 직후:

1. endpoint 응답 확인
2. backend JSON line 생성 확인
3. DB query 가능 확인
4. artifact 저장 경로 확인
