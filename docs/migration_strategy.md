# Migration Strategy

## Objective

기존 시스템의 사용자, 실행 설정, 이벤트/로그 데이터를 신규 `ExecutionUnit` 중심 구조로 이전할 수 있도록 준비한다.

이번 단계에서는 실제 이관 스크립트보다 "테이블이 어떤 신규 엔티티로 분해되는가"를 명확히 문서화하는 데 집중한다.

## Legacy Inputs To Inspect

- `legacy/sql.sql`
- `legacy/backend/database`
- 기존 backend route 및 util 내 DB 접근 코드
- 환경변수 기반 설정값

## Migration Workstreams

### 1. Schema Inventory

- 레거시 테이블 목록 정리
- 각 컬럼 의미 문서화
- PK/FK/nullable/default 파악
- 테스트/실거래 분리 방식 파악

### 2. Mapping Design

- legacy 사용자/설정 테이블을 신규 `User`, `ExchangeAccount`, `ExecutionUnit`, `ExecutionPolicy`로 분해
- legacy 로그 테이블을 신규 `ExecutionEvent`, `OrderExecution`, `NotificationError`, `AuditLog`로 분해
- live/test 분리 테이블은 신규 엔티티의 `context` 필드로 통합

### 3. Data Quality Checks

- 필수 컬럼 null 여부
- 중복 계정/중복 사용자
- 거래소 코드와 마켓 타입 표준화 필요 여부
- timestamp timezone 정합성
- live/test 데이터 간 스키마 편차 여부

### 4. Migration Execution Strategy

- read-only snapshot 확보
- 샘플 데이터 dry-run
- row count 및 샘플 레코드 검증
- cutover 전 delta sync 필요 여부 판단

## Legacy To New Table Mapping

| Legacy table | Legacy role | New entity mapping | Notes |
| --- | --- | --- | --- |
| `admin_member` | 사용자 및 운영 대상 기본 정보 | `User`, 일부 `ExchangeAccount` seed 후보, `AuditLog` actor reference | 계정 자격 증명과 사용자 프로필이 혼재되어 있을 수 있어 분리 정제 필요 |
| `play_list` | 테스트 또는 일반 실행 설정 목록 | `ExecutionUnit`, `ExecutionPolicy`, `ExecutionUnitSummary` seed | `context=test` 또는 규칙 기반 context 판정 후보 |
| `live_play_list` | 실거래 실행 설정 목록 | `ExecutionUnit`, `ExecutionPolicy`, `ExecutionUnitRuntimeState`, `ExecutionUnitSummary` seed | 신규 구조에서는 별도 테이블이 아니라 `ExecutionUnit.context=live` |
| `stoch_list` | 전략 정의/파라미터 템플릿 | `Strategy`, 일부 `ExecutionPolicy` default seed | `Strategy`는 secondary 개념으로 유지 |
| `play_log` | 테스트 또는 일반 실행 결과 로그 | `ExecutionEvent`, `ExecutionTask`, `OrderExecution`, `PositionState` history source | 결과 상태와 수익 정보는 performance projection 재계산 입력 |
| `live_play_log` | 실거래 실행 결과 로그 | `ExecutionEvent`, `ExecutionTask`, `OrderExecution`, `PositionState` history source, `ExecutionUnitSummary` rollup source | live/test 통합 시 `context=live` |
| `event_log` | 사용자/실행 이벤트 로그 | `ExecutionEvent`, `AuditLog` | 운영자 액션과 시스템 이벤트를 분리 분류 필요 |
| `msg_list` | 에러/메시지/거래소 응답 로그 | `ExecutionEvent`, `NotificationError`, `OrderExecution.failure_reason` | unresolved error center 구성의 핵심 입력 |
| `alert_log` | alert 원문 로그 | `AlertEvent`, 일부 `NormalizedSignal` source | alert 계열 테이블은 스키마 차이를 흡수해 공통 alert ingestion 모델로 정규화 |
| `alert_log2` | alert 원문 로그 변형 | `AlertEvent`, 일부 `NormalizedSignal` source | `alert_log` 계열로 통합 처리 |
| `alert_log3` | alert 원문 로그 변형 | `AlertEvent`, 일부 `NormalizedSignal` source | `alert_log` 계열로 통합 처리 |
| `line_list` | 심볼별 기준선/보조 설정 | `ExecutionPolicy`, `Strategy` parameter supplement, `ExecutionUnit` decoration metadata | 독립 엔터티보다는 보조 정책/파라미터로 흡수하는 편이 적합 |

