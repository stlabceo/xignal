-- Projection rebuild / upsert query draft
-- These statements are intentionally written as operator-friendly templates.
-- Replace placeholders such as :from_execution_unit_id and :to_execution_unit_id in application code or migration tooling.

-- ---------------------------------------------------------------------------
-- 1. execution_unit_runtime_states rebuild / upsert
-- ---------------------------------------------------------------------------

INSERT INTO execution_unit_runtime_states (
  execution_unit_id,
  context,
  is_active,
  last_signal_at,
  last_execution_at,
  last_event_at,
  last_event_type,
  last_error_code,
  last_error_message,
  worker_status,
  health_status,
  snapshot_version,
  created_at,
  updated_at
)
SELECT
  eu.id AS execution_unit_id,
  eu.context,
  CASE
    WHEN eu.activation_status = 'active' AND eu.is_deleted = 0 THEN 1
    ELSE 0
  END AS is_active,
  sig.last_signal_at,
  task.last_execution_at,
  evt.last_event_at,
  evt.last_event_type,
  err.last_error_code,
  err.last_error_message,
  CASE
    WHEN task.last_task_status IN ('queued', 'running', 'retrying') THEN 'busy'
    WHEN eu.activation_status = 'active' THEN 'ready'
    ELSE 'idle'
  END AS worker_status,
  CASE
    WHEN err.last_error_at IS NOT NULL
      AND err.last_error_at >= COALESCE(task.last_execution_at, evt.last_event_at, eu.updated_at)
      THEN 'error'
    WHEN eu.activation_status = 'active' THEN 'healthy'
    ELSE 'paused'
  END AS health_status,
  COALESCE(runtime.snapshot_version, 0) + 1 AS snapshot_version,
  COALESCE(runtime.created_at, CURRENT_TIMESTAMP(3)) AS created_at,
  CURRENT_TIMESTAMP(3) AS updated_at
FROM execution_units eu
LEFT JOIN execution_unit_runtime_states runtime
  ON runtime.execution_unit_id = eu.id
LEFT JOIN (
  SELECT
    et.execution_unit_id,
    MAX(ns.signal_time) AS last_signal_at
  FROM execution_tasks et
  INNER JOIN normalized_signals ns
    ON ns.id = et.normalized_signal_id
  GROUP BY et.execution_unit_id
) sig
  ON sig.execution_unit_id = eu.id
LEFT JOIN (
  SELECT
    et.execution_unit_id,
    MAX(COALESCE(oe.executed_at, et.finished_at, et.started_at, et.updated_at)) AS last_execution_at,
    SUBSTRING_INDEX(
      GROUP_CONCAT(et.task_status ORDER BY COALESCE(oe.executed_at, et.updated_at) DESC, et.id DESC),
      ',',
      1
    ) AS last_task_status
  FROM execution_tasks et
  LEFT JOIN order_executions oe
    ON oe.execution_task_id = et.id
  GROUP BY et.execution_unit_id
) task
  ON task.execution_unit_id = eu.id
LEFT JOIN (
  SELECT
    ee.execution_unit_id,
    MAX(ee.created_at) AS last_event_at,
    SUBSTRING_INDEX(
      GROUP_CONCAT(ee.event_type ORDER BY ee.created_at DESC, ee.id DESC),
      ',',
      1
    ) AS last_event_type
  FROM execution_events ee
  GROUP BY ee.execution_unit_id
) evt
  ON evt.execution_unit_id = eu.id
LEFT JOIN (
  SELECT
    ne.execution_unit_id,
    MAX(ne.last_occurred_at) AS last_error_at,
    SUBSTRING_INDEX(
      GROUP_CONCAT(COALESCE(ne.error_code, '') ORDER BY ne.last_occurred_at DESC, ne.id DESC),
      ',',
      1
    ) AS last_error_code,
    SUBSTRING_INDEX(
      GROUP_CONCAT(ne.message ORDER BY ne.last_occurred_at DESC, ne.id DESC SEPARATOR '||'),
      '||',
      1
    ) AS last_error_message
  FROM notification_errors ne
  WHERE ne.resolved_at IS NULL
  GROUP BY ne.execution_unit_id
) err
  ON err.execution_unit_id = eu.id
