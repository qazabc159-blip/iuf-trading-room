# BRUCE BLOCK #6 — Announcements / 重大訊息 Empty Root Cause Verify
**Date**: 2026-05-07  
**Verifier**: Bruce  
**Task**: B4 — announcements/重大訊息 page empty; verify root cause + propose fix  
**Time box**: 30min  

---

## TL;DR Verdict

**Path C + Path B-partial** — 兩條 data path 都有問題，原因不同：

| Path | Channel | State | Root Cause |
|------|---------|-------|------------|
| A (TWSE OpenAPI) | `/api/v1/companies/2330/announcements` | `{data:[]}` | TWSE t187ap46_L 回 HTML maintenance page (非 JSON) |
| B (FinMind News) | marketIntel.news in full-profile | `state=EMPTY, history=[]` | migration 0024 是 DRAFT，未 apply → tw_stock_news table 不存在 → runStockNewsSync 每次 skipped=table_not_migrated |

---

## Evidence: Live Probes (2026-05-07 ~11:00 TST)

### 1. Auth
```
POST /auth/login → HTTP 200  (cookie obtained)
```

### 2. TWSE OpenAPI announcements endpoint (Path A)
```
GET /api/v1/companies/2330/announcements?days=30  → {"data":[]}
GET /api/v1/companies/2330/announcements?days=90  → {"data":[]}
```

Direct TWSE upstream check:
```
curl -sL https://openapi.twse.com.tw/v1/opendata/t187ap46_L
→ HTTP 200 but returns HTML (maintenance/404 page, not JSON)
```

Root cause: `fetchTwse()` in `twse-openapi-client.ts` checks `!response.ok` only. When TWSE returns HTTP 200 with HTML body, `JSON.parse` fails → returns `[]`. Client-side filter then returns 0 rows. This is the transient vs structural ambiguity — TWSE may be up later, but the client has no fallback state signal.

### 3. FinMind News full-profile (Path B)
```
GET /api/v1/companies/2330/full-profile
→ marketIntel.news = {
    state: "EMPTY",
    history: [],
    sourceTrail: { datasetKey: "TaiwanStockNews", recordCount: 0, degradedReason: "no_rows" },
    experimental: true
  }
```

### 4. FinMind diagnostics
```
GET /api/v1/diagnostics/finmind
→ tokenPresent: true, quotaTier: "sponsor999", lastDataset: "TaiwanStockBalanceSheet"
```
FinMind token IS present and active. The issue is NOT token absence.

---

## Static Code Analysis

### Path A — TWSE OpenAPI (twse-openapi-client.ts)
- File: `apps/api/src/data-sources/twse-openapi-client.ts`
- Endpoint: `GET /api/v1/companies/:id/announcements` (server.ts:4916)
- Implementation: EXISTS and wired (Jason H4 PR, merged)
- Issue: `fetchTwse()` (line 134) treats HTTP 200 as success before checking Content-Type; when TWSE returns HTML, `JSON.parse` silently catches and returns `[]`
- Missing: No `Content-Type: application/json` check; no state signal to frontend when TWSE is down

### Path B — FinMind TaiwanStockNews (market-intel-finmind-sync.ts)
- Function: `runStockNewsSync()` (line 572) — EXISTS and wired to 30min scheduler
- Scheduler: `runMarketIntelNewsTick()` (server.ts:6965) — EXISTS
- DB table: `tw_stock_news` — defined in `0024_finmind_market_intel.DRAFT.sql`
- Migration status: **DRAFT only** — file is `0024_finmind_market_intel.DRAFT.sql`, NOT promoted to `.sql`
- Consequence: `tableExists("tw_stock_news")` returns `false` → every tick returns `skipped=table_not_migrated` → 0 rows ever ingested
- server.ts:3995: `{ key: "TaiwanStockNews", implemented: false, blocker: "freeze_no_news_feature" }` — explicitly marked NOT implemented in dataset registry

### Migration file status
```
packages/db/migrations/0024_finmind_market_intel.DRAFT.sql  ← DRAFT (never applied)
packages/db/migrations/0024_finmind_market_intel.down.sql   ← rollback exists (awaiting promote)
```

No `0024_finmind_market_intel.sql` (applied form) exists.

---

## Root Cause Summary

