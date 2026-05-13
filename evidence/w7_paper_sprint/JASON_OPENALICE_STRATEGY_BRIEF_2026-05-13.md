# Jason: OpenAlice Strategy-Level Brief — Axis 4

**Date**: 2026-05-13
**PR Branch**: `feat/api-openalice-strategy-brief-2026-05-13`
**Owner**: Jason

---

## 1. What Was Built

**New module**: `apps/api/src/openalice-strategy-brief.ts`

- `generateStrategyBrief(input)` — main entry point. Collects sources, calls OpenAI (gpt-4o-mini via OPENAI_MODEL env), runs hallucination check + red wording guard, stores result in-memory + optional DB.
- `collectStrategyBriefSourcePack(tradingDate, workspaceId)` — assembles:
  - cont_liq Period 1 daily yamls (today + last 5 days from `reports/trading_room/cont_liq_period1_daily/`)
  - Strategy snapshots v47 via `fetchStrategySnapshot()` (cont_liq_v36 / strategy_002 / strategy_003)
  - FinMind institutional buysell from DB (`tw_institutional_buysell` table)
  - OHLCV for basket stocks + 0050 (`companies_ohlcv` table)
- `parseContLiqYaml(raw)` — hand-rolled minimal yaml parser (no new dep) extracts basket / kill_switch / alert_triggers
- `isStrategyBriefWindow()` / `getTstDate()` / `getTstHHMM()` — TST time helpers
- `getStrategyBriefWithStaleness()` — read endpoint with 26h staleness
- Hallucination check: 2nd OpenAI call with ground-truth numeric list vs generated text
- Red wording guard: regex set blocks buy/sell/進場/賣出/目標價/approved/勝率
- Source-only fallback: publishes 2-section brief when AI unavailable
- DB persistence: `CREATE TABLE IF NOT EXISTS strategy_briefs` (additive, no migration file)

**Routes added to `apps/api/src/server.ts`**:
- `POST /api/v1/openalice/strategy-brief/generate` (Owner) — manual generate
- `GET /api/v1/openalice/strategy-brief/latest` (Owner) — latest published

**Scheduler added to `startSchedulers()`**:
- Every 15min, gates on `isStrategyBriefWindow()` (14:00–14:30 TST)
- Idempotency: skips if `tradingDate` already published

**New test file**: `apps/api/src/__tests__/strategy-brief.test.ts`

Tests (SB0–SB8, 9 cases):
- SB0: source pack shape correct
- SB1: prompt does NOT contain API key / password / person_id / FINMIND_API_TOKEN
- SB2: hallucination check catches fabricated numbers
- SB3: red wording blocks buy/sell/進場/目標價/勝率/approved
- SB4: empty source guard → BLOCKED_DATA_QUALITY
- SB5: source-only fallback publishes when AI unavailable
- SB6: parseContLiqYaml extracts basket / kill_switch / alerts correctly
- SB7: risk alert threshold distance logic correct (0.70pp to -10%, 5.70pp to -15%)
- SB8: isStrategyBriefWindow gates correctly on 14:00–14:30 TST

---

## 2. Build / Test Results

| Check | Result |
|---|---|
| `tsc --noEmit` (API project) | GREEN |
| `strategy-brief.test.ts` (9 tests) | 9/9 PASS |
| Related suites (33 tests: lab-snapshot + dashboard + brief-catchup + strategy-brief) | 33/33 PASS |
| Pre-existing failures (FI5, T05-*, A2/A3/D4/E2/F1/G3/S1) | NOT INTRODUCED by this PR — pre-existing |

---

## 3. Files Changed

- `apps/api/src/openalice-strategy-brief.ts` (NEW, 550 lines)
- `apps/api/src/__tests__/strategy-brief.test.ts` (NEW, 370 lines)
- `apps/api/src/server.ts` (+import block + 2 routes + scheduler entry)
- `evidence/w7_paper_sprint/JASON_OPENALICE_STRATEGY_BRIEF_2026-05-13.md` (this file)

---

## 4. Hard-Line Status

| Rule | Status |
|---|---|
| No broker.* / risk.ts / risk-engine.ts touched | PASS |
| No contracts edit | PASS |
| No migration file — CREATE TABLE IF NOT EXISTS only | PASS |
| No big OpenAlice pipeline core change (additive hook) | PASS |
| Hallucination check mandatory (2nd OpenAI pass) | PASS |
| No promote/demote wording ("approved"/"alpha confirmed") | PASS — blocked by RED_WORDING_PATTERNS |
| No manual force-approve (gate automatic) | PASS |
| No token leak in prompts (yaml scrubbed, only numerics passed) | PASS |
| Neutral tone ("觀察到"/"資料顯示") enforced in prompt | PASS |
| Data absent → BLOCKED_DATA_QUALITY (no fake) | PASS |
| No web/* touched | PASS |
| Lane boundary maintained | PASS |

---

## 5. Assumptions Made

- YAML dir for cont_liq is `reports/trading_room/cont_liq_period1_daily/` relative to monorepo root (matches Athena's actual filing path as seen in 2026-05-13.yaml).
- Strategy snapshot v47 contract files already in `apps/api/data/lab/strategy_snapshots/` (Railway-safe path, from PR #400).
- `OPENAI_MODEL` env var controls the model (default `gpt-4o-mini` per OPENAI_MODEL env in ai-reviewer).
- `strategy_briefs` DB table is additive; if Postgres CREATE fails (duplicate), in-memory store remains authoritative.
- Scheduler window 14:00–14:30 TST gives 30min buffer after 13:30 market close + FinMind sync time.

---

## 6. Not Done (by design)

- EC2 deploy — Elva's scope
- Merge to main — Bruce verify required
- Frontend consume of `/api/v1/openalice/strategy-brief/latest` — Jim's scope
