# Proposed Architecture

## Overview

신규 시스템은 기존 레거시 코드를 보존한 채, `ExecutionUnit` 중심의 실행 엔진과 운영 콘솔을 병행 구축하는 구조를 따른다.

- `apps/backend`: 단일 backend 앱으로 시작하되 API와 worker split을 준비한 구조
- `apps/frontend`: 운영 콘솔 UI
- `infra/docker`: 로컬 개발 및 통합 실행용 인프라 정의
- `infra/sql`: 신규 스키마 및 projection 재계산용 SQL 초안

초기 런타임은 하나의 backend 앱으로 유지하지만, 내부 경계는 아래처럼 나눈다.

- `api`: REST API + webhook + admin auth
- `worker-ready`: execution pipeline, projection updater, retry processor
- `shared`: domain model, adapter contracts, config

## Logical Components

### 1. Alert Gateway

- TradingView webhook 수신
- webhook secret 검증
- raw alert payload 저장
- idempotency key 생성

### 2. Signal Normalizer

- alert를 내부 표준 signal로 변환
- symbol, side, action, timeframe, strategy key 정규화
- validation failure 저장

### 3. Execution Unit Resolver

- signal이 어떤 execution unit 집합에 매칭되는지 결정
- `context`, symbol, strategy linkage, activation status 기준으로 필터링

### 4. Execution Orchestrator

- execution unit별 실행 가능 여부 확인
- policy 위반 여부 검증
- execution task 생성
- adapter 호출과 결과 반영

### 5. Exchange Adapter Layer

- 거래소별 인증, 주문, 조회 API 추상화
- 공통 인터페이스와 거래소별 구현 분리
- mock adapter 지원

### 6. Projection Builder

- `ExecutionUnitRuntimeState`
- `ExecutionUnitSummary`
- `DashboardSummaryView`
- `NotificationError`

위 projection을 execution event와 order result를 기반으로 갱신한다.

### 7. Operations API

- 운영 콘솔이 직접 쓰는 read model API 제공
- execution unit 목록/상세/타임라인/성과 조회
- dashboard 및 notification center 조회

### 8. Operations Console

- live/test unit 목록
- unit 상세와 timeline
- 오류 센터
- 대시보드 KPI

## Data Flow

1. TradingView가 webhook을 전송한다.
2. backend가 `AlertEvent`를 저장하고 검증한다.
3. alert를 `NormalizedSignal`로 정규화한다.
4. resolver가 대상 `ExecutionUnit`을 찾는다.
5. orchestrator가 `ExecutionTask`와 `ExecutionEvent`를 생성한다.
6. exchange adapter를 통해 주문을 실행한다.
7. 결과를 `OrderExecution`, `PositionState`, `ExecutionEvent`에 반영한다.
8. projection builder가 `ExecutionUnitRuntimeState`, `ExecutionUnitSummary`, dashboard projection을 갱신한다.
9. frontend는 read model API 또는 realtime channel을 통해 상태를 조회한다.

## Operations Console Read Models

운영 콘솔은 write model을 직접 조합하지 않고, 아래 read model을 중심으로 사용한다.

### Live Unit List Read Model

Source:

- `ExecutionUnitSummary`
- `ExecutionUnitRuntimeState`
- `PositionState`

Use cases:

- `GET /api/v1/live-units`
- 메인 운영 화면

### Test Unit List Read Model

Source:

- 위와 동일
- 단 `context=test`

Use cases:

- `GET /api/v1/test-units`

### Execution Unit Detail Read Model

Source:

- `ExecutionUnit`
- `ExecutionPolicy`
- `PositionState`
- `ExecutionUnitRuntimeState`
- 최근 `ExecutionEvent`
- 최근 `OrderExecution`

Use cases:

- `GET /api/v1/execution-units/:unitId`

### Execution Timeline Read Model

Source:

- `ExecutionEvent`
- 일부 `AlertEvent`
- 일부 `OrderExecution`
- 일부 `AuditLog`

Use cases:

- `GET /api/v1/execution-units/:unitId/timeline`

### Performance Read Model

Source:

- `OrderExecution`
- `ExecutionEvent`
- 종료 포지션 결과 집계 테이블 또는 materialized projection

Use cases:

- `GET /api/v1/execution-units/:unitId/performance`

### Dashboard Summary Read Model

Source:

- `ExecutionUnitSummary`
- `ExecutionUnitRuntimeState`
- `NotificationError`

Use cases:

- `GET /api/v1/dashboard/summary`

### Notification Error Read Model

Source:

- `NotificationError`
- `ExecutionUnitSummary`

Use cases:

- `GET /api/v1/notifications/errors`

## Realtime Updates

운영 콘솔은 목록/상세/알림 센터가 빠르게 변해야 하므로 realtime updates를 고려한다.

### Candidate transports

- SSE
- WebSocket

### Initial recommendation

- 초기 제품은 SSE 우선 검토
- 이유: 운영 콘솔은 서버 -> 클라이언트 단방향 갱신 비중이 높고, 구현/운영 복잡도가 비교적 낮음
- 향후 다중 채널 제어, 상호작용, presence가 필요하면 WebSocket으로 확장

### Realtime event topics

- execution unit runtime updated
- position state updated
- execution event appended
- notification error raised
- notification error resolved
- dashboard summary updated

### Realtime design considerations

- polling fallback 유지
- event ordering 보장 전략 필요
- connection reconnect와 last-event-id 처리 필요
- live/test context 필터링 지원 필요
- 대시보드와 상세 화면의 projection freshness 기준 정의 필요

## Cross-Cutting Concerns

- 인증/인가
- idempotency
- audit logging
- observability
- projection consistency
- retry and dead-letter strategy
- secret management
- migration compatibility

## Folder Direction

```text
apps/
  backend/
    src/
      app/
      modules/
      domain/
      projections/
      adapters/
      infrastructure/
  frontend/
    src/
      app/
      pages/
      widgets/
      entities/
      features/
      shared/
infra/
  docker/
  sql/
docs/
```

## Open Decisions

- queue를 즉시 도입할지, 단일 DB 기반 background processor로 시작할지
- projection 갱신을 sync로 처리할지 async worker로 분리할지
- SSE를 바로 도입할지 polling부터 시작할지
- 거래소 adapter 우선순위를 어떻게 가져갈지
