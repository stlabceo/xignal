# CANONICAL_ORDER_LIFECYCLE_V1

Status: DESIGN_APPROVED / SOURCE_IMPLEMENTED_PENDING_RUNTIME

Version: CANONICAL_ORDER_LIFECYCLE_V1

This document is the canonical source for order lifecycle state semantics. It is not replaceable by local runtime observations, queue emptiness, projection state, or a successful source patch. If this canonical model must change, every diagram and case table must be rewritten and explicitly approved before source behavior is changed.

## Canonical Truth Boundaries

Exchange Truth:
- Binance orders
- fills
- positions
- openOrders
- openAlgoOrders

Platform Canonical Truth:
- order_intent_queue
- live_pid_position_ledger
- live_position_bucket_owner
- live_pid_position_snapshot
- live_pid_exit_reservation
- clientOrderId / orderId / tradeId mapping

Projection:
- user PID table
- admin UI
- live_play_list
- summary APIs

Projection is not canonical truth.

## Invariants

1. Optional runtime read budget must never starve order-canonical lane.
2. PARTIALLY_FILLED is transient, never terminal.
3. accepted is not complete.
4. created/enqueued is not active.
5. reservation is not exchange order.
6. submit ACK and exchange verification are separate.
7. close dispatch is not close convergence.
8. enabled=N is not terminal.
9. manual close is not platform close success.
10. projection is not canonical truth.

## Entry Completion

DONE_NORMAL is allowed only when:
- exchange exposure is final: ENTRY_FILLED_FINAL or ENTRY_PARTIAL_TERMINAL
- ledger write exists
- owner is OPEN with PID-owned qty
- snapshot is OPEN with matching qty
- protection state is at least ENTRY_PROTECTED_ACKED

Forbidden shortcuts:
- order accepted
- protection intent created
- protection intent enqueued
- local reservation exists
- PARTIALLY_FILLED
- enabled=N
- projection flat

## Protection Lifecycle

Protection states:
- PROTECTION_REQUIRED
- PROTECTION_SUBMIT_REQUESTED
- PROTECTION_SUBMITTED_ACKED
- ENTRY_PROTECTED_ACKED
- PROTECTION_RECOVERY_QUERY_PENDING
- PROTECTION_EXCHANGE_VERIFIED
- PROTECTION_MISMATCH_P0
- PROTECTION_SUBMIT_FAILED_P0
- UNPROTECTED_EXPOSURE_P0

created/enqueued is not active. Reservation is not exchange order. Submit ACK and exchange verification are separate.

## Close Lifecycle

Close states:
- CLOSE_SUBMIT_REQUESTED
- CLOSE_ACCEPTED
- CLOSE_FILL_TRACKING
- CLOSE_PARTIAL_FILL_OBSERVED
- CLOSE_FILLED_FINAL
- CLOSE_PARTIAL_TERMINAL
- EXIT_LEDGER_WRITTEN
- OWNER_RELEASED
- SNAPSHOT_CLOSED
- RESERVATION_TERMINATED
- CLOSE_CONVERGED

Close complete is allowed only after close fill is final and canonical ledger/owner/snapshot/reservation convergence is complete.

## Manual And OFF Semantics

Manual exchange action may be recorded only as:
- USER_MANUAL_EXCHANGE_CLOSE_REPORTED
- USER_MANUAL_EXCHANGE_CANCEL_REPORTED
- EXCHANGE_FLAT_VERIFIED
- NOT_PLATFORM_CLOSE_SUCCESS

enabled=N blocks new entry but does not terminalize existing owner, snapshot, reservation, staged grid rows, or exchange exposure.

## Source/Test Mapping

Current source implementation status:
- Entry parent normal DONE requires protection child ACK or exchange verification: implemented pending runtime verification.
- PARTIALLY_FILLED is transient and parent-complete forbidden: implemented pending runtime verification.
- Optional read budget lane separation for order-canonical recovery: implemented pending runtime verification.
- Protection ACK vs exchange verification split: implemented pending runtime verification.
- Close convergence: design-approved, implementation pending.
- Grid all-or-nothing: design-approved, implementation pending.
- OFF/manual containment: design-approved, implementation pending.
- Watch/Admin/UI hard blocker: design-approved, implementation pending.

Source-only tests:
- sol-signal-entry-convergence-phase1-2-static-test.js
- signal-entry-protection-parent-join-static-test.js

Runtime verification remains required before Live QA can resume.

## Grid Explicit Exit Contract

Status: GATE_0A_DOCS_ONLY / SOURCE_IMPLEMENTATION_NOT_STARTED

