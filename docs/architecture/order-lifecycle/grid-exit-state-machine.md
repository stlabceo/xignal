# Grid Exit State Machine

Status: GATE_0A_DOCS_ONLY / SOURCE_IMPLEMENTATION_NOT_STARTED

This document specifies the canonical Grid exit and emergency STOP state
machines. It does not enable runtime behavior.

## GRID_EXIT Parent / Child State Machine

| state | entry condition | allowed next | terminal? | forbidden shortcut | evidence |
|---|---|---|---|---|---|
| `GRID_EXIT_REQUESTED` | Valid explicit `GRID_EXIT` payload received | `GRID_EXIT_TARGET_LOCKED`, `GRID_EXIT_FAILED_P0` | No | Treat webhook receipt as complete | webhook event and target preview |
| `GRID_EXIT_TARGET_LOCKED` | Active rows matched by `gridRegimeKey`, `strategySignal`, symbol, timeframe | `GRID_EXIT_REENTRY_BLOCKED` | No | Broad fallback target | target log with exact key |
| `GRID_EXIT_REENTRY_BLOCKED` | New arm/reentry blocked for target regime | `GRID_EXIT_ENTRY_CANCEL_REQUESTED` | No | New entry during exit | row lock or audit state |
| `GRID_EXIT_ENTRY_CANCEL_REQUESTED` | Resting entry orders exist or need verification | `GRID_EXIT_ENTRY_CANCEL_CONVERGED`, `GRID_EXIT_CANCEL_RACE_FILL_DETECTED` | No | Cancel ACK as terminal | cancel intent and exchange order status |
| `GRID_EXIT_ENTRY_CANCEL_CONVERGED` | Entry orders canceled, terminal unfilled, or race fill recovered | `GRID_EXIT_PROTECTION_CANCEL_REQUESTED`, `GRID_EXIT_NO_FILLED_LEG_ENTRIES_CANCELLED` | No | Ignore late fill | allOrders/userTrades check |
| `GRID_EXIT_PROTECTION_CANCEL_REQUESTED` | Active TP/STOP reservations or exchange protections exist | `GRID_EXIT_PROTECTION_CANCEL_CONVERGED`, `GRID_EXIT_CANCEL_RACE_FILL_DETECTED` | No | Protection cancel ACK as terminal | protection cancel child and exchange state |
| `GRID_EXIT_PROTECTION_CANCEL_CONVERGED` | Protections terminal or race fills recovered | `GRID_EXIT_CLOSEOUT_PROTECTION_GAP_GUARDED` | No | Assume no exposure after cancel | reservation and exchange evidence |
| `GRID_EXIT_CLOSEOUT_PROTECTION_GAP_GUARDED` | Protection is canceled or not effective while closeout is not converged | `GRID_EXIT_REMAINING_EXPOSURE_DETECTED`, `GRID_EXIT_NO_REMAINING_EXPOSURE_AFTER_RACE_LEDGER`, `GRID_EXIT_BLOCKED_USER_ACTION_REQUIRED`, `GRID_EXIT_FAILED_P0` | No | Leave exposure open without child close or risk surfacing | active owner/snapshot and close child state |
| `GRID_EXIT_CANCEL_RACE_FILL_DETECTED` | Entry, TP, or STOP fill is observed during cancel | `GRID_EXIT_CANCEL_RACE_RECOVERED` | No | Drop race fill | socket or REST trade evidence |
| `GRID_EXIT_CANCEL_RACE_RECOVERED` | Race fill applied or deduped | `GRID_EXIT_CLOSEOUT_PROTECTION_GAP_GUARDED`, `GRID_EXIT_NO_REMAINING_EXPOSURE_AFTER_RACE_LEDGER` | No | Duplicate ledger or projection-only close | sourceTradeId ledger and owner/snapshot |
| `GRID_EXIT_REMAINING_EXPOSURE_DETECTED` | PID-owned open qty remains after cancel/recovery | `GRID_EXIT_MARKET_CLOSE_REQUESTED` | No | Aggregate close or sibling close | PID owner/snapshot qty |
| `GRID_EXIT_NO_FILLED_LEG_ENTRIES_CANCELLED` | No filled leg ever existed; entries are terminal/canceled; no owner open; no active reservation | `GRID_EXIT_GRID_ROW_TERMINAL` | No | Write exit ledger without fill | no-filled-leg proof and entry terminal proof |
| `GRID_EXIT_NO_REMAINING_EXPOSURE_AFTER_RACE_LEDGER` | Cancel/fill race or TP/STOP fill removed exposure | `GRID_EXIT_GRID_ROW_TERMINAL` | No | Skip race ledger/convergence | race fill, exit ledger, owner/snapshot/reservation convergence |
| `GRID_EXIT_MARKET_CLOSE_REQUESTED` | Bounded PID-owned close qty computed | `GRID_EXIT_MARKET_CLOSE_ACCEPTED`, `GRID_EXIT_BLOCKED_USER_ACTION_REQUIRED`, `GRID_EXIT_FAILED_P0` | No | Direct Binance write outside queue | close child intent |
| `GRID_EXIT_MARKET_CLOSE_ACCEPTED` | Exchange accepted market close submit | `GRID_EXIT_MARKET_CLOSE_FILL_TRACKING` | No | Submit ACK as complete | order ACK |
| `GRID_EXIT_MARKET_CLOSE_FILL_TRACKING` | Waiting for close fill through socket/REST | `GRID_EXIT_MARKET_CLOSE_PARTIAL_OBSERVED`, `GRID_EXIT_MARKET_CLOSE_REST_RECOVERY_PENDING`, `GRID_EXIT_MARKET_CLOSE_FILLED_CONFIRMED` | No | Time-based success | fill tracking event |
| `GRID_EXIT_MARKET_CLOSE_PARTIAL_OBSERVED` | Close fill is partial | `GRID_EXIT_MARKET_CLOSE_FILL_TRACKING`, `GRID_EXIT_MARKET_CLOSE_REST_RECOVERY_PENDING`, `GRID_EXIT_BLOCKED_USER_ACTION_REQUIRED` | No | Partial as terminal | partial tradeId and remaining qty |
| `GRID_EXIT_MARKET_CLOSE_REST_RECOVERY_PENDING` | Socket fill missing or incomplete | `GRID_EXIT_MARKET_CLOSE_PARTIAL_OBSERVED`, `GRID_EXIT_MARKET_CLOSE_FILLED_CONFIRMED`, `GRID_EXIT_BLOCKED_USER_ACTION_REQUIRED` | No | No-fill assumption | allOrders/userTrades |
| `GRID_EXIT_MARKET_CLOSE_FILLED_CONFIRMED` | Final close fill proven | `GRID_EXIT_LEDGER_APPLIED` | No | ACK-only completion | sourceClientOrderId/sourceOrderId/sourceTradeId |
| `GRID_EXIT_LEDGER_APPLIED` | Exit ledger written or duplicate proved | `GRID_EXIT_OWNER_RELEASED_OR_REDUCED` | No | Ledger missing | ledger row |
| `GRID_EXIT_OWNER_RELEASED_OR_REDUCED` | PID owner qty converged | `GRID_EXIT_SNAPSHOT_CLOSED_OR_REDUCED` | No | Owner ignored | live_position_bucket_owner |
| `GRID_EXIT_SNAPSHOT_CLOSED_OR_REDUCED` | PID snapshot converged | `GRID_EXIT_RESERVATION_TERMINAL_OR_RESIZED` | No | Projection flat only | live_pid_position_snapshot |
| `GRID_EXIT_RESERVATION_TERMINAL_OR_RESIZED` | Reservation/staged rows terminalized or resized | `GRID_EXIT_GRID_ROW_TERMINAL` | No | Active reservation hidden | live_pid_exit_reservation and staged rows |
| `GRID_EXIT_GRID_ROW_TERMINAL` | Grid row regime terminalized after canonical convergence | `GRID_EXIT_CONVERGED` | No | `enabled=N` as success | grid row state |
| `GRID_EXIT_CONVERGED` | All matched PIDs independently converged | None | Yes | None | parent evidence bundle |
| `GRID_EXIT_BLOCKED_USER_ACTION_REQUIRED` | Closeout cannot safely converge without operator action | operator action or retry after evidence | Blocked | Silent retry loop | blocker reason |
| `GRID_EXIT_FAILED_P0` | Invariant is broken | None without source fix/approval | Fail | Continue live loop | P0 report |

