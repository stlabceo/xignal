-- Xignal rebuild schema draft
-- MySQL 8.4+ oriented DDL
--
-- Assumptions:
-- 1. `context` is modeled as VARCHAR(16) with CHECK constraints instead of separate live/test tables.
-- 2. Secrets are stored by reference (`*_ref`) and not directly persisted in plaintext.
-- 3. JSON columns are used for payloads, flexible policy fragments, and migration-safe metadata.
-- 4. Projection tables are persisted read models and may be rebuilt from source-of-truth tables.
-- 5. TODO-marked columns and indexes are intentionally provisional until API and migration scripts are finalized.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS notification_errors;
DROP TABLE IF EXISTS execution_unit_summaries;
DROP TABLE IF EXISTS execution_unit_runtime_states;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS execution_events;
DROP TABLE IF EXISTS position_states;
DROP TABLE IF EXISTS order_executions;
DROP TABLE IF EXISTS execution_tasks;
DROP TABLE IF EXISTS normalized_signals;
DROP TABLE IF EXISTS alert_events;
DROP TABLE IF EXISTS execution_policies;
DROP TABLE IF EXISTS execution_units;
DROP TABLE IF EXISTS strategies;
DROP TABLE IF EXISTS exchange_accounts;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  phone_number VARCHAR(32) NULL,
  legacy_user_ref VARCHAR(128) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_legacy_user_ref (legacy_user_ref),
  KEY idx_users_status (status),
  KEY idx_users_display_name (display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exchange_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  exchange_type VARCHAR(64) NOT NULL,
  account_label VARCHAR(128) NOT NULL,
  context VARCHAR(16) NOT NULL DEFAULT 'live',
  api_key_ref VARCHAR(255) NULL,
  api_secret_ref VARCHAR(255) NULL,
  passphrase_ref VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  last_validated_at DATETIME(3) NULL,
  legacy_source_table VARCHAR(64) NULL,
  legacy_source_id VARCHAR(128) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_exchange_accounts_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT chk_exchange_accounts_context
    CHECK (context IN ('live', 'test')),
  UNIQUE KEY uq_exchange_accounts_user_label_context (user_id, account_label, context),
  UNIQUE KEY uq_exchange_accounts_legacy_source (legacy_source_table, legacy_source_id),
  KEY idx_exchange_accounts_user_context (user_id, context),
  KEY idx_exchange_accounts_status (status),
  KEY idx_exchange_accounts_exchange_type (exchange_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE strategies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  strategy_key VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  version INT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  default_parameters JSON NULL,
  legacy_source_table VARCHAR(64) NULL,
  legacy_source_id VARCHAR(128) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_strategies_key_version (strategy_key, version),
  UNIQUE KEY uq_strategies_legacy_source (legacy_source_table, legacy_source_id),
  KEY idx_strategies_status (status),
  KEY idx_strategies_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE execution_units (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  exchange_account_id BIGINT UNSIGNED NOT NULL,
  strategy_id BIGINT UNSIGNED NULL,
  context VARCHAR(16) NOT NULL,
  name VARCHAR(255) NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  market_type VARCHAR(32) NOT NULL DEFAULT 'futures',
  timeframe VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  activation_status VARCHAR(32) NOT NULL DEFAULT 'inactive',
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  latest_signal_key VARCHAR(128) NULL,
  legacy_source_table VARCHAR(64) NULL,
  legacy_source_id VARCHAR(128) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_execution_units_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_execution_units_exchange_account
    FOREIGN KEY (exchange_account_id) REFERENCES exchange_accounts (id),
  CONSTRAINT fk_execution_units_strategy
    FOREIGN KEY (strategy_id) REFERENCES strategies (id),
  CONSTRAINT chk_execution_units_context
    CHECK (context IN ('live', 'test')),
  UNIQUE KEY uq_execution_units_legacy_source (legacy_source_table, legacy_source_id),
  UNIQUE KEY uq_execution_units_user_account_context_name (user_id, exchange_account_id, context, name),
  KEY idx_execution_units_context_activation (context, activation_status),
  KEY idx_execution_units_user_context (user_id, context),
  KEY idx_execution_units_symbol_context (symbol, context),
  KEY idx_execution_units_status (status),
  KEY idx_execution_units_strategy (strategy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE execution_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  execution_unit_id BIGINT UNSIGNED NOT NULL,
  allocation_mode VARCHAR(32) NOT NULL DEFAULT 'fixed_notional',
  allocation_value DECIMAL(20,8) NULL,
  max_position_size DECIMAL(20,8) NULL,
  max_daily_loss DECIMAL(20,8) NULL,
  max_concurrent_positions INT NULL,
  entry_policy JSON NULL,
  exit_policy JSON NULL,
  risk_policy JSON NULL,
  line_policy JSON NULL,
  migration_notes JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_execution_policies_unit
    FOREIGN KEY (execution_unit_id) REFERENCES execution_units (id),
  UNIQUE KEY uq_execution_policies_unit (execution_unit_id),
  KEY idx_execution_policies_allocation_mode (allocation_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE alert_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source VARCHAR(64) NOT NULL DEFAULT 'tradingview',
  external_event_id VARCHAR(128) NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  context VARCHAR(16) NULL,
  webhook_secret_label VARCHAR(128) NULL,
  raw_payload JSON NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  validation_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  validation_errors JSON NULL,
  normalized_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_alert_events_context
    CHECK (context IS NULL OR context IN ('live', 'test')),
  UNIQUE KEY uq_alert_events_idempotency_key (idempotency_key),
  KEY idx_alert_events_received_at (received_at),
  KEY idx_alert_events_external_event_id (external_event_id),
  KEY idx_alert_events_validation_status (validation_status),
  KEY idx_alert_events_source_received (source, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE normalized_signals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  alert_event_id BIGINT UNSIGNED NOT NULL,
  signal_key VARCHAR(191) NOT NULL,
  context VARCHAR(16) NULL,
  symbol VARCHAR(64) NOT NULL,
  market_type VARCHAR(32) NOT NULL DEFAULT 'futures',
  side VARCHAR(16) NOT NULL,
  action VARCHAR(32) NOT NULL,
  timeframe VARCHAR(32) NOT NULL,
  strategy_key VARCHAR(128) NULL,
  signal_time DATETIME(3) NOT NULL,
  signal_payload JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_normalized_signals_alert_event
    FOREIGN KEY (alert_event_id) REFERENCES alert_events (id),
  CONSTRAINT chk_normalized_signals_context
    CHECK (context IS NULL OR context IN ('live', 'test')),
  UNIQUE KEY uq_normalized_signals_signal_key (signal_key),
  KEY idx_normalized_signals_alert_event (alert_event_id),
  KEY idx_normalized_signals_symbol_time (symbol, signal_time),
  KEY idx_normalized_signals_strategy_key (strategy_key),
  KEY idx_normalized_signals_context_time (context, signal_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE execution_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  normalized_signal_id BIGINT UNSIGNED NOT NULL,
  execution_unit_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  exchange_account_id BIGINT UNSIGNED NOT NULL,
  context VARCHAR(16) NOT NULL,
  task_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  scheduled_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  retry_count INT NOT NULL DEFAULT 0,
  dedupe_key VARCHAR(191) NOT NULL,
  worker_claim_key VARCHAR(191) NULL,
  failure_code VARCHAR(64) NULL,
  failure_message VARCHAR(500) NULL,
  task_payload JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_execution_tasks_signal
    FOREIGN KEY (normalized_signal_id) REFERENCES normalized_signals (id),
  CONSTRAINT fk_execution_tasks_unit
    FOREIGN KEY (execution_unit_id) REFERENCES execution_units (id),
  CONSTRAINT fk_execution_tasks_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_execution_tasks_exchange_account
    FOREIGN KEY (exchange_account_id) REFERENCES exchange_accounts (id),
  CONSTRAINT chk_execution_tasks_context
    CHECK (context IN ('live', 'test')),
  UNIQUE KEY uq_execution_tasks_dedupe_key (dedupe_key),
  KEY idx_execution_tasks_unit_status (execution_unit_id, task_status),
  KEY idx_execution_tasks_context_status (context, task_status),
  KEY idx_execution_tasks_signal_unit (normalized_signal_id, execution_unit_id),
  KEY idx_execution_tasks_scheduled_at (scheduled_at),
  KEY idx_execution_tasks_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_executions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  execution_task_id BIGINT UNSIGNED NOT NULL,
  exchange_order_id VARCHAR(191) NULL,
  exchange_client_order_id VARCHAR(191) NULL,
  order_side VARCHAR(16) NULL,
  order_type VARCHAR(32) NULL,
  requested_quantity DECIMAL(20,8) NULL,
  requested_price DECIMAL(20,8) NULL,
  filled_quantity DECIMAL(20,8) NULL,
  average_fill_price DECIMAL(20,8) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  failure_code VARCHAR(64) NULL,
  failure_reason VARCHAR(1000) NULL,
  request_payload JSON NULL,
  response_payload JSON NULL,
  executed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_order_executions_task
    FOREIGN KEY (execution_task_id) REFERENCES execution_tasks (id),
  UNIQUE KEY uq_order_executions_exchange_order (exchange_order_id),
  UNIQUE KEY uq_order_executions_client_order (exchange_client_order_id),
  KEY idx_order_executions_task_status (execution_task_id, status),
  KEY idx_order_executions_status_executed (status, executed_at),
  KEY idx_order_executions_failure_code (failure_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE position_states (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  execution_unit_id BIGINT UNSIGNED NOT NULL,
  context VARCHAR(16) NOT NULL,
  position_side VARCHAR(16) NOT NULL DEFAULT 'flat',
  quantity DECIMAL(20,8) NOT NULL DEFAULT 0,
  entry_price DECIMAL(20,8) NULL,
  mark_price DECIMAL(20,8) NULL,
  unrealized_pnl DECIMAL(20,8) NOT NULL DEFAULT 0,
  realized_pnl DECIMAL(20,8) NOT NULL DEFAULT 0,
  leverage DECIMAL(10,4) NULL,
  liquidation_price DECIMAL(20,8) NULL,
  position_status VARCHAR(32) NOT NULL DEFAULT 'flat',
  source_event_id BIGINT UNSIGNED NULL,
  snapshot_payload JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_position_states_unit
    FOREIGN KEY (execution_unit_id) REFERENCES execution_units (id),
  CONSTRAINT chk_position_states_context
    CHECK (context IN ('live', 'test')),
  UNIQUE KEY uq_position_states_unit_context (execution_unit_id, context),
  KEY idx_position_states_context_status (context, position_status),
  KEY idx_position_states_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE execution_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  execution_unit_id BIGINT UNSIGNED NOT NULL,
  execution_task_id BIGINT UNSIGNED NULL,
  order_execution_id BIGINT UNSIGNED NULL,
  alert_event_id BIGINT UNSIGNED NULL,
  normalized_signal_id BIGINT UNSIGNED NULL,
  context VARCHAR(16) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_source VARCHAR(64) NOT NULL,
  event_status VARCHAR(32) NOT NULL,
  correlation_id VARCHAR(191) NULL,
  payload JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_execution_events_unit
    FOREIGN KEY (execution_unit_id) REFERENCES execution_units (id),
  CONSTRAINT fk_execution_events_task
    FOREIGN KEY (execution_task_id) REFERENCES execution_tasks (id),
  CONSTRAINT fk_execution_events_order_execution
    FOREIGN KEY (order_execution_id) REFERENCES order_executions (id),
  CONSTRAINT fk_execution_events_alert_event
    FOREIGN KEY (alert_event_id) REFERENCES alert_events (id),
  CONSTRAINT fk_execution_events_normalized_signal
    FOREIGN KEY (normalized_signal_id) REFERENCES normalized_signals (id),
  CONSTRAINT chk_execution_events_context
    CHECK (context IN ('live', 'test')),
  KEY idx_execution_events_unit_created (execution_unit_id, created_at),
  KEY idx_execution_events_context_created (context, created_at),
  KEY idx_execution_events_event_type_created (event_type, created_at),
  KEY idx_execution_events_correlation_id (correlation_id),
  KEY idx_execution_events_task (execution_task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projection table for operations-console live/test detail and list freshness.
-- PK stays as `execution_unit_id` only because one execution unit owns exactly one current runtime projection row.
-- `context` is duplicated from execution_units as a read field for filtering and transport convenience.
-- Rebuild from execution_units, execution_tasks, execution_events, order_executions, and position_states.
CREATE TABLE execution_unit_runtime_states (
  execution_unit_id BIGINT UNSIGNED NOT NULL,
  context VARCHAR(16) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  last_signal_at DATETIME(3) NULL,
  last_execution_at DATETIME(3) NULL,
  last_event_at DATETIME(3) NULL,
  last_event_type VARCHAR(64) NULL,
  last_error_code VARCHAR(64) NULL,
  last_error_message VARCHAR(1000) NULL,
  worker_status VARCHAR(32) NOT NULL DEFAULT 'idle',
  health_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  snapshot_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (execution_unit_id),
  CONSTRAINT fk_execution_unit_runtime_states_unit
    FOREIGN KEY (execution_unit_id) REFERENCES execution_units (id),
  CONSTRAINT chk_execution_unit_runtime_states_context
    CHECK (context IN ('live', 'test')),
  KEY idx_execution_unit_runtime_states_context_active (context, is_active),
  KEY idx_execution_unit_runtime_states_context_health (context, health_status),
  KEY idx_execution_unit_runtime_states_last_event_at (last_event_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projection table for operations-console list, search, and dashboard rollups.
-- PK stays as `execution_unit_id` only because one execution unit owns exactly one current summary projection row.
-- `context` is duplicated from execution_units as a read field for filtering and transport convenience.
-- Rebuild from execution_units, users, exchange_accounts, execution_events, order_executions, and position_states.
CREATE TABLE execution_unit_summaries (
  execution_unit_id BIGINT UNSIGNED NOT NULL,
  context VARCHAR(16) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  user_display_name VARCHAR(255) NOT NULL,
  exchange_account_id BIGINT UNSIGNED NOT NULL,
  exchange_type VARCHAR(64) NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  timeframe VARCHAR(32) NOT NULL,
  activation_status VARCHAR(32) NOT NULL,
  position_status VARCHAR(32) NOT NULL,
  today_pnl DECIMAL(20,8) NOT NULL DEFAULT 0,
  cumulative_pnl DECIMAL(20,8) NOT NULL DEFAULT 0,
  win_rate DECIMAL(7,4) NULL,
  trade_count INT NOT NULL DEFAULT 0,
  last_event_at DATETIME(3) NULL,
  last_event_type VARCHAR(64) NULL,
  last_error_message VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (execution_unit_id),
  CONSTRAINT fk_execution_unit_summaries_unit
    FOREIGN KEY (execution_unit_id) REFERENCES execution_units (id),
  CONSTRAINT fk_execution_unit_summaries_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_execution_unit_summaries_exchange_account
    FOREIGN KEY (exchange_account_id) REFERENCES exchange_accounts (id),
  CONSTRAINT chk_execution_unit_summaries_context
    CHECK (context IN ('live', 'test')),
  KEY idx_execution_unit_summaries_context_activation (context, activation_status),
  KEY idx_execution_unit_summaries_context_symbol (context, symbol),
  KEY idx_execution_unit_summaries_user_context (user_id, context),
  KEY idx_execution_unit_summaries_last_event_at (last_event_at),
  KEY idx_execution_unit_summaries_today_pnl (today_pnl)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projection table for the operations error center and unresolved notifications.
-- `dedupe_key` is the base deterministic identity for an unresolved error group.
-- `error_instance_seq` is the recurrence sequence for that base error identity.
-- While unresolved, repeated occurrences update the same `(dedupe_key, error_instance_seq)` row.
-- After resolution, the next recurrence reuses the same base `dedupe_key` but increments `error_instance_seq`.
-- Rebuild from execution_events, order_executions, execution_tasks, and msg_list-derived migration data.
CREATE TABLE notification_errors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  execution_unit_id BIGINT UNSIGNED NOT NULL,
  context VARCHAR(16) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'error',
  dedupe_key VARCHAR(191) NOT NULL,
  error_instance_seq INT NOT NULL DEFAULT 1,
  error_code VARCHAR(64) NULL,
  message VARCHAR(1000) NOT NULL,
  source_event_id BIGINT UNSIGNED NULL,
  source_task_id BIGINT UNSIGNED NULL,
  source_order_execution_id BIGINT UNSIGNED NULL,
  first_occurred_at DATETIME(3) NOT NULL,
  last_occurred_at DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_notification_errors_unit
    FOREIGN KEY (execution_unit_id) REFERENCES execution_units (id),
  CONSTRAINT fk_notification_errors_event
    FOREIGN KEY (source_event_id) REFERENCES execution_events (id),
  CONSTRAINT fk_notification_errors_task
    FOREIGN KEY (source_task_id) REFERENCES execution_tasks (id),
  CONSTRAINT fk_notification_errors_order_execution
    FOREIGN KEY (source_order_execution_id) REFERENCES order_executions (id),
  CONSTRAINT chk_notification_errors_context
    CHECK (context IN ('live', 'test')),
  UNIQUE KEY uq_notification_errors_dedupe_instance (dedupe_key, error_instance_seq),
  KEY idx_notification_errors_context_resolved (context, resolved_at),
  KEY idx_notification_errors_unit_resolved (execution_unit_id, resolved_at),
  KEY idx_notification_errors_last_occurred_at (last_occurred_at),
  KEY idx_notification_errors_severity (severity),
  KEY idx_notification_errors_error_code (error_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NULL,
  target_id VARCHAR(128) NULL,
  payload JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_logs_actor (actor_type, actor_id, created_at),
  KEY idx_audit_logs_event_type (event_type, created_at),
  KEY idx_audit_logs_target (target_type, target_id),
  KEY idx_audit_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TODO:
-- 1. Decide whether status-like fields should move to reference tables.
-- 2. Confirm if `position_states` should keep only the latest snapshot or also version snapshots in a history table.
-- 3. Confirm whether `execution_unit_runtime_states` and `execution_unit_summaries` should carry explicit rebuild cursors.
-- 4. Add dashboard-specific projection table if summary aggregation cost becomes high.
-- 5. Add partitioning or archival strategy for `alert_events`, `execution_events`, and `order_executions` if volume grows quickly.
