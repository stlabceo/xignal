-- Local smoke-test seed data for /api/v1/internal/execution-events
-- Assumes 001_init_placeholder.sql and 002_projection_support.sql have already been applied.

INSERT INTO users (
  id,
  email,
  display_name,
  status,
  created_at,
  updated_at
)
VALUES (
  9001,
  'smoke-user@example.com',
  'Smoke User',
  'active',
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO exchange_accounts (
  id,
  user_id,
  exchange_type,
  account_label,
  context,
  status,
  created_at,
  updated_at
)
VALUES (
  9001,
  9001,
  'binance-futures',
  'local-smoke-live',
  'live',
  'active',
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO execution_units (
  id,
  user_id,
  exchange_account_id,
  strategy_id,
  context,
  name,
  symbol,
  market_type,
  timeframe,
  status,
  activation_status,
  is_deleted,
  created_at,
  updated_at
)
VALUES (
  9001,
  9001,
  9001,
  NULL,
  'live',
  'Local Smoke BTC Unit',
  'BTCUSDT',
  'futures',
  '5m',
  'active',
  'active',
  0,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  activation_status = VALUES(activation_status),
  is_deleted = VALUES(is_deleted),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO execution_policies (
  execution_unit_id,
  allocation_mode,
  allocation_value,
  created_at,
  updated_at
)
VALUES (
  9001,
  'fixed_notional',
  100.00000000,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE
  allocation_mode = VALUES(allocation_mode),
  allocation_value = VALUES(allocation_value),
  updated_at = CURRENT_TIMESTAMP(3);
