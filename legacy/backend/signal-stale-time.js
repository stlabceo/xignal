"use strict";

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(utc);
dayjs.extend(customParseFormat);

const parseUtcWallClockParts = (value) => {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  return dayjs.utc(new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0
  )));
};

const parseDatabaseUtcDateTime = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    // mysql2 constructs DATETIME values as local wall-clock Dates. The DB stores
    // UTC wall-clock text, so preserve the displayed components and reinterpret
    // them as UTC instead of trusting the Date instant.
    const parsed = dayjs.utc(new Date(Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds()
    )));
    return parsed.isValid() ? parsed : null;
  }

  if (dayjs.isDayjs(value)) {
    const parsed = value.utc();
    return parsed.isValid() ? parsed : null;
  }

  if (typeof value === "string") {
    const normalized = value
      .trim()
      .replace(/Z$/i, "")
      .replace(/\.\d+$/, "");
    if (!normalized) {
      return null;
    }

    const parsed = parseUtcWallClockParts(normalized);
    if (!parsed) {
      return null;
    }
    return parsed.isValid() ? parsed : null;
  }

  const parsed = dayjs.utc(value);
  return parsed.isValid() ? parsed : null;
};

const getSignalEntryPendingStaleInfo = (play, options = {}) => {
  const staleSeconds = Math.max(10, Number(options.staleSeconds || 30));
  if (String(play?.status || "").trim().toUpperCase() !== "EXACT_WAIT") {
    return {
      stale: false,
      ageSeconds: 0,
      signalTime: null,
      reason: null,
    };
  }

  const signalTime = parseDatabaseUtcDateTime(play?.r_signalTime);
  if (!signalTime) {
    return {
      stale: true,
      ageSeconds: null,
      signalTime: null,
      reason: "missing-signal-time",
    };
  }

  const now = parseDatabaseUtcDateTime(options.now || dayjs.utc()) || dayjs.utc();
  const rawAgeSeconds = now.diff(signalTime, "second", true);
  const ageSeconds = Math.max(0, rawAgeSeconds);
  return {
    stale: ageSeconds >= staleSeconds,
    ageSeconds,
    signalTime,
    reason: ageSeconds >= staleSeconds
      ? "dispatch-timeout"
      : null,
  };
};

module.exports = {
  parseDatabaseUtcDateTime,
  getSignalEntryPendingStaleInfo,
};
