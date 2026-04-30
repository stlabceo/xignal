"use strict";

const REQUIRED_DELETE_INTENT = "USER_DELETE_STRATEGY";

const normalizeIntent = (value) => String(value || "").trim().toUpperCase();

const hasExplicitStrategyDeleteIntent = (body = {}) =>
  body &&
  body.confirmDelete === true &&
  normalizeIntent(body.deleteIntent) === REQUIRED_DELETE_INTENT;

module.exports = {
  REQUIRED_DELETE_INTENT,
  hasExplicitStrategyDeleteIntent,
};