## STOP Emergency Backstop State Machine

| state | entry condition | allowed next | terminal? | forbidden shortcut | evidence |
|---|---|---|---|---|---|
| `GRID_EMERGENCY_STOP_TRIGGERED` | STOP protection fill begins | `STOP_FILL_CONFIRMED` | No | Treat STOP as normal GRID_EXIT | STOP order event |
| `STOP_FILL_CONFIRMED` | STOP fill proven by socket or REST | `STOP_EXIT_LEDGER_APPLIED` | No | ACK-only close | sourceTradeId/order evidence |
| `STOP_EXIT_LEDGER_APPLIED` | Exit ledger written or duplicate proved | `OWNER_RELEASED_OR_REDUCED` | No | Ledger skip | ledger row |
| `OWNER_RELEASED_OR_REDUCED` | PID owner qty reduced or closed | `SNAPSHOT_CLOSED_OR_REDUCED` | No | Owner zero by projection only | owner row |
| `SNAPSHOT_CLOSED_OR_REDUCED` | Snapshot reduced or closed | `RESERVATION_TERMINAL_OR_RESIZED` | No | Snapshot ignored | snapshot row |
| `RESERVATION_TERMINAL_OR_RESIZED` | STOP reservation filled and sibling reservation adjusted | `SIBLING_EXPOSURE_SCAN` | No | Hide sibling risk | reservation rows |
| `SIBLING_EXPOSURE_SCAN` | Sibling leg and same-regime exposure checked | `SIBLING_CLOSE_OR_USER_ACTION_REQUIRED`, `GRID_EMERGENCY_TERMINATED` | No | Aggregate close | PID-owned owner/snapshot |
| `SIBLING_CLOSE_OR_USER_ACTION_REQUIRED` | Sibling exposure needs close or operator decision | `GRID_EMERGENCY_TERMINATED`, blocked | No | Close another PID exposure | bounded close evidence |
| `GRID_EMERGENCY_TERMINATED` | Emergency path converged or safely blocked | None | Yes | None | full convergence or blocker evidence |

