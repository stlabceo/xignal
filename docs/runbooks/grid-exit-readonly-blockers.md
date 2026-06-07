# Grid Exit Read-Only Blockers

Status: GATE_0A_DOCS_ONLY / READ_ONLY_INVENTORY_PLAN

This runbook defines the read-only inventory needed before enabling any
`GRID_EXIT` runtime enforcement. It must not be used to mutate data.

## Hard Rules

- SELECT only.
- No UPDATE, INSERT, DELETE, DDL, cleanup, broad close, direct intent insert, or
  direct `GRID_LIVE_ARM` insert.
- Keyless active regimes must not be broad-closed.
- Terminal rows must not be retargeted.
- Candle-close legacy payloads must not close, cancel, market-close, or mutate
  targets in release mode.

## Required Inventory

| item | risk | recommended handling |
|---|---|---|
| active Grid rows without stored `gridRegimeKey` | wrong target or broad fallback close | USER_ACTION_REQUIRED or LEGACY_CONTAINED |
| keyless active rows with open snapshot | unkeyed close could affect wrong regime | block automatic GRID_EXIT |
| keyless active rows with active TP/STOP reservation | protection cancel could expose position | block automatic GRID_EXIT |
| same symbol/timeframe/box duplicate rows | same-key multi-PID allowed only after explicit key match | require stored key and PID-independent convergence |
| terminal row retarget candidates | old rows can receive new exits | exclude terminal/disabled rows |
| active candle-close legacy mode rows/alerts | legacy alert may mutate runtime | audit only until operator cleanup |
| owner/snapshot/reservation mismatch | close qty ambiguity | read-only blocker and operator review |

## Schema Introspection

Run introspection before inventory queries because legacy schemas may differ.

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'live_grid_strategy_list',
    'live_pid_position_snapshot',
    'live_position_bucket_owner',
    'live_pid_exit_reservation',
    'order_intent_queue',
    'webhook_event_log',
    'webhook_event_target_log'
  )
ORDER BY table_name;

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN (
    'live_grid_strategy_list',
    'live_pid_position_snapshot',
    'live_position_bucket_owner',
    'live_pid_exit_reservation',
    'order_intent_queue',
    'webhook_event_log',
    'webhook_event_target_log'
  )
ORDER BY table_name, ordinal_position;
```

## Inventory Query Templates

Adjust column names only after introspection.

```sql
-- 1. Active Grid rows without stored gridRegimeKey.
SELECT COUNT(*) AS active_keyless_grid_rows
FROM live_grid_strategy_list
WHERE (
    enabled = 'Y'
    OR UPPER(COALESCE(regimeStatus, status, '')) NOT IN (
      'ENDED', 'CLOSED', 'CANCELLED', 'CANCELED', 'TERMINAL'
    )
  )
  AND (
    JSON_EXTRACT(COALESCE(webhookPayloadSnapshot, '{}'), '$.gridRegimeKey') IS NULL
    OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(webhookPayloadSnapshot, '{}'), '$.gridRegimeKey')) = ''
  );

-- 2. Keyless active rows with open snapshot.
SELECT COUNT(DISTINCT g.id) AS keyless_open_snapshot_rows
FROM live_grid_strategy_list g
JOIN live_pid_position_snapshot s
  ON s.uid = g.uid
 AND s.pid = g.id
 AND LOWER(s.strategyCategory) = 'grid'
WHERE s.openQty > 0
  AND UPPER(COALESCE(s.state, '')) NOT IN ('CLOSED', 'TERMINAL')
  AND (
    JSON_EXTRACT(COALESCE(g.webhookPayloadSnapshot, '{}'), '$.gridRegimeKey') IS NULL
    OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(g.webhookPayloadSnapshot, '{}'), '$.gridRegimeKey')) = ''
  );

