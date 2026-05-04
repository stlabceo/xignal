# Local Test Checklist

## Install

```bash
npm install
```

## Start Infra

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

## Set Backend Env

Windows PowerShell example:

```powershell
$env:DB_HOST="127.0.0.1"
$env:DB_PORT="3307"
$env:DB_USER="quantu_app"
$env:DB_PASSWORD="<local-quantu-password>"
$env:DB_NAME="quantu_local"
```

Optional:

```powershell
$env:PORT="4000"
```

## Run Backend Tests

```bash
npm --workspace apps/backend run test
```

## Run Backend App

```bash
npm --workspace apps/backend run dev
```

## Expected Failure Points

- import/path:
  - `.js` extension import mismatch
  - newly added folders not included in build path
- env:
  - missing `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
  - invalid numeric port values
- db:
  - mysql container not started
  - schema not applied yet
  - `execution_events` / projection tables missing
- test:
  - dependencies not installed
  - Node version too old for current loader/test setup

## Next Integration Test Scope

- `MysqlNotificationErrorsRepository` transaction path with real MySQL
- `FOR UPDATE` lock behavior under concurrent unresolved error inserts
- resolved -> recurred sequence increment correctness
- `ExecutionEventsApplicationService` end-to-end:
  - insert execution event
  - projection updater invocation
  - projection table row verification
