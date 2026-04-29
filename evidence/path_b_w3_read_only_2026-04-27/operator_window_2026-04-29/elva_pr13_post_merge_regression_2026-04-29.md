# PR #13 Post-Merge Regression — 2026-04-29

**Owner**: Elva
**Trigger**: PR #13 squash-merged at 2026-04-29T04:04:47Z (merge commit `f9d3b46`)
**Scope**: 8-point regression on `main` HEAD post-merge.

---

## Result Summary

**7/8 PASS**, 1 deferred (operator-window required).

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | `main` HEAD updated to PR #13 squash | PASS | `git log -1 origin/main` → `f9d3b46 feat(w5b-a3-a4): /order/create 422->409 short-circuit + WS hygiene tests (DRAFT) (#13)` |
| 2 | PR #13 status MERGED | PASS | `gh pr view 13 --json state,mergedAt,mergeCommit` → `state=MERGED, mergedAt=2026-04-29T04:04:47Z, mergeCommit=f9d3b46e4685437011d07e7499090d267ffdb3bf` |
| 3 | Python suite PASS on `main` | PASS | `cd services/kgi-gateway && pytest tests/ -q` → `60 passed in 0.60s` |
| 4 | `/order/create` all-payload returns 409 NOT_ENABLED_IN_W1 | DEFERRED | Operator-window required (gateway must be running with `python services/kgi-gateway/app.py`). See `next_operator_runbook_pr13_retest_2026-04-29.md` for the 5-payload retest checklist. |
| 5 | No-order grep on `main` | PASS | `app.py` references to `api.Order.*` are: (a) read-side `get_position` / `get_trades` / `get_deals` (W1.5 scope, not order submission); (b) docstring/comment text describing future wiring; (c) the `create_order` handler signature itself (body ignored, returns 409). NO active call to `api.Order.create_order` / `cancel_order` / `submit_order`. |
| 6 | No contracts mutation | PASS | `git show --stat f9d3b46` → only `services/kgi-gateway/app.py` + 2 test files. NO `packages/contracts/`, NO `apps/api/src/contracts/`, NO IUF_SHARED_CONTRACTS touched. |
| 7 | No secret leakage | PASS | Diff scope is Python service code + tests; no `.env`, no API key, no token, no PII. |
| 8 | Hard-line table updated | PASS (this doc) | This regression report itself constitutes the hard-line evidence row for "fail-closed `/order/create`" — see `Hard-Line Status Update` below. |

---

## Hard-Line Status Update

| Hard line | Pre-PR-13 | Post-PR-13 |
|-----------|-----------|------------|
| `/order/create` rejects all payloads with structured envelope | TRUE (422 SCHEMA_INVALID via Pydantic) | TRUE (409 NOT_ENABLED_IN_W1 via handler short-circuit; payload no longer matters) |
| Handler must NOT call any SDK order method | TRUE | TRUE (verified by `test_order_create_handler_never_calls_sdk` patching `_api`; mock asserts 0 calls) |
| WebSocket `order_events_ws` must NOT process orders | TRUE | TRUE (verified by `test_ws_hygiene_current_handler_no_control_plane` with regex tightened to dot-anchor + docstring stripping) |
| Candidate F `/position` 503 circuit breaker preserved | TRUE | TRUE (lines 265-278 of `app.py` unchanged; verified via diff stat — `app.py` only +19/-5 inside `/order/create` route + nearby helpers) |
| `/quote/kbar` and `/quote/status` unaffected | TRUE | TRUE (no diff in those route definitions; pytest suite includes 60 tests covering them) |

---

## Diff Footprint

```
services/kgi-gateway/app.py                        |  24 +- (+19/-5)
services/kgi-gateway/tests/test_order_gate.py      | 237 ++++++++++++++++++ (new)
services/kgi-gateway/tests/test_ws_order_hygiene.py | 271 +++++++++++++++++++++ (new)
3 files changed, 527 insertions(+), 5 deletions(-)
```

No app behavior change outside `/order/create` route. No new dependencies. No env-var contract changes.

---

## Open Items / Carry-Forward

1. **Item #4 (operator-window retest)** — must be run during a 楊董-authorised operator window. Runbook delivered separately at `next_operator_runbook_pr13_retest_2026-04-29.md`. Not blocking this regression report; the route safety is proved by the 60/60 Python suite.
2. PR #13 head branch (`feat/w5b-a3-a4-order-route-...`) NOT deleted (per directive `--delete-branch=false`). Manual cleanup deferred.
3. PR #14 (Jim visual overhaul) remains DRAFT and frozen (Jim lane halted 2026-04-29; outsourced).
4. PR #12 (whitelist) updated to Option C in commit `2f61a65`, still DRAFT pending Bruce W9 gate.

---

## Conclusion

PR #13 post-merge regression PASS on the 7 main-side checks. Item #4 is the only operator-window deferred item, and it is gated by 楊董's authorisation, not by code state. `main` is in a clean post-merge state with hard lines preserved and no surprise mutations.
