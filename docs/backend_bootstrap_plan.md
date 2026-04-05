# Backend Bootstrap Plan

## Goal

backend를 로컬에서 띄우고 projection updater 테스트를 실행할 수 있는 최소 개발 경로를 정리한다.

## Local Run Order

1. workspace 루트에서 backend dependencies를 설치한다.
2. MySQL과 Redis를 `infra/docker/docker-compose.yml` 기준으로 준비한다.
3. backend용 환경변수 파일을 준비한다.
4. backend 개발 서버를 실행한다.

Suggested flow:

```bash
npm install
docker compose -f infra/docker/docker-compose.yml up -d
set DB_HOST=127.0.0.1
set DB_PORT=3306
set DB_USER=root
set DB_PASSWORD=root
set DB_NAME=xignal
npm --workspace apps/backend run dev
```

## Test Execution

backend는 현재 Node built-in test runner를 사용한다.

Run:

```bash
npm --workspace apps/backend run test
```

현재 테스트는 `tsx` loader를 통해 TypeScript spec를 직접 실행하는 방식이다.

## mysql2/promise Connection Strategy

### Current Direction

- `mysql2/promise`를 사용한다.
- pool 생성은 `apps/backend/src/infrastructure/db/mysql-pool.ts`
- transaction wrapper는 `apps/backend/src/infrastructure/db/transaction-runner.ts`
- repository는 pool 또는 transaction connection을 주입받아 실행한다.

### Expected Environment Inputs

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

### Integration Shape

1. env 로드
2. mysql pool 생성
3. repository 인스턴스 생성
4. application service와 projection updater 조립
5. route 또는 worker entry에서 execution event application service 호출

## Projection Updater Call Path

초기 경로는 아래처럼 잡는다.

1. execution event가 application service로 들어온다.
2. `ExecutionEventsApplicationService`가 execution event를 저장한다.
3. 저장 직후 `ProjectionUpdaterService`를 호출한다.
4. `ProjectionUpdaterService`가:
   - `NotificationErrorsUpdaterService`
   - `ExecutionUnitRuntimeUpdaterService`
   - `ExecutionUnitSummaryUpdaterService`
   순서로 projection patch를 적용한다.

## Notes

- 현재 MySQL repository는 초안 수준이므로 실제 schema/driver 설정에 따라 반환 타입 보정이 필요하다.
- `notification_errors`는 transaction + row lock 전제가 강하므로 실제 DB integration test가 중요하다.
- 장기적으로는 execution event 저장과 projection 갱신 사이에 outbox 또는 worker split을 도입할 수 있다.
