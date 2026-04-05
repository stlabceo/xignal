# DDL Notes

## Assumptions

- DBMS는 MySQL 8.x를 기준으로 한다.
- `live`와 `test`는 별도 테이블이 아니라 `context` 컬럼으로 통합한다.
- JSON 컬럼은 payload, 정책 파라미터, migration-safe metadata 저장 용도로 사용한다.
- projection 테이블은 재생성 가능하다는 전제를 둔다.
- credential 원문은 저장하지 않고 reference 값만 저장한다.
- `infra/sql/002_projection_support.sql`와 `infra/sql/003_projection_rebuild_queries.sql`는 운영 보조 및 rebuild 초안이다.

## SQL File Map

- `infra/sql/001_init_placeholder.sql`
  - core source-of-truth 테이블과 기본 projection 테이블 정의
- `infra/sql/002_projection_support.sql`
  - performance projection 및 rebuild 운영 보조 테이블 정의
- `infra/sql/003_projection_rebuild_queries.sql`
  - projection rebuild/upsert 쿼리 초안

## Table Roles

### Source Of Truth Tables

- `users`
  - 사용자 기본 정보
- `exchange_accounts`
  - 사용자 거래소 연결 정보
- `strategies`
  - 재사용 가능한 rule/template 정의
- `execution_units`
  - 실제 운영/실행/조회 기준이 되는 핵심 단위
- `execution_policies`
  - execution unit별 실행 정책
- `alert_events`
  - TradingView webhook 원문과 수신 이력
- `normalized_signals`
  - alert를 정규화한 내부 signal
- `execution_tasks`
  - signal -> unit 적용 단위의 내부 작업
- `order_executions`
  - 실제 주문 요청/응답/실패 기록
- `position_states`
  - unit 기준 최신 포지션 스냅샷
- `execution_events`
  - unit lifecycle append-only 이벤트
- `audit_logs`
  - 운영자 및 시스템 감사 로그

### Projection Tables

- `execution_unit_runtime_states`
  - 운영 콘솔 실시간 현재 상태 projection
- `execution_unit_summaries`
  - 운영 목록/대시보드용 summary projection
- `notification_errors`
  - 운영 오류 센터용 projection
- `execution_unit_performance_daily`
  - 운영 콘솔 performance API 및 기간별 수익 집계용 일 단위 projection

## Projection PK Decision

- `execution_unit_runtime_states`의 PK는 `execution_unit_id` 단일키로 유지한다.
- `execution_unit_summaries`의 PK도 `execution_unit_id` 단일키로 유지한다.
- 이유:
  - projection row는 "현재 execution unit의 최신 상태/요약"을 1:1로 표현한다.
  - `context`는 source `execution_units.context`를 중복 저장한 read field이며, projection identity 자체는 아니다.
  - 목록/상세 API에서 unit id 기준 upsert와 조회가 단순해진다.

## Notification Error Dedupe Strategy

- `notification_errors`는 `dedupe_key` 컬럼을 base error identity로 사용한다.
- `error_instance_seq`는 recurrence sequence를 의미한다.
- unique index는 `(dedupe_key, error_instance_seq)`로 관리한다.
- 기본 규칙:
  - `execution_unit_id`
  - `context`
  - `error_code` 또는 `unknown`
  - `severity`
  - `source category`
- source category 예시:
  - `validation`
  - `exchange`
  - `runtime`
  - `recovery`
  - `system`
- unresolved 상태에서는 같은 dedupe 기준 오류가 같은 `(dedupe_key, error_instance_seq)` row에 누적된다.
- resolved 이후 동일 오류가 다시 발생하면 같은 base `dedupe_key`를 유지하되 `error_instance_seq`를 증가시킨 새 row를 생성한다.
- 즉:
  - `dedupe_key` = "이 오류가 어떤 종류인가"
  - `error_instance_seq` = "이 오류가 몇 번째로 다시 열렸는가"
- ordered replay rebuild 또는 application updater가 recurrence sequence를 재구성해야 한다.

### Projection Support Tables

- `projection_rebuild_runs`
  - rebuild 실행 이력과 실패 추적
- `projection_rebuild_cursors`
  - incremental rebuild resume 지점 관리

## Which Tables Are Projections

- `execution_unit_runtime_states`
- `execution_unit_summaries`
- `notification_errors`
- `execution_unit_performance_daily`

이 테이블들은 write path의 직접 authoritative source가 아니라, source-of-truth 데이터에서 계산되거나 재구성 가능한 read model이다.

## Projection Rebuild Candidates

### Must Be Rebuildable

- `execution_unit_runtime_states`
- `execution_unit_summaries`
- `notification_errors`
- `execution_unit_performance_daily`

### Rebuild Inputs

