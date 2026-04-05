# Backend Scaffold

신규 backend는 운영 API와 TradingView webhook ingestion의 출발점이다.

## Initial Direction

- Express + TypeScript 기반
- 추후 `api`, `worker`, `shared` 성격으로 분리 가능
- 현재는 구조와 TODO만 정의

## TODO

- health check route 추가
- webhook ingestion route 추가
- config validation 추가
- domain module skeleton 정리
- persistence abstraction 정의
