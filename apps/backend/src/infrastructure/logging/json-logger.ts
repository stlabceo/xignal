export type JsonLogLevel = "info" | "warn" | "error";

export type JsonLogRecord = {
  level: JsonLogLevel;
  category: string;
  timestamp?: string;
  [key: string]: unknown;
};

export function logJson(record: JsonLogRecord): void {
  const payload = {
    timestamp: record.timestamp ?? new Date().toISOString(),
    ...record
  };

  const line = JSON.stringify(payload);

  switch (record.level) {
    case "error":
      console.error(line);
      return;
    case "warn":
      console.warn(line);
      return;
    default:
      console.log(line);
  }
}

// TODO:
// 1. Replace direct console.* calls with a transport abstraction when file sinks or log shippers are wired.
// 2. Preserve this JSON line shape so stdout, files, and external sinks can share one parser contract.
// 3. Add request / correlation ids once ingress tracing is introduced.
// 4. Keep this module as the single output boundary so PM2, systemd, Docker, and shippers do not need format-specific forks.
