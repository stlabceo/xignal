# GRID_EXIT Live QA Release Closure

Date: 2026-06-08
Branch: `codex/canonical-order-lifecycle-v1-review`
Accepted source HEAD: `3817a78`
Evidence bundle: `C:\Users\tmdtk\grid-exit-review-packets\20260608_live_qa_pass`

## Release Gate

`GRID_EXIT_LIVE_QA_ACCEPTED_WITH_MINOR_RISK`

This record closes the focused `GRID_EXIT` live QA for QA PID 204 on
`PUMPUSDT.P` / `PUMPUSDT`. No additional live QA is implied by this document.

## Accepted Live QA Evidence

| Item | Evidence |
| --- | --- |
| ARM intent | `261998` DONE |
| TVE_EXIT event | `989` |
| Route mode | `ACTUAL` |
| Matched / requested / processed | `1 / 1 / 1` |
| ignoredActive | `0` |
| resultCode | `GRID_EXIT_CONVERGED` |
| closeCount | `2` |
| LONG close | FILLED, order `4580171019`, trade `230258745` |
| SHORT close | FILLED, order `4580171074`, trade `230258753` |
| Exit ledger | LONG and SHORT `GRID_EXCHANGE_RECONCILED_EXIT_FILL` |
| Safety close | Not used for the accepted run |
| Final exchange | LONG `0`, SHORT `0`, openOrders `0`, openAlgoOrders `0` |
| Final local | owner open `0`, snapshot open `0`, active reservation `0` |
| Queue | `PENDING` / `RUNNING` / `RETRY` = `0` |
| Unrelated PID touch | None observed in scoped runtime logs |
| 418 / 429 | None observed in scoped logs |

## Required ACTUAL Mode Checklist

The first EXIT call before the accepted run fell back to audit-only because the
ACTUAL execution gate requires exact max-target confirmation. Before any future
controlled `GRID_EXIT` ACTUAL run, all of the following must be set exactly:

```text
GRID_EXIT_ORCHESTRATOR_ENABLED=1
GRID_EXIT_ROUTE_EXECUTION_MODE=ACTUAL
GRID_EXIT_ACTUAL_CANCEL_ENABLED=1
GRID_EXIT_ACTUAL_CANCEL_HARD_CONFIRM=1
GRID_EXIT_ACTUAL_CANCEL_MAX_TARGETS=1
GRID_EXIT_ACTUAL_MARKET_CLOSE_ENABLED=1
GRID_EXIT_ACTUAL_MARKET_CLOSE_HARD_CONFIRM=1
GRID_EXIT_ACTUAL_MARKET_CLOSE_MAX_TARGETS=1
GRID_EXIT_ROUTE_EXECUTION_MAX_TARGETS=1
```

If either max-target value is not exactly `1`, the route must remain audit-only
and must not be counted as release evidence.

## PID204 Terminal-Safe Display Note

Final PID204 state is terminal-safe:

| Field | Final value |
| --- | --- |
| `enabled` | `N` |
| LONG / SHORT leg status | `IDLE` / `IDLE` |
| LONG / SHORT qty | `0` / `0` |
| Entry / exit / stop order refs | `NULL` |
| owner open | `0` |
| snapshot open | `0` |
| active reservation | `0` |
| exchange exposure | `0` |

Minor display risk: the row currently shows `regimeStatus=WAITING_WEBHOOK`
because the terminal projection repair resets a fully flat disabled row through
the common reset patch. This is safe for release because `enabled=N`, all leg
projection fields are idle/zero, and canonical owner/snapshot/reservation state
is closed.

TODO, display only: UI/preflight readers should classify
`enabled=N + both legs IDLE + qty/order refs 0 + owner/snapshot/reservation 0`
as terminal-safe even if `regimeStatus` is `WAITING_WEBHOOK`.

No DB correction was applied for this display note. If a DB correction is ever
needed, it must be an exact PID204 proposal reviewed separately; no broad update
is allowed.

## Minimal Regression Accepted

| Command | Result |
| --- | --- |
| `node legacy/backend/tools/qa/grid-exit-route-execution-mode-test.js` | PASS |
| `node legacy/backend/tools/qa/grid-exit-market-close-decision-test.js` | PASS |
| `node legacy/backend/tools/qa/grid-exit-terminal-projection-guard-test.js` | PASS |
| `node legacy/backend/tools/qa/grid-exit-gate-bc-market-close-recovery-convergence-test.js` | PASS |
| `node legacy/backend/tools/qa/grid-live-arm-immediate-fill-recovery-test.js` | PASS |
| `git diff --check` | PASS |

## Release Caveats

| Risk | Severity | Required action |
| --- | --- | --- |
| Initial EXIT audit-only due max-target/env mismatch | Minor operational | Use the checklist above before ACTUAL mode |
| PID204 `regimeStatus=WAITING_WEBHOOK` while disabled and flat | Minor display | Treat as terminal-safe; add display classification later if needed |
| Entry fill recovery required exact truth sync in the focused series | Minor operational | Keep immediate-fill recovery regression in release gate |
| Historical PID204 QA rows remain in history | Low | Do not count manual/safety history as strategy success |

## Forbidden Compliance

This closure document does not perform or require:

- new TVE ARM
- new TVE_EXIT
- Binance order submit
- Binance cancel
- Binance market close
- broad cancel
- aggregate close
- direct DB intent insert
- direct GRID_LIVE_ARM insert
- unrelated PID touch
- source behavior patch
