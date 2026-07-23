# Bruce Prod Verify — 5-Merge Batch (#1348 / #1350 / #1351 / #1352 / #1353)

- Verifier: Bruce (verifier-release lane)
- Verify window: 2026-07-23 (四) 21:3x-21:5x TST
- Target buildCommit: originally `37d7068b` (#1352); **scope expanded mid-task by Elva** — #1353 (AI 投研晨報 newspaper redesign) merged during this verify pass (`931723ac`). Waited for deploy queue to converge to `931723ac` before running item 6.

## 0. Deploy confirmation

- `gh run watch 30011454312` (Deploy to Railway, headSha=37d7068b) → all jobs green (`deploy (api)` 3m53s, `deploy (web)` 2m45s).
- `GET https://api.eycvector.com/health` →
  ```json
  {"status":"ok","buildCommit":"37d7068b1f1ed873f7a74ac124e725d873b7000a","deploymentId":"e8e0dbac-db0f-471c-b47f-de85b5b9ce04",...}
  ```
- `railway status` confirms same `deploymentId=e8e0dbac-db0f-471c-b47f-de85b5b9ce04`, service Online.
- **All 4 original merges (#1348 `2a2de354` / #1350 `5a36fe9d` / #1351 `b68f3e73` / #1352 `37d7068b`) are live in prod.**
- **#1353 scope addition**: `gh run watch 30012336406` (Deploy to Railway, headSha=931723ac) → green. `GET /health` → `buildCommit=931723ac9a82d37b30818ba4254fbe7ded342f6c`, `deploymentId=cc0f9525-a9f5-443e-8caf-5339ac44da76`. **#1353 is live in prod.**
- Note: #1352's own CI Validate run shows `completed failure` (Playwright P0 Smoke — `jim_home_heatmap_mode_toggle` + `jim_home_ledger_rsc` heatmap-tile-count assertions) while its **Deploy to Railway run succeeded**. This is the same pre-existing homepage-heatmap flake documented repeatedly in session_handoff.md ("Playwright 紅確認=無關 flake 照 merge") — unrelated to #1352's postgres `.rows` fix content, not a new blocker.

## Result summary (PASS/FAIL/未驗)

| # | Item | Result |
|---|---|---|
| 1 | #1348 法人 state 誠實欄位 (live path) | PASS |
| 1b | #1348 fallback 態 (盤中觸發) | 未驗 — 盤後 FinMind 已發布無法觸發 fallback，需明早 09:00-14:00 窗補驗 |
| 2 | #1352 orchestrator 開機無新錯 + v3 回應形狀 | PASS |
| 3 | #1350 首頁/戰情台盤後渲染 + 零 console error | PASS |
| 3b | #1349 bench 特徵化數字可觀測性 | PASS (CI golden snapshot 綠；PR-2 本身宣告 zero-consumer/zero-behavior-change，前端無新可觀測面) |
| 4 | #1351 純新增檔案 + dry-run | PASS |
| 5 | 全站快掃 5 頁 200 + 零 console error | PASS |
| 6 | #1353 AI 投研晨報改版 (真上版式 + 盤後誠實 + 零 console error + mobile 390px 零溢出) | PASS |

## 1. #1348 法人 state 誠實欄位

Owner session login (`POST https://api.eycvector.com/auth/login`, qazabc159@gmail.com) → 200, cookie `iuf_session` obtained.

```
GET https://api.eycvector.com/api/v1/market/institutional-summary/finmind
→ HTTP 200
{"asOf":"2026-07-23T13:30:00+08:00","totalNet":127809181,
 "institutions":[...6 rows: Foreign_Investor/Investment_Trust/Dealer_self/Dealer/Foreign_Dealer_Self/Dealer_Hedging...],
 "topNetBuy":[...],"topNetSell":[...],
 "source":"finmind","staleAfterSec":60,
 "dataDate":"2026-07-23","isFallback":false,"state":"live"}
```

- `state="live"`, `isFallback=false`, `dataDate="2026-07-23"` (today, matches `asOf` date) — three fields present and semantically self-consistent (live + not-fallback + today's date all agree).
- Route logic confirmed at `apps/api/src/server.ts:20907-20940` — `state:"live"` only set when `getFinMindInstitutionalSummary()` returns a non-null result; falls to `state:"unavailable"` on empty/no-token. `isFallback`/`dataDate` are pass-through fields from `finmind-aggregate-client.ts`'s intraday-fallback logic (the actual #1348 change), not independently faked.
- **未驗項**: fallback path (`isFallback=true`, using prior trading day's value) cannot be exercised right now because FinMind has already published today's live data post-market. Needs re-check tomorrow during the 09:00–14:00 TST window when intraday fallback is the live code path.

## 2. #1352 orchestrator (no real AI generation triggered)

- Boot log (`railway logs --service api`, post-restart at 13:33:31Z): no new errors tied to ai-recommendations/orchestrator. Only expected off-hours warnings present:
  - `[kgi-subscription-manager] gateway status probe network error: ... timeout` — expected, EC2 gateway is EventBridge-scheduled off after 14:10 TST (now 21:3x).
  - `subscribe_tick_error` / `subscribe_bidask_error` `KgiQuoteUnreachableError` — same cause, pre-existing pattern, not new.
  - `[twse-openapi-client] TPEX daily_close_quotes fetch failed: terminated` — known off-hours upstream flakiness, unrelated to #1352.
- `GET /api/v1/ai-recommendations/v3` → HTTP 200, `ok:true, status:"complete"`, 5 items, `generatedAt:"2026-07-23T00:33:50Z"` (existing this-morning batch, no new generation triggered — cost-safe as instructed).
- Response shape intact: top-level keys include `marketState`, `marketRiskOffScore`, `sourceState`, `scoreBreakdown`, `reactTrace`, `finalReportMarkdown`, etc. — unchanged shape vs pre-merge baseline.
- `marketState: None`, `marketRiskOffScore: None` at top level — **matches known, pre-existing, non-regression gap** (companies_ohlcv has no TAIEX row; Jason-4 round 2 is working the source fix). Not misreported as a new #1352 bug.
- Per-item `marketState: "trend"` present for all 5 tickers (item-level field unaffected).

## 3. #1350 write-side / overview pages + #1349 bench

- #1349 (`649e081d`) CI status: `gh pr view 1349` → all 4 checks `SUCCESS` (validate / W6 audit / secret regression / Playwright P0 smoke) — golden snapshot bench passed pre-merge.
- #1350 (`5a36fe9d`, title: "PR-2 incremental per-(source,symbol) history aggregate, **no consumer yet**") — by its own commit title this is a backend-only aggregate population with zero wired frontend consumer, so there is no new UI-observable "quality number" to check yet; nothing to regress against on the overview pages either.
- Page-level regression check (Playwright, fresh owner login, `packages/qa-playwright/_bruce_4merge_prod_smoke_20260723.mjs`):
  - `/`, `/market-intel`, `/ai-recommendations`, `/desk-exact`, `/companies/2330` → all HTTP 200, **0 console errors, 0 page errors** on every page.

## 4. #1351 tool files (zero runtime wiring)

- Local main checkout was stale (c5a3dace, well behind origin/main tip f7435117) and dirty (unrelated uncommitted changes to `apps/api/src/market-data.ts` + untracked files) — used a detached worktree at `origin/main` to avoid touching the dirty tree (per established safe pattern).
- Confirmed both files exist on `origin/main`:
  - `reports/sim_go_live_20260723/resend_residual_20260724.mjs`
  - `reports/sim_go_live_20260723/RUNBOOK_ADDENDUM_20260724.md`
- Ran `node resend_residual_20260724.mjs` (no flags = default DRY-RUN per script's own header docs) in the clean worktree:
  ```
  === 7/24 RESIDUAL RE-SEND PLAN (phase 1 pricing preview) — DRY-RUN ===
  TOTAL residual orders=21  total_lots=68
  EXCLUDED (1) — MANUAL_DECISION_NEEDED: 1808 ambiguous duplicate-symbol submission
  [dry-run] no network calls made. Re-run with --send ... or --requote ...
  ```
  - Zero network I/O confirmed by the script's own dry-run guard (no `--send`/`--requote` flags were passed).
  - Numbers (21 orders / 68 lots) match the figures already recorded in session_handoff.md — consistent, no surprise.
- Cleaned up: `git worktree remove ../bruce_verify_wt_20260723 --force` — no residue left in the main working tree; the dry-run's local evidence JSON was written only inside the (now-removed) worktree, never touched/committed to main.

## 5. Full-site quick sweep

Covered by the same Playwright run in §3 — 首頁 `/`, 市場情報 `/market-intel`, AI推薦 `/ai-recommendations`, 交易室 `/desk-exact` all HTTP 200 with 0 console errors (公司頁 `/companies/2330` also checked as a bonus 5th page, also clean).

## 6. #1353 AI 投研晨報 newspaper redesign (added mid-task by Elva)

Owner session, Playwright, `packages/qa-playwright/_bruce_1353_airec_verify_20260723.mjs`, two viewports (desktop 1440x900, mobile 390x844), fresh login each time.

- **Format confirmed as newspaper layout, not old card-grid**: desktop screenshot (`evidence/sprint_2026_07_23/pr1353_verify/_bruce_1353_desktop.png`) shows masthead "AI 投研晨報 / MORNING RESEARCH REPORT", a "頭版" (front page) hero section for the top pick (緯穎 6669: 七維評分 radar table, 主要風險 paragraph, 交易區間 target/stop/entry numbers), followed by a "內頁 其餘候選" (inside-page / remaining candidates) section listing the other 4 tickers each with their own detail block (南亞科/樺漢/台化/旺矽) — matches the "頭版特稿+內頁欄目" spec, zero old 三元凶 card/chip/meter-array pattern detected.
- **Mobile 390px**: `evidence/sprint_2026_07_23/pr1353_verify/_bruce_1353_mobile390.png` — same content stacks to single column, `document.body.scrollWidth === 390 === viewport width` on both desktop and mobile (script-measured, `overflow: 0` both), i.e. **zero horizontal overflow** confirmed by direct DOM measurement, not just visual eyeballing.
- **盤後誠實顯示**: page header shows live timestamp "2026/7/23 21:46:05" plus a green post-market banner ("台股目前盤後或週末休市 / 顯示收盤資料" — paraphrased from screenshot) and both top data-freshness badges read "07/23 08:33 收盤" — consistent honest post-market state, no fake "即時" claim.
- **Console errors**: initial run flagged 4x `401` on `auth/me` + `market-data/overview` — investigated further (`_bruce_1353_401_probe*.mjs`, ad-hoc, deleted after use) and confirmed this is a **transient login-redirect race present on every page** (reproduced identically on `/` homepage right after login-redirect, resolves to 0 once the session settles ~2-3s before navigating) — **not a #1353-specific regression**. Re-ran with a 3s settle delay after login before navigating to `/ai-recommendations`: **0 console errors, 0 page errors**.
- Response-shape sanity: `/api/v1/ai-recommendations/v3` (already checked in §2) is the same data source this page consumes — confirmed 5 items present, matches the 5 tickers rendered (緯穎/南亞科/樺漢/台化/旺矽).
- Known non-regression per Elva's note: `marketState`/`marketRiskOffScore` null at top level (TAIEX companies_ohlcv gap, Jason-4 R2 in progress) — not surfaced as a defect on this page; `market_risk_off` UI branch is separately being finished by Jim-2, out of scope for this verify pass.

## Deploy / release verdict

- **Can deploy**: N/A — already deployed, confirmed live at buildCommit=`931723ac` (all 5: #1348/#1350/#1351/#1352/#1353).
- **Can declare 收口 for tonight's 5-merge batch**: YES, with one flagged 未驗項 (see below).
- No functional-file edits were made; only read-only verification (curl, `railway logs`/`railway status`, `gh run watch`, Playwright scripts written under `packages/qa-playwright/`, temporary detached worktrees used and removed).

## 意外與未解決事項

- fallback path for #1348 (`isFallback=true` intraday case) — genuinely cannot be exercised post-market; carry to tomorrow's 09:00-14:00 TST window per task instructions.
- #1352's own CI Validate run shows `failure` due to the pre-existing homepage-heatmap Playwright flake (unrelated to its content) while its Deploy to Railway run succeeded — noted in §0, not a new blocker, but flagging since a raw `gh run list` glance would look alarming.
- Local main checkout (this session's default cwd) was significantly behind `origin/main` (missing commits including the merges under test) and has pre-existing unrelated dirty state (`apps/api/src/market-data.ts` modified, some untracked `s1-lab-*` files, `errMsg.ini`) — not caused by this verification pass; flagged for whoever owns that worktree to reconcile, not touched here per lane boundary. This evidence report itself was pushed via a separate clean detached worktree (commit `c4b00f10` rebased onto `origin/main` → pushed as `1631cadc`) to avoid touching that dirty state.
- Ad-hoc verify scripts left in repo: `packages/qa-playwright/_bruce_4merge_prod_smoke_20260723.mjs` + `_bruce_1353_airec_verify_20260723.mjs` (uncommitted at write time, matches existing naming convention of other `_elva-*` throwaway scripts in that directory).
