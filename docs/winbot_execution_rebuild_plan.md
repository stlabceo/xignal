# WinBot Execution Rebuild Plan

## Purpose

기존 TradingView 기반 자동매매 시스템을 참고 자산으로 유지하면서, 다중 사용자 운영을 전제로 한 신규 실행 시스템을 병행 구축한다.

이번 단계의 목표는 "구조 재정의 + 문서화 + scaffold 생성"이며, 실제 매매 로직 구현은 후속 단계에서 점진적으로 진행한다.

## Rebuild Goals

- TradingView alert 수신부터 주문 실행까지를 재설계한다.
- 다중 사용자, 다중 거래소 계정, 다중 전략 운영을 지원하는 구조를 마련한다.
- 실행 엔진과 운영 콘솔을 분리하여 장애 격리와 운영 가시성을 높인다.
- 기존 데이터베이스와 설정 데이터의 이관 준비 문서를 만든다.
- 프론트엔드, 백엔드, DB, 인프라 구성을 신규 구조로 병행 정비한다.

## Non-Goals For This Phase

- 실제 거래소 주문 로직 완성
- 모든 기존 기능의 1:1 재현
- 실시간 운영 배포 자동화 완성
- 데이터 이관 스크립트의 최종 구현

## Target Streams

### 1. Execution Engine

- TradingView alert ingestion
- signal normalization
- user/account/strategy resolution
- idempotency and replay protection
- order execution orchestration
- execution result persistence

### 2. Operations Console

- 사용자/계정/전략 관리
- alert 수신 상태 모니터링
- 주문 실행 이력 조회
- 실패 재처리와 운영자 액션 지원
- 감사 로그 및 운영 이벤트 확인

### 3. Data Platform

- 신규 스키마 정의
- 레거시 테이블 분석
- 이관 맵핑 문서화
- 검증 절차 정의

## Proposed Delivery Phases

### Phase 0. Foundation

- 신규 폴더 구조 생성
- 핵심 설계 문서 작성
- backend/frontend scaffold 구성
- docker/sql placeholder 추가

### Phase 1. Core Domain

- 사용자, 거래소 계정, 전략, alert, execution 도메인 모델 고정
- API contract 1차 확정
- DB DDL 초안 작성

### Phase 2. Alert Pipeline

- webhook endpoint 구현
- 서명 검증 또는 webhook secret 처리
- alert normalization 및 deduplication
- queue or job processing 도입 검토

### Phase 3. Execution Engine

- 계정별 실행 정책
- 주문 전 검증
- 거래소 adapter abstraction
- retry, timeout, circuit breaker 전략 추가

### Phase 4. Console

- 운영자 인증/권한
- 대시보드
- 계정/전략 관리 화면
- alert/execution timeline

### Phase 5. Migration

- legacy schema inventory
- 매핑 규칙 확정
- dry-run migration
- 샘플 검증

## Risks

- 레거시 코드와 신규 구조의 책임 경계가 불명확할 수 있음
- 기존 DB 스키마의 의미론이 문서화되지 않았을 가능성
- TradingView alert payload 형식이 운영 환경마다 달라질 수 있음
- 다중 사용자 주문 실행 시 idempotency 설계가 미흡하면 중복 주문 위험이 있음
- 거래소별 API 제약 차이로 인해 adapter 설계가 복잡해질 수 있음

## Immediate TODO

- legacy backend route/db/schema를 인벤토리화한다.
- 신규 DB 핵심 엔터티의 컬럼 수준 설계를 시작한다.
- webhook payload 표준 포맷을 정의한다.
- backend를 API 서버와 execution worker로 분리할지 결정한다.
- frontend 운영 콘솔 IA를 정의한다.