WHERE eu.is_deleted = 0
  AND eu.id BETWEEN :from_execution_unit_id AND :to_execution_unit_id
ON DUPLICATE KEY UPDATE
  context = VALUES(context),
  is_active = VALUES(is_active),
  last_signal_at = VALUES(last_signal_at),
  last_execution_at = VALUES(last_execution_at),
  last_event_at = VALUES(last_event_at),
  last_event_type = VALUES(last_event_type),
  last_error_code = VALUES(last_error_code),
  last_error_message = VALUES(last_error_message),
  worker_status = VALUES(worker_status),
  health_status = VALUES(health_status),
  snapshot_version = VALUES(snapshot_version),
  updated_at = VALUES(updated_at);

-- ---------------------------------------------------------------------------
-- 2. execution_unit_summaries rebuild / upsert
-- ---------------------------------------------------------------------------

INSERT INTO execution_unit_summaries (
  execution_unit_id,
  context,
  display_name,
  user_id,
  user_display_name,
  exchange_account_id,
  exchange_type,
  symbol,
  timeframe,
  activation_status,
  position_status,
  today_pnl,
  cumulative_pnl,
  win_rate,
  trade_count,
  last_event_at,
  last_event_type,
  last_error_message,
  created_at,
  updated_at
)
SELECT
  eu.id AS execution_unit_id,
  eu.context,
  eu.name AS display_name,
  u.id AS user_id,
  u.display_name AS user_display_name,
  ea.id AS exchange_account_id,
  ea.exchange_type,
  eu.symbol,
  eu.timeframe,
  eu.activation_status,
  COALESCE(ps.position_status, 'flat') AS position_status,
  COALESCE(perf_today.realized_pnl, 0) AS today_pnl,
  COALESCE(perf_all.cumulative_pnl, 0) AS cumulative_pnl,
  CASE
    WHEN COALESCE(perf_all.trade_count, 0) = 0 THEN NULL
    ELSE ROUND(perf_all.win_count / perf_all.trade_count, 4)
  END AS win_rate,
  COALESCE(perf_all.trade_count, 0) AS trade_count,
  evt.last_event_at,
  evt.last_event_type,
  err.last_error_message,
  COALESCE(summary.created_at, CURRENT_TIMESTAMP(3)) AS created_at,
  CURRENT_TIMESTAMP(3) AS updated_at
FROM execution_units eu
INNER JOIN users u
  ON u.id = eu.user_id
INNER JOIN exchange_accounts ea
  ON ea.id = eu.exchange_account_id
LEFT JOIN execution_unit_summaries summary
  ON summary.execution_unit_id = eu.id
LEFT JOIN position_states ps
  ON ps.execution_unit_id = eu.id
 AND ps.context = eu.context
LEFT JOIN (
  SELECT
    epd.execution_unit_id,
    SUM(epd.realized_pnl) AS cumulative_pnl,
    SUM(epd.trade_count) AS trade_count,
    SUM(epd.win_count) AS win_count
  FROM execution_unit_performance_daily epd
  GROUP BY epd.execution_unit_id
) perf_all
  ON perf_all.execution_unit_id = eu.id
LEFT JOIN (
  SELECT
    epd.execution_unit_id,
    epd.realized_pnl
  FROM execution_unit_performance_daily epd
  WHERE epd.performance_date = CURRENT_DATE()
) perf_today
  ON perf_today.execution_unit_id = eu.id
LEFT JOIN (
  SELECT
    ee.execution_unit_id,
    MAX(ee.created_at) AS last_event_at,
    SUBSTRING_INDEX(
      GROUP_CONCAT(ee.event_type ORDER BY ee.created_at DESC, ee.id DESC),
      ',',
      1
    ) AS last_event_type
  FROM execution_events ee
  GROUP BY ee.execution_unit_id
) evt
  ON evt.execution_unit_id = eu.id
