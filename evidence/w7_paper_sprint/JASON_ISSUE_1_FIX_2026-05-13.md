# JASON_ISSUE_1_FIX — News Announcements Fix
**Date**: 2026-05-13
**PR**: #435 `fix/api-news-announcements-issue1-2026-05-13`
**Commit**: 0437f65
**Status**: OPEN — awaiting CI + Bruce merge

## Root Cause
`tw_announcements` 30-day window yields only 6 official posts (楊董 saw 1 台泥).
- `limit` default was 10, max 24
- `isMarketWideNews()` blocked `moneydj`/`cmoney`/財報 news
- FinMind fallback only fired when `rows.length < limit` (≤10) — never fired when 6 rows present

## Changes (server.ts only — 3 edits, 9 added / 87 deleted)
1. `limit` default: 10 → 30, max: 24 → 50
2. `isMarketWideNews()`: removed moneydj/cmoney from blocked list; removed company report (財報/EPS/營收/法說) over-filtering; retained only true retail noise block (達人/老師/存股/同學會 etc.)
3. FinMind fallback threshold: `rows.length < limit` → `rows.length < 15`

## Verify (after deploy)
```
GET https://api.eycvector.com/api/v1/market-intel/announcements
```
- `items.length > 1`
- `source: "finmind_stock_news"` or `"mixed"` when tw_stock_news has data
- moneydj / cmoney / 財報 news appear in items

## Build
- tsc: 0 errors (apps/api)
- Lane: 1 file changed (server.ts, announcements route only)
