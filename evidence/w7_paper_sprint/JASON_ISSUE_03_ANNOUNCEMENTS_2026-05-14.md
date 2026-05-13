# ISSUE_03 — Announcements Route 404 + news_recent stale date fix

**Date**: 2026-05-14  
**Branch**: fix/api-announcements-route-news-recent-issue03-2026-05-14  
**Author**: Jason (backend strategy)

## Root Cause

### A. `/api/v1/announcements` → 404
Route did not exist. Frontend announcements panel called this path expecting `{ items, total, asOf }`. Only `/api/v1/market-intel/announcements` and `/api/v1/companies/:id/announcements` existed.

### B. Dashboard `news_recent` only showed 5/12 items (all yesterday)
`fetchNewsPanel()` in `dashboard-snapshot-aggregator.ts` queried only `tw_stock_news`, ordered by `fetched_at DESC`. FinMind ingest ran on 5/12 → all rows had `fetched_at = 5/12` → panel displayed 10 items all dated 5/12. `tw_announcements` (with real today timestamps from TWSE) was not included.

## Fix

### A. Added `GET /api/v1/announcements` (`server.ts`)
- Auth: `READ_DRAFT_ROLES` (Owner / Admin / Analyst)
- Primary: `tw_announcements` last 30 days, `announced_at DESC`, limit 50
- Fallback: `tw_stock_news` supplements when `tw_announcements < 15 items` (same threshold as `/market-intel/announcements`)
- Response shape: `{ items: [...], total: N, asOf: "YYYY-MM-DD" }`

### B. Fixed `fetchNewsPanel()` (`dashboard-snapshot-aggregator.ts`)
- Now queries `tw_announcements` first (real TWSE timestamps → today's data shows immediately)
- Supplements with `tw_stock_news` when tw_announcements < 10 items
- Deduped by `(ticker, title)` key
- Returns top 10 items merged, today-first ordering

## Files Changed
- `apps/api/src/server.ts` — +118 lines (new route)
- `apps/api/src/dashboard-snapshot-aggregator.ts` — +80 lines, -22 lines (fetchNewsPanel rewrite)

## Build Result
- contracts build: PASS (tsc 0 errors)
- api build: PASS (tsc 0 errors)
- CI test: pre-existing ERR_REQUIRE_CYCLE_MODULE on main (not caused by this change)

## Lane Boundary
- No broker / contracts / migration / token leak
- No apps/web/* changes
- Surgical: only strategy lane files touched (server.ts strategy-adjacent route, dashboard aggregator)
