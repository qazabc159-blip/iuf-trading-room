# Jason Cycle 16 — TWSE Announcement Ingest (P1-B Backlog)
Date: 2026-05-14 ~06:19 TST

## Summary

Implemented TWSE OpenAPI announcement ingest job to populate `tw_announcements` table (migration 0030, already promoted by PR #446/Mike SAFE_TO_MERGE).

## New Capability

- `apps/api/src/jobs/twse-announcement-ingest.ts` — fetches TWSE OpenAPI `/opendata/t187ap46_L` (all material announcements, no auth), upserts into `tw_announcements` via `ON CONFLICT DO NOTHING`
- Scheduler wired in `server.ts`: 60-min poll, fires 09:00–15:00 TST weekdays; startup catch-up 45s after boot when in trading hours
- Source dedup via `(COALESCE(ticker_symbol,''), announced_at, title_hash)` unique index (migration 0030)
- Kill switch: `TWSE_ANNOUNCEMENT_INGEST_KILL_SWITCH=true`

## Query Upgrades

Both announcement routes now prefer `source_url` (populated by ingest) over constructed MOPS URL:
- `/api/v1/market-intel/announcements` — `COALESCE(a.source_url, <mops-url>)` (was `NULL::text AS url`)
- `/api/v1/announcements` — same fix
- `news-ai-selector.ts` `fetchRawNewsRows()` — same fix (tw_announcements query now returns real URLs)

## Files Changed

- `apps/api/src/jobs/twse-announcement-ingest.ts` (new — 260 lines)
- `apps/api/src/jobs/twse-announcement-ingest.test.ts` (new — 12 tests)
- `apps/api/src/server.ts` (+1 import, +scheduler block ~45 lines, +2 COALESCE patches)
- `apps/api/src/news-ai-selector.ts` (+COALESCE url patch)

## Build / Test Results

- tsc: 0 errors
- `node --test ./apps/api/src/jobs/twse-announcement-ingest.test.ts`: 12/12 PASS
- `node --test ./tests/ci.test.ts`: 251/251 PASS (no regression)

## Lane Boundary

- Only modified strategy-adjacent files: jobs/, server.ts (ingest block), news-ai-selector.ts
- Did not touch: risk-engine.ts, broker/*, market-data.ts, apps/web/*
- No DB migration added (table created by PR #446 migration 0030)
- No destructive SQL (INSERT-only)

## Next Step

After deploy: verify `GET /api/v1/announcements` returns items with non-null `url` (next trading day 09:00–15:00 TST window when ingest fires).