Normal Grid regime termination is requested only by explicit `GRID_EXIT`.
`GRID_CANDLE_CLOSE_BREAKOUT` and related candle-close payloads are not part of
the release termination contract. In release mode they may only produce
legacy-disabled audit or operator warning until existing alerts are cleaned up.
They must not cancel orders, submit market close orders, terminalize rows, or
mutate targets.

`GRID_EXIT` is an exact regime-target contract:

- `gridRegimeKey` is required for both `GRID_ARM` and `GRID_EXIT`.
- Missing or wrong `gridRegimeKey` fallback is forbidden.
- A `GRID_EXIT` may target multiple active Grid PIDs when they share the same
  `gridRegimeKey`, `strategySignal`, symbol, and timeframe.
- Each matched PID must cancel, close, write ledger, release owner, close or
  reduce snapshot, and terminalize or resize reservation independently.
- Same symbol/side aggregate exposure must never be used to close another PID.
- Close quantity must be bounded by PID-owned remaining quantity.

`GRID_EXIT` receipt is not terminal. Cancel ACK is not terminal. Market close
ACK is not terminal. Projection flat, `enabled=N`, and local qty zero are not
terminal evidence. `PARTIALLY_FILLED` is transient and never terminal.
`PARTIALLY_FILLED is not terminal`.

Grid payloads must not include `signalPrice` or `signal_price`.
`strategySignal` is the actual Grid strategy signal name and must not be
hardcoded to `SQZ_GRID` or any other single strategy.

### Grid Exit No-Exposure Split

No-exposure Grid exit has two different canonical meanings and must not be
collapsed into one state:

- `GRID_EXIT_NO_FILLED_LEG_ENTRIES_CANCELLED`: no filled leg ever existed.
  Resting entry cancel is enough only after entries are terminal/canceled and
  owner, snapshot, and active reservation checks prove no open exposure.
  No market close and no exit ledger are expected.
- `GRID_EXIT_NO_REMAINING_EXPOSURE_AFTER_RACE_LEDGER`: cancel/fill race or
  TP/STOP fill removed the remaining exposure. Race fill evidence, exit ledger,
  owner/snapshot/reservation convergence, and row terminalization are required.

### Grid Exit Closeout Protection Gap Guard

`GRID_EXIT_CLOSEOUT_PROTECTION_GAP_GUARDED` is the required state between
protection cancel and market close dispatch. Protection cancel is not terminal.
If protection has been canceled while PID-owned exposure remains open, market
close child work must be queued immediately. If market close submit fails, the
parent must be `GRID_EXIT_BLOCKED_USER_ACTION_REQUIRED` or `GRID_EXIT_FAILED_P0`.
If this unprotected window persists, it must surface as
`UNPROTECTED_CLOSEOUT_WINDOW_P0` or USER_ACTION_REQUIRED. Silent retry loops are
forbidden.

### Grid STOP Emergency Backstop

STOP fill is not a normal Grid regime termination request. STOP remains an
emergency protective backstop. STOP fill must follow close convergence:
STOP fill evidence, exit ledger, owner release or reduction, snapshot close or
reduction, reservation terminalization or resize, sibling exposure scan, and
emergency termination or USER_ACTION_REQUIRED.

For new keyed regimes, STOP price policy should move from normal regime
termination boundary to emergency backstop offset. Existing active keyless or
legacy regimes must not be silently migrated into the new contract.

### Release Flags

Default PM-approved Gate 0A values:

| flag | allowed values | default | no-live value | live enforce condition |
|---|---|---|---|---|
| `GRID_EXIT_CONTRACT_MODE` | `OFF`, `SHADOW`, `ENFORCE` | `SHADOW` | `ENFORCE` allowed in fixtures | PM approval after docs, fixtures, and runtime-disabled integration |
| `GRID_CANDLE_CLOSE_LEGACY_MODE` | `AUDIT_ONLY`, `REJECT` | `AUDIT_ONLY` | `REJECT` allowed in fixtures | Existing alerts cleaned up and PM approval |
| `GRID_EXIT_ORCHESTRATOR_ENABLED` | `0`, `1` | `0` | `1` allowed in fixtures | PM approval after parent/child queue tests |
| `GRID_EMERGENCY_STOP_BACKSTOP_MODE` | `LEGACY`, `NEW_KEYED_ONLY`, `ENFORCE` | `NEW_KEYED_ONLY` | `ENFORCE` allowed in fixtures | PM approval after keyed regime migration policy |

See `docs/architecture/order-lifecycle/grid-exit-state-machine.md` for the
state tables and `docs/runbooks/grid-exit-readonly-blockers.md` for read-only
inventory and blocker handling.