-- 3. Keyless active rows with active TP/STOP reservation.
SELECT COUNT(DISTINCT g.id) AS keyless_active_reservation_rows
FROM live_grid_strategy_list g
JOIN live_pid_exit_reservation r
  ON r.uid = g.uid
 AND r.pid = g.id
 AND LOWER(r.strategyCategory) = 'grid'
WHERE UPPER(COALESCE(r.status, '')) IN (
    'ACTIVE', 'PENDING', 'SUBMITTED', 'PARTIAL', 'CANCEL_PENDING'
  )
  AND (
    JSON_EXTRACT(COALESCE(g.webhookPayloadSnapshot, '{}'), '$.gridRegimeKey') IS NULL
    OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(g.webhookPayloadSnapshot, '{}'), '$.gridRegimeKey')) = ''
  );

-- 4. Same symbol/timeframe/box duplicate rows.
SELECT uid, symbol, bunbong, strategySignal, supportPrice, resistancePrice,
       triggerPrice, COUNT(*) AS row_count
FROM live_grid_strategy_list
WHERE enabled = 'Y'
   OR UPPER(COALESCE(regimeStatus, status, '')) NOT IN (
     'ENDED', 'CLOSED', 'CANCELLED', 'CANCELED', 'TERMINAL'
   )
GROUP BY uid, symbol, bunbong, strategySignal, supportPrice, resistancePrice,
         triggerPrice
HAVING COUNT(*) > 1;

-- 5. Terminal row retarget risk candidates.
SELECT COUNT(*) AS terminal_retarget_candidates
FROM live_grid_strategy_list
WHERE enabled <> 'Y'
  AND UPPER(COALESCE(regimeStatus, status, '')) IN (
    'ENDED', 'CLOSED', 'CANCELLED', 'CANCELED', 'TERMINAL'
  )
  AND (
    supportPrice IS NOT NULL
    OR resistancePrice IS NOT NULL
    OR triggerPrice IS NOT NULL
    OR webhookPayloadSnapshot IS NOT NULL
  );

-- 6. Active candle-close legacy mode row/alert candidates.
SELECT COUNT(*) AS candle_close_legacy_alert_candidates
FROM webhook_event_log
WHERE JSON_SEARCH(COALESCE(rawPayloadJson, payloadJson, '{}'), 'one',
                  'GRID_CANDLE_CLOSE%') IS NOT NULL
   OR JSON_SEARCH(COALESCE(rawPayloadJson, payloadJson, '{}'), 'one',
                  'CANDLE_CLOSE%') IS NOT NULL;

-- 7. Open owner/snapshot/reservation mismatch candidates.
SELECT COUNT(*) AS open_snapshot_without_owner_or_reservation
FROM live_pid_position_snapshot s
LEFT JOIN live_position_bucket_owner o
  ON o.uid = s.uid
 AND o.pid = s.pid
 AND LOWER(o.strategyCategory) = LOWER(s.strategyCategory)
 AND o.positionSide = s.positionSide
LEFT JOIN live_pid_exit_reservation r
  ON r.uid = s.uid
 AND r.pid = s.pid
 AND LOWER(r.strategyCategory) = LOWER(s.strategyCategory)
 AND r.positionSide = s.positionSide
 AND UPPER(COALESCE(r.status, '')) IN (
   'ACTIVE', 'PENDING', 'SUBMITTED', 'PARTIAL', 'CANCEL_PENDING'
 )
WHERE LOWER(s.strategyCategory) = 'grid'
  AND s.openQty > 0
  AND (COALESCE(o.ownedQty, 0) <= 0 OR r.id IS NULL);
```

## Handling Policy

- New keyed regimes: apply `GRID_EXIT` contract only after PM-approved source
  enforcement.
- Active keyless regimes: classify as USER_ACTION_REQUIRED or
  LEGACY_CONTAINED. Do not infer a key automatically and do not auto-close.
- Terminal rows: exclude from target matching.
- Legacy candle-close payloads: `GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT` only.
- Mismatched owner/snapshot/reservation: block release readiness until reviewed.
