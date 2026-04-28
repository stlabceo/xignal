# QA Harness

This harness is anchored to:

- [canonical_runtime_reconcile.md](C:/Users/tmdtk/Xignal/legacy/docs/canonical_runtime_reconcile.md)

The harness is split into three rails:

1. Data / Replay QA
2. Live Read-only QA
3. Live Execution QA preflight

## Safety Rules

- Never place live orders unless `allowLiveOrders === true`.
- Never trigger live webhooks unless `allowLiveOrders === true` and an explicit extra guard is set.
- Never cancel existing live orders in this harness.
- Never close live positions in this harness.
- Data replay uses temp rows only.
- Live read-only only reads Binance and local DB state.
- Live execution in this phase is preflight and observation only.

## Files

- `QA_ACCEPTANCE_MATRIX.md`
- `qa-config.example.json`
- `qa-config.js`
- `qa-db.js`
- `qa-binance.js`
- `qa-assert.js`
- `qa-report.js`
- `qa-cleanup.js`
- `qa-runtime-loader.js`
- `qa-scenarios.js`
- `qa-live.js`

Data / Replay scripts:

- `data-replay-ledger-dedupe.js`
- `data-replay-partial-fill.js`
- `data-replay-signal-entry-recovery.js`
- `data-replay-split-tp.js`
- `data-replay-grid-timeframe-alias-normalization.js`
- `data-replay-reconcile-flat.js`
- `data-replay-orphan-flatten.js`

Live Read-only scripts:

- `live-readonly-preflight.js`
- `live-readonly-compare-state.js`
- `live-readonly-observe-strategy.js`

Live Execution preflight / skeleton scripts:

- `live-execution-preflight.js`
- `live-execution-trigger-webhook.js`
- `live-execution-observe-run.js`
- `live-execution-assert-result.js`
- `live-execution-cleanup-check.js`

## Config

Only `qa-config.example.json` is meant to be committed.

Create a local file such as:

- `legacy/backend/tools/qa/qa-config.local.json`

and pass it explicitly:

```powershell
node .\legacy\backend\tools\qa\data-replay-ledger-dedupe.js --config .\legacy\backend\tools\qa\qa-config.local.json
```

If no config is given:

- Data / Replay scripts fall back to a safe temp-member default if one exists.
- Live Read-only / Live Execution preflight scripts require a valid UID with Binance credentials or they fail closed.

## Typical Usage

Data / Replay:

```powershell
node .\legacy\backend\tools\qa\data-replay-ledger-dedupe.js
node .\legacy\backend\tools\qa\data-replay-partial-fill.js
node .\legacy\backend\tools\qa\data-replay-signal-entry-recovery.js
node .\legacy\backend\tools\qa\data-replay-split-tp.js
node .\legacy\backend\tools\qa\data-replay-grid-timeframe-alias-normalization.js
node .\legacy\backend\tools\qa\data-replay-reconcile-flat.js
node .\legacy\backend\tools\qa\data-replay-orphan-flatten.js
node .\legacy\backend\tools\qa\run-all-data-replay.js
```

Live Read-only:

```powershell
node .\legacy\backend\tools\qa\live-readonly-preflight.js --config .\legacy\backend\tools\qa\qa-config.local.json
node .\legacy\backend\tools\qa\live-readonly-compare-state.js --config .\legacy\backend\tools\qa\qa-config.local.json
node .\legacy\backend\tools\qa\live-readonly-observe-strategy.js --config .\legacy\backend\tools\qa\qa-config.local.json
node .\legacy\backend\tools\qa\run-all-live-readonly.js --config .\legacy\backend\tools\qa\qa-config.local.json
```

Live Execution preflight only:

```powershell
node .\legacy\backend\tools\qa\live-execution-preflight.js --config .\legacy\backend\tools\qa\qa-config.local.json
```

Reports:

- `legacy/backend/tools/qa/reports/qa-report-<timestamp>.json`
- `legacy/backend/tools/qa/reports/qa-report-<timestamp>.md`
- `legacy/backend/tools/qa/reports/qa-live-readonly-report-<timestamp>.json`
- `legacy/backend/tools/qa/reports/qa-live-readonly-report-<timestamp>.md`

## Output Contract

Every script prints a final summary with:

1. QA mode
2. target UID / PID / strategy / symbol
3. scenarios executed
4. Ledger result
5. Snapshot result
6. Grid / Signal row result
7. Reservation result
8. Binance read-only result when relevant
9. PASS / FAIL
10. failure reasons
11. canonical invariant reference

## Notes

- `qa-runtime-loader.js` is used only to expose internal signal truth-sync helpers for synthetic replay without touching production source files.
- `qa-binance.js` uses signed GET requests only.
- `live-execution-trigger-webhook.js` is intentionally guard-locked and will refuse to run unless explicit live-order flags are enabled later.
