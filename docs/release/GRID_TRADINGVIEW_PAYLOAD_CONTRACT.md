# GRID TradingView Payload Contract

Status: GATE_0A_DOCS_ONLY / RELEASE_CONTRACT_CANDIDATE

This document defines the Grid TradingView payload contract before runtime
source enforcement. It is a documentation contract only until PM approves the
source patch gate.

## Core Rules

- Grid payloads must not include target identity fields such as `pid`, `uid`,
  `targetId`, `target_id`, or `userId`.
- Grid payloads must not include `signalPrice` or `signal_price`.
- `strategySignal` is the actual Grid strategy signal name. It is not hardcoded
  to `SQZ_GRID` or any single Grid strategy.
- `gridRegimeKey` is required for `GRID_ARM` and `GRID_EXIT`.
- `gridRegimeKey` is public and deterministic. It is not user-specific,
  PID-specific, or account-specific.
- One `GRID_EXIT` alert can target multiple active Grid PIDs when they share the
  same `gridRegimeKey`, `strategySignal`, symbol, and timeframe.
- Missing-key fallback is forbidden. Wrong-key payloads must not close unrelated
  active boxes.

## gridRegimeKey Generation

Canonical helper shape:

```text
GRIDREGIME|v1|{strategySignal}|{symbol}|{timeframe}|{supportPrice}|{resistancePrice}|{triggerPrice}|{signalTime}
```

Normalization:

- `strategySignal`: trim, uppercase, whitespace to `_`.
- `symbol`: trim, uppercase, remove exchange prefix, remove `.P`.
- `timeframe`: trim, uppercase, normalize minute aliases to `{N}MIN`.
- prices: numeric, `toFixed(12)`, trim trailing zeroes and a trailing decimal.
- time: backend-normalized `YYYY-MM-DD HH:mm:ss`, then whitespace to `T`.

Example:

```text
GRIDREGIME|v1|MEAN_REVERT_GRID|ADAUSDT|10MIN|1.1987|1.2345|1.2166|2026-06-05T12:00:00
```

## GRID_ARM

```json
{
  "eventType": "GRID_ARM",
  "strategySignal": "<actual Grid strategySignal>",
  "symbol": "{{ticker}}",
  "timeframe": "{{interval}}",
  "gridRegimeKey": "<deterministic public regime key>",
  "supportPrice": 1.1987,
  "resistancePrice": 1.2345,
  "triggerPrice": 1.2166,
  "signalTime": "{{time}}"
}
```

Behavior:

- Backend matches eligible Grid rows by `strategySignal`, normalized symbol,
  timeframe, and box prices.
- Each matched active regime stores `gridRegimeKey` in its webhook payload
  snapshot.
- `gridRegimeKey` must equal the backend canonical helper output for the ARM
  payload.
- Legacy ARM without `gridRegimeKey` is rejected in release `ENFORCE` mode.

## GRID_EXIT

```json
{
  "eventType": "GRID_EXIT",
  "strategySignal": "<same strategySignal as ARM>",
  "symbol": "{{ticker}}",
  "timeframe": "{{interval}}",
  "gridRegimeKey": "<same gridRegimeKey as ARM>",
  "exitReason": "EXPLICIT_GRID_EXIT",
  "signalTime": "{{time}}"
}
```

Behavior:

- Backend matches active Grid regimes by stored `gridRegimeKey`,
  `strategySignal`, symbol, and timeframe.
- Terminal rows and disabled rows are excluded.
- Same-key multi-PID closeout is expected and is not contamination.
- Missing key and wrong key are rejected or ignored without broad fallback.
- Each matched PID must run its own cancel, market close, ledger, owner,
  snapshot, and reservation convergence.

## Realtime Candle Close / Breakout

Realtime candle close or breakout observation is not a terminal closeout
condition in the release contract.

Legacy candle-close payloads may only produce:

- `GRID_CANDLE_CLOSE_LEGACY_DISABLED_AUDIT`
- admin/operator warning

They must not:

- close or cancel orders
- submit market close
- mutate target rows
- terminalize a Grid regime

Only explicit `GRID_EXIT` may request normal Grid regime termination.

## Release Flags

| flag | allowed values | default | no-live value | live enforce condition |
|---|---|---|---|---|
| `GRID_EXIT_CONTRACT_MODE` | `OFF`, `SHADOW`, `ENFORCE` | `SHADOW` | `ENFORCE` allowed in fixtures | PM approval after docs, fixtures, and runtime-disabled integration |
| `GRID_CANDLE_CLOSE_LEGACY_MODE` | `AUDIT_ONLY`, `REJECT` | `AUDIT_ONLY` | `REJECT` allowed in fixtures | Existing alerts cleaned up and PM approval |
| `GRID_EXIT_ORCHESTRATOR_ENABLED` | `0`, `1` | `0` | `1` allowed in fixtures | PM approval after parent/child queue tests |
| `GRID_EMERGENCY_STOP_BACKSTOP_MODE` | `LEGACY`, `NEW_KEYED_ONLY`, `ENFORCE` | `NEW_KEYED_ONLY` | `ENFORCE` allowed in fixtures | PM approval after keyed regime migration policy |

Live `ENFORCE` is forbidden until PM explicitly approves it.

## Source Patch Plan

Phase 1: payload contract helpers behind flag

- move/adapt `buildGridRegimeKey`
- validate ARM/EXIT keys
- reject `signalPrice` / `signal_price`
- remove hardcoded single-strategy assumptions
- convert candle-close to audit/no-op
- tests only, no live enforce

Phase 2: `GRID_EXIT` parent intent

- add `GRID_EXIT_REQUEST`
- join child cancel, close, and recovery intents
- make duplicate exit idempotent
- persist parent state

Phase 3: closeout orchestrator

- cancel entries/protection
- recover cancel/fill races
- compute remaining PID-owned qty
- submit bounded market close through `order_intent_queue`
- converge socket/REST fill, ledger, owner, snapshot, reservation

Phase 4: STOP emergency backstop

- apply to new keyed regimes only
- add offset config
- handle STOP partial/race
- scan sibling exposure

Phase 5: no-live fixtures

- implement QA matrix cases
- prove no Binance write
- prove sourceTradeId dedupe
- prove parent/child queue states

Phase 6: runtime-disabled integration

- verify worker route with Binance writes blocked
- before/after exchange delta must be zero

Phase 7: PM approval then controlled live QA
