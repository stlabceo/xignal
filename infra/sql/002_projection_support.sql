-- Projection support tables for Xignal rebuild
-- Depends on: infra/sql/001_init_placeholder.sql
--
-- Assumptions:
-- 1. `execution_unit_performance_daily` is a persisted projection table, rebuilt from order_executions and execution_events.
-- 2. `projection_rebuild_runs` and `projection_rebuild_cursors` are optional operational tables for rebuild observability.
-- 3. Projection tables use narrow, stable PKs for efficient upsert and dashboard reads.

CREATE TABLE IF NOT EXISTS execution_unit_performance_daily (
  execution_unit_id BIGINT UNSIGNED NOT NULL,
  context VARCHAR(16) NOT NULL,
  performance_date DATE NOT NULL,
  realized_pnl DECIMAL(20,8) NOT NULL DEFAULT 0,
  unrealized_pnl_close DECIMAL(20,8) NOT NULL DEFAULT 0,
  gross_profit DECIMAL(20,8) NOT NULL DEFAULT 0,
  gross_loss DECIMAL(20,8) NOT NULL DEFAULT 0,
  trade_count INT NOT NULL DEFAULT 0,
  win_count INT NOT NULL DEFAULT 0,
  loss_count INT NOT NULL DEFAULT 0,
  last_closed_at DATETIME(3) NULL,
  source_last_event_id BIGINT UNSIGNED NULL,
  source_last_order_execution_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (execution_unit_id, performance_date),
  CONSTRAINT fk_execution_unit_performance_daily_unit
    FOREIGN KEY (execution_unit_id) REFERENCES execution_units (id),
  CONSTRAINT chk_execution_unit_performance_daily_context
    CHECK (context IN ('live', 'test')),
  KEY idx_execution_unit_performance_daily_context_date (context, performance_date),
  KEY idx_execution_unit_performance_daily_date (performance_date),
  KEY idx_execution_unit_performance_daily_last_closed_at (last_closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projection_rebuild_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  projection_name VARCHAR(128) NOT NULL,
  scope_type VARCHAR(32) NOT NULL DEFAULT 'full',
  scope_key VARCHAR(191) NULL,
  run_status VARCHAR(32) NOT NULL DEFAULT 'running',
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  rows_written BIGINT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(1000) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_projection_rebuild_runs_projection_status (projection_name, run_status),
  KEY idx_projection_rebuild_runs_started_at (started_at),
  KEY idx_projection_rebuild_runs_scope (scope_type, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projection_rebuild_cursors (
  projection_name VARCHAR(128) NOT NULL,
  cursor_key VARCHAR(191) NOT NULL DEFAULT 'default',
  last_event_id BIGINT UNSIGNED NULL,
  last_order_execution_id BIGINT UNSIGNED NULL,
  last_task_id BIGINT UNSIGNED NULL,
  last_rebuilt_at DATETIME(3) NULL,
  cursor_payload JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (projection_name, cursor_key),
  KEY idx_projection_rebuild_cursors_last_rebuilt_at (last_rebuilt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TODO:
-- 1. Decide whether `execution_unit_performance_daily` should also track fees and funding.
-- 2. Confirm whether projection cursoring should be per-context, per-unit, or global for the initial release.
-- 3. Consider a dedicated `dashboard_summary_snapshots` table if dashboard aggregation becomes hot.
