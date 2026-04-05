# Domain Model

## Modeling Direction

1차 제품의 핵심 단위는 `Strategy`가 아니라 `ExecutionUnit`이다.

`Strategy`는 재사용 가능한 규칙 정의이자 템플릿 성격의 secondary 개념으로 두고, 실제 운영/조회/활성화/비활성화/성과 집계의 기준은 `ExecutionUnit`으로 통일한다.

또한 `live`와 `test`는 별도 엔티티로 분리하지 않고, 대부분의 핵심 엔터티에 `context` 필드로 표현한다.

Suggested context values:

- `live`
- `test`

## Core Entities

### User

- 자동매매 서비스를 사용하는 운영 대상 사용자
- 여러 거래소 계정과 여러 execution unit을 가질 수 있음

Suggested fields:

- `id`
- `email`
- `display_name`
- `status`
- `created_at`
- `updated_at`

### ExchangeAccount

- 사용자의 거래소 API 자격 증명 및 연결 상태

Suggested fields:

- `id`
- `user_id`
- `exchange_type`
- `api_key_ref`
- `api_secret_ref`
- `passphrase_ref`
- `status`
- `last_validated_at`

### Strategy

- 진입/청산 규칙, 파라미터 세트, 지표 조합을 표현하는 secondary 엔티티
- 직접 실행되는 단위가 아니라 `ExecutionUnit`이 참조하는 템플릿 또는 rule pack

Suggested fields:

- `id`
- `strategy_key`
- `name`
- `description`
- `version`
- `status`

### ExecutionUnit

- 운영 콘솔과 실행 엔진이 공통으로 다루는 최상위 실행 단위
- "누가, 어떤 계정으로, 어떤 마켓/심볼에, 어떤 전략 규칙을, 어떤 context에서 실행하는가"를 표현

Suggested fields:

- `id`
- `user_id`
- `exchange_account_id`
- `strategy_id`
- `context`
- `symbol`
- `market_type`
- `timeframe`
- `name`
- `status`
- `activation_status`
- `created_at`
- `updated_at`

### ExecutionPolicy

- execution unit별 주문 크기, 손절/익절, 재진입, 리스크 제한 등 실행 정책
- 정책은 strategy 기본값과 분리하여 unit 수준 override를 허용

Suggested fields:

- `id`
- `execution_unit_id`
- `allocation_mode`
- `allocation_value`
- `max_position_size`
- `max_daily_loss`
- `max_concurrent_positions`
- `entry_policy`
- `exit_policy`
- `risk_policy`
- `updated_at`

### PositionState

- execution unit 기준 현재 포지션 상태의 최신 스냅샷
- 운영 콘솔 상세 화면과 live/test 목록의 핵심 read source

Suggested fields:

- `id`
- `execution_unit_id`
- `context`
- `position_side`
- `quantity`
- `entry_price`
- `mark_price`
- `unrealized_pnl`
- `realized_pnl`
- `leverage`
- `status`
- `updated_at`

### AlertEvent

- TradingView에서 수신한 원본 webhook 이벤트
- 중복 판정과 원문 감사 추적의 기준

Suggested fields:

- `id`
- `source`
- `external_event_id`
- `idempotency_key`
- `raw_payload`
- `received_at`
- `validation_status`

### NormalizedSignal

- 원본 alert를 내부 실행 엔진이 처리 가능한 표준 signal로 변환한 결과
- 특정 strategy 정의와 느슨하게 연결되며, 최종 실행은 execution unit 매칭으로 진행

Suggested fields:

- `id`
- `alert_event_id`
- `symbol`
- `market_type`
- `side`
- `action`
- `timeframe`
- `strategy_key`
- `signal_time`

### ExecutionTask

- 특정 signal이 특정 execution unit에 적용되며 생성된 내부 실행 작업
- 큐 기반 또는 worker 기반 처리 단위

Suggested fields:

- `id`
- `normalized_signal_id`
- `execution_unit_id`
- `user_id`
- `exchange_account_id`
- `context`
- `status`
- `scheduled_at`
- `started_at`
- `finished_at`

### OrderExecution

- 실제 거래소 주문 요청 및 응답 기록

Suggested fields:

- `id`
- `execution_task_id`
- `exchange_order_id`
- `request_payload`
- `response_payload`
- `status`
- `failure_reason`
- `executed_at`

### ExecutionEvent

- execution unit lifecycle에서 발생하는 상태 변화 이벤트
- 활성화, 비활성화, signal 수신, 주문 요청, 주문 실패, 포지션 종료 등을 append-only로 기록

