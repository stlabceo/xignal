# Projection Updater Design

## Scope

초기 backend projection updater는 아래 세 projection을 우선 갱신한다.

- `notification_errors`
- `execution_unit_runtime_states`
- `execution_unit_summaries`

실제 MySQL 실행 코드는 아직 넣지 않고, service + repository interface 수준에서 흐름을 고정한다.

## Notification Error Updater State Flow

입력은 execution event 단위다.

### Error Event Flow

1. execution event에서 base `dedupe_key`를 계산한다.
2. 같은 `dedupe_key`의 최신 unresolved row를 조회한다.
3. unresolved row가 있으면:
   - 같은 `error_instance_seq` row에 `occurrence_count`를 누적한다.
   - `last_occurred_at`, source pointers, message를 갱신한다.
4. unresolved row가 없으면:
   - 같은 base `dedupe_key`의 `max(error_instance_seq)`를 조회한다.
   - `max + 1`로 새 instance row를 insert 한다.

### Resolve Event Flow

1. resolve 이벤트(`error_resolved`, `unit_recovered`)에서 닫으려는 오류의 base `dedupe_key`를 계산한다.
2. 이때 resolve 이벤트는 원래 오류의 `errorSourceCategory`와 `notificationSeverity`를 함께 전달하는 것이 안전하다.
3. 가능하면 `errorCode`도 함께 전달해서 target error identity를 좁힌다.
3. 같은 `dedupe_key`의 unresolved row를 조회한다.
4. row가 있으면 `resolved_at`을 채운다.
5. 이후 동일 오류가 다시 발생하면 새 `error_instance_seq`를 가진 row가 열린다.

### Resolve Target Fallback Rules

- 우선순위 1:
  - `errorSourceCategory`
  - `notificationSeverity`
  - `errorCode`
- 우선순위 2:
  - `errorSourceCategory`
  - `notificationSeverity`
  - `failureReason` 또는 `message` 기반 operator 판단
- 우선순위 3:
  - `eventType` 기본 매핑으로 source category 추정
  - `eventStatus`로 severity 추정
  - `errorCode`가 없으면 `unknown`

즉 resolve 이벤트가 충분한 target identity를 주지 못하면 base dedupe key가 넓어질 수 있으므로, production 계약에서는 `errorSourceCategory`, `notificationSeverity`, `errorCode`를 가능한 한 함께 넘기는 것이 바람직하다.

## Unresolved -> Resolved -> Recurred

- unresolved:
  - 같은 `(dedupe_key, error_instance_seq)` row를 계속 업데이트
- resolved:
  - 현재 row에 `resolved_at` 기록
- recurred:
  - 같은 base `dedupe_key`
  - 새로운 `error_instance_seq`
  - 새로운 row insert

이 구조는 "같은 오류 종류"와 "몇 번째 재발생 인스턴스인가"를 분리한다.

## Race Condition Risks

가장 중요한 위험은 동시성이다.

### 위험 사례

- 같은 오류 이벤트 두 개가 동시에 들어와 둘 다 "unresolved row 없음"을 보고 각각 새 instance를 만들 수 있음
- resolve 이벤트와 신규 오류 이벤트가 거의 동시에 처리되어 닫아야 할 row와 새로 열어야 할 row가 꼬일 수 있음
- occurrence_count 누적이 lost update가 될 수 있음

## Transaction And Locking Strategy

notification updater는 transaction과 row lock이 사실상 필요하다.

### 권장 방식

1. transaction 시작
2. `dedupe_key` 기준 unresolved row를 `FOR UPDATE`로 조회
3. unresolved row가 없으면 같은 `dedupe_key` 범위의 max sequence를 `FOR UPDATE` 또는 동일 보호 범위에서 조회
4. update 또는 insert 수행
5. transaction commit

### Why

- unresolved 누적과 recurrence sequence 발급이 같은 원자 단위여야 함
- resolve/recurred 경계가 동시성 때문에 깨지지 않아야 함

## Runtime And Summary Updater Role

### `execution_unit_runtime_states`

- 최근 이벤트
- 최근 오류 정보
- worker/health 상태
- 활성 여부 관련 patch 반영

이 projection은 near-realtime 성격이므로 event 입력 직후 갱신이 적합하다.

### `execution_unit_summaries`

- 목록용 최근 이벤트/오류 메시지 patch 반영
- 성과 값 자체는 별도 performance projection에서 들어올 수 있음

초기 구현은 partial patch 중심이고, 정합성 보정은 rebuild가 맡는다.

## Realtime Updater vs Full Rebuild

### Realtime Updater Responsibility

- 이벤트 발생 직후 projection 빠르게 반영
- 운영 콘솔 freshness 확보
- unresolved error 누적과 resolve 처리

### Full Rebuild Responsibility

- 누락된 projection 복구
- 잘못된 summary/runtime 상태 보정
- 이벤트 로그를 시간순으로 replay 하여 `error_instance_seq` 재구성

## Design Boundary

- 실시간 updater는 "빠른 반영"에 집중
- full rebuild는 "정합성 회복"에 집중
- 따라서 `notification_errors.error_instance_seq`는:
  - 실시간 경로에서는 application updater가 발급
  - full rebuild 경로에서는 ordered replay가 재계산
