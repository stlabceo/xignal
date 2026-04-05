# Decision Log

## Decision 001: Strategy-Centric Model -> ExecutionUnit-Centric Model

### Decision

1차 제품의 핵심 운영 단위를 `Strategy`가 아니라 `ExecutionUnit`으로 본다.

### Why

- 운영 콘솔에서 실제로 보고 제어하는 대상은 "전략 템플릿"이 아니라 "현재 실행 중인 개별 실행 단위"이기 때문이다.
- 같은 strategy를 여러 사용자, 여러 계정, 여러 심볼, 여러 context에서 재사용할 수 있으므로 strategy만으로는 운영 상태를 대표할 수 없다.
- 활성화/비활성화, 현재 포지션, 최근 실패, 성과 집계는 모두 unit 수준에서 판단하는 것이 자연스럽다.
- legacy의 `play_list`, `live_play_list`도 실질적으로는 strategy definition보다 실행 설정 인스턴스에 가깝다.

### Consequence

- `Strategy`는 secondary template/rule-pack 개념으로 남긴다.
- API와 projection은 `ExecutionUnit` 중심으로 재배치한다.
- migration도 `play_list` 계열을 `ExecutionUnit`으로 우선 변환한다.

## Decision 002: Live/Test As Context, Not Separate Entities

### Decision

`live`와 `test`는 별도 엔티티나 별도 서비스 타입이 아니라, 핵심 엔터티의 `context` 필드로 표현한다.

### Why

- legacy에는 `play_list`와 `live_play_list`, `play_log`와 `live_play_log`처럼 중복 테이블이 존재하는데, 신규 구조에서는 이를 정규화하고 싶기 때문이다.
- `ExecutionUnit`, `ExecutionEvent`, `PositionState`, `ExecutionUnitSummary` 등은 동일한 shape를 유지한 채 context만 달라지는 경우가 많다.
- 운영 콘솔 입장에서도 live/test는 완전히 다른 도메인보다 같은 화면의 다른 필터 또는 탭으로 다루는 편이 자연스럽다.

### Consequence

- read/write model 대부분에 `context`를 둔다.
- `GET /api/v1/live-units`, `GET /api/v1/test-units`는 별도 storage가 아니라 context filter alias가 된다.
- migration 시 live/test 분리 테이블을 공통 엔티티 + context 값으로 통합한다.

## Decision 003: Separate Read Models For Operations Console

### Decision

운영 콘솔용 조회 모델은 write model을 직접 join해서 만들지 않고, 별도 read model 또는 projection을 둔다.

### Why

- 운영 콘솔은 목록, 대시보드, 오류 센터, unit 상세처럼 조회 패턴이 명확하고 읽기 비중이 높다.
- 현재 상태, 최근 이벤트, 오류, 성과를 한 번에 보여주려면 비정규화된 projection이 응답성과 구현 단순성에 유리하다.
- realtime updates를 붙일 때도 write model 전체가 아니라 projection 변경 이벤트만 전파하는 편이 단순하다.
- worker split을 도입해도 projection 갱신 경계가 분명해져 확장에 유리하다.

### Consequence

- `ExecutionUnitRuntimeState`, `ExecutionUnitSummary`, `NotificationError`, `DashboardSummaryView`를 주요 read model로 본다.
- dashboard/list/detail/timeline/performance API는 projection 우선으로 설계한다.
- projection consistency와 rebuild 전략을 아키텍처의 주요 관심사로 둔다.

## Decision 004: Projection PK Single-Key Decision

### Decision

`execution_unit_runtime_states`와 `execution_unit_summaries`의 PK는 `execution_unit_id` 단일키로 유지한다.

### Why

- 두 projection 모두 "execution unit 하나의 최신 상태"를 표현하는 1:1 read model이기 때문이다.
- `context`는 projection의 identity가 아니라 source `execution_units`에서 복제한 read field다.
- 단일키를 유지하면 upsert, 캐시 무효화, 상세 조회가 단순해진다.

### Consequence

- projection row는 execution unit당 하나만 존재한다.
- `context`는 필터링과 응답 전달을 위한 중복 저장 필드로 본다.
- 복합키 `(execution_unit_id, context)`는 현재 채택하지 않는다.

## Decision 005: NotificationError Dedupe Key Decision

### Decision

`notification_errors`는 별도 `dedupe_key` 컬럼을 두고 unique index로 관리한다.

### Why

- 운영 콘솔 오류 센터는 동일 unresolved 오류를 하나의 항목으로 집계해 보여주는 편이 더 유용하다.
- 결정적 키가 있으면 rebuild/upsert와 실시간 오류 반영이 단순해진다.
- error code가 비어 있는 경우도 있으므로 `unknown` fallback이 필요하다.

### Base Rule

- `execution_unit_id`
- `context`
- `error_code` or `unknown`
- `severity`
- `source category`

### Consequence

- unresolved 상태에서는 같은 dedupe key를 같은 row에 누적한다.
- resolved 이후 동일 오류가 다시 발생하면 새 row가 생성될 수 있다.
- 추후 recurrence suffix 또는 reopen sequence를 dedupe key에 추가할 수 있다.

## Decision 006: NotificationError Recurrence Instance Decision

### Decision

`notification_errors.dedupe_key`는 base deterministic key로 유지하고, 재발생은 `error_instance_seq`를 증가시킨 새 row로 기록한다.

### Why

- 오류의 "종류"와 "몇 번째 재발생인가"를 분리하면 unresolved 집계와 과거 이력 보존을 동시에 만족시킬 수 있다.
- base key를 바꾸지 않으면 같은 오류 유형을 식별하기 쉽고, instance sequence를 두면 resolved 이후 재발생도 별도 사건으로 관리할 수 있다.

### Consequence

- unresolved 상태에서는 같은 `(dedupe_key, error_instance_seq)` row에 `occurrence_count`를 누적한다.
- resolved 이후 동일 오류가 재발생하면 같은 `dedupe_key`에 대해 `error_instance_seq`를 증가시킨 새 row를 생성한다.
- ordered replay rebuild 또는 application updater가 recurrence sequence를 계산해야 한다.