Suggested fields:

- `id`
- `execution_unit_id`
- `context`
- `event_type`
- `event_source`
- `event_status`
- `correlation_id`
- `payload`
- `created_at`

### ExecutionUnitRuntimeState

- 운영 콘솔의 실시간 상태 조회를 위한 최신 런타임 projection
- worker가 갱신하며 list/detail read model의 현재 상태 소스로 사용

Suggested fields:

- `execution_unit_id`
- `context`
- `is_active`
- `last_signal_at`
- `last_execution_at`
- `last_event_type`
- `last_error_code`
- `last_error_message`
- `worker_status`
- `health_status`
- `updated_at`

### ExecutionUnitSummary

- 운영 콘솔 목록/대시보드용 집계 projection
- 성능, 승률, 최근 이벤트, 현재 포지션 여부 등을 비정규화해서 제공

Suggested fields:

- `execution_unit_id`
- `context`
- `display_name`
- `user_display_name`
- `exchange_type`
- `symbol`
- `timeframe`
- `activation_status`
- `position_status`
- `today_pnl`
- `cumulative_pnl`
- `win_rate`
- `last_event_at`
- `last_event_type`
- `last_error_message`

### NotificationError

- 운영 콘솔 상단 또는 오류 센터에서 보여줄 에러/경고 알림 모델

Suggested fields:

- `id`
- `execution_unit_id`
- `context`
- `severity`
- `error_code`
- `message`
- `first_occurred_at`
- `last_occurred_at`
- `resolved_at`

### AuditLog

- 운영자 액션과 주요 시스템 변경을 기록하는 감사 로그

Suggested fields:

- `id`
- `actor_type`
- `actor_id`
- `event_type`
- `target_type`
- `target_id`
- `payload`
- `created_at`

## Relationship Summary

- User 1:N ExchangeAccount
- User 1:N ExecutionUnit
- Strategy 1:N ExecutionUnit
- ExecutionUnit 1:1 ExecutionPolicy
- ExecutionUnit 1:1 PositionState
- ExecutionUnit 1:1 ExecutionUnitRuntimeState
- ExecutionUnit 1:1 ExecutionUnitSummary
- ExecutionUnit 1:N ExecutionTask
- ExecutionUnit 1:N ExecutionEvent
- AlertEvent 1:N NormalizedSignal
- NormalizedSignal 1:N ExecutionTask
- ExecutionTask 1:N OrderExecution

## Aggregate Candidates

- User aggregate
- ExecutionUnit aggregate
- Alert/Signal aggregate
- Execution aggregate

## Frontend Read Models

운영 콘솔은 write model을 직접 조합하기보다 아래 read model을 우선 사용한다.

### LiveUnitListItem

- `ExecutionUnitSummary` + `ExecutionUnitRuntimeState` + `PositionState` 일부를 결합한 목록 모델

Key fields:

- `execution_unit_id`
- `name`
- `symbol`
- `timeframe`
- `activation_status`
- `position_status`
- `today_pnl`
- `last_event_type`
- `last_error_message`

### TestUnitListItem

- live와 동일 구조를 가지되 `context=test` 조건으로 조회

### ExecutionUnitDetailView

- 기본 unit 정보
- policy
- position snapshot
- runtime state
- 최근 execution event
- 최근 order execution

### DashboardSummaryView

- 전체 live unit 수
- 전체 test unit 수
- 활성 unit 수
- 오류 발생 unit 수
- 당일 PnL 요약
- 최근 실패 이벤트 수

### NotificationErrorItem

- 오류 코드
- 메시지
- 대상 unit
- 마지막 발생 시각
- 해결 여부

## Realtime State Model

운영 콘솔의 실시간 업데이트는 `ExecutionUnitRuntimeState`, `ExecutionEvent`, `NotificationError` 변경을 기준으로 동작한다.

Realtime channels to consider:

- unit runtime updated
- position updated
- execution event appended
- notification error raised
- notification error resolved

## Domain Rules To Clarify

- 하나의 signal이 어떤 execution unit 집합에 매칭되는가
- unit 활성화 상태와 policy 위반 상태 중 무엇이 우선 차단 사유인가
- `context=live`와 `context=test`에서 허용하는 동작 차이를 어디서 강제할 것인가
- PositionState를 주문 응답 기반으로만 갱신할지, 거래소 조회 reconcile을 병행할지
- ExecutionUnitSummary 재계산 주기와 실시간 projection 갱신 전략은 무엇인가
