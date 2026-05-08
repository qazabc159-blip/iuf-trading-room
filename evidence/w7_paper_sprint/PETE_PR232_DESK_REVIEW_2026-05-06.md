# PR #232 Desk Review — Pete 2026-05-06

## 1. PR Intent
- Ingest 4 FinMind market-intel datasets: TaiwanStockDividend / TaiwanStockMarketValue / TaiwanStockPER (valuation) / TaiwanStockNews [EXPERIMENTAL]
- Corresponding sprint task: BLOCK #4 PR C (Athena spec §1 datasets 5/9/10/11)
- Base branch: main (verified — branch forks from `a0a57e3` fundamentals merge)

## 2. Diff Summary
- 26 files changed: +3879 / -72
- Core new: market-intel-finmind-sync.ts (758L), openalice-pipeline.ts (new 1066L), openalice-ai-reviewer.ts (+47), server.ts (+314)
- Migration: 0024 DRAFT.sql (165L) + down.sql (21L)
- Tests: market-intel-finmind-sync.test.ts (235L T1-T12), openalice-pipeline.test.ts (260L)
- Web: portfolio/page.tsx, briefs/page.tsx, paper-orders-api.ts (read-only additions), evidence PNGs

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [PASS] FINMIND_KILL_SWITCH toggling in diff = tests only (save/restore pattern correct)
- [PASS] No `place_order` / `submit_order` / `kgi.order.create` in diff
- [PASS] No `/order/create` call anywhere in diff
- [PASS] paper-orders-api.ts adds `listPaperFills()` (GET /api/v1/paper/fills only — read-only)
- [PASS] All new scheduler jobs are data-ingest only, no write-side broker touch

### B. Auth / Secret Hygiene
- [PASS] Two new internal endpoints (`/internal/openalice/pipeline/trigger`, `/internal/openalice/ai-reviewer/run-batch`) both gated via `requireOpenAliceAdmin(c)` which calls `c.get("session")`
- [PASS] `FINMIND_API_TOKEN` never logged — only boolean presence surfaced
- [PASS] No hardcoded API keys / tokens found in diff
- [PASS] No `person_id` / `userId` / `sessionId` leaked in log lines

### C. State / Schema Integrity
- [PASS] 0024 DRAFT.sql — all 4 tables use `IF NOT EXISTS`; zero destructive DDL
- [PASS] down.sql present — DROP IF EXISTS in correct reverse order (quarantine first, then main)
- [PASS] Upsert keys match spec: dividend (stock_id, year, dividend_type) / market_value (stock_id, date) / valuation (stock_id, date) / news (content_hash unique idx)
- [PASS] Migration marked DRAFT — code-side `tableExists()` guard emits DEGRADED (not throw) when table absent
- [PASS] No enum / state string changes to existing tables
- [PASS] No module-level mutable state introduced — all state is per-request or per-tick local

### D. PR Hygiene
- [PASS] Commit: `feat(api): finmind 4 market-intel datasets ingest (dividend / market-value / valuation / news)` — conventional commits OK
- [PASS] Evidence PNGs + manifest.json present
- [PASS] openalice-pipeline.ts, openalice-ai-reviewer.ts appear to be new files bundled into same PR — scope is wider than PR title implies (see finding below)
- [PASS] down.sql included

### E. IUF-Specific
- [PASS] No agent lane cross (Pete desk only, not modifying)
- [PASS] No governance bypass
- [PASS] No KGI `/order/create` call
- [PASS] No redaction violation

## 4. Findings — Priority Ranked

### Blocker
None.

### Suggestions

1. **Dividend cadence guard uses `isWeekendTriggerDay()` (Sat OR Sun) — Athena spec says Sunday only**
   - Location: server.ts `runMarketIntelDividendTick`, market-intel-finmind-sync.ts `isSundayTriggerDay()` is exported but never called for dividend
   - Athena spec §1: "Dividend: weekly Sunday 22:00 TST"
   - As-is: dividend syncs on both Saturday AND Sunday
   - Risk: low (double run is idempotent; no extra API cost), but spec drift
   - Fix: swap guard to `isSundayTriggerDay()` in `runMarketIntelDividendTick`

2. **PR scope includes openalice-pipeline.ts (1066L) and openalice-ai-reviewer.ts — wider than "4 market-intel datasets" title**
   - These appear to be the OpenAlice autonomous pipeline (P0-C main axis) bundled with PR C
   - Not a blocker since both are new files with no write-side touches, but Elva should confirm this was intentional bundling vs separate PR
   - Risk: review surface area increases; if openalice pipeline has a bug the 4-dataset work gets reverted together

3. **content_hash formula: migration comment says `sha256(title+url+published_at)`, code uses `sha256(title+url+date)` (FinMind `date` field)**
   - These are equivalent (FinMind `date` IS published_at), but the inconsistent naming could confuse a future reader
   - Fix: align comment in migration to say `sha256(title + url + date/published_at)` or vice versa

4. **staleDays for dividend set to 10 — but weekly cadence means legitimate gap is 7 days**
   - `queryMarketIntelDatasetStats("tw_dividend", 10)` — would show LIVE even if 10 days stale
   - Fix: staleDays=8 or 9 gives 1-2 day tolerance for a weekly job; 10 is loose

### Nits

1. `void recordFinMindRequest;` suppression comment could be clearer — "imported for side-effect tracking via withFinMindRetry" is accurate but unusual pattern
2. `url` column in `tw_stock_news` is nullable (TEXT) — acceptable per spec but a missing URL means the content_hash falls back to `sha256(title+date)` which reduces collision resistance; fine for now, worth noting in schema comment

### Praise
- Graceful DEGRADED fallback on every path (table missing, no DB, no token, kill-switch) is exemplary — zero throw paths
- sha256 dedup for news using Node crypto (no external dep) is the right call
- down.sql drop order (quarantine first, then main) is correct and consistent with #224/#226 pattern
- `recordFinMindRequest` quota tracking inherited correctly via `withFinMindRetry` — quota safety proven by chain
- 12 tests cover killswitch/no-token/no-db guard paths for all 4 datasets

## 5. Verdict

[x] NEEDS_FIX — 0 blockers; 1 spec-drift suggestion (dividend Sunday vs weekend guard)

Can be marked ready after owner confirms dividend cadence intent (fix or accept deviation).
The openalice-pipeline bundling should get Elva's explicit ACK.
All other findings are low-risk.

## 6. Suggested Owner for Fixes
- Suggestion #1 (dividend cadence) — Jason: 1-line guard swap `isWeekendTriggerDay` → `isSundayTriggerDay`
- Suggestion #2 (openalice bundling scope) — Elva: confirm intentional or split
- Suggestion #3 (comment alignment) — Jason: nit, can fix in same commit as #1
- Suggestion #4 (staleDays=10) — Jason: change to 8

## 7. Re-review Required
NO — if Jason fixes Suggestion #1 (single-line guard swap), can proceed to ready without re-review; Elva spot-check the cadence guard only.

---
Reviewer: Pete
Date: 2026-05-06
Sprint: W7 Paper Sprint