- `execution_unit_runtime_states`
  - `execution_units`
  - `execution_tasks`
  - `execution_events`
  - `order_executions`
  - `position_states`

- `execution_unit_summaries`
  - `execution_units`
  - `users`
  - `exchange_accounts`
  - `execution_events`
  - `order_executions`
  - `position_states`
  - `execution_unit_performance_daily`

- `notification_errors`
  - `execution_events`
  - `execution_tasks`
  - `order_executions`
  - legacy migration 단계에서는 `msg_list`

- `execution_unit_performance_daily`
  - `order_executions`
  - `execution_events`
  - 필요 시 `position_states`

## Performance Projection Notes

- `execution_unit_performance_daily`는 `GET /api/v1/execution-units/:unitId/performance`를 위한 핵심 집계 입력이다.
- 초기에는 일 단위 집계를 기준으로 하고, 7일/30일/cumulative 성과는 이 테이블을 합산해 계산한다.
- fee, funding, slippage를 별도 컬럼으로 둘지는 아직 미확정이다.
- realized/unrealized 반영 방식은 API 확정 시 다시 맞춰야 한다.

## Migration Mapping Notes

### `users`

- legacy source:
  - `admin_member`

### `exchange_accounts`

- legacy source:
  - `admin_member`
  - 필요 시 `play_list` / `live_play_list`의 계정 관련 컬럼 보조 사용

### `strategies`

- legacy source:
  - `stoch_list`

### `execution_units`

- legacy source:
  - `play_list`
  - `live_play_list`

### `execution_policies`

- legacy source:
  - `play_list`
  - `live_play_list`
  - `line_list`
  - 일부 기본값은 `stoch_list`

### `alert_events`

- legacy source:
  - `alert_log`
  - `alert_log2`
  - `alert_log3`

### `normalized_signals`

- legacy source:
  - `alert_log` 계열 정규화 결과

### `execution_tasks`

- legacy source:
  - `play_log`
  - `live_play_log`

### `order_executions`

- legacy source:
  - `play_log`
  - `live_play_log`
  - `msg_list`

### `position_states`

- legacy source:
  - `play_log`
  - `live_play_log`
  - 필요 시 거래소 reconcile 데이터

### `execution_events`

- legacy source:
  - `event_log`
  - `play_log`
  - `live_play_log`
  - `msg_list`
  - `alert_log` 계열 일부 이벤트

### `execution_unit_runtime_states`

- 신규 projection
- migration 시 초기값은 `execution_units`, `play_log`, `live_play_log`, `msg_list` 기반 재계산

### `execution_unit_summaries`

- 신규 projection
- migration 시 초기값은 `execution_units`, `users`, `play_log`, `live_play_log`, `execution_unit_performance_daily` 기반 재계산

### `notification_errors`

- 신규 projection
- migration 시 초기값은 `msg_list`, `play_log`, `live_play_log`, `event_log` 기반 재계산

### `execution_unit_performance_daily`

- 신규 projection
- migration 시 초기값은 `play_log`, `live_play_log`, 필요 시 `event_log` 기반 재계산

### `audit_logs`

- legacy source:
  - `event_log`
  - 운영자 액션 추출 가능 시 `admin_member` 연계

## Operational Notes

- `execution_units`는 운영 제어의 기준 테이블이다.
- `execution_events`는 timeline과 rebuild 입력으로 중요하므로 append-only 성격을 유지하는 편이 좋다.
- `position_states`는 최신 스냅샷 테이블로 두고, 필요 시 별도 history 테이블을 후속 추가할 수 있다.
- `notification_errors`는 unresolved error center 용도이므로 `resolved_at` 인덱스가 중요하다.
- `projection_rebuild_runs`는 장애 시 어떤 projection이 실패했는지 파악하는 운영용 메타 테이블이다.

## Unsettled Decisions

- `position_states.source_event_id`는 현재 nullable reference 후보이며 FK 부여 여부를 추후 확정
- `notification_errors.source_event_id` / `source_task_id` / `source_order_execution_id`는 nullable FK 유지 원칙으로 간다
- `notification_errors.error_instance_seq`를 DB 저장 프로시저로 계산할지 application updater로 계산할지 추후 확정 가능
- `execution_unit_performance_daily`의 source pointer를 `source_last_event_id`와 `source_last_order_execution_id` 둘 다 유지할지 결정 필요

## TODO

- status 값 집합을 enum으로 고정할지 reference table로 분리할지 결정
- dashboard 전용 materialized projection이 필요한지 판단
- `execution_tasks.dedupe_key` 규칙과 `normalized_signals.signal_key` 규칙 확정
- 성과 계산 기준 realized/unrealized 반영 정책 확정
- migration id mapping table 스키마 설계
- `003_projection_rebuild_queries.sql`의 placeholder 범위 필터를 실제 작업 단위 규칙으로 구체화
