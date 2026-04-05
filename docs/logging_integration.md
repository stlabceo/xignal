# Logging Integration Guide

## Purpose

`stdout` JSON line logging을 실제 운영 환경에서 보존하고, 파일 또는 외부 sink로 연결하는 적용 예시를 정리한다.

## Baseline

- retry / failure observability는 `stdout` JSON line으로 출력된다.
- `/api/v1/internal/observability/transaction-retries` 는 현재 프로세스 메모리 snapshot이다.
- 장기 보존 기준은 endpoint가 아니라 로그 수집이다.

## Recommended Log Path

권장 파일 경로:

```text
/var/log/xignal/backend-jsonl.log
```

## File Redirect Example

Linux production-style example:

```bash
mkdir -p /var/log/xignal
PORT=3000 NODE_ENV=production node apps/backend/dist/main.js >> /var/log/xignal/backend-jsonl.log 2>&1
tail -n 20 /var/log/xignal/backend-jsonl.log
```

PowerShell local example:

```powershell
New-Item -ItemType Directory -Force .\logs | Out-Null
$env:PORT="3003"
npm.cmd --workspace apps/backend run dev *> .\logs\backend-3003.jsonl
```

## Docker Stdout Collection

운영 원칙:

- backend는 계속 `stdout` JSON line만 출력
- Docker logging driver 또는 host-side collector가 보존 담당

example:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
mkdir -p /var/log/xignal
docker logs -f xignal-backend >> /var/log/xignal/backend-jsonl.log
tail -n 20 /var/log/xignal/backend-jsonl.log
```

## systemd + File Logging

sample unit:

- [xignal-backend.service.example](/C:/Users/tmdtk/Xignal/infra/systemd/xignal-backend.service.example)

env file:

```bash
sudo mkdir -p /etc/xignal
sudo tee /etc/xignal/backend.env >/dev/null <<'EOF'
PORT=3000
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=xignal
EOF
```

deploy steps:

```bash
sudo cp infra/systemd/xignal-backend.service.example /etc/systemd/system/xignal-backend.service
sudo mkdir -p /var/log/xignal
sudo systemctl daemon-reload
sudo systemctl enable --now xignal-backend
sudo systemctl status xignal-backend --no-pager
sudo journalctl -u xignal-backend -f
sudo tail -n 20 /var/log/xignal/backend-jsonl.log
```

## Fluent Bit Example

sample config:

- [xignal-backend-fluent-bit.conf](/C:/Users/tmdtk/Xignal/infra/observability/fluent-bit/xignal-backend-fluent-bit.conf)

recommended flow:

```text
/var/log/xignal/backend-jsonl.log -> Fluent Bit tail -> Loki
```

apply example:

```bash
sudo mkdir -p /var/log/xignal
sudo cp infra/observability/fluent-bit/xignal-backend-fluent-bit.conf /etc/fluent-bit/conf.d/xignal-backend.conf
sudo systemctl restart fluent-bit
sudo systemctl status fluent-bit --no-pager
sudo tail -n 20 /var/log/xignal/backend-jsonl.log
```

check before enabling:

1. `Path` matches real log file path
2. `Parser json` parses the current JSON line shape
3. destination host/port values are replaced for the target environment

## Transport Abstraction Follow-Up Tasks

- keep `logJson(...)` call sites unchanged
- split `stdout` transport wrapper
- add append-only file transport
- add `configureJsonLogger()` transport factory
- add multi-transport fan-out
- add correlation/request/execution-unit enrichment
- add logger transport tests
- keep shipper parser contract stable

## Activation Checklist

1. confirm backend writes JSON lines to `stdout`
2. confirm file or container log retention exists
3. confirm `tail -n 20 /var/log/xignal/backend-jsonl.log` shows valid JSON lines
4. confirm shipper parses the same field shape