### B4-A: TWSE Announcements empty
- **Root cause**: TWSE OpenAPI t187ap46_L currently returns HTTP 200 + HTML body (maintenance/offline state). The client's `fetchTwse()` JSON.parse fails silently → `[]`.
- **Type**: TRANSIENT infrastructure issue (TWSE upstream) + STRUCTURAL gap (no Content-Type guard / no state surfacing)
- **Verdict**: `BLOCKED_TWSE_UPSTREAM_HTML_RESPONSE` (transient) + structural: client needs Content-Type check to distinguish "no data" vs "TWSE offline"

### B4-B: FinMind News empty
- **Root cause**: Migration `0024` is DRAFT — table `tw_stock_news` has never been created in production DB. Scheduler runs every 30min but always exits `skipped=table_not_migrated`.
- **Type**: STRUCTURAL — `BLOCKED_NOT_MIGRATED`
- **Verdict**: `BLOCKED_MIGRATION_NOT_PROMOTED` — cannot ingest until Mike audits + Elva promotes 0024

---

## Effort Estimates

| Fix | Owner | Files | Effort | Risk |
|-----|-------|-------|--------|------|
| F1: Promote migration 0024 DRAFT → apply | Mike audit → Elva promotes | `0024_finmind_market_intel.DRAFT.sql` → rename + `migrate.ts` | 15min | LOW — all tables have IF NOT EXISTS |
| F2: Add Content-Type guard to fetchTwse() | Jason | `twse-openapi-client.ts` line 153 | 10min | LOW |
| F3: Surface TWSE state in announcements response (BLOCKED vs EMPTY) | Jason | `server.ts:4916` handler | 20min | LOW |
| F4: Flip server.ts:3995 TaiwanStockNews implemented=true (after F1) | Jason | `server.ts:3995` | 5min | LOW |

**F1 is the unblocking fix** — without 0024 applied, FinMind news ingest never runs.  
F2+F3 fix the silent failure mode for TWSE announcements.

---

## Frontend Display Recommendation

### Current state (both channels empty)
Frontend should show:
- `重大訊息` section: `state = BLOCKED_TWSE_UPSTREAM` or `state = EMPTY` (honest), NOT fake entries
- FinMind news widget: `state = BLOCKED_MIGRATION_NOT_PROMOTED` (if Codex surfaces state), NOT empty list that looks like "no news"

### After F1 (migration applied)
- FinMind news will start ingesting on next 30min tick if `FINMIND_API_TOKEN` present (confirmed present: sponsor999 tier)
- Backfill: `runStockNewsSync` pulls last 24h incremental per tick; historical backfill would need manual trigger with wider date range
- State will become `LIVE` when first rows land

### After F2+F3 (TWSE guard)
- When TWSE is online: announcements populate from TWSE OpenAPI (free, no auth)
- When TWSE offline: response returns `{ data: [], state: "BLOCKED_TWSE_UPSTREAM" }` — honest

---

## Stop-line Check
- 0 functional code changes made (read-only audit)
- 0 strategy-engine / frontend / risk-engine touched
- 0 secrets exposed
- 0 production writes

---

## Is-Deploy-Ready / Can-Close Assessment

| Question | Answer |
|----------|--------|
| Can deploy as-is? | YES — current state is EMPTY/BLOCKED, not broken; no P0 |
| Can close B4? | NO — requires F1 (migration promote) to unblock FinMind news |
| TWSE announcements closeable? | PARTIAL — transient upstream + structural client fix needed |
| Frontend must show BLOCKED? | YES — must not show empty list as if "no news exists" |

---

## Recommended Actions (priority order)

1. **[Mike]** Audit 0024 DRAFT migration — all 4 tables have IF NOT EXISTS, quarantine bins present, upsert keys correct → should be APPROVE
2. **[Elva]** Promote 0024 DRAFT → apply (rename + add to migrate.ts run sequence)
3. **[Jason]** Add Content-Type check to `fetchTwse()` + surface BLOCKED state in announcements handler
4. **[Codex/Jim]** Surface `state` from news/announcements API in frontend — do not show empty list without state label
5. **[Bruce]** Round 2 smoke after F1+F3 land to confirm `tw_stock_news` rows appear after first scheduler tick

---

*Evidence generated by Bruce (verifier-release-bruce) — read-only production probe + static code analysis*  
*No functional files modified. No secrets accessed.*