## STOP / GRID_EXIT Race Policy

- Fill evidence wins over cancel or close request state.
- `sourceTradeId` is the fill identity when present.
- If STOP fill and `GRID_EXIT` race, the GRID_EXIT parent must absorb the STOP
  fill as race recovery and must not over-close.
- Remaining quantity after partial STOP or market close must stay protected,
  retried through recovery, or surfaced as USER_ACTION_REQUIRED.

## No-Exposure Split

`GRID_EXIT_NO_FILLED_LEG_ENTRIES_CANCELLED` applies only when no filled leg ever
existed. It allows grid row terminalization after entry cancel convergence and
no owner/snapshot/reservation exposure evidence.

`GRID_EXIT_NO_REMAINING_EXPOSURE_AFTER_RACE_LEDGER` applies when a race fill,
TP fill, or STOP fill removed exposure. It requires fill evidence, exit ledger,
owner/snapshot/reservation convergence, and then grid row terminalization.

## Closeout Protection Gap

`GRID_EXIT_CLOSEOUT_PROTECTION_GAP_GUARDED` must be visible whenever protection
is canceled before market close convergence. The parent cannot be DONE while
this gap is open.

If market close child is not immediately queued or accepted, the parent must
surface `UNPROTECTED_CLOSEOUT_WINDOW_P0`, `GRID_EXIT_BLOCKED_USER_ACTION_REQUIRED`,
or `GRID_EXIT_FAILED_P0`. Silent retry loops are forbidden.
