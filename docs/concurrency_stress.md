# Concurrency Stress Guide

## Purpose

`stress:concurrency:same` 와 `stress:concurrency:race` 를 릴리스 전, DB 설정 변경 후, 장애 분석 시 반복 가능한 절차로 정리한다.

## Prerequisites

1. 최신 backend를 dedicated port로 실행
2. MySQL / Redis 기동
3. `execution_unit_id = 9001` seed 준비
4. stress 전 DB reset
5. observability reset

recommended port:

```powershell
$env:PORT="3003"
npm.cmd --workspace apps/backend run dev
```

DB reset:

```powershell
docker exec xignal-mysql mysql -uroot -proot xignal -e "DELETE FROM execution_unit_summaries WHERE execution_unit_id = 9001; DELETE FROM execution_unit_runtime_states WHERE execution_unit_id = 9001; DELETE FROM notification_errors WHERE execution_unit_id = 9001; DELETE FROM execution_events WHERE execution_unit_id = 9001; UPDATE execution_units SET context='live', status='active', activation_status='active', is_deleted=0 WHERE id = 9001;"
```

seed:

```powershell
Get-Content -Raw infra\sql\010_local_smoke_seed.sql | docker exec -i xignal-mysql mysql -uroot -proot xignal
```

observability reset:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:3003/api/v1/internal/observability/transaction-retries/reset' | ConvertTo-Json -Compress
```

CI placeholder:

- default DB values are local defaults only
- replace with repository Variables or Secrets when the CI environment differs
- choose a dedicated `port` input

## Execution

same-dedupe:

```powershell
npm.cmd --workspace apps/backend run stress:concurrency:same -- --url http://localhost:3003 --runs 4 --parallelism 4
```

resolve-race:

```powershell
npm.cmd --workspace apps/backend run stress:concurrency:race -- --url http://localhost:3003 --runs 4 --parallelism 2
```

## Normal Criteria

- same-dedupe: unresolved row 1, `occurrence_count = total requests`, `failureCount = 0`
- resolve-race: duplicate unresolved instance 없음, unresolved row 최대 1, `failureCount = 0`
- `retryCount > 0` 이어도 `failureCount = 0` 이면 정상
- runtime / summary / `notification_errors` 상태가 final event stream과 일치

## Abnormal Criteria

- `failureCount > 0`
- duplicate unresolved instance
- wrong `occurrence_count`
- projection mismatch

## Follow-Up Action

정상일 때:

1. endpoint snapshot 저장
2. backend.log 저장
3. notification/runtime artifact 저장

비정상일 때:

1. 프로세스를 바로 재시작하지 않는다.
2. logs와 snapshot을 먼저 보존한다.
3. duplicate unresolved instance 여부를 DB에서 확인한다.
4. 최신 build를 별도 포트에서 재현한다.

## Runbook Checklists

배포 전:

1. dedicated port 확인
2. DB reset
3. seed 적용
4. observability reset
5. same-dedupe 실행
6. resolve-race 실행
7. artifact 저장

DB 설정 변경 후:

1. schema 적용
2. seed 적용
3. observability reset
4. same-dedupe 실행
5. resolve-race 실행
6. 결과 비교

장애 분석 시:

1. snapshot 저장
2. JSON logs 저장
3. DB query 저장
4. 별도 포트 재현
5. 정상 기준과 비교

활성화 직후:

1. workflow_dispatch 가 UI에 보이는지 확인
2. artifacts 가 업로드되는지 확인
3. `GITHUB_STEP_SUMMARY` 가 보이는지 확인
4. `notification-errors-*.txt` 에 duplicate unresolved instance 가 없는지 확인

## CI Opt-In

sample workflow:

- [.github/workflows/concurrency-stress-opt-in.yml](/C:/Users/tmdtk/Xignal/.github/workflows/concurrency-stress-opt-in.yml)

manual trigger inputs:

```text
port: 3003
same_runs: 4
same_parallelism: 4
race_runs: 4
race_parallelism: 2
```

expected artifacts:

- `backend.log`
- `observability-same.json`
- `observability-race.json`
- `notification-errors-same.txt`
- `notification-errors-race.txt`
- `runtime-same.txt`
- `runtime-race.txt`
