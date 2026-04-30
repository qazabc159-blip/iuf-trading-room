# Jason W7 D3 + D5 + Theme Cron Closeout

**Date**: 2026-04-30
**Branch**: `jason/w7-d3-d5-d-themecron-2026-04-30`
**Lane**: backend-strategy (Jason)

---

## Delivered

### D3 — OHLCV Schema + Endpoint

**Migration** `packages/db/migrations/0017_companies_ohlcv.sql`:
- Table `companies_ohlcv`: companyId / workspaceId / dt (DATE) / interval / open / high / low / close / volume (BIGINT) / source ('mock'|'kgi'|'tej')
- UNIQUE index on (company_id, dt, interval)
- Idempotent (IF NOT EXISTS)

**Drizzle schema** `packages/db/src/schema.ts`:
- Added `companiesOhlcv` table export
- Added `bigint` + `date` Drizzle imports
- Also added `dailyThemeSummaries` table export (migration 0018)

**Module** `apps/api/src/companies-ohlcv.ts`:
- `generateMockOhlcv(companyId)` — mulberry32 PRNG seeded by companyId hash, produces 200 trading-day bars (skip Sat/Sun), deterministic
- `getCompanyOhlcv(companyId, session, params)` — DB query → mock fallback; 5-minute Redis cache (fail-open)
- `getCompanyOhlcvBulk(ids, session, params)` — parallel per-company fetch, keyed result map

**Routes** added to `apps/api/src/server.ts`:
- `GET /api/v1/companies/:id/ohlcv?from=YYYY-MM-DD&to=YYYY-MM-DD&interval=1d`
- `GET /api/v1/companies/ohlcv/bulk?ids=a,b,c&from=...&to=...&interval=1d` (≤50 ids per request)

### D5 — Lightweight Charts Backend Prep

D5 is fulfilled by D3: the OHLCV endpoint is ready for Jim to wire `lightweight-charts`. The bulk endpoint handles watchlist use cases. Cache layer (5-min TTL Redis) is already wired.

### OpenAlice Daily Theme Cron

**Migration** `packages/db/migrations/0018_daily_theme_summaries.sql`:
- Table `daily_theme_summaries`: workspaceId / dt (TEXT 'YYYY-MM-DD') / summary_md / theme_label / source_event_count / generated_by
- UNIQUE index on (workspace_id, dt) — one summary per workspace per day
- Idempotent (IF NOT EXISTS)

**Producer** `apps/worker/src/jobs/daily-theme-summary-producer.ts`:
- Calls OpenAI gpt-5.4-mini via native Node 20 `fetch` (no SDK dependency added)
- Graceful fallback: if OPENAI_API_KEY absent or call fails → rule-template summary (always succeeds)
- Idempotent: skips if today's summary already exists
- Cost: ~$0.0003/call at gpt-5.4-mini pricing (well under $0.005/day budget)
- Upsert uses Drizzle `onConflictDoUpdate` for safe re-runs

**Wired** into `apps/worker/src/worker.ts`:
- New import + `runDailyThemeSummaryProducer` called on startup + every 4h
- Worker is idempotent: the producer itself skips if already ran today
- 4h interval so if worker restarts during business day, it still runs before EOD

**Route** added to `apps/api/src/server.ts`:
- `GET /api/v1/themes/daily/:date` — returns { id, dt, summaryMd, themeLabel, sourceEventCount, generatedBy, createdAt }
- 404 when no summary for that date; mock fallback in memory mode

---

## Test Coverage

**File**: `apps/api/src/companies-ohlcv.test.ts` — 8 unit tests (T1-T8)

| Test | Description | Status |
|------|-------------|--------|
| T1 | generateMockOhlcv returns exactly 200 bars | logic |
| T2 | generateMockOhlcv is deterministic (same seed → same output) | logic |
| T3 | bars in ascending date order | logic |
| T4 | OHLCV invariants (high >= max(o,c), low <= min(o,c)) | logic |
| T5 | no weekend bars | logic |
| T6 | getCompanyOhlcv in memory mode returns mock bars | integration-light |
| T7 | from/to filter applied correctly | integration-light |
| T8 | getCompanyOhlcvBulk returns keyed map for all ids | integration-light |

Run: `node --test --import tsx/esm apps/api/src/companies-ohlcv.test.ts`

---

## Files Modified / Created

| File | Change |
|------|--------|
| `packages/db/migrations/0017_companies_ohlcv.sql` | NEW |
| `packages/db/migrations/0018_daily_theme_summaries.sql` | NEW |
| `packages/db/src/schema.ts` | ADD companiesOhlcv + dailyThemeSummaries + bigint/date imports |
| `apps/api/src/companies-ohlcv.ts` | NEW |
| `apps/api/src/companies-ohlcv.test.ts` | NEW |
| `apps/api/src/server.ts` | ADD imports + 3 new routes |
| `apps/worker/src/jobs/daily-theme-summary-producer.ts` | NEW |
| `apps/worker/src/worker.ts` | WIRE import + schedule |

---

## Hard Lines Status

| Hard Line | Status |
|-----------|--------|
| No KGI SDK import | PASS |
| OPENAI_MODEL = gpt-5.4-mini | PASS (locked in producer file) |
| MARKET_AGENT_HMAC_SECRET env-only | PASS (not touched) |
| Migrations idempotent (IF NOT EXISTS) | PASS |
| Cache failure non-blocking (W7 #11) | PASS (all Redis calls wrapped in try/catch + timeout race) |
| No KGI import in apps/api | PASS |
| No /order/create touch | PASS |
| Kill-switch untouched | PASS |

---

## Assumptions

1. `bigint` and `date` are available in the installed `drizzle-orm/pg-core` version (^0.44.5 has both).
2. The worker's `package.json` does NOT need openai SDK — native `fetch` is used (Node 20 has it built-in).
3. `dailyThemeSummaries` `onConflictDoUpdate` uses compound target `[workspaceId, dt]` — this requires the UNIQUE constraint to be defined on those two columns (migration 0018 sets it).
4. The bulk route `/api/v1/companies/ohlcv/bulk` doesn't conflict with `/api/v1/companies/:id/ohlcv` in Hono because the path depth differs (the `:id/ohlcv` pattern requires exactly `id=ohlcv` + segment `bulk` not found).
5. `source_event_count` is hardcoded to 0 for now — `market_events` table has no Drizzle schema yet (registered via raw SQL migration 0016). A future ticket can wire the actual count when market_events gets a Drizzle entry.

---

## Next Steps for Elva / Jim

1. **Jim**: Wire `GET /api/v1/companies/:id/ohlcv` into `lightweight-charts` component — data shape is `OhlcvBar[]` with `{ dt, open, high, low, close, volume, source }`.
2. **Bruce**: Run migrations 0017 + 0018 on prod Railway DB. Commands: `psql $DATABASE_URL -f packages/db/migrations/0017_companies_ohlcv.sql && psql $DATABASE_URL -f packages/db/migrations/0018_daily_theme_summaries.sql`
3. **Elva**: Add `OPENAI_API_KEY` to Railway worker environment vars if not already present (the producer gracefully falls back if absent).
