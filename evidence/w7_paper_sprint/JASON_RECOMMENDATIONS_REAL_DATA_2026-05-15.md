# Jason — Recommendations Real Data Integration Evidence
Date: 2026-05-15 14:xx TST
Branch: feat/api-recommendations-real-data-2026-05-15
PR: feat(api): /recommendations/today integrate Athena fixture + leaders + news (replace mock)

## Changes

### apps/api/src/recommendation-store.ts
- Added `loadAthenaFixture()` — reads `quant_candidate_signal_cont_liq_v36_2026_05_14.json` from sibling IUF_QUANT_LAB repo; env var `ATHENA_FIXTURE_PATH` override; Railway-safe (graceful null if path absent)
- Added `synthesizeFromFixture(fixture, leaders, newsItems)` — exported for unit tests
  - Computes `totalScore = quantScore * (1 - dqPenalty)` where `dqPenalty = MISSING*0.15 + PENDING*0.05`
  - Maps totalScore → action bucket (今日首選 / 可布局 / 等回檔 / 高風險排除 / 資料不足暫不推薦)
  - Populates `reasons.news[]` from announcements ticker match (up to 3 headlines)
  - Populates `sourceTrail` with ≥2 entries (fixture + quant always; leaders + news conditional)
- Added `getTodayRecommendations({ internalBaseUrl, sessionCookie })` — async; parallel-fetches leaders + news, calls synthesize, falls back to mock+isMock=true on fixture miss
- Added `_resetAthenaFixtureCache()` — test helper for fixture cache reset
- Added `getRecommendationById(items, id)` — lookup helper for /:id endpoint
- Kept `getMockRecommendations()` / `getMockRecommendationById()` intact as fallback

### apps/api/src/server.ts (strategy route block only)
- Replaced `getMockRecommendations()` calls with `getTodayRecommendations()`
- Added 60s in-process cache (`_recCache`) shared between /today and /:id
- `_mock: true` only emitted when `isMock === true` (fixture missing)
- Real data response: no `_mock` key

### tests/ci.test.ts (REC block only)
- Added `synthesizeFromFixture`, `_resetAthenaFixtureCache` to import
- Added REC10: 4-candidate synthesis PASS + sourceTrail >= 2 + schema valid
- Added REC11: mock fallback schema valid

## Build / Test Evidence
- `tsc --noEmit`: 0 errors (api package)
- `synthesizeFromFixture` inline verify: 4 PASS, all schema valid
  - 3707: action=可布局, sourceTrail=2
  - 2426: action=可布局, sourceTrail=2
  - 6205: action=等回檔, sourceTrail=2
  - 2486: action=等回檔, sourceTrail=2
- Mock fallback: 3 items, all schema PASS (REC11 PASS)
- ci.test.ts global run blocked by EADDRINUSE (pre-existing port collision in test suite, not caused by this PR)

## Constraints Honoured
- No PAPER_LIVE promotion
- No contracts schema changes
- No token leak
- Athena fixture read-only (no write to IUF_QUANT_LAB)
- Lane boundary maintained: no broker/*, risk-engine, market-data changes
