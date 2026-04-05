import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Env = {
  port: number;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
};

export function loadEnv(): Env {
  loadDotEnvIfPresent();

  return {
    port: parsePort(process.env.PORT, 4000, "PORT"),
    dbHost: readRequiredString(process.env.DB_HOST, "DB_HOST"),
    dbPort: parsePort(process.env.DB_PORT, 3306, "DB_PORT"),
    dbUser: readRequiredString(process.env.DB_USER, "DB_USER"),
    dbPassword: readRequiredString(process.env.DB_PASSWORD, "DB_PASSWORD"),
    dbName: readRequiredString(process.env.DB_NAME, "DB_NAME")
  };
}

function loadDotEnvIfPresent(): void {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const envPath = resolve(currentDir, "../../.env");

  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readRequiredString(
  value: string | undefined,
  fieldName: string
): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`[env] Missing required environment variable: ${fieldName}`);
  }

  return trimmed;
}

function parsePort(
  value: string | undefined,
  fallback: number,
  fieldName: string
): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[env] Invalid port value for ${fieldName}: ${value}`);
  }

  return parsed;
}