## Entity Split Guidance By Legacy Table

### `admin_member`

- 사용자 식별자와 표시명은 `User`
- 거래소 API credential 관련 컬럼이 있으면 `ExchangeAccount`
- 활성/차단 상태는 `User.status`, `ExchangeAccount.status`로 분리

### `play_list` and `live_play_list`

- 사용자/심볼/타임프레임/전략 연결은 `ExecutionUnit`
- 수량, 배분 방식, 손절/익절, 제한값은 `ExecutionPolicy`
- 현재 활성 여부는 `ExecutionUnit.activation_status`
- live/test 구분은 `ExecutionUnit.context`

### `stoch_list`

- 전략 템플릿 식별자와 지표 파라미터는 `Strategy`
- unit 기본 정책으로 승격 가능한 값은 `ExecutionPolicy` default seed

### `play_log` and `live_play_log`

- 행 단위 실행 시도는 `ExecutionTask`
- 주문 결과와 체결 관련 필드는 `OrderExecution`
- 상태 변화 로그는 `ExecutionEvent`
- 포지션 결과 스냅샷은 `PositionState` 또는 성과 재계산 입력으로 사용

### `event_log`

- unit lifecycle 관련 항목은 `ExecutionEvent`
- 운영자 조작 또는 관리 이력은 `AuditLog`

### `msg_list`

- 오류 발생 사실은 `NotificationError`
- 해당 오류가 주문 단계에서 발생했다면 `OrderExecution.failure_reason`
- 운영 타임라인 노출용으로는 `ExecutionEvent`도 함께 생성

### `alert_log` family

- raw webhook payload는 `AlertEvent`
- symbol, side, action, timeframe 추출 결과는 `NormalizedSignal`
- 중복 제거 키는 `AlertEvent.idempotency_key`

### `line_list`

- 심볼별 선 기준, 상하단 범위, 추가 파라미터는 `ExecutionPolicy` 또는 `Strategy` parameter supplement
- 운영 콘솔 노출용 태그/보조 메타데이터가 필요하면 `ExecutionUnit` 확장 metadata에 반영

## Recommended Migration Sequence

1. `admin_member`를 `User` 기준으로 정제한다.
2. `stoch_list`에서 `Strategy` 템플릿을 정의한다.
3. `play_list`와 `live_play_list`를 읽어 `ExecutionUnit`, `ExecutionPolicy`를 생성한다.
4. `alert_log` 계열을 `AlertEvent`, `NormalizedSignal`로 적재한다.
5. `play_log`, `live_play_log`, `event_log`, `msg_list`를 `ExecutionEvent`, `ExecutionTask`, `OrderExecution`, `NotificationError`로 분해 적재한다.
6. 마지막으로 `ExecutionUnitSummary`, `ExecutionUnitRuntimeState`, `PositionState` projection을 재계산한다.

## Risks To Watch

- legacy 컬럼명이 의미를 충분히 설명하지 않을 수 있음
- live/test 테이블 간 동일 명칭 컬럼의 의미가 미세하게 다를 수 있음
- 하나의 legacy row가 신규 여러 엔티티로 분해되므로 id mapping table이 필요함
- 에러 메시지와 실행 로그 사이 correlation key가 약할 수 있음
- timezone 혼재로 timeline 재구성 순서가 어긋날 수 있음

## Migration Deliverables

- 레거시 스키마 인벤토리 문서
- legacy row -> new entity id mapping table
- 신규 DDL
- dry-run script
- projection rebuild script
- 검증 체크리스트
