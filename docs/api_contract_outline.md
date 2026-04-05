# API Contract Outline

## Guiding Principles

- REST 우선
- 운영 콘솔이 바로 사용할 수 있는 read model 중심 계약
- write model과 read model을 필요 시 분리
- TradingView webhook namespace는 별도 유지
- `live`와 `test`는 개별 리소스 타입이 아니라 `context` 필터로 관리하되, 운영 편의를 위해 일부 별칭 endpoint를 제공

## API Areas

### 1. Public Webhook

- `POST /api/v1/webhooks/tradingview`
  - TradingView alert 수신
  - raw payload 저장
  - idempotency 처리
  - TODO: secret or signature 정책 확정

### 2. Auth / Admin

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`

### 3. Users

- `GET /api/v1/users`
- `GET /api/v1/users/:userId`
- `POST /api/v1/users`
- `PATCH /api/v1/users/:userId`

### 4. Exchange Accounts

- `GET /api/v1/exchange-accounts`
- `POST /api/v1/exchange-accounts`
- `PATCH /api/v1/exchange-accounts/:accountId`
- `POST /api/v1/exchange-accounts/:accountId/validate`

### 5. Execution Units

- `GET /api/v1/live-units`
  - `context=live` execution unit 목록 read model

- `GET /api/v1/test-units`
  - `context=test` execution unit 목록 read model

- `GET /api/v1/execution-units`
  - 공통 목록 API
  - filters: `context`, `status`, `activationStatus`, `userId`, `symbol`, `exchangeType`

- `GET /api/v1/execution-units/:unitId`
  - execution unit 상세 view
  - policy, runtime state, position state, latest summary 포함

- `POST /api/v1/execution-units`
  - execution unit 생성
  - body에 `context`, `exchangeAccountId`, `symbol`, `strategyId`, `policy` 포함

- `PATCH /api/v1/execution-units/:unitId`
  - execution unit 설정 수정
  - 기본 정보와 policy 일부 수정

- `POST /api/v1/execution-units/:unitId/activate`
  - 활성화 요청
  - 실제 runtime state 변경 결과는 event 기반 반영

- `POST /api/v1/execution-units/:unitId/deactivate`
  - 비활성화 요청

- `GET /api/v1/execution-units/:unitId/timeline`
  - execution event timeline
  - alert 수신, task 생성, 주문 실행, 오류, 운영자 액션 포함

- `GET /api/v1/execution-units/:unitId/performance`
  - 누적 성과, 기간별 pnl, 승률, 최근 결과

### 6. Dashboard / Notifications

- `GET /api/v1/dashboard/summary`
  - 운영 콘솔 상단 KPI
  - live/test unit count, active count, error count, today pnl 등

- `GET /api/v1/notifications/errors`
  - 최근 또는 미해결 오류 목록
  - execution unit 중심 정렬

### 7. Alerts / Signals / Executions

- `GET /api/v1/alerts`
- `GET /api/v1/alerts/:alertId`
- `GET /api/v1/signals`
- `GET /api/v1/executions`
- `GET /api/v1/executions/:executionId`
- `POST /api/v1/executions/:executionId/retry`

## Execution Unit Read Models

### `GET /api/v1/live-units`

Purpose:

- 운영 콘솔 메인 목록
- 현재 상태를 빠르게 스캔하기 위한 summary projection

Response outline:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "executionUnitId": "eu_123",
        "context": "live",
        "name": "BTC live scalp",
        "userDisplayName": "operator-01",
        "exchangeType": "binance-futures",
        "symbol": "BTCUSDT",
        "timeframe": "5m",
        "activationStatus": "active",
        "positionStatus": "open",
        "todayPnl": 132.55,
        "lastEventType": "order_filled",
        "lastEventAt": "2026-04-05T09:20:00Z",
        "lastErrorMessage": null
      }
    ]
  },
  "error": null,
  "meta": {
    "requestId": "req_001"
  }
}
```

### `GET /api/v1/execution-units/:unitId`

Response sections:

- `unit`
- `policy`
- `runtimeState`
- `positionState`
- `summary`
- `recentEvents`
- `recentExecutions`

### `GET /api/v1/execution-units/:unitId/timeline`

Timeline item fields:

- `eventId`
- `eventType`
- `eventStatus`
- `occurredAt`
- `source`
- `message`
- `correlationId`

### `GET /api/v1/execution-units/:unitId/performance`

Performance fields:

- `todayPnl`
- `sevenDayPnl`
- `thirtyDayPnl`
- `cumulativePnl`
- `winRate`
- `tradeCount`
- `lastClosedAt`

### `GET /api/v1/dashboard/summary`

Summary fields:

- `liveUnitCount`
- `testUnitCount`
- `activeUnitCount`
- `inactiveUnitCount`
- `errorUnitCount`
- `todayPnl`
- `recentFailures`

### `GET /api/v1/notifications/errors`

Notification item fields:

- `notificationId`
- `severity`
- `executionUnitId`
- `executionUnitName`
- `context`
- `errorCode`
- `message`
- `lastOccurredAt`
- `resolved`

## Realtime Contracts

초기에는 polling fallback을 유지하되, 아래 채널은 SSE 또는 WebSocket으로 확장 가능해야 한다.

- `unit.runtime.updated`
- `unit.position.updated`
- `unit.event.created`
- `notification.error.created`
- `notification.error.resolved`
- `dashboard.summary.updated`

Suggested initial endpoint options:

- `GET /api/v1/stream/events` via SSE
- `GET /api/v1/realtime-token` if websocket gateway is introduced later

## Sample Webhook Payload Outline

```json
{
  "secret": "TODO_SHARED_SECRET",
  "strategyKey": "ema-cross-btc",
  "symbol": "BTCUSDT",
  "side": "buy",
  "action": "entry",
  "timeframe": "15m",
  "price": 65000.12,
  "timestamp": "2026-04-05T00:00:00Z",
  "meta": {}
}
```

## Sample Response Shape

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "requestId": "TODO"
  }
}
```

## Contract TODO

- execution unit 생성 시 필수 필드와 기본 policy 상속 규칙 확정
- live/test context별 권한 및 안전장치 정의
- pagination/filter/sort 규칙 통일
- timeline item의 표준 message schema 확정
- SSE와 websocket 중 초기 선택지 결정
