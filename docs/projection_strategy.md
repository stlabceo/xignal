# Projection Strategy

## Goal

운영 콘솔이 필요한 목록, 상세, 오류 센터, 성과 데이터를 안정적으로 제공하기 위해 write model과 projection 갱신 전략을 분리한다.

초기 제품은 단일 backend 앱으로 시작하지만, projection 계산은 추후 worker split으로 이동할 수 있게 설계한다.

## Projection Inventory

### Near-Realtime Operational Projections

- `execution_unit_runtime_states`
- `execution_unit_summaries`
- `notification_errors`

### Performance Projection

- `execution_unit_performance_daily`

### Operational Support Tables

- `projection_rebuild_runs`
- `projection_rebuild_cursors`

## Sync Write-Through Candidates

초기 제품에서 아래 projection은 sync write-through 또는 "동일 트랜잭션 직후 짧은 후처리"에 가깝게 갱신하는 편이 좋다.

### `execution_unit_runtime_states`

Reason:

- 운영 콘솔 live/test 목록과 상세 화면의 현재 상태 체감이 가장 중요하다.
- 활성화/비활성화, 마지막 이벤트, worker 상태는 즉시 반영되지 않으면 운영자가 혼란을 느끼기 쉽다.

Recommended triggers:

- execution unit activate/deactivate
- execution task status change
- execution event append
- latest position snapshot update

### `notification_errors`

Reason:

- 오류 센터는 늦게 보이면 운영 대응이 늦어진다.
- unresolved error는 가능한 한 즉시 생성되어야 한다.
- 같은 unresolved 오류는 dedupe key 기준으로 하나의 row에 집계되는 편이 운영자 경험에 유리하다.

Recommended triggers:

- order failure
- task failure
- validation failure
- exchange/runtime error
- explicit error resolved event

Aggregation rule:

- unresolved 상태에서는 `dedupe_key`와 현재 `error_instance_seq` 기준으로 같은 오류를 하나의 row로 집계
- 기본 dedupe 요소는 `execution_unit_id + context + error_code(or unknown) + severity + source category`
- resolved 이후 동일 오류 재발생은 같은 base `dedupe_key`에 대해 `error_instance_seq`를 증가시킨 새 row 생성

## Async Rebuild Candidates

초기 제품에서 아래 projection은 async rebuild 또는 배치 보정이 적합하다.

### `execution_unit_summaries`

Reason:

- 목록 응답에는 빠름이 중요하지만, 일부 성과 지표와 집계는 source 테이블을 많이 읽을 수 있다.
- 일단은 이벤트 후 부분 upsert를 하고, 주기적 rebuild로 정합성을 보정하는 하이브리드 방식이 적합하다.

Recommended mode:

- 기본: partial async upsert
- 보정: 주기적 rebuild

### `execution_unit_performance_daily`

Reason:

- realized pnl, trade count, win/loss 집계는 지연 허용도가 상대적으로 높다.
- 날짜 단위 집계는 이벤트 누락 복구나 재계산이 쉬운 편이다.

Recommended mode:

- 일별 async rebuild
- 필요 시 당일 row만 incremental upsert

## Initial Freshness Strategy

초기 제품에서는 SSE를 즉시 강제하지 않고 polling fallback을 유지하되, projection freshness를 아래처럼 맞춘다.

### Polling Baseline

- 목록 화면: 10~15초 주기 polling
- 상세 화면: 5~10초 주기 polling
- 오류 센터: 5~10초 주기 polling
- 성과 화면: 30~60초 주기 polling

### SSE Introduction Path

- 1차에서는 `unit.runtime.updated`, `unit.event.created`, `notification.error.created`, `notification.error.resolved`만 SSE 대상으로 우선 검토
- SSE 수신 시 클라이언트는 해당 unit row만 재조회하거나 캐시를 부분 무효화
- SSE 연결 실패 시 polling으로 자동 fallback

### Freshness Target

- runtime / notification projection: 수 초 이내
- summary projection: 수 초 ~ 수십 초
- performance_daily: 분 단위 또는 수동 refresh 허용

## Rebuild Failure Handling

projection rebuild가 실패하더라도 source-of-truth 데이터는 유지되므로, 운영 대응은 "서비스 중단"보다 "projection 복구" 관점으로 가져간다.

### Operational Response

1. `projection_rebuild_runs`에 실패 상태와 에러 메시지를 남긴다.
2. `notification_errors` 또는 운영자 알림으로 projection failure를 표면화한다.
3. 실패 범위가 unit 단위면 scoped rebuild를 먼저 시도한다.
4. 광범위한 불일치가 의심되면 full rebuild를 수행한다.
5. 임시로 API에서 source-of-truth 기반 fallback 조회를 일부 허용할지 판단한다.

### Recommended Recovery Order

1. `execution_unit_runtime_states`
2. `notification_errors`
3. `execution_unit_summaries`
4. `execution_unit_performance_daily`

## Resolved And Recurred Error Policy

- 오류가 unresolved인 동안에는 같은 base `dedupe_key`와 현재 `error_instance_seq`를 가진 `notification_errors` row를 계속 upsert한다.
- 운영자가 해결했거나 시스템이 `error_resolved` / `unit_recovered` 이벤트를 반영해 resolved 처리하면 현재 instance는 닫힌다.
- 그 뒤 동일 유형 오류가 다시 발생하면 같은 base `dedupe_key`를 유지한 채 `error_instance_seq + 1`인 새 row를 생성한다.
- 이 정책은 "현재 미해결 문제"와 "과거 해결된 문제"를 운영 콘솔에서 구분하기 쉽게 만든다.

Rebuild note:

- full rebuild 시에는 time-ordered replay로 recurrence 경계를 재구성해야 한다.
- incremental 갱신에서는 application updater가 현재 unresolved instance를 찾아 `occurrence_count`를 누적하거나 새 instance seq를 발급하는 책임을 가진다.

## Cursor Strategy

`projection_rebuild_cursors`는 초기 제품에서 필수는 아니지만, 아래 상황을 대비해 두는 것이 좋다.

- event volume 증가
- full rebuild 비용 증가
- 단위별 incremental rebuild 필요
- 장애 이후 resume point 필요

초기 권장 전략:

- projection별 global cursor부터 시작
- 필요 시 context별 cursor
- 마지막 단계에서 unit-range cursor로 확장

## Open Questions

- `notification_errors`의 dedupe key를 어떤 규칙으로 고정할지
- `source_event_id` FK를 projection에 강하게 유지할지, nullable reference로 둘지
- `execution_unit_summaries`를 event-driven으로만 갱신할지, read-through refresh를 섞을지
- performance_daily에 fee/funding/separate realized components를 넣을지
