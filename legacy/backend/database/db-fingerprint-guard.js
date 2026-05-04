"use strict";

const fs = require("fs");
const path = require("path");

const LOCAL_HOST_ALLOWLIST = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "mysql",
  "host.docker.internal",
  "quantu-mysql",
  "quantu_mysql",
  "quantu-db",
  "quantu_db",
]);

const FORBIDDEN_REMOTE_HOSTS = new Set(["1.234.63.146"]);
const FORBIDDEN_DATABASES = new Set(["xignal"]);
const QUANTU_DB_PATTERN = /^quantu($|[_-])/i;

const redact = (value) => {
  if (value == null || value === "") return "";
  return "[REDACTED]";
};

const normalize = (value) => String(value || "").trim();
const normalizeLower = (value) => normalize(value).toLowerCase();

const loadEnvFileIfPresent = (envPath) => {
  if (!envPath || !fs.existsSync(envPath)) {
    return false;
  }

  // dotenv does not override explicitly supplied process env values by default.
  // That keeps tests able to inject unsafe targets and verify fail-closed behavior.
  // eslint-disable-next-line global-require
  require("dotenv").config({ path: envPath });
  return true;
};

const getBackendEnvPath = () => path.resolve(__dirname, "../.env");

const getDbTargetFromEnv = (env = process.env) => ({
  host: normalize(env.MYSQL_HOST || env.DB_HOST),
  port: normalize(env.MYSQL_PORT || env.DB_PORT || "3306"),
  database: normalize(env.MYSQL_DB || env.DB_NAME),
  user: normalize(env.MYSQL_USER || env.DB_USER),
});

const sanitizeTarget = (target = {}) => ({
  host: target.host || "",
  port: target.port || "",
  database: target.database || "",
  user: target.user ? redact(target.user) : "",
});

const evaluateDbTarget = (target = {}, options = {}) => {
  const context = options.context || "runtime";
  const host = normalizeLower(target.host);
  const database = normalizeLower(target.database);
  const user = normalizeLower(target.user);
  const failures = [];
  const warnings = [];

  if (!host) failures.push("DB_HOST is required");
  if (!database) failures.push("DB_NAME/MYSQL_DB is required");
  if (!user) failures.push("DB_USER/MYSQL_USER is required");

  if (FORBIDDEN_REMOTE_HOSTS.has(host)) {
    failures.push("remote XIGNAL DB host is forbidden");
  }

  if (FORBIDDEN_DATABASES.has(database)) {
    failures.push("XIGNAL database name is forbidden");
  }

  if (host && !LOCAL_HOST_ALLOWLIST.has(host)) {
    failures.push(`DB host must be local QUANTU Docker/localhost in ${context}`);
  }

  if (database && !QUANTU_DB_PATTERN.test(database)) {
    failures.push("DB name must use the QUANTU prefix");
  }

  if (user === "root") {
    failures.push("root DB user is forbidden for app/QA/seed/migration targets");
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    context,
    sanitizedTarget: sanitizeTarget(target),
  };
};

const formatFailure = (evaluation) => {
  const reasons = evaluation.failures.join("; ");
  return `QUANTU DB guard failed (${evaluation.context}): ${reasons}`;
};

const assertSafeDbTarget = (target = {}, options = {}) => {
  const evaluation = evaluateDbTarget(target, options);
  if (!evaluation.ok) {
    const error = new Error(formatFailure(evaluation));
    error.code = "QUANTU_DB_GUARD_FAILED";
    error.details = evaluation;
    throw error;
  }
  return evaluation;
};

const assertSafeDbEnv = (options = {}) => assertSafeDbTarget(getDbTargetFromEnv(options.env), options);

const readDatabaseFingerprint = async (pool) => {
  const [rows] = await pool.query(
    "SELECT @@hostname AS hostname, @@server_uuid AS serverUuid, @@port AS port, DATABASE() AS databaseName, USER() AS userName, CURRENT_USER() AS currentUser"
  );
  return rows && rows[0] ? rows[0] : null;
};

const assertSafeDatabaseFingerprint = async (pool, options = {}) => {
  const fingerprint = await readDatabaseFingerprint(pool);
  const target = {
    host: options.host || process.env.MYSQL_HOST || process.env.DB_HOST,
    port: String(fingerprint?.port || options.port || process.env.MYSQL_PORT || process.env.DB_PORT || ""),
    database: fingerprint?.databaseName || process.env.MYSQL_DB || process.env.DB_NAME,
    user: fingerprint?.currentUser || process.env.MYSQL_USER || process.env.DB_USER,
  };
  const evaluation = assertSafeDbTarget(target, {
    ...options,
    context: options.context || "runtime-fingerprint",
  });
  return {
    ...evaluation,
    fingerprint,
  };
};

module.exports = {
  LOCAL_HOST_ALLOWLIST,
  FORBIDDEN_REMOTE_HOSTS,
  FORBIDDEN_DATABASES,
  QUANTU_DB_PATTERN,
  assertSafeDatabaseFingerprint,
  assertSafeDbEnv,
  assertSafeDbTarget,
  evaluateDbTarget,
  getBackendEnvPath,
  getDbTargetFromEnv,
  loadEnvFileIfPresent,
  readDatabaseFingerprint,
  sanitizeTarget,
};
