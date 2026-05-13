# Jason — LLM Brief Heading Fix Evidence
## Date: 2026-05-13
## BUG_003: AI 簡報英文 heading → isEnglishHeavy() → fallback text

---

## Root Cause

Two LLM call paths in `openalice-pipeline.ts` for daily brief generation:

1. **OpenAlice device path** (`generateDailyBrief`): `instructions` string was English ("Generate a structured daily brief..."). LLM produces English headings ("Market Overview", "Technical Analysis", "Risk Alert").
2. **Direct path** (`generateDirectDailyBriefDraft`): Prompt said 繁體中文 but schema example was generic `{ "heading": "章節標題" }` without explicit prohibition.

Frontend `cleanExternalHeadline(section.heading)` in `apps/web/app/briefs/page.tsx:500` runs `isEnglishHeavy()` on the heading. English-heavy headings return fallback text "消息文字尚未完成中文整理；保留來源紀錄，不納入正式判讀。" → "AI 簡報沒頭沒腦".

Strategy brief (`openalice-strategy-brief.ts`) had Chinese heading examples but no explicit prohibition rule.

---

## Fixes Applied

### 1. `apps/api/src/openalice-pipeline.ts` — `generateDailyBrief()` instructions

Rewrote `instructions` from English to Chinese with explicit rules:
- Added: 「所有 heading 欄位必須使用繁體中文，禁止 "Market Overview" / "Technical Analysis" / "Risk Alert" / "Strategy Observation" / "Summary" 等英文標題」
- Added: heading 範例列表

### 2. `apps/api/src/openalice-pipeline.ts` — `generateDirectDailyBriefDraft()` prompt

Added explicit heading prohibition + heading examples to hard rules.
Updated schema example from generic `{ "heading": "章節標題" }` to concrete Chinese heading examples.

### 3. `apps/api/src/openalice-pipeline.ts` — `sanitizeBriefHeading()` (NEW)

Backend post-process guard added before section validation in `parseDirectBriefPayload`:
- Maps known English headings → canonical Chinese equivalents
- Falls back to "今日市場簡報" for unrecognised English-heavy headings (latin >= 8 AND latin > cjk)
- Logs warning when fallback triggered (visible in Railway logs)

### 4. `apps/api/src/openalice-strategy-brief.ts` — prompt hard rules

Added explicit Chinese heading prohibition and examples to `buildGeneratorPrompt()`.

### 5. `apps/api/src/openalice-strategy-brief.ts` — `sanitizeStrategyHeading()` (NEW)

Same post-process guard applied to strategy brief section parsing in `generateStrategyBrief()`.

---

## isEnglishHeavy() Analysis

Current threshold: `latin >= 16 && latin > Math.max(8, cjk * 2)`

- "Market Overview" = 13 alpha chars → `latin=13 < 16` → NOT triggered (heading passes through as-is, displays English)
- "Market Overview and Technical Analysis" = 36 alpha chars → triggered → fallback text shown
- "TAIEX 漲跌幅觀察" = 5 alpha chars → `latin=5 < 16` → NOT triggered (safe, mixed text)
- "KGI 報告顯示" = 3 alpha chars → NOT triggered (safe)

Backend sanitizer uses a lower threshold (latin >= 8) to catch even short English headings before they reach the frontend. Frontend `isEnglishHeavy` is NOT modified (apps/web is forbidden).

---

## Tests

- `apps/api/src/openalice-pipeline.test.ts`: 31/31 PASS (no regressions)
- `npx tsc -p apps/api/tsconfig.json --noEmit`: 0 errors
- `npx tsc -p apps/web/tsconfig.json --noEmit`: 0 errors
- `npx tsc -p packages/contracts/tsconfig.json --noEmit`: 0 errors
- NOTE: `tests/ci.test.ts` has pre-existing ERR_REQUIRE_CYCLE_MODULE on main (known issue per Jason memory)

---

## Files Changed

- `apps/api/src/openalice-pipeline.ts` — prompt rewrites + sanitizeBriefHeading()
- `apps/api/src/openalice-strategy-brief.ts` — prompt hard rule + sanitizeStrategyHeading()

## Files NOT Changed

- `apps/web/*` — frontend forbidden
- `packages/contracts/*` — no schema change
- `apps/api/src/risk-engine.ts` — not touched
- `apps/api/src/broker/*` — not touched

---

## Post-Deploy Retry Steps (Bruce to execute)

After this PR deploys to Railway:

1. Get Owner session cookie:
   ```
   POST https://api.eycvector.com/auth/login
   { "email": "qazabc159@gmail.com", "password": "qazabc159" }
   ```

2. Reject stale 5/13 brief draft (if exists):
   ```
   GET https://api.eycvector.com/api/v1/content-drafts?limit=5
   → find draft with targetEntityId="2026-05-13" AND status != "rejected"
   POST https://api.eycvector.com/api/v1/content-drafts/{id}/reject
   ```

3. Fire 5/13 brief regeneration:
   ```
   POST https://api.eycvector.com/api/v1/internal/openalice/brief/fire-now
   { "date": "2026-05-13" }
   ```

4. Wait ~30-60s, then verify:
   ```
   GET https://api.eycvector.com/api/v1/briefs?date=2026-05-13
   → status="published", sections[].heading 全為中文
   ```

5. Check Railway logs for any `[pipeline] brief heading English fallback:` warnings (should be absent if prompt fix works; present if sanitizer caught a regression).

---

## Hard-Line Status

- no manual force-approve: CLEAR
- no broker code: CLEAR
- no contracts: CLEAR
- no frontend (apps/web/*): CLEAR
- lane boundary maintained: CLEAR
