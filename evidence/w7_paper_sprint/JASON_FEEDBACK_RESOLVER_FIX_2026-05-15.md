# Jason — Feedback Resolver Fix (Pete B1 Blocker)
Date: 2026-05-15 16:00 TST
Branch: fix/api-recommendation-feedback-real-resolver-2026-05-15

## Problem
POST /api/v1/recommendations/:id/feedback used getMockRecommendationById() as its resolver.
Real synthesized IDs (rec_3707_20260515 etc.) from PR #517 never matched mock IDs → always 404.

## Fix
server.ts feedback handler now calls getOrFetchRecommendations() (same 60s cache used by /today and /:id)
then getRecommendationById(items, id). 404 message updated to "推薦項目已過期或不存在".

## Files Changed
- apps/api/src/server.ts — feedback POST handler resolver swapped
- tests/ci.test.ts — REC12 added; getRecommendationById added to import

## Test Results
REC1 ✔ REC2 ✔ REC3 ✔ REC4 ✔ REC5 ✔ REC10 ✔ REC11 ✔ REC12 ✔

## Build
contracts build: GREEN
api build (tsc): GREEN

## Lane Boundary
No contracts changed. No risk/broker/frontend touched. Pure strategy lane.
