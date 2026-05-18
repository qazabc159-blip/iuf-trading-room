# 2026-05-18 PR-A Backend Blocker

Owner needed: Jason / Elva

## What is blocked

PR-A target is AI stock recommendations + AI selected news. Production currently does not meet Yang's acceptance criteria:

- `GET /api/v1/recommendations/today` returns 4 recommendation items, but Yang requires at least 5 visible real-backed stock cards.
- `GET /api/v1/ai-recommendations/v3` returns `404 no_v3_run_yet`.
- `GET /api/v1/market-intel/announcements?days=30&limit=20&scope=market` returns 0 items with `source=empty`.

## Why Codex frontend will not fake it

Frontend must not invent a fifth recommendation, fake a v3 run, or turn strategy ideas into AI stock recommendations. That would violate the product hardline: no mock/fake data pretending to be live.

## Next action for Jason / Elva

1. Materialize a production v3 run, or make the v1/v2 recommendation source reliably return 5+ real-backed cards.
2. Confirm each card includes entry, stop, TP1/TP2, reason, risk, data quality, source, and recommendation id.
3. Either populate official announcements or expose a clear source-empty reason and next run timestamp.

## Frontend fallback work

Codex is moving to frontend-owned PR-E while this blocker is open: direct route 404 fixes for EventLog, Portfolio Snapshot, ToolCenter, and UTA aliases.