LEFT JOIN (
  SELECT
    ne.execution_unit_id,
    SUBSTRING_INDEX(
      GROUP_CONCAT(ne.message ORDER BY ne.last_occurred_at DESC, ne.id DESC SEPARATOR '||'),
      '||',
      1
    ) AS last_error_message
  FROM notification_errors ne
  WHERE ne.resolved_at IS NULL
  GROUP BY ne.execution_unit_id
) err
  ON err.execution_unit_id = eu.id
WHERE eu.is_deleted = 0
  AND eu.id BETWEEN :from_execution_unit_id AND :to_execution_unit_id
ON DUPLICATE KEY UPDATE
  context = VALUES(context),
  display_name = VALUES(display_name),
  user_id = VALUES(user_id),
  user_display_name = VALUES(user_display_name),
  exchange_account_id = VALUES(exchange_account_id),
  exchange_type = VALUES(exchange_type),
  symbol = VALUES(symbol),
  timeframe = VALUES(timeframe),
  activation_status = VALUES(activation_status),
  position_status = VALUES(position_status),
  today_pnl = VALUES(today_pnl),
  cumulative_pnl = VALUES(cumulative_pnl),
  win_rate = VALUES(win_rate),
  trade_count = VALUES(trade_count),
  last_event_at = VALUES(last_event_at),
  last_event_type = VALUES(last_event_type),
  last_error_message = VALUES(last_error_message),
  updated_at = VALUES(updated_at);

-- ---------------------------------------------------------------------------
-- 3. notification_errors rebuild / upsert
-- ---------------------------------------------------------------------------

INSERT INTO notification_errors (
  execution_unit_id,
  context,
  severity,
  dedupe_key,
  error_instance_seq,
  error_code,
  message,
  source_event_id,
  source_task_id,
  source_order_execution_id,
  first_occurred_at,
  last_occurred_at,
  resolved_at,
  occurrence_count,
  metadata,
  created_at,
  updated_at
)
SELECT
  err.execution_unit_id,
  err.context,
  err.severity,
  err.dedupe_key,
  err.error_instance_seq,
  err.error_code,
  err.message,
  err.source_event_id,
  err.source_task_id,
  err.source_order_execution_id,
  err.first_occurred_at,
  err.last_occurred_at,
  err.resolved_at,
  err.occurrence_count,
  err.metadata,
  CURRENT_TIMESTAMP(3) AS created_at,
  CURRENT_TIMESTAMP(3) AS updated_at
