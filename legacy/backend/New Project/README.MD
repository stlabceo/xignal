# WinBot Execution System

TradingView alert 기반 다중 사용자 자동매매 실행 시스템 재개발 저장소입니다.

## 목표

이 저장소의 1차 목표는 다음입니다.

- TradingView alert 수신
- 다중 사용자 자동매매 실행
- 거래소/증권사 계정별 주문 처리
- 운영 콘솔 제공
- 기존 테스터 데이터 이관 준비

장기적으로는 WinBot AI 전략 생성 시스템과 연결될 수 있는 실행 엔진 기반을 제공합니다.

---

## 기술 스택

### 공통
- Node.js 20
- npm 10
- Docker / Docker Compose

### Backend
- Express
- TypeScript
- socket.io
- mysql2
- redis
- zod
- pino

### Frontend
- React
- Vite
- TypeScript
- Zustand
- Axios
- socket.io-client

---

## 저장소 구조

```text
apps/
  backend/
  frontend/

infra/
  docker/
  sql/

docs/