FROM (
  SELECT
    ee.execution_unit_id,
    ee.context,
    CASE
      WHEN ee.event_type IN ('validation_failed') THEN 'validation'
      WHEN ee.event_type IN ('exchange_error', 'order_failed') THEN 'exchange'
      WHEN ee.event_type IN ('task_failed', 'runtime_error') THEN 'runtime'
      WHEN ee.event_type IN ('error_resolved', 'unit_recovered') THEN 'recovery'
      ELSE 'system'
    END AS source_category,
    CASE
      WHEN ee.event_status IN ('warning', 'degraded') THEN 'warning'
      ELSE 'error'
    END AS severity,
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ee.payload, '$.errorCode')), 'unknown') AS error_code,
    COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(ee.payload, '$.message')),
      JSON_UNQUOTE(JSON_EXTRACT(ee.payload, '$.failureReason')),
      CONCAT('Execution event error: ', ee.event_type)
    ) AS message,
    CONCAT(
      ee.execution_unit_id,
      '|',
      ee.context,
      '|',
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ee.payload, '$.errorCode')), 'unknown'),
      '|',
      CASE
        WHEN ee.event_status IN ('warning', 'degraded') THEN 'warning'
        ELSE 'error'
      END,
      '|',
      CASE
        WHEN ee.event_type IN ('validation_failed') THEN 'validation'
        WHEN ee.event_type IN ('exchange_error', 'order_failed') THEN 'exchange'
        WHEN ee.event_type IN ('task_failed', 'runtime_error') THEN 'runtime'
        WHEN ee.event_type IN ('error_resolved', 'unit_recovered') THEN 'recovery'
        ELSE 'system'
      END
    ) AS dedupe_key,
    1 AS error_instance_seq,
    MAX(ee.id) AS source_event_id,
    MAX(ee.execution_task_id) AS source_task_id,
    MAX(ee.order_execution_id) AS source_order_execution_id,
    MIN(ee.created_at) AS first_occurred_at,
    MAX(ee.created_at) AS last_occurred_at,
    CASE
      WHEN MAX(CASE WHEN ee.event_type IN ('error_resolved', 'unit_recovered') THEN 1 ELSE 0 END) = 1
        THEN MAX(CASE WHEN ee.event_type IN ('error_resolved', 'unit_recovered') THEN ee.created_at END)
      ELSE NULL
    END AS resolved_at,
    COUNT(*) AS occurrence_count,
    JSON_OBJECT(
      'rebuiltFrom', 'execution_events',
      'dedupeKeyRule', 'execution_unit_id|context|error_code_or_unknown|severity|source_category',
      'sourceCategory', CASE
        WHEN ee.event_type IN ('validation_failed') THEN 'validation'
        WHEN ee.event_type IN ('exchange_error', 'order_failed') THEN 'exchange'
        WHEN ee.event_type IN ('task_failed', 'runtime_error') THEN 'runtime'
        WHEN ee.event_type IN ('error_resolved', 'unit_recovered') THEN 'recovery'
        ELSE 'system'
      END,
      'latestEventType', SUBSTRING_INDEX(
        GROUP_CONCAT(ee.event_type ORDER BY ee.created_at DESC, ee.id DESC),
        ',',
        1
      )
    ) AS metadata
  FROM execution_events ee
  WHERE ee.event_type IN (
      'order_failed',
      'task_failed',
      'exchange_error',
      'validation_failed',
      'runtime_error',
      'error_resolved',
      'unit_recovered'
    )
    AND ee.execution_unit_id BETWEEN :from_execution_unit_id AND :to_execution_unit_id
  GROUP BY
    ee.execution_unit_id,
    ee.context,
    CASE
      WHEN ee.event_status IN ('warning', 'degraded') THEN 'warning'
      ELSE 'error'
    END,
    CASE
      WHEN ee.event_type IN ('validation_failed') THEN 'validation'
      WHEN ee.event_type IN ('exchange_error', 'order_failed') THEN 'exchange'
      WHEN ee.event_type IN ('task_failed', 'runtime_error') THEN 'runtime'
      WHEN ee.event_type IN ('error_resolved', 'unit_recovered') THEN 'recovery'
      ELSE 'system'
    END,
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ee.payload, '$.errorCode')), 'unknown')
) err
ON DUPLICATE KEY UPDATE
  context = VALUES(context),
  severity = VALUES(severity),
  dedupe_key = VALUES(dedupe_key),
  error_instance_seq = VALUES(error_instance_seq),
  error_code = VALUES(error_code),
  message = VALUES(message),
  source_event_id = VALUES(source_event_id),
  source_task_id = VALUES(source_task_id),
  source_order_execution_id = VALUES(source_order_execution_id),
  first_occurred_at = LEAST(notification_errors.first_occurred_at, VALUES(first_occurred_at)),
  last_occurred_at = GREATEST(notification_errors.last_occurred_at, VALUES(last_occurred_at)),
  resolved_at = VALUES(resolved_at),
  occurrence_count = VALUES(occurrence_count),
  metadata = VALUES(metadata),
  updated_at = VALUES(updated_at);

-- NOTE:
-- `notification_errors` uses base deterministic `dedupe_key` upserts.
-- Current base rule: execution_unit_id + context + error_code(or `unknown`) + severity + source category.
-- `error_instance_seq` is not derived in this SQL draft and must be assigned by:
-- 1. the application-side projection updater, or
-- 2. an ordered replay rebuild that walks events chronologically and increments recurrence instances after resolution.
-- This SQL keeps generating the base dedupe key and assumes instance sequence handling is done separately.
--
-- TODO:
-- 1. Add performance_daily rebuild query if API starts depending on date-range rollups.
-- 2. Add ordered replay rebuild procedure for notification_errors if DB-side recurrence reconstruction is required.
-- 3. Confirm if runtime/summaries rebuild should filter only changed units via cursor tables.
