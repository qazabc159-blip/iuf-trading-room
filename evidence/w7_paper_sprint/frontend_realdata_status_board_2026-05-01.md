# Frontend Real-Data Status Board — 2026-05-01

Owner: Codex
Cadence: Codex update every 30 minutes during overnight run. Elva lane may update every 20 minutes.
Primary goal: make production UI meaningful, sourced, and operational.

### 2026-05-03 10:18 Taipei - Codex heartbeat pass 45 - production table breathing-room follow-up

**Scope**: demo-critical UI repair only during freeze. No live submit, no Railway secrets, no migration 0020, no KGI SDK/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/companies/[symbol]/FinancialsPanel.tsx` - company financial/revenue/dividend table content now sits inside padded inline wrappers so values are not visually glued to table borders.
- `apps/web/app/globals.css` - shared `.table-cell-inner` breathing-room utility for dense production tables.
- `apps/web/components/portfolio/OrderTicket.tsx` - bid/ask fallback changed from `-- / --` to explicit `買價待接 / 賣價待接`.

**Behavior**:
- Production smoke after PR #97 found company financial cells still too close to the table edge and the paper order quote card still exposing an engineering placeholder when bid/ask is unavailable.
- This pass keeps the same real-data / paper-trading behavior but makes the empty bid/ask state readable in Traditional Chinese.

**Checks**:
- `git diff --check -- apps/web/app/companies/[symbol]/FinancialsPanel.tsx apps/web/app/globals.css apps/web/components/portfolio/OrderTicket.tsx evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Local authenticated 1365px Playwright QA on `/companies/1101` + `/portfolio` PASS: status 200, 0 page errors, 0 console errors, 0 horizontal overflow, 0 narrow vertical stacks, 0 close-to-border hits, 0 `-- / --` / ` / --` / raw engineering placeholder hits. Evidence: `evidence/w7_paper_sprint/local_visual_qa_pass45_table_bidask_2026-05-03/`.

**Blockers / next bypass**:
- None for this scoped visual/copy repair.

### 2026-05-03 20:30 Taipei - Codex heartbeat pass 42 - mobile route zh-TW cleanup

**Scope**: demo-critical UI repair only during freeze. No live submit, no Railway secrets, no migration 0020, no KGI SDK/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/m/page.tsx` - mobile theme cards now map known theme slugs such as orphan audit/AI optics to clean Traditional Chinese labels instead of exposing `[ORPHAN]` source names.
- `apps/web/app/m/layout.tsx` - bottom mobile nav labels changed from `BRIEF/FIELD`, `KILL/MODE`, `DESK/FULL` to Chinese operator labels.
- `apps/web/app/globals.css` - mobile sections/cards get internal gutters so section text and cards do not sit directly on border lines.
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` - recorded this pass.

**Behavior**:
- `/m` no longer shows `[ORPHAN]` in the theme scan and no longer shows the English bottom-nav labels flagged by the production route sweep.
- Mobile cards have more inset spacing while keeping the existing dark trading-room visual language.
- This is copy/layout only. No backend data, order payload, broker path, migration, or data-source behavior changed.

**Checks**:
- `git diff --check -- apps/web/app/m/page.tsx apps/web/app/m/layout.tsx apps/web/app/globals.css evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Local authenticated 1365px Playwright smoke on `/m` and `/m/kill` PASS: status 200, 0 page errors, 0 horizontal overflow, 0 `[ORPHAN]` / `BRIEF` / `FIELD` / `KILL` / `MODE` / `DESK` / `FULL` / lifecycle raw hits, 0 mojibake. Screenshot/report: `evidence/w7_paper_sprint/local_visual_qa_pass42_mobile_2026-05-03/`.

**Blockers / next bypass**:
- None for this scoped mobile UI fix.

### 2026-05-03 20:10 Taipei - Codex heartbeat pass 41 - duplicate reason + border breathing repair

**Scope**: demo-critical UI repair only during freeze. No live submit, no Railway secrets, no migration 0020, no KGI SDK/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/companies/duplicates/page.tsx` - expands duplicate-report reason mapping so backend phrases such as `richer graph coverage` and `canonical company card` render as Traditional Chinese operator copy.
- `apps/web/app/globals.css` - increases shared panel/hud padding, company info section spacing, validation pill padding, K-line toolbar gutters, and K-line pending/meta row inset so labels/buttons do not sit against border lines.
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` - recorded this pass.

**Behavior**:
- `/companies/duplicates` should no longer leak the residual English `canonical company card` reason found by the previous production full-route sweep.
- Company detail panels, the K-line controls, and the simulated-order area inherit more internal spacing from shared panel styles, reducing the text-against-line problem seen in the operator screenshots.
- This pass is visual/copy only. It does not alter order payloads, odd-lot/board-lot conversion, broker paths, backend contracts, migrations, or data sources.

**Checks**:
- `git diff --check -- apps/web/app/companies/duplicates/page.tsx apps/web/app/globals.css evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Local authenticated 1365px Playwright smoke on `/companies/duplicates` and `/companies/1101` PASS after restarting a stale local server: status 200, 0 page errors, 0 horizontal overflow, 0 raw English lifecycle/reason hits, 0 mojibake, 0 narrow text stacks. Screenshot/report: `evidence/w7_paper_sprint/local_visual_qa_pass41_border_reason_2026-05-03_rerun/`.

**Blockers / next bypass**:
- None for this scoped UI fix. If production deploy lags, verify GitHub/Railway deploy status and continue local route QA instead of waiting.

### 2026-05-03 08:42 Taipei - Codex heartbeat pass 40 - duplicate page text containment

**Scope**: demo-critical UI repair only during freeze. No live submit, no Railway secrets, no migration 0020, no KGI SDK/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/companies/duplicates/page.tsx` - duplicate-report rows now translate the canonical English reason into Traditional Chinese, hide corrupt backend names as `名稱待校正`, and translate beneficiary-tier fallback labels.
- `apps/web/app/m/page.tsx` - mobile theme lifecycle labels now include `Discovery` / `Validation` / `Expansion` / `Crowded` as `探索` / `驗證` / `擴張` / `擁擠`.
- `apps/web/app/globals.css` - duplicate-report layout now uses a full-width one-column report surface, wider reason columns, and wrapping row styles instead of half-width squeezed text.
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` - recorded this pass.

**Behavior**:
- `/companies/duplicates` no longer displays long English audit reasons in a narrow vertical strip.
- If backend duplicate data contains replacement-character names, the operator sees `名稱待校正` instead of visible mojibake.
- `/m` no longer leaks `Discovery` / `Validation` in mobile theme cards.

**Endpoints / data**:
- Existing read endpoints only: `GET /api/v1/companies/duplicates`, plus existing mobile read endpoints.
- No merge/ignore/delete action added; duplicate page remains read-only because migration 0020 is still gated.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `git diff --check -- apps/web/app/companies/duplicates/page.tsx apps/web/app/m/page.tsx apps/web/app/globals.css` PASS.
- Local authenticated 1365px Playwright smoke on `/companies/duplicates` and `/m` PASS for current local/prod API state: status 200, 0 overflow, 0 clipped, 0 narrow stacks, 0 raw lifecycle/reason hits, 0 mojibake hits. Screenshot/report: `evidence/w7_paper_sprint/local_visual_qa_pass40_duplicates_mobile_2026-05-03/`.

**Blockers / next bypass**:
- Production verification waits on PR CI and Railway deploy. Next smoke should re-run full route sweep; previous pass 40 production sweep found only `/companies/duplicates` and `/m`.

### 2026-05-03 08:31 Taipei - Codex heartbeat pass 39 - company financial table breathing room

**Scope**: demo-critical UI repair only during freeze. No live submit, no Railway secrets, no migration 0020, no KGI SDK/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/companies/[symbol]/FinancialsPanel.tsx` - simplified financial/revenue/dividend labels, normalized loading/empty/blocked copy, removed inline tab styling, and applied the compact data-table class to company financial tables.
- `apps/web/app/globals.css` - company data panels collapse to one column below 1450px so 1365px desktop no longer squeezes the financial table into a half-width card; added reusable company data tab spacing and compact table cell padding.
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` - recorded this pass.

**Behavior**:
- Company detail lower data panels keep breathing room at 1365px instead of cutting the financial table against the card edge.
- The financial panel now shows clean Traditional Chinese labels (`財報`, `月營收`, `股利`, `正常`, `載入中`, `來源`, `更新`) and avoids raw/garbled source copy.
- This is UI/layout only. It does not change FinMind request paths, quote/K-line data, paper-order payloads, Taiwan odd-lot/board-lot conversion, broker paths, or backend contracts.

**Endpoints / data**:
- Existing read endpoints only: `GET /api/v1/companies/:id/financials`, `GET /api/v1/companies/:id/revenue`, `GET /api/v1/companies/:id/dividend`.
- No new data source, no RSS/news feed, no commercial provider, no AI-generated market item, no fake success fallback.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS after rerun; the first parallel run hit the known `.next/types` generation race only.
- `git diff --check -- apps/web/app/companies/[symbol]/FinancialsPanel.tsx apps/web/app/globals.css` PASS.
- Local authenticated 1365px Playwright smoke on `/companies/1101` PASS for current real API state: status 200, 0 console/page errors, 0 body horizontal overflow, 0 non-scroll overflow elements, 0 narrow text stacks. Screenshot/report: `evidence/w7_paper_sprint/local_visual_qa_pass39_company_financials_2026-05-03/`.
- Fixture-only financial table QA was attempted to force a live financial table while the local real endpoint returned blocked; tooling produced server logs but no final report, so production post-deploy smoke remains the decisive verification for the live-table case.

**Blockers / next bypass**:
- Production post-deploy check should re-run `/companies/1101` after this PR lands. If FinMind financials are live in production, verify `.table-scroll` no longer overflows; if blocked, the panel should truthfully show `暫停`.
- Next safe task: continue all-page spacing/raw-copy sweep or add a focused company-page mobile breakpoint pass.

### 2026-05-03 05:50 Taipei - Codex heartbeat pass 29 - company hydration time-zone fix

**Scope**: demo-critical UI/runtime repair only during freeze. No live submit, no Railway secrets, no migration 0020, no KGI SDK/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/companies/[symbol]/CompanyHeroBar.tsx` - company quote `更新` time now formats with explicit `Asia/Taipei`.
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` - individual-company paper-order ledger/preview times now format with explicit `Asia/Taipei`.
- `apps/web/app/companies/[symbol]/SourceStatusCard.tsx` - expanded source-status timestamps now format with explicit `Asia/Taipei`.
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` - recorded the production hydration finding and fix.

**Behavior**:
- Production `/companies/1101` no longer risks SSR/client text mismatch between Railway server time zone and browser Taipei time zone in visible company update timestamps.
- This is display-only. It does not change quote data, OHLCV data, paper-order payloads, Taiwan stock unit conversion, broker paths, or backend contracts.

**Endpoints / data**:
- No backend endpoint changes.
- No new data source, RSS, commercial news feed, AI translation, mock data, or fallback success path added.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Local authenticated-cookie 1365px Playwright check on `127.0.0.1:3048/companies/1101` with read-only fake local API PASS: status 200, 0 console/page errors, 0 horizontal overflow, 0 narrow vertical text stacks, 0 raw diagnostics. Screenshot/report are local-only under `evidence/w7_paper_sprint/local_visual_qa_pass29_company_hydration_2026-05-03/`.

**Blockers / next bypass**:
- Production confirmation waits for PR CI and Railway deploy. Next safe task after deploy: re-run production authenticated smoke on `/companies/1101` to ensure the React hydration error is gone.

### 2026-05-03 05:38 Taipei - Codex heartbeat pass 28 - shared chrome breathing-room cleanup

**Scope**: demo-critical UI repair only during freeze. No live submit, no Railway secrets, no migration 0020, no KGI SDK/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/globals.css` - widened the application sidebar, increased nav icon hit areas, panel/header gutters, terminal-note padding, HUD-frame padding, and badge primitive line-height/padding.
- `apps/web/components/DataSourceBadge.tsx` - moved the fixed data-source badge farther from the viewport edge, increased internal padding, reduced letter spacing, and changed checking/blocked copy to clean Traditional Chinese source-status wording.

**Behavior**:
- Text, icons, tags, side navigation, page headers, panel titles, and the bottom-right source badge no longer sit tight against borders or separator lines.
- The source badge now reads like a small status plate rather than a cramped diagnostic label, and it stays away from the bottom/right edge on 1365px desktop.
- This is layout/copy only. It does not alter data contracts, order payloads, broker paths, Taiwan stock unit handling, or any backend state.

**Endpoints / data**:
- No backend endpoint changes.
- No new data source, RSS, commercial news feed, AI translation, mock data, or fallback success path added.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Local unauthenticated 1365px Playwright sweep over 21 routes on `127.0.0.1:3047` PASS: 0 horizontal overflow, 0 narrow vertical text stacks, 0 page errors, 0 raw diagnostics.
- Local authenticated-cookie 1365px Playwright sweep over 19 protected routes on `127.0.0.1:3047` with read-only fake local API PASS: all 200, 0 horizontal overflow, 0 narrow vertical text stacks, 0 page errors, 0 raw diagnostics. Screenshots/report are local-only under `evidence/w7_paper_sprint/local_visual_qa_pass28_authed_shared_chrome_2026-05-03/`.
- `git diff --check -- apps/web/app/globals.css apps/web/components/DataSourceBadge.tsx` PASS with only CRLF normalization warnings.

**Blockers / next bypass**:
- Production authenticated smoke waits for PR CI and Railway deploy. Next safe task after deploy: production spot-check the company page and trading room, then continue page-specific polish where screenshots still feel visually sparse.

### 2026-05-03 04:37 Taipei - Codex heartbeat pass 23 - theme cleanup rows hidden

**Scope**: demo-critical UI/content repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/themes/page.tsx` - hides internal cleanup themes whose source text contains `broken`, `deprecated`, `placeholder`, or `[BROKEN]` from the operator-facing theme table, with a truthful compact note showing how many were collected.
- `apps/web/app/page.tsx` - applies the same internal cleanup filter before selecting dashboard theme rows.

**Behavior**:
- The theme board no longer shows `[BROKEN-1] To Fix`, `[BROKEN-2] To Fix`, `[DEPRECATED] Photoresist Test`, or `placeholder` rows in the main operator table.
- Visible theme totals now count operator-facing themes, not internal cleanup records.
- Internal cleanup records are not deleted and no backend data is changed; they are just kept out of the production UI table.

**Endpoints / data**:
- No backend endpoint changes.
- No new data source, RSS, commercial news feed, AI translation, or mock data added.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `git diff --check -- apps/web/app/page.tsx apps/web/app/themes/page.tsx` PASS (CRLF warning only).

**Blockers / next bypass**:
- Production visual confirmation waits on PR CI/deploy. Next safe task: production `/themes` smoke, then continue route-by-route cleanup for portfolio/order wording and remaining English source IDs.

### 2026-05-03 04:18 Taipei - Codex heartbeat pass 22 - dashboard/theme/signal zh-TW cleanup

**Scope**: demo-critical UI/content repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/page.tsx` - dashboard theme rows now use Traditional Chinese display names for known theme slugs and hide English-heavy thesis/signal/news text behind truthful "待整理" states.
- `apps/web/app/themes/page.tsx` - full theme board applies the same known theme label mapping and avoids rendering English-heavy thesis text as primary operator copy.
- `apps/web/app/signals/page.tsx` - signal ledger treats mixed Chinese/English-but-English-heavy signal titles as "外文訊號待整理" instead of showing operator-facing English sentences.

**Behavior**:
- Dashboard no longer exposes `[ORPHAN] Audit Trail Live Check`, `[ORPHAN] AI Optics`, or long English thesis/signal text as the primary display copy.
- Known Taiwan-market themes show Chinese-first names such as `內部稽核軌跡`, `AI 光通訊封裝`, `ABF 載板`, `CoWoS 先進封裝`, and `CPO 光通訊`.
- No fake translation is introduced; English-heavy source strings are preserved in the backend but rendered as truthful pending-cleanup states.

**Endpoints / data**:
- No backend endpoint changes.
- No new data source, RSS, commercial news feed, AI translation, or mock data added.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `git diff --check -- apps/web/app/page.tsx apps/web/app/themes/page.tsx apps/web/app/signals/page.tsx` PASS (CRLF warning only).
- Production pre-fix route sweep screenshots/metrics recorded under `evidence/w7_paper_sprint/production_screenshots_pass22_route_sweep_2026-05-03/`; pre-fix sweep had zero horizontal overflow, but still showed English-heavy theme/signal copy.

**Blockers / next bypass**:
- Production visual confirmation waits on PR CI/deploy. Next safe task: deploy smoke for dashboard/themes/signals, then continue route-by-route copy/spacing cleanup.

### 2026-05-03 03:48 Taipei - Codex heartbeat pass 21 - company panel spacing repair

**Scope**: demo-critical UI repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/globals.css` - restored safe padding for `.panel.hud-frame`, widened panel inner padding, and gave mini/outline buttons stable height plus no-wrap text.
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` - increased spacing in the company-detail simulated order panel: source row, warning banner, form grid, labels, segmented controls, and inputs no longer sit tight against borders.
- `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx` - added breathing room around K-line timeframe controls, pending interval chips, and metadata rows.

**Behavior**:
- Company-detail panels such as `[01] 公司主檔`, `[06] 模擬委託`, and the K-line control band now keep visible text and controls away from border lines.
- Buttons and segmented controls maintain stable touch/click height and avoid clipped or cramped labels.
- This is spacing-only; no endpoint, order payload, unit conversion, broker path, or data fallback behavior changed.

**Endpoints / data**:
- No backend endpoint changes.
- No new data source, RSS, commercial news feed, AI translation, or mock data added.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `git diff --check -- apps/web/app/globals.css apps/web/app/companies/[symbol]/PaperOrderPanel.tsx apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx` PASS (CRLF warning only).
- Local 1365px Playwright route probe recorded under `evidence/w7_paper_sprint/local_visual_qa_pass21_spacing_2026-05-03/`; local protected company page could not be treated as visual truth because the local server lacks a production API session and static assets 404 on the existing dev process. Bypass: CI/deploy, then production authenticated smoke.

**Blockers / next bypass**:
- Production visual confirmation waits on PR CI/deploy. Next safe task after deploy: authenticated production company-page smoke for `1101` and `2330`, then continue global spacing sweep across dashboard/theme/portfolio routes.
### 2026-05-03 03:18 Taipei — Codex heartbeat pass 20 — market-intel text containment

**Scope**: demo-critical UI repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/page.tsx` — dashboard Market Intel rows now contain English-only or broken announcement text with a truthful Traditional Chinese state instead of rendering long English titles in a narrow panel.
- `apps/web/app/market-intel/page.tsx` — full Market Intel page applies the same text-safety rule and localizes common category labels.
- `apps/web/app/globals.css` — Market Intel / telex rows now force child min-width containment and use the zh-TW sans font for announcement titles to avoid one-word vertical wrapping.

**Behavior**:
- No fake translation is introduced. English-only titles render as `外文消息待整理；保留來源紀錄，不納入...判讀。`
- Broken mojibake/undefined/null-like strings render as a truthful text-cleanup state instead of becoming operator-facing evidence.
- Announcement category badges prefer Traditional Chinese labels such as `產業`, `財報`, `供應鏈`, `公告`.

**Endpoints / data**:
- No backend endpoint changes.
- No new data source, RSS, commercial news feed, AI translation, or mock data added.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS after `next build` regenerated `.next/types`
- `git diff --check -- apps/web/app/page.tsx apps/web/app/market-intel/page.tsx apps/web/app/globals.css` PASS (CRLF warning only)

**Blockers / next bypass**:
- Local browser QA not run in this cycle to avoid GUI/sandbox confirmation blocking. Next bypass: PR/CI/deploy smoke, then continue with demo-critical dashboard/portfolio spacing checks.

### 2026-05-03 00:59 Taipei — Codex heartbeat pass 19 — signal text containment

**Scope**: demo-critical UI repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/page.tsx` — dashboard signal rows now convert English-only signal text to a truthful Chinese state instead of rendering a long English sentence as primary operator text.
- `apps/web/app/signals/page.tsx` — full signal ledger applies the same English-only containment rule.
- `apps/web/app/globals.css` — signal title cells now use `break-word` / `keep-all` plus a height cap so long text cannot collapse a narrow column into one-word vertical wrapping.

**Behavior**:
- Internal/test signals remain filtered or collected as before.
- English-only signal content is not fake-translated. The UI states: `外文訊號待整理；保留來源紀錄，不納入...判讀。`
- This prevents the dashboard/signals page from showing a tall English wall of text while keeping the true 4-state/evidence posture.

**Endpoints / data**:
- No backend endpoint changes.
- No new data source, RSS, commercial news feed, mock data, or AI translation added.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check -- apps/web/app/page.tsx apps/web/app/signals/page.tsx apps/web/app/globals.css` PASS (CRLF warning only)

**Blockers / next bypass**:
- Local browser QA not run in this cycle to avoid sandbox/GUI confirmation blocking. Next bypass: PR/CI/deploy smoke, then continue with company/detail or portfolio route visual QA.

### 2026-05-03 00:21 Taipei — Codex heartbeat pass 18 — paper preview vocabulary cleanup

**Scope**: demo-critical UI repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/lib/paper-order-vocab.ts` — added Traditional Chinese labels for paper risk decisions, quote-gate decisions, risk guards, quote reasons, and quote sources.
- `apps/web/components/portfolio/OrderTicket.tsx` — trading room paper preview now renders risk/quote decisions, guard names, reasons, quote source, and odd-lot/board-lot review wording in Chinese-first language.
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` — company-detail paper preview now uses the same Chinese-first vocabulary and keeps `SHARE` / `LOT` only as parenthesized payload identifiers.

**Behavior**:
- Paper-order preview no longer shows raw backend enums like `allow`, `block`, `review_required`, `quote_unknown`, `max_absolute_notional`, or `Blocked by ...` as operator-facing primary text.
- Review modal unit badges now read `零股（SHARE）` and `整張（LOT）`; formulas use `股` / `張 × 1,000 股/張` instead of English-first `SHARE` / `LOT`.
- Payload identifiers remain visible only where they help prevent a future zero-lot / board-lot routing mistake; no API payload or backend contract changed.

**Endpoints / data**:
- No backend endpoint changes.
- Still uses existing paper preview/submit/list APIs.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check -- apps/web/lib/paper-order-vocab.ts apps/web/components/portfolio/OrderTicket.tsx apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` PASS (CRLF warning only)

**Blockers / next bypass**:
- Local browser QA not started this cycle because sandbox/GUI prompts must not block autonomous work. Build/typecheck/diff-check are green; next bypass is PR/CI/deploy smoke, then continue demo-critical visual cleanup.

### 2026-05-02 21:00 Taipei — Codex heartbeat pass 15 — company panel raw-error cleanup

**Scope**: demo-critical UI repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/companies/[symbol]/FinancialsPanel.tsx` — blocked financial/revenue/dividend errors now pass through `friendlyDataError()`.
- `apps/web/app/companies/[symbol]/ChipsPanel.tsx` — blocked errors now pass through `friendlyDataError()` and malformed/partial chips payloads render `無資料` instead of throwing raw JavaScript exceptions.
- `apps/web/app/companies/[symbol]/AnnouncementsPanel.tsx` — blocked announcement errors now pass through `friendlyDataError()`.
- `apps/web/app/companies/[symbol]/error.tsx` — route error boundary no longer prints `error.message` directly.

**Behavior**:
- Company detail panels no longer surface implementation strings like `Cannot read properties of undefined` to the operator.
- If a data source returns an incomplete chips payload, the UI says the endpoint did not return the expected three-institution fields and hides partial data.
- Network/auth/not-found/timeout failures keep the existing Traditional Chinese 4-state wording.

**Endpoints / data**:
- No backend endpoint changes.
- No mock or fallback data added.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git grep error instanceof Error ? error.message -- apps/web/app/companies apps/web/lib` now only leaves internal friendly-error conversion and the server helper; client-facing company panels no longer print raw messages directly.

**Blockers / next bypass**:
- ELVA/backend lanes still unavailable until 2026-05-05. Continue frontend 4-state polishing and route-level QA without changing data contracts.

### 2026-05-02 20:45 Taipei — Codex heartbeat pass 14 — company-detail order review modal

**Scope**: demo-critical UI safety repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` — replaced native `window.confirm` with an in-app blocking order review modal for the individual-company paper order panel.

**Behavior**:
- Company-detail paper order submit no longer uses the browser-native confirm box.
- After a passing paper preview, `檢查並送出` opens a Traditional Chinese modal with stock, side, order type, unit badges (`SHARE 零股` / `LOT 整張`), quantity, actual share count, price, notional formula, demo available cash, estimated usage, fee, and submit type.
- Odd-lot safety is explicit: `1 股 × NT$800 = NT$800`; board-lot still clearly means `1 張 × 1,000 股/張`.
- Confirm button still calls the existing paper submit endpoint only; no API contract, broker write-side, live submit, or backend route changed.

**Endpoints / data**:
- No backend endpoint changes.
- Still uses existing `POST /api/v1/paper/orders/preview`, `POST /api/v1/paper/orders`, and `GET /api/v1/paper/orders`.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git grep window.confirm -- apps/web/app/companies/[symbol]/PaperOrderPanel.tsx apps/web/components/portfolio/OrderTicket.tsx` PASS: no native confirm remains in paper order surfaces.
- Local 1365px Playwright modal QA with fake local API on `127.0.0.1:59999` PASS: `/companies/2330` rendered 200, preview passed, modal opened, zero horizontal overflow, zero narrow vertical text; modal contained `SHARE 零股`, `LOT 整張`, `實際股數 1 股`, and `1 股 × NT$800 = NT$800`.
- Screenshot/report: `evidence/w7_paper_sprint/local_visual_qa_pass14_order_modal_2026-05-02/`

**Blockers / next bypass**:
- Full post-demo order review hardening (cash freshness, market deviation checkbox, Playwright E2E suite) remains scheduled after freeze per ELVA handoff. Current change closes the immediate demo-critical odd-lot/board-lot confirmation gap without touching backend.

### 2026-05-02 20:30 Taipei — Codex heartbeat pass 13 — dashboard degraded-state collapse

**Scope**: demo-critical UI repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS/commercial data feature.

**Files changed**:
- `apps/web/app/page.tsx` — added a dashboard degraded-state detector and a compact source-status summary when most core data sources are BLOCKED.
- `apps/web/app/globals.css` — added responsive layout for the degraded summary and source rows.

**Behavior**:
- If market overview / watchlist / themes / strategy ideas / signals / announcements are mostly blocked, the dashboard no longer expands every secondary panel into repeated `暫停` / `無資料` sections.
- The page now renders one clear Traditional Chinese degradation card with source, updated time, status, and reason for each data lane.
- Normal LIVE/partial-live dashboard behavior is unchanged; the full market strip, watchlist, themes, ideas, signals, and ops panels still render when enough real data is available.
- No fake market/news data added and no data contract changed.

**Endpoints / data**:
- No backend endpoint changes.
- Local QA intentionally used `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:59999` to verify the worst-case fail-closed UI.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- Local Next production server on `127.0.0.1:3035` PASS
- Local 1365px Playwright QA over `/`, `/companies/2330`, `/portfolio`, `/quote?symbol=2330`, `/themes`, `/signals`, `/login`, `/register` PASS: all 200, 0 horizontal overflow, 0 narrow vertical text, 0 wide elements, 0 page errors, no raw backend/error text.
- Screenshot/report: `evidence/w7_paper_sprint/local_visual_qa_pass13_routes_2026-05-02/`

**Blockers / next bypass**:
- ELVA/Jason/Bruce/Mike/Pete/Athena lanes are quota-blocked until 2026-05-05. Frontend will continue only within safe demo-critical UI fixes and record backend-contract blockers rather than waiting.

### 2026-05-02 17:11 Taipei — Codex heartbeat pass 12 — company-detail order unit trace

**Scope**: demo-critical UI safety repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS.

**Files changed**:
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` — individual-company paper order history now shows the Taiwan quantity unit and computed actual share count for each displayed paper order.

**Behavior**:
- A submitted/recent paper order no longer appears as ambiguous `買進 1`; it renders as `買進 1 零股` plus `實際 1 股`, or `買進 1 整張` plus `實際 1,000 股`.
- This keeps the post-submit ledger consistent with the pre-submit odd-lot / board-lot guard and prevents the UI from hiding the difference between one share and one board lot.
- No submit contract changed; `quantity_unit` remains the existing required payload field.

**Endpoints / data**:
- No backend endpoint changes.
- Still reads `GET /api/v1/paper/orders`; display-only formatting change.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS after build completed
- Attempted local 1365px Playwright QA for `/companies/2330` and `/portfolio`; Chromium required elevated spawn and the combined local-server/browser harness timed out before a usable screenshot summary. This is a QA tooling blocker, not an application build/type blocker.

**Blockers / next bypass**:
- Browser QA path needs a stable elevated local-browser runner in this sandbox. Bypass for this micro-fix: keep change display-only, build/typecheck-gated, and run production/public smoke after CI deploy if merged.

### 2026-05-02 16:28 Taipei — Codex heartbeat pass 11 — remove global overlay + hydration fix

**Scope**: demo-critical UI repair only; no live submit, no Railway secrets, no migration 0020, no KGI/broker write-side, no destructive DB, no deferred news/RSS.

**Files changed**:
- `apps/web/app/layout.tsx` — removed the global floating source badge from the root layout; page/panel-level 4-state truth remains.
- `apps/web/components/PageFrame.tsx` — added a targeted hydration suppressor on the generated-at timestamp so client pages do not emit React hydration errors.

**Behavior**:
- Bottom-right source overlay no longer sits on top of the trading room / market pages.
- Company board and quant lab no longer throw React hydration mismatch on first paint.
- No new functionality, no data-source expansion, no wording iteration outside demo-critical UI breakage.

**Endpoints / data**:
- No backend endpoint changes.
- Local QA used `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:59999` to keep frontend 4-state fail-closed behavior visible without touching production data or secrets.

**Checks**:
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- Local production Playwright sweep at 1365x768 over 21 routes PASS after rerun: `/login`, `/register`, `/`, `/themes`, `/companies`, `/companies/duplicates`, `/companies/2330`, `/ideas`, `/runs`, `/plans`, `/ops`, `/signals`, `/market-intel`, `/portfolio`, `/quote?symbol=2330`, `/lab`, `/briefs`, `/drafts`, `/reviews`, `/m`, `/m/kill`
- QA assertions: 0 horizontal overflow, 0 narrow vertical text columns, 0 raw backend labels, 0 `.source-badge`, 0 React page errors.

**Blockers / next bypass**:
- None for this scoped fix. Next step: PR + CI + deploy smoke for this pass, then continue page-by-page demo UI repair within freeze.

### 2026-05-01 18:53 Taipei — Elva cadence: 68h sprint Block 1, 20min #8 — 楊董返回 + 詳報已交 + P1-12 EOD closeout 模板

**Codex burst since 18:23 (0 commits)**: Codex still quiet — likely waiting on Jason backend (Contract 4 4 routes) before wiring frontend full PROMOTE flow.

**Verify**: 0 new commits to grep, prior 12-commit window stop-line clean held.

**楊董返回 (18:53 TST)** — 我已交完整 6 小時報告（9 段 §1-§9）；楊董未回覆即發 `<<autonomous-loop-dynamic>>` → autonomous push 繼續，不停下等決策。

**Cycle deliverable — P1-12 W7 EOD closeout template**:
- File: `evidence/w7_paper_sprint/w7_eod_closeout_template_2026-05-01.md`
- 8-section standardized format: headline (≤25字) / shipped today / **demo readiness D-3→D-day matrix** / 4-lane status / yellow-red events / blockers / tomorrow top-5 / 楊董 decisions
- Filename convention `eod/w7_eod_YYYY-MM-DD.md`, filed 21:00 TST nightly
- Special cases: weekend EOD / demo day EOD (with §9 execution log) / sprint close 5/9 with W7_FINAL_CLOSEOUT.md
- Today's first-use EOD (5/1) due 21:00 — preview included in §7

**Block 1 status table (full)**:
| P1 # | Topic | Design | Impl |
|---|---|---|---|
| P1-1 (Contract 2) | Portfolio + 4-layer risk read | ★ 16:43 | ★ `13ca56a` 16:54 |
| P1-2 (Contract 3) | Watchlist UI | ★ 17:23 | ★ `cbadbb9` 17:45 |
| P1-3 (Contract 4) | Idea→paper promote | ★ 16:23 | ★ `1d9f50f` 18:23 (groundwork) |
| P1-4 (Contract 2b) | Risk override admin UI | ★ 18:23 | W8 D2-D4 deferred |
| P1-7 (Codex) | K-line wire | covered | `8a749d7` |
| P1-8 | Demo runbook | ★ 17:03 | static |
| P1-9 | Idempotency verify gate | ★ 17:43 | Bruce 5/2 prep |
| P1-10 | Demo contingency plan | ★ 18:03 | Bruce monitor 5/3 |
| P1-11 | OpenAlice 100-co batch | ★ 15:54 | queued |
| P1-12 | EOD closeout template | ★ 18:53 (this cycle) | first use today 21:00 |

**6h push tally**: 10 P1 designs + 3 Codex direct executions + 1 standardized closeout template + 7 status board updates + 0 stop-line hits.

**Yellow / red**: 楊董返回但未拍板 8 個 §9 Q1-Q5 — 我繼續按 default 推進。

**Next 20min (19:13 cadence)**:
1. Check Codex 是否在 Contract 4 PROMOTE 主流程繼續推進
2. Stop-line grep 不放鬆
3. 寫第一份正式 EOD `eod/w7_eod_2026-05-01.md` 草稿（按 P1-12 template，21:00 收板）
4. 或寫 **P1-5 daily_brief OpenAI streaming UX** / **P1-6 paper E2E observability dashboard** 視 Codex 進度
5. Cycle entry write-back

---

### 2026-05-01 18:23 Taipei — Elva cadence: 68h sprint Block 1, 20min #7 — P1-4 risk override admin UI design (Contract 2b) + Codex Contract 4 in motion

**Codex burst since 18:03 (1 commit, mid-cycle)**:
- `1d9f50f fix(web): show blocked idea promotion state` — Contract 4 (P1-3) groundwork; ideas/runs pages now respect 4-state hard rule for promotion-BLOCKED scenarios. 53 insertions, no migration, stop-line clean.

**Verify clean**:
| Check | Result |
|---|---|
| Stop-line grep on `09aaec4..origin/main` | **0 hits** |
| New file count under apps/web/components/admin/ | 0 (Contract 2b is fresh design — Codex hasn't touched it yet) |
| 4-state hard rule across all 12 fix(web)+feat(web) commits since 15:54 | All compliant |

**Cycle deliverable — Contract 2b (P1-4) risk override admin UI design**:
- File: `evidence/w7_paper_sprint/contract_2b_risk_override_admin_ui_design_2026-05-01.md`
- Closes the gap between Contract 2 read-side and DB-shell-only write-side
- Backend: 1 new migration `0023_risk_limit_override_audit.sql` (immutable audit table, idempotent CREATE) + 3 routes (GET / PATCH / GET audit) + risk-store `applyOverride()` extension
- Frontend: 5 new components under `apps/web/components/admin/` — `RiskLimitAdminSurface` / `LimitGrid` / `LimitEditModal` / `AuditTrail` / page entry — all 4-state explicit
- Key safety invariants:
  - Reason field REQUIRED min 10 chars (server validates)
  - Audit row immutable (no UPDATE/DELETE route ever exposed)
  - Kill-switch ENGAGED → all edits 423 LOCKED (read still allowed)
  - NTD bound [0, 100M], lots bound [0, 10k], hard server-side
  - Synchronous risk-store cache invalidation (next 5s poll reflects)
- 12/12 hard-line matrix PASS at design time
- ~1130 LOC / ~22h e2e
- **Explicitly NOT on 5/4 demo path** — W8 D2-D4 deliverable (Jason 5/5-5/6, Codex 5/7, Bruce+Mike 5/8)
- 7 open Q with defaults

**Block 1 status table**:
| P1 # | Topic | Design | Impl |
|---|---|---|---|
| P1-1 (Contract 2) | Portfolio + 4-layer risk read | ★ 16:43 | ★ `13ca56a` 16:54 |
| P1-2 (Contract 3) | Watchlist UI | ★ 17:23 | ★ `cbadbb9` 17:45 |
| P1-3 (Contract 4) | Idea→paper promote | ★ 16:23 | in-progress `1d9f50f` 18:23 |
| P1-4 (Contract 2b) | Risk override admin UI | ★ 18:23 (this cycle) | W8 D2-D4 deferred |
| P1-7 (Codex) | K-line wire | covered | `8a749d7` |
| P1-8 | Demo runbook | ★ 17:03 | static |
| P1-9 | Idempotency verify gate | ★ 17:43 | Bruce 5/2 prep |
| P1-10 | Demo contingency plan | ★ 18:03 | Bruce monitor 5/3 |
| P1-11 | OpenAlice 100-co batch | ★ 15:54 | queued |

**Demo path coverage**: 100% papered. Read-side (Contract 2 ✓ implemented), watchlist (Contract 3 ✓ implemented), promote flow (Contract 4 partial impl), runbook + idempotency + contingency all written. The **only** missing piece for the demo is Contract 4 full implementation — which Codex started this cycle.

**Yellow / red**: none.

**Velocity**: 9 P1 designs (P1-1, P1-2, P1-3, P1-4, P1-7, P1-8, P1-9, P1-10, P1-11) + Codex active execution on P1-1, P1-2, P1-3 in 6h push.

**Next 20min (18:43 cadence)**:
1. Watch for Contract 4 PROMOTE button wire-up (the heart of the demo path)
2. Stop-line grep on every new commit
3. Pick next design candidate: **P1-5 daily_brief OpenAI streaming UX** OR **P1-12 W7 EOD closeout template** (handoff for 楊董's return) OR **P1-6 paper E2E observability dashboard** (institutional roadmap §8)
4. Cycle entry write-back

---

### 2026-05-01 18:03 Taipei — Elva cadence: 68h sprint Block 1, 20min #6 — P1-10 demo contingency plan drafted (failure-mode playbook)

**Codex burst since 17:43 (0 commits)**: Codex quiet — likely chewing through Contract 4 (P1-3) which is heavier (~980 LOC, 4 routes, 1 migration, frontend PROMOTE wiring).

**Verify clean**:
| Check | Result |
|---|---|
| New Codex commits since `cbadbb9` | 0 (digesting Contract 4) |
| Stop-line grep on apps/web | **0 hits** |
| Hard rule status | All 8 most recent fix(web) + 2 feat(web) commits compliant |

**Cycle deliverable — P1-10 demo contingency / backup plan**:
- File: `evidence/w7_paper_sprint/paper_e2e_demo_contingency_plan_2026-05-04.md`
- 10 failure categories F1-F10 mapped to severity (DEMO STOP / PARTIAL / RECOVERABLE)
- 8 hard-stop conditions HS1-HS8 (idempotency fail / kill bypass / pool exhaust / regression / stop-line hit / state non-determinism / 楊董 veto)
- 3 partial-demo modes:
  - Mode A: read-only walkthrough (no submit) → ~10min
  - Mode B: submit + cancel before fill (mini-cycle) → ~15min
  - Mode C: submit on alt-symbol (0050 pivot) → ~25min full
- Pre-open monitoring script (Bruce-owned, 5/3 author) with 7 probes / 60s cadence
- 08:55 go/no-go decision matrix + 楊董 ack protocol
- Postponement protocol: rootcause within 24h, 5/5 retry, hotfix gate
- Mid-flow recovery: turn failures into honest 4-state demos (system shows reality, not silent mock)
- Communication tree (8 events from 06:00 → post-demo)
- Evidence bundle layout for `contingency_triggered/` subfolder
- 4 open Q with defaults (audience composition / alt-symbol / postpone cadence / Elva NO-GO authority)

**Block 1 status table**:
| P1 # | Topic | Design | Impl |
|---|---|---|---|
| P1-1 (Contract 2) | Portfolio + 4-layer risk | ★ 16:43 | ★ `13ca56a` 16:54 |
| P1-2 (Contract 3) | Watchlist UI | ★ 17:23 | ★ `cbadbb9` 17:45 |
| P1-3 (Contract 4) | Idea→paper promote | ★ 16:23 | queued (~980 LOC) |
| P1-7 (Codex) | K-line wire | covered | `8a749d7` |
| P1-8 | Demo runbook (happy path) | ★ 17:03 | static |
| P1-9 | Idempotency verify gate | ★ 17:43 | Bruce-actionable 5/2 |
| P1-10 | Demo contingency plan | ★ 18:03 (this cycle) | Bruce monitor script 5/3 |
| P1-11 | OpenAlice 100-co batch | ★ 15:54 | queued |

**Demo readiness map**:
- 5/2 Sat: Bruce drafts preopen_monitor.ps1 + Jason confirms migration unique indices + Codex confirms `submitInFlight` ref + draft-time UUID
- 5/3 Sun 09:00: Idempotency dry-run T01-T05
- 5/3 Sun 14:00: T06-T12 + Mode A/B/C dry-rehearsal
- 5/3 Sun 22:00: Full 12/12 verify gate (postpone if not green)
- 5/4 06:00–08:55: monitor probe loop + go/no-go ack
- 5/4 09:00: Demo OR postpone

**Yellow / red**: none.

**Velocity**: 8 P1 designs delivered (P1-1, P1-2, P1-3, P1-7-Codex, P1-8, P1-9, P1-10, P1-11) + 2 Codex direct executions in 5.5h overnight push. Demo path is now fully papered.

**Next 20min (18:23 cadence)**:
1. Verify next Codex commits stop-line clean
2. Watch for Contract 4 (P1-3) Codex pickup
3. Pick next design candidate: **P1-4 4-layer risk override admin UI** (lets operator nudge limits without DB shell) OR **P1-5 daily_brief OpenAI streaming UX** (institutional-grade roadmap §6) OR **P1-12 W7 sprint EOD closeout template**
4. Cycle entry write-back

---

### 2026-05-01 17:43 Taipei — Elva cadence: 68h sprint Block 1, 20min #5 — ★ Codex executed Contract 3 (P1-2) inside 20min for the SECOND time + P1-9 idempotency verify checklist drafted

**★ HEADLINE (2nd time)**: Codex executed Contract 3 P1-2 design **inside ~22min of my 17:23 push** — `cbadbb9 feat(web): scaffold dashboard watchlist surface`. Design→impl loop now repeating reliably.

**Codex burst since 17:23 (1 commit, big one)**:
- `cbadbb9` — 6 files, 324 insertions, exact §3.4-§5 file layout from my Contract 3 spec:
  - `apps/web/components/watchlist/WatchlistSurface.tsx` (65 lines vs my §5.1 ~120 — leaner, faithful)
  - `apps/web/components/watchlist/WatchlistTable.tsx` (134 lines vs my §5.2 ~180 — leaner)
  - `apps/web/components/watchlist/QuoteCellRender.tsx` (51 lines vs my §5.2 ~50 — bullseye)
  - `apps/web/lib/api.ts` (+39 — types added per my §5.4)
  - `apps/web/app/page.tsx` (+30 — 3-pane integration per my §5.3)

**Diff inspection of WatchlistSurface.tsx**:
| Spec | Codex impl |
|---|---|
| `WatchlistSurfaceState = LIVE \| BLOCKED` | ✓ exact |
| BLOCKED branch shows reason + source + checked time | ✓ exact (matches RiskSurface BLOCKED pattern) |
| LIVE renders source line with kill+paper state | ✓ exact |
| `data.warnings` rendered as PARTIAL banner | ✓ added (per my §3.1 warnings array) |
| `rows.length === 0` → EMPTY hint | ✓ exact |
| Otherwise `<WatchlistTable>` | ✓ exact |
| Stop-line grep | **0 hits** |

**Cycle deliverable — P1-9 idempotency verify checklist**:
- File: `evidence/w7_paper_sprint/paper_e2e_idempotency_verify_checklist_2026-05-04.md`
- 12 test cases T01-T12 covering 5 idempotency layers (L1 frontend ref / L2 API key / L3 DB unique / L4 state machine guard / L5 ledger unique)
- Cross-tab, retry, race, terminal-state, network-drop, cross-surface promote scenarios
- Evidence bundle layout for `idempotency_verify/` subfolder
- 6 hard lines for demo day (single click, one tab, no cross-surface PROMOTE etc.)
- 5 open Q with defaults
- Sequencing: 5/2-5/3 Bruce + Codex prep, 5/3 22:00 full 12/12 verify, 5/4 06:00 smoke, 5/4 09:00 go/no-go gated on PASS
- Demo postponed to 5/5 if 12/12 not green by 5/3 22:00

**Block 1 status table**:
| P1 # | Topic | Design | Impl |
|---|---|---|---|
| P1-1 (Contract 2) | Portfolio + 4-layer risk | ★ 16:43 | ★ `13ca56a` 16:54 |
| P1-2 (Contract 3) | Watchlist UI | ★ 17:23 | ★ `cbadbb9` 17:45 |
| P1-3 (Contract 4) | Idea→paper promote | ★ 16:23 | queued |
| P1-7 (Codex self) | K-line wire | covered | `8a749d7` |
| P1-8 | Paper E2E demo runbook | ★ 17:03 | static |
| P1-9 | Idempotency verify checklist | ★ 17:43 (this cycle) | Bruce-actionable 5/2 |
| P1-11 | OpenAlice 100-co batch | ★ 15:54 | queued |

**Yellow / red events**: none this cycle.

**Velocity check**: 7 P1 designs delivered + 2 Codex direct executions in 5h overnight push. On track for 5/4 demo readiness.

**Next 20min (18:03 cadence)**:
1. Verify next Codex commits stop-line clean
2. Check if Codex picks up Contract 4 (P1-3) idea→paper promote next
3. Pick next P1 design candidate: **P1-4 4-layer risk override admin UI** OR **P1-10 paper E2E backup plan** (what to do if 5/4 09:00 has TWSE outage, KGI quote storm, etc.)
4. Cycle entry write-back

---

### 2026-05-01 17:23 Taipei — Elva cadence: 68h sprint Block 1, 20min #4 — Contract 3 Watchlist UI design queued (P1-2)

**Codex burst since 17:03 (0 commits)**: Codex quiet — likely consuming Contract 4 (P1-3) design or in design-read mode. No drift, no stop-line risk.

**Verify clean (origin/main e53dbf0..origin/main = 0 new web commits)**:
| Check | Result |
|---|---|
| Stop-line grep on diff `94df067..origin/main` apps/web | **0 hits** (broker.submit / live.submit / kgi-broker / /order/create) |
| 4-state hard rule across last 8 fix(web) commits | All hide/block patterns — no silent fallback regression |

**Cycle deliverable — Contract 3 (P1-2) Watchlist UI design**:
- File: `evidence/w7_paper_sprint/contract_3_watchlist_ui_design_2026-05-01.md`
- Mirrors Contract 2 pattern: `WatchlistSurfaceState = LIVE | BLOCKED`, per-row `QuoteCell` 4-state, re-uses `PositionRiskBadge` from Contract 2 (no duplication)
- 7 columns: SYMBOL/NAME/LAST/BID/ASK/Δ%/RISK/[PROMOTE]
- PROMOTE click → invokes Contract 4 `POST /api/idea/promote-to-paper-preview` first, then navigates → unifies idea+watchlist promotion path
- Hard-blocks PROMOTE if any quote BLOCKED, kill-switch ENGAGED, or paper gate not ARMED
- Backend: 1 aggregator route, **0 migrations**, p95 ≤ 200ms target for 50 rows
- 12/12 hard-line matrix PASS at design time
- ~700 LOC / ~14h e2e (Jason 4h + Codex 8h + Bruce 2h)
- 8 open Q with defaults applied — Codex can pick up immediately

**Block 1 status table**:
| P1 # | Topic | Design status | Impl status |
|---|---|---|---|
| P1-1 (Contract 2) | Portfolio + 4-layer risk badge | ★ DELIVERED 16:43 | ★ Codex executed `13ca56a` 16:54 |
| P1-2 (Contract 3) | Watchlist UI | ★ DELIVERED 17:23 (this cycle) | queued for Codex |
| P1-3 (Contract 4) | Idea→paper promote | ★ DELIVERED 16:23 | queued |
| P1-5 / 6 / 7 | (Codex P1-7 self-took) | covered | `8a749d7` |
| P1-8 | Paper E2E demo runbook | ★ DELIVERED 17:03 | runbook static |
| P1-9 | idempotency live verify checklist | not yet | (next cycle candidate) |
| P1-11 | OpenAlice 100-co exposure batch | ★ DELIVERED 15:54 | queued |

**Yellow / red events**: none this cycle.

**Sequencing call**:
- 5/2 Sat → Jason aggregator + Codex skeleton
- 5/3 Sun → Codex full wire + Bruce 4-state harness
- 5/4 06:00 → preflight against 2330/2317/0050
- Fallback: strip PROMOTE button if weekend slips, watchlist still LIVE read-only, demo path covered by Contract 4 idea panel

**Next 20min (17:43 cadence)**:
1. Verify next Codex commits stop-line clean
2. Standby for Jason / 0020 v2 PR #39 trigger (no probe — ASYNC)
3. Pick next P1 design — likely **P1-9 idempotency live verify checklist for 5/4 demo** (3 days out, getting closer to operationally critical)
4. Cycle entry write-back

---

### 2026-05-01 17:03 Taipei — Elva cadence: 68h sprint Block 1, 20min #3 — ★ design→impl loop closed inside 20min

**★ HEADLINE**: Codex executed Contract 2 P1-1 design **inside 20min of my 16:43 design push**.

**Codex burst recap since 16:43 (1 commit, but it's the big one)**:
- `13ca56a` **feat(web): scaffold portfolio risk surface** — ★ direct execution of `contract_2_portfolio_4layer_risk_ui_design_2026-05-01.md`

Diff stat:
| File | Lines | Match my §7 spec |
|---|---|---|
| `apps/web/components/portfolio/RiskSurface.tsx` | +286 | ✓ — 4-cell horizontal block + drawer; my est ~280 |
| `apps/web/components/portfolio/PositionRiskBadge.tsx` | +102 | ✓ — 4-char status code; my est ~120 |
| `apps/web/lib/api.ts` | +53 | ✓ — `risk-portfolio-api` zod helper; my est ~80 |
| `apps/web/app/portfolio/page.tsx` | +55/-5 | ✓ — wire RiskSurface above positions table; my est ~60 |
| board entry | +6 | self-documented |

**Total**: +497/-5 LOC vs my §10 estimate of ~620 LOC frontend (~80+280+120+60+40+0 client). Codex shipped *tighter* than estimate — efficient. **All 5 frontend files match my design 1:1**. Codex even mapped my Q1-Q8 defaults (e.g. cell click → `/risk/limits?layer=...` per Q6 default, `[OK]/[WARN]/[BLOCK]/[KILL]/[NO LIMIT]` status labels per §5).

**Verification at 17:03 (HEAD `13ca56a`)**:
- Read `RiskSurface.tsx:1-80`: confirms `RiskSurfaceState` is `LIVE | BLOCKED` only (no silent mock fallback per my §7.4 hard rule). Util clamped 0-1. Status tone uses CRT phosphor palette vars (var(--gold-bright) for warn, var(--tw-up-bright) for block).
- Stop-line grep `apps/web` for `broker\.submit|live\.submit|kgi-broker|/order/create`: 1 hit (docs file, expected). 0 actual broker-write paths. ★ Codex did NOT introduce broker call despite scaffolding new component.
- 4-state hard rule: ✓ scaffold defaults to BLOCKED until backend `/api/v1/risk/portfolio-overview` ships (which requires Jason — currently OFFLINE)

**Working tree**: clean.

**Block 1 status (5/1 12:33 → 24:00, ~7h remaining)**:
| Lane | Owner | Status |
|---|---|---|
| A — Codex Contract 1 + RiskSurface scaffold | Codex | LIVE-pushing; 4-state convergence + design-execute-loop now active |
| B — Elva design docs | Elva | **7 docs DONE** — risk-persist 修正 / session-layer / OpenAlice / Contract 4 promote / Contract 2 portfolio risk badge UI / **paper E2E live demo runbook 5/4 (本 cycle)** / P1-7 K-line Codex-自助 cover |
| C — Bruce regression | Bruce | Bash dead 9th session, static audit DONE @ 22363e4 |
| D — Jason 0020 v2 | Jason | OFFLINE (Codex wired RiskSurface to Jason-pending route — UI gracefully BLOCKED until Jason ships aggregator) |

**Yellow / Red events**: 0 / 0.

**This cycle's deliverable**: `evidence/w7_paper_sprint/paper_e2e_live_demo_runbook_2026-05-04.md` — 10-section operational runbook for **the W7 sprint goal** (first paper E2E live demo). 10-item pre-open checklist / 8-step demo sequence Step A-H / 9 success criteria / 10 hard lines / evidence bundle structure / backup plan / pre-demo deps matrix / 8 open Q for 楊董. Targets 5/4 (Mon) 09:00 → 09:30 demo window.

**Block 1 design coverage status — 7 P1 docs in 4.5 hours (12:33→17:03)**:
- ✓ P1-1 Contract 2 Portfolio + 4-layer risk badge UI design (16:43)
- ✓ P1-3 Contract 4 idea→paper promote pipeline (16:23)
- ✓ P1-5 Risk persistence stale claim corrected (13:46)
- ✓ P1-6 Session-layer risk schema design (13:46)
- ✓ P1-7 K-line UI — Codex 自主接管 (15:54-16:23)
- ✓ P1-8 **Paper E2E live demo runbook for 5/4 09:00 (本 cycle)**
- ✓ P1-11 OpenAlice 100-co exposure batch design (15:54)

**Bonus**: Codex began executing Contract 2 P1-1 frontend (`13ca56a`) before Block 1 ends — design→impl loop now active.

**Next 20min (17:23 cadence)**:
1. Verify next Codex commits stop-line clean
2. Standby for Jason / 0020 v2 trigger (no probe — ASYNC)
3. Pick next P1 design — candidate: **P1-2 Watchlist UI design** (mirrors Contract 2 patterns) OR **P1-9 idempotency live verify checklist for 5/4 demo**
4. Cycle entry write-back

---

### 2026-05-01 16:43 Taipei — Elva cadence: 68h sprint Block 1, 20min #2

**Codex burst recap since 16:23 (2 commits — burst slowing as Codex hits steady state)**:
- `a990790` hide blocked plan and lab metrics
- `12c591c` hide company registry counts when source blocks

Aggregate diff scope: continued surface BLOCKED-not-EMPTY truthfulness on plans/lab + companies registry. No new contract entity, no migration, no broker write.

**Verification at 16:43 (HEAD `12c591c`)**:
- Stop-line grep `apps/web` for `broker\.submit|live\.submit|kgi-broker|/order/create`: 1 hit (docs file, expected). 0 actual broker-write paths.
- 4-state hard rule: still strictly enforced; commits add fail-closed BLOCKED branches across 2 more pages
- No new working-tree diff observed

**Working tree**: clean.

**Block 1 status (5/1 12:33 → 24:00, ~7.3h remaining)**:
| Lane | Owner | Status |
|---|---|---|
| A — Codex Contract 1 + truthfulness | Codex | LIVE-pushing, burst slowing (~6 commits/hour vs prior 24/hour); approaching 4-state convergence |
| B — Elva design docs | Elva | **6 docs DONE** — risk-persist 修正 / session-layer / OpenAlice / Contract 4 promote / **Contract 2 portfolio risk badge UI (本 cycle)** / P1-7 K-line Codex-自助 cover |
| C — Bruce regression | Bruce | Bash dead 9th session, static audit DONE @ 22363e4 |
| D — Jason 0020 v2 | Jason | OFFLINE |

**Yellow / Red events**: 0 / 0.

**This cycle's deliverable**: `evidence/w7_paper_sprint/contract_2_portfolio_4layer_risk_ui_design_2026-05-01.md` — 12-section P1-1 design for **portfolio + 4-layer risk badge**. New entity `RiskPortfolioOverview`、1 backend route (no new migration, reuses risk-store)、`RiskSurface.tsx` 4-cell horizontal block + drawer、`PositionRiskBadge.tsx` 4-char status code (`OWBN` style)、4-state strict (BLOCKED never renders as `[OK]`)、12/12 hard-line PASS、~970 LOC / ~18.5h e2e、W8 D1-D3 sequenced。8 open Q for 楊董。

**Block 1 design coverage status — 6 P1 docs in 4 hours (12:33→16:43)**:
- ✓ P1-1 Contract 2 Portfolio + 4-layer risk badge UI design (本 cycle)
- ✓ P1-3 Contract 4 idea→paper promote pipeline (16:23 cycle)
- ✓ P1-5 Risk persistence stale claim corrected (13:46 cycle)
- ✓ P1-6 Session-layer risk schema design (13:46 cycle)
- ✓ P1-7 K-line UI — **Codex 自主接管不需 Elva design** (15:54-16:23 cycle)
- ✓ P1-11 OpenAlice 100-co exposure batch design (15:54 cycle)

Remaining P1 design needs: P1-2 Watchlist (depends on P1-1 portfolio patterns), P1-4 KGI WS (gated on operator), P1-8 paper E2E live demo plan, P1-9 idempotency live verify, P1-10 order-detail timeline filter. Most are operator-gated or depend on other P1 work — write further design only if Codex / Jason haven't auto-covered.

**Next 20min (17:03 cadence)**:
1. Verify next Codex commits stop-line clean
2. Standby for Jason / 0020 v2 trigger (no probe — ASYNC)
3. Pick next P1 design — candidate: **P1-8 paper E2E live demo runbook for 5/4 09:00 open** OR **P1-2 Watchlist UI design** (mirrors Contract 2 patterns, depends on Contract 3 backend)
4. Cycle entry write-back

---

### 2026-05-01 16:23 Taipei — Elva cadence: 68h sprint Block 1, 20min mode

**Trigger**: 楊董出門前指示「每20分鐘自主推進」+「一堆紅字好好處理」 → cadence 60→20min, PowerShell git stderr 改用 `2>$null`，新 memory `feedback_powershell_git_red_noise.md` 落地。

**Codex burst recap since 15:54 (8 commits)**:
- `86a73b8` block theme detail panels when source unavailable
- `e0857e7` hide theme totals when source is blocked
- `053c226` block strategy run summaries when source unavailable
- `9c2d60e` hide idea and signal counts when sources block
- `7486efb` classify empty and blocked company kline states
- `8a749d7` **wire quote kline to production ohlcv** ★ P1-7 K-line UI Codex 自主接管
- `805f447` hide market intel counts when source blocks
- `e72e3b0` block mobile dependent sections when source unavailable

Aggregate diff (94df067..e72e3b0): **11 source files +267/-119**, 11 pages tightened — themes / theme detail / runs list / runs detail / ideas / signals / company detail + OHLCV chart / quote / market-intel / mobile. Codex 自己也加了 8 條 board entry（cycle 16:05/16:06/16:09/16:11/16:15/16:18/16:20/16:22）每條都標 typecheck PASS / build PASS / no broker write / no migration 0020。

**Key deliverable from Codex this cycle**: `apps/web/app/quote/page.tsx` K-line panel 改吃 production OHLCV (`GET /api/v1/companies/:id/ohlcv?interval=1d`) — 取代之前 "static blocked placeholder claiming no bars contract exists"。**P1-7 (K-line UI 用 KGI K-bar Phase 2 backend) 不需 Elva 寫 hand-off design — Codex 自主完成**。

**Verification at 16:23 (HEAD `e72e3b0`)**:
- Stop-line grep `apps/web` for `broker\.submit|live\.submit|kgi-broker|/order/create`: 1 hit (`apps/web/docs/paper_trading_api_binding_contract_2026-04-29.md` design doc — expected). 0 actual broker-write paths.
- Codex per-cycle typecheck + build PASS (記錄在每條 board entry)；本 cycle 接受 Codex 自證
- 4-state hard rule: 8 commits 全部主軸是「拒絕把 BLOCKED 顯示為 EMPTY 的零值/假時戳/假 count」，4-state 條件更嚴而非更寬
- 木馬風險 grep: `auto.*submit|broker.*submit` apps/web → 0 hit (excluding docs)

**Working tree**: clean.

**Block 1 status (5/1 12:33 → 24:00, ~7.5h remaining)**:
| Lane | Owner | Status |
|---|---|---|
| A — Codex Contract 1 + truthfulness + K-line | Codex | LIVE-pushing ~24 commits/hour, polish + K-line wiring 都做完 |
| B — Elva design docs (P1-3/-5/-6/-7/-11) | Elva | **5 docs DONE** — risk-persist 修正 / session-layer / OpenAlice / **Contract 4 promote (本 cycle)** / P1-7 K-line **由 Codex 自己 cover** |
| C — Bruce regression | Bruce | Bash dead 9th session, static audit DONE @ 22363e4 |
| D — Jason 0020 v2 | Jason | OFFLINE |

**Yellow / Red events**: 0 / 0. No stop-line violation. No live broker write. No 0020 promote. No Codex working-tree pickup. No secret rotation.

**This cycle's deliverable**: `evidence/w7_paper_sprint/contract_4_idea_to_order_promote_design_2026-05-01.md` — 12-section P1-3 design for **research → execution closed loop**. New entity `IdeaPromotionPreview`、4 routes、migration `0022_idea_promotion_log.sql`、frontend "PROMOTE → TICKET" button + PaperOrderPanel hydration、4-layer risk advisory (advisory only, real block at submit)、12/12 hard-line PASS、~980 LOC / ~22.5h end-to-end、W8 D1-D5 (5/5→5/9) sequenced，**5/9 paper E2E deadline 內可達**。9 open Q for 楊董，每題有 Elva default。

**Next 20min (16:43 cadence)**:
1. Verify next Codex commit batch stop-line clean (預期 K-line 後續 polish)
2. Standby for Jason / 0020 v2 trigger (no probe — ASYNC)
3. 寫 P1-1 Portfolio + 4-layer risk badge UI design draft (next P1 still queued)
4. Cycle entry write-back

---

### 2026-05-01 15:54 Taipei — Elva cadence: 68h sprint Block 1 final-third checkpoint

**Codex burst recap since 14:51 (13 commits, all `apps/web/**` truthfulness polish)**:
- `f3c272b` tighten company paper order source text
- `f322835` classify empty paper ledgers truthfully
- `87716e8` show source freshness on dashboard market strip
- `ee32e1f` report partial market intel coverage
- `13ddfc6` expose partial market intel coverage
- `5a6d90a` remove static companies catalog count
- `c45c675` expose companies registry state
- `88f2f59` hide non-live mobile metric placeholders
- `3f592b9` use market overview generated timestamp
- `4ffd680` show freshness on empty review surfaces
- `0440d8e` fail closed without portfolio kill state
- `88514fd` block dependent plan panels when source unavailable
- `119914f` show frozen kill state without payload

Aggregate diff (7004030..119914f): **13 files, +203/-66** across `app/admin/content-drafts/` (3 files) + `app/briefs/` + `app/companies/[symbol]/PaperOrderPanel.tsx` (+16/-? truthfulness) + `app/companies/page.tsx` (+44/-?) + `app/drafts/` + `app/m/page.tsx` (+22/-?) + `app/market-intel/page.tsx` (+15/-?) + `app/page.tsx` (+62/-?) + `app/plans/page.tsx` (+29/-?) + `app/portfolio/page.tsx` (+22/-?) + `app/reviews/` + `components/portfolio/OrderTicket.tsx` (+29/-?). Net +137 LOC — adding source/freshness/state badges across most pages.

**Verification at 15:54 (HEAD `119914f`)**:
- Stop-line grep `apps/web` for `broker\.submit|live\.submit|kgi-broker|/order/create`: 1 hit (`apps/web/docs/paper_trading_api_binding_contract_2026-04-29.md` design doc — expected). 0 actual broker-write paths in code.
- pnpm typecheck NOT runnable from this shell (PowerShell exec policy blocks pnpm.ps1) — accept Codex's own per-cycle CI as authority; previous cycle 14:51 PASS at `2408853`, cleanup since then is presentation-only edits inside React components, no contract/router change. Will revisit if Bruce's Bash recovers.
- 4-state hard rule: still LIVE/EMPTY/BLOCKED/HIDDEN; commits explicitly add source-state metadata or fail-closed kill-state branches; net direction is **more truthful**, not less.

**Working tree** (still NOT my lane to touch):
- `.gitignore` modified, unstaged
- `apps/web/app/ops/page.tsx` modified, unstaged
- Codex still owns these. No pickup.

**Block 1 status (5/1 12:33 → 24:00, ~8h remaining)**:
| Lane | Owner | Status |
|---|---|---|
| A — Codex Contract 1 + truthfulness polish | Codex | LIVE-pushing ~24 commits/hour, polish phase, no slowdown |
| B — Elva design docs (P1-5/P1-6/P1-11) | Elva | **ALL 3 DONE** (risk-persist correction `a5a9d3a` / session-layer `a5a9d3a` / OpenAlice 100-co batch this cycle) |
| C — Bruce regression | Bruce | Bash dead 9th session, static audit DONE @ 22363e4 |
| D — Jason 0020 v2 | Jason | OFFLINE |

**Yellow / Red events**: 0 / 0. No stop-line violation. No live broker write. No 0020 promote. No Codex working-tree pickup. No secret rotation.

**This cycle's deliverable**: `evidence/w7_paper_sprint/openalice_100co_exposure_batch_design_2026-05-01.md` — 11-section operational design for P1-11. Universe SQL by `coverage_priority_score`, prompt YAML using gpt-5.4-mini, ~$0.034 per batch / ~50s wall-clock at 2 RPS, 5-dim scoring, Stages A-F pipeline, 9-rule hard-line matrix all PASS, ~6h total effort (~5h impl + ~1h operator review). Gated on 楊董 ACK + Codex Contract 1 cleanup + Jason 0020 v2 merge.

Plus: `evidence/w7_paper_sprint/INDEX.md` §9 added — full Day 2 (2026-05-01) deliverables index covering 9.1 (frontend pivot — Codex board + work order + autonomy rule) / 9.2 (backend — Jason 5 contracts + 0020 v2 + session-layer schema) / 9.3 (Bruce 4-state harness + morning smoke + Contract 1+5 readiness) / 9.4 (PR #39 standby Mike+Pete) / 9.5 (Elva governance + roadmap + OpenAlice + spot-check) / 9.6 (hard-line state) / 9.7 (Block 1-4 forward path).

**Next 60min (16:54 cadence)**:
1. Verify next Codex commit batch stop-line clean
2. Standby for Jason / 0020 v2 trigger (no probe — ASYNC)
3. If no new dispatch trigger: pick up next P1 design doc — candidate is **P1-7 K-line UI design hand-off** (use KGI K-bar Phase 2 backend already wired), or **P1-3 Contract 4 strategy idea→order promote pipeline design**.
4. Cycle entry write-back; if Block 1 closes at midnight: write Block 1 closeout doc.

---

### 2026-05-01 14:51 Taipei — Elva cadence: 68h sprint Block 1 mid-late checkpoint

**Codex burst recap since 13:46 (10 commits, all `apps/web/**`)**:
- `1d3b507` remove fake auth footer version
- `00b9bd3` clean document title metadata
- `7d4729b` make company source status truthful
- `e01cd80` clean ohlcv chart truthfulness wording
- `bcd136b` remove static post-close session label
- `4c577d8` make company master labels readable
- `b52bb26` render command palette state rows as notes
- `ba1cc1b` remove unused decorative widget helpers
- `2408853` remove unused block spark helper
- `a3412da` docs(w7): record frontend smoke and ci status

Aggregate diff (a5a9d3a..2408853): **31 files, +991/-1648 (net -657 LOC)**. Codex now in cleanup phase — retiring fake/decorative widgets that survived the wire-live phase.

**Verification at 14:51 (HEAD `2408853`)**:
- `pnpm typecheck` PASS (clean tsc -p tsconfig.json --noEmit)
- Stop-line grep `apps/web` for `broker.*submit|live.*submit|kgi.*broker|order/create`: 5 hits, all confirmed false positives (UI state machine `submit.status === "live"` + 3 hard-line marker comments + 1 LabClient note "does not enable live submit"). 0 actual broker-write paths.
- 4-state hard rule: still LIVE/EMPTY/BLOCKED/HIDDEN; no fake mock fallback introduced.
- `radar-lab.ts` -230 LOC — earlier Cycle 8 B12 working tree finally committed by Codex with the production fail-closed pattern intact.

**Working tree** (still NOT my lane to touch):
- `.gitignore` modified, unstaged (Codex still has it on its plate)
- All previously `D` files now committed (no longer in working tree)

**Block 1 status (5/1 12:33 → 24:00, ~9h remaining)**:
| Lane | Owner | Status |
|---|---|---|
| A — Codex Contract 1 + cleanup | Codex | LIVE-pushing ~24 commits/hour, cleanup phase, no slowdown |
| B — Elva session-layer schema | Elva | DONE (`session_layer_risk_schema_design_2026-05-01.md` committed `a5a9d3a`) |
| C — Bruce regression | Bruce | Bash dead, static audit DONE @ 22363e4 |
| D — Jason 0020 v2 | Jason | OFFLINE |

**Yellow / Red events**: 0 / 0. No stop-line violation. No live broker write. No 0020 promote. No Codex working-tree pickup. No secret rotation.

**Pivot note**: Block 1 original B-lane scope (risk persist + session schema + OpenAlice 100-co batch design) is now (a) DONE for risk persist correction, (b) DONE for session schema, (c) NOT STARTED for OpenAlice batch design. Will pick up OpenAlice 100-co batch design next cycle.

**Next 60min (15:51 cadence)**:
1. Write OpenAlice 100-company exposure batch design doc (P1-11)
2. Update `evidence/w7_paper_sprint/INDEX.md` (if exists, else create) with today's docs
3. Verify any new Codex commits stop-line clean
4. Standby for Jason / 0020 v2 trigger

---

### 2026-05-01 13:46 Taipei — Elva cadence: 68h sprint Block 1 mid-checkpoint

**Trigger**: 60min cadence on (12:33 dispatch + 13:33 plan checkpoint + 13:46 Codex burst verification fold-in).

**Codex burst recap (12:42 → 13:38, ~14 commits to main)**:
- `54a6041` Contract 1 paper orders wiring (PaperOrderPanel +584/-220, OrderTicket +878/-214, new `paper-orders-api.ts` +193, lib/api +38)
- `17b8049` dashboard live; `5d615b5` ideas live; `2c9baba` strategy runs live; `399ecd6` signals/themes live; `2e86f95` theme detail live
- `2dafaae` plans live; `5bfe76d` ops live; `a893309` mobile live; `8ce3e46` portfolio live (full kill-switch real reads + paper risk surface)
- `40d2267` retire remaining radar-api consumers; `b2b17cc` portfolio placeholder type drop; `8bd2e98` retire legacy radar mock layer; `211c1c7` dormant quote mock widgets removed

**Verification at 13:42 (HEAD `8bd2e98`)**:
- `pnpm typecheck` PASS (clean tsc -p tsconfig.json --noEmit)
- `pnpm build` PASS (full Next.js bundle, /portfolio 5.96kB, all routes compiled)
- Stop-line grep `apps/web/lib/paper-orders-api.ts`: 0 matches mock|placeholder|TODO|FIXME|fake
- Stop-line grep `apps/web/**` live submit patterns: only legitimate hard-line markers (`// HARD LINE: never import KGI SDK or call broker live submit path.`, "Submit remains paper-only and creates no broker/live order")
- 4-state hard rule: every wired endpoint shows source + updatedAt + LIVE/EMPTY/BLOCKED branch (per Codex's own per-cycle log)

**Working tree note (NOT my lane to touch)**:
- 18 `D` (deleted, unstaged) component files — `RadarCandlestickChart.tsx`, `RadarDataStateBadge.tsx`, `boot-sequence.tsx`, etc. — Codex still mid-burst retiring legacy mock components.
- `.gitignore` modified, unstaged.
- Will NOT pick up Codex working tree (Codex is active; B12 lesson learned).

**Bruce backend Contract 1-5 audit** (committed `22363e4` on Bruce's behalf — Bash dead 9th session):
- C1 Paper Orders = READY (5 routes, idempotency 409 PASS, gate ARMED, 0 KGI calls)
- C2 Portfolio = BLOCKED (routes absent — Jason ETA Day 4-5)
- C3 Watchlist = BLOCKED (routes absent — Jason ETA Day 4-5)
- C4 Strategy idea→order = PARTIAL (4a-4d READY, 4e promote-to-order no impl)
- C5 KGI Bidask = PARTIAL (read at server.ts:2556/2617, gateway ops BLOCKED, 5c WS not implemented)

**Stale memory correction (P1-5 risk persist gap is INVALID)**:
- `apps/api/src/risk-store.ts:1-64` already file-backed via `RAILWAY_VOLUME_MOUNT_PATH ?? "/data"` + atomic tmp→rename + `hydrateRiskEngine(state)` on boot rehydrates 4 stores (limits, killSwitch, strategyLimits, symbolLimits).
- Memory + roadmap claim "P1-5 in-memory only" was wrong. Will correct in `institutional_grade_roadmap_2026-05-01.md` next push and update relevant memory entries.

**Block 1 lane status (5/1 12:33 → 24:00, ~10h remaining)**:
| Lane | Owner | Status |
|---|---|---|
| A — Codex Contract 1 wiring | Codex | LIVE-pushing (14 commits, still mid-burst) |
| B — Elva risk persist + session schema design | Elva self | RESCOPED — risk persist already done; pivot to Session layer schema (P1-6) only |
| C — Bruce regression sweep | Bruce | Bash dead, static audit DONE; static-only path until tooling fixed |
| D — Jason 0020 v2 standby | Jason | OFFLINE (Mike + Pete templates ready) |

**Yellow / Red events**: 0 / 0. No stop-line violation. No live broker write. No 0020 promote. No secret rotation. No Codex working-tree pickup.

**Next 60min (14:46 cadence)**:
1. Update institutional_grade_roadmap §3 P1-5 → mark CORRECTION (already done) + bump P1-6 Session layer to P1-5 priority
2. Write Session layer schema design doc (4th risk layer: open-to-close 限額 + 當日緊急停損)
3. Verify 0 stop-line violations in latest Codex commits (post `211c1c7`)
4. Standby for Jason / Pete review trigger

---

### 2026-05-01 13:38 Taipei - Codex cycle: legacy RADAR mock layer retired
- Now: Removed the unused legacy RADAR client/components that kept placeholder schemas and mock datasets alive in `apps/web`. Company detail adapter no longer invents market cap, score, FII, intraday, or quote values; missing non-contracted fields now render EMPTY/BLOCKED instead of generated numbers.
- Files: deleted `apps/web/lib/radar-api.ts`, `apps/web/lib/radar-mocks.ts`, `apps/web/lib/radar-types.ts`, `apps/web/components/Chart.tsx`, unused `apps/web/components/research/*`, and unused legacy portfolio client/table/override widgets. Updated `apps/web/lib/company-adapter.ts`, `apps/web/app/companies/[symbol]/page.tsx`, and `CompanyHeroBar.tsx`.
- Endpoints: no new backend writes. Company detail still uses `GET /api/v1/companies`, `GET /api/v1/companies/:id/ohlcv`, `GET /api/v1/companies/:id/announcements`, plus existing client panels for financials/chips where available.
- Behavior: OHLCV rows with `source=mock` are filtered before chart/quote rendering. Quote badge now says EMPTY when no production bar exists. Company KPIs that do not have real contracted data show `--` or BLOCKED, not deterministic fallback values.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact scan for `radar-types`, `radar-api`, `radar-mocks`, old research imports, and old portfolio widgets returns zero rows.
- Blockers: broader scan still finds other mock-named files/components (`mock-kbar`, `kgi-quote-mock`, blocked quote/chart panels). These need separate treatment: either bind to real quote/K-line endpoints or keep HIDDEN/BLOCKED.

### 2026-05-01 13:29 Taipei - Codex cycle: production portfolio no longer depends on placeholder `radar-types`
- Now: Removed `@/lib/radar-types` from the active `/portfolio` page, kill-switch control, paper order ticket, and idea handoff path. Kept the paper ticket read/write behavior bounded to existing paper-order endpoints; live broker submit remains untouched.
- Files: `apps/web/app/portfolio/page.tsx`; `apps/web/components/portfolio/KillSwitch.tsx`; `apps/web/components/portfolio/OrderTicket.tsx`; `apps/web/lib/radar-handoff.ts`; `apps/web/components/SendToTicketButton.tsx`.
- Endpoints: unchanged from prior portfolio work: paper-order preview/submit/status/list/cancel through `paper-orders-api.ts`, plus real risk/kill-switch reads from `/api/v1/risk/*`.
- Behavior: `KillMode` is now a portfolio UI type instead of a placeholder schema type. Idea handoff stores only the minimal live/paper-ticket payload (`symbol`, `side`, `rationale`, `themeCode`, `emittedAt`) and accepts real strategy idea shapes without importing the old mock domain model.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: residual `@/lib/radar-types` imports remain only in legacy shared/research components and unused old portfolio client/table widgets. Next cycle can either retire unused legacy components or migrate them to contract types.

### 2026-05-01 13:24 Taipei - Codex cycle: final visible `radar-api` adapter consumers removed
- Now: Removed the remaining visible `@/lib/radar-api` consumers from the global data-source badge, root command palette, and execution timeline component. `apps/web` no longer imports the old mock adapter anywhere.
- Files: `apps/web/components/DataSourceBadge.tsx`; `apps/web/components/CommandPalette.tsx`; `apps/web/components/portfolio/ExecutionTimeline.tsx`.
- Endpoints: `GET /api/v1/session`; `GET /api/v1/themes`; `GET /api/v1/companies`; `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`; `GET /api/v1/strategy/runs?decisionMode=paper&sort=created_at`; `GET /api/v1/trading/events`; `GET /api/v1/trading/stream`.
- Behavior: badge now reports LIVE or BLOCKED from the real session endpoint, never MOCK. Command palette lazy-loads real themes/companies/ideas/runs and renders BLOCKED/EMPTY when backend data is unavailable. Execution timeline reads paper-default execution events and uses the real stream helper with polling fallback; no mock event stream remains.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact `@/lib/radar-api` scan under `apps/web` returns zero rows; `git diff --check` PASS for changed files.
- Blockers: old `apps/web/lib/radar-types.ts` placeholder types still have residual imports in legacy shared components; no `radar-api` mock adapter imports remain. Next cycle should retire or replace those placeholder-type consumers without touching backend, broker, migrations, or secrets.

### 2026-05-01 13:15 Taipei - Codex cycle: `/portfolio` real paper trading surface DONE
- Now: Converted `apps/web/app/portfolio/page.tsx` from legacy `@/lib/radar-api` mock-shaped `PortfolioClient` inputs into a server-side production paper trading/risk surface. Page-level `@/lib/radar-api` imports under `apps/web/app/**` are now zero.
- Files: `apps/web/app/portfolio/page.tsx`.
- Endpoints: `GET /api/v1/trading/balance`; `GET /api/v1/trading/positions`; `GET /api/v1/trading/orders`; `GET /api/v1/trading/events`; `GET /api/v1/risk/limits`; `GET /api/v1/risk/strategy-limits`; `GET /api/v1/risk/symbol-limits`; `GET /api/v1/risk/kill-switch`, all scoped to `accountId=paper-default`.
- Behavior: page renders LIVE / EMPTY / BLOCKED with source + updatedAt; keeps the already-wired Paper Order Ticket; reads real kill-switch state; shows real paper balance/positions/orders/events/risk limits. Kill-switch writes remain disabled; live broker submit remains out of scope.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `Get-ChildItem apps/web/app -Recurse -Include *.tsx | Select-String '@/lib/radar-api'` returns zero rows.
- Blockers: no remaining page-level `radar-api` usage. Residual cleanup can move to unused legacy client/components/libs later, but production pages are no longer importing the mock adapter.

### 2026-05-01 13:12 Taipei - Codex cycle: mobile `/m` + `/m/kill` real read paths DONE
- Now: Converted `apps/web/app/m/page.tsx` from legacy `@/lib/radar-api` mock mobile brief to real briefs/themes/strategy ideas/market overview/kill-switch data. Converted `apps/web/app/m/kill/page.tsx` from mock session kill mode to real kill-switch read endpoint.
- Files: `apps/web/app/m/page.tsx`; `apps/web/app/m/kill/page.tsx`.
- Endpoints: `GET /api/v1/briefs`; `GET /api/v1/themes`; `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`; `GET /api/v1/market-data/overview`; `GET /api/v1/risk/kill-switch?accountId=paper-default`.
- Behavior: mobile brief renders LIVE / EMPTY / BLOCKED and no longer shows mock countdown/events/heat/watchlist. Mobile kill switch reads real state but all mode buttons remain disabled; write path stays BLOCKED pending backend governance, audit, risk regression, and operator approval.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none for mobile read paths. Next: diff check + commit/push; then assess `/portfolio` separately because its client still uses legacy `radar-types` and needs a narrower adapter or backend readiness.

### 2026-05-01 13:08 Taipei - Codex cycle: `/ops` real ops snapshot DONE
- Now: Converted `apps/web/app/ops/page.tsx` from legacy `@/lib/radar-api` mock API probes/jobs/audit to production ops snapshot data.
- Files: `apps/web/app/ops/page.tsx`.
- Endpoint: `GET /api/v1/ops/snapshot?auditHours=24&recentLimit=12`.
- Behavior: page renders LIVE / EMPTY / BLOCKED with source + updatedAt. Removed fake endpoint latency/error-rate rows and fake worker jobs; now shows workspace stats, OpenAlice observability/queue, latest rows, audit summary, and recent audit rows from the ops snapshot payload.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none for ops snapshot read path. Next: diff check + commit/push; continue `/m` and `/portfolio` legacy `radar-api` cleanup.

### 2026-05-01 13:06 Taipei - Codex cycle: `/plans` real planning surface DONE
- Now: Converted `apps/web/app/plans/page.tsx` from legacy `@/lib/radar-api` mock brief/review/weekly/risk/events into a read-only production planning board.
- Files: `apps/web/app/plans/page.tsx`.
- Endpoints: `GET /api/v1/plans`; `GET /api/v1/companies`; `GET /api/v1/themes`; `GET /api/v1/signals`; `GET /api/v1/briefs`; `GET /api/v1/reviews`; `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`.
- Behavior: page renders LIVE / EMPTY / BLOCKED with source + updatedAt. Removed unsupported mock weekly rotation, mock PnL, fake risk snapshot, fake execution events, and fake order action. Planning page is explicitly read-only; order controls stay in approved paper-order UI only.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none for read-only plan board. Next: diff check + commit/push; then continue `/ops`, `/m`, `/portfolio` legacy `radar-api` cleanup.

### 2026-05-01 13:03 Taipei - Codex cycle: `/themes/[short]` real detail DONE
- Now: Converted `apps/web/app/themes/[short]/page.tsx` from legacy `@/lib/radar-api` mock detail to a real theme detail view using theme slug lookup plus DB-backed companies/signals and strategy ideas filtered by theme id.
- Files: `apps/web/app/themes/[short]/page.tsx`.
- Endpoints: `GET /api/v1/themes`; `GET /api/v1/companies`; `GET /api/v1/signals?themeId=:id`; `GET /api/v1/strategy/ideas?themeId=:id&decisionMode=paper&includeBlocked=true&sort=score`.
- Behavior: page renders LIVE / EMPTY / BLOCKED with source + updatedAt. Removed mock heat/pulse/member metrics and fake order action; company/idea rows link only to company detail.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none for theme detail read path. Next: diff check + commit/push; continue legacy `radar-api` cleanup on `/plans`, `/ops`, `/m`, `/portfolio`.

### 2026-05-01 13:01 Taipei - Codex cycle: `/signals` + `/themes` real endpoints DONE
- Now: Converted `apps/web/app/signals/page.tsx` from legacy `@/lib/radar-api` signal mocks to real `getSignals()` with theme/company id mapping from real theme/company endpoints. Converted `apps/web/app/themes/page.tsx` from heat/pulse mock ladder to real `getThemes()` rows.
- Files: `apps/web/app/signals/page.tsx`; `apps/web/app/themes/page.tsx`.
- Endpoints: `GET /api/v1/signals`; `GET /api/v1/themes`; `GET /api/v1/companies`.
- Behavior: both pages render explicit LIVE / EMPTY / BLOCKED states with source + updatedAt. Theme list removed unsupported heat/pulse/mock momentum values and displays only DB-backed priority, marketState, lifecycle, core/observation pool counts, thesis, and updatedAt.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: `/themes/[short]` still legacy radar-api and must be converted before theme drilldown is fully truthful. Next: diff check + commit/push; then wire `/themes/[short]`.

### 2026-05-01 12:58 Taipei - Codex cycle: `/runs` real strategy endpoints DONE
- Now: Converted `apps/web/app/runs/page.tsx` and `apps/web/app/runs/[id]/page.tsx` from legacy `@/lib/radar-api` mock-shaped run data to production strategy run endpoints.
- Files: `apps/web/app/runs/page.tsx`; `apps/web/app/runs/[id]/page.tsx`.
- Endpoints: `GET /api/v1/strategy/runs?decisionMode=paper&sort=created_at`; `GET /api/v1/strategy/runs/:id`.
- Behavior: run list/detail now render explicit LIVE / EMPTY / BLOCKED states with source + updatedAt; detail page removed fake `/portfolio` ORDER action and exposes company detail links only. Execute/order controls remain hidden until backend and risk gates approve them.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web/app/runs/page.tsx apps/web/app/runs/[id]/page.tsx` PASS.
- Blockers: none for run read paths. Next: commit/push this scoped change; continue legacy `radar-api` cleanup on signals/themes/plans/mobile/ops as safe.

### 2026-05-01 12:53 Taipei - Codex cycle: `/ideas` real strategy endpoint DONE
- Now: Converted `apps/web/app/ideas/page.tsx` from legacy `@/lib/radar-api` mock-shaped ideas to `getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 30, sort: "score" })`.
- Files: `apps/web/app/ideas/page.tsx`.
- Endpoint: `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`.
- Behavior: page now renders explicit LIVE / EMPTY / BLOCKED states with source + updatedAt; removed fake `/portfolio` order action and replaced row action with read-only company detail link. Strategy idea -> order handoff remains BLOCKED until Contract 4 promote route is approved.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web/app/ideas/page.tsx evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` PASS.
- Blockers: none for `/ideas` read path. Next: commit/push this scoped change; continue to `/runs` legacy radar-api cleanup.

## Current State

- Auth cookie/domain: DONE.
- Sidebar logout: DONE.
- API health: PASS after deployment.
- Company 2330 with authenticated cookie: PASS.
- Production no-silent-mock policy: IN PROGRESS; B10/B11 wrapper-level production fallback fixed in Codex cycle 02:48, B12 Quant Lab fallback fixed in Codex cycle 03:40, kill-switch mock writes removed in Codex catch-up cycle 12:10.
- Market Intel/news lane: IN PROGRESS; company detail panel [05] now binds TWSE announcements through the shared API client.
- Build-time mock static HTML risk: MITIGATED in Codex catch-up cycle 12:30; legacy `radar-api` pages now force dynamic request-time render.
- Paper Orders Contract 1 frontend wiring: DONE in Codex catch-up cycle 12:41; portfolio order ticket and company-side panel now call real paper preview/submit/status/list/cancel endpoints through `paper-orders-api.ts`.
- Dashboard real-data conversion + Market Intel/news column: DONE in Codex catch-up cycle 12:49; `/` now uses real market-data overview, themes, strategy ideas/runs, signals, and TWSE material announcements.
- Full mock/placeholder removal: OPEN.

## Path Locks

**Jim D1 production path handed off to Codex at 2026-05-01 01:42 Taipei, main/origin main = e231201.**

Codex active ownership (post-handoff):

- `apps/web/app/**`
- `apps/web/components/**`
- `apps/web/lib/**`
- `apps/web/app/globals.css`

**Local Jim branch `jim/w7-d-ui-deplumbing-2026-04-30 @ ab8cfe8` is NOT merged and is path-locked pending Elva disposition.**

Elva disposition (2026-05-01 01:42 Taipei): **DEPRECATED / SUPERSEDED**.
- Branch is not main ancestor; merging would delete 13,022 lines including `secret_inventory.md`, `services/market-agent/**`, migrations 0017-0019, W5/W6/W7 evidence — all landed via newer PRs.
- The "deplumb decoratives" intent appears already covered by `d6e907b feat(ui): deplumb decoratives + fix companies 3470 symbols (#28)` already on main.
- **Codex: 不擋你，可以動 `apps/web/**`，這條 branch 不會被 merge。** 若 Pete 後續審出有 Codex 應參考的 deplumb 細節，會單獨開小 PR 補。

Elva/Jason/Bruce should mark active conflicts here before editing same files.

Active backend lanes (Jason scope, Codex 不踩):
- `apps/api/src/paper/**`, `apps/api/src/risk/**`, `apps/api/src/broker/**`
- `apps/api/src/audit/**`, `apps/api/src/worker/**`
- `packages/db/migrations/**`

## Backend Ready

Bruce 4-state harness v1 DONE @ 2026-05-01 02:00 Taipei → evidence/w7_paper_sprint/bruce_4state_harness_v1_2026-05-01.md

Bruce Cycle 3 regression sweep DONE @ 2026-05-01 ~02:54 Taipei → B10 RESOLVED / B11 RESOLVED / B12 NEW (radar-lab.ts no IS_PROD guard, /lab + /lab/[bundleId] pages affected, owner=Codex)

Codex B12 fix landed @ 2026-05-01 ~03:40 Taipei: Quant Lab frontend now fails closed in production and renders BLOCKED/EMPTY instead of mock bundles when lab API routes are unavailable.

Known usable endpoints:

- `GET /api/v1/session`
- `GET /api/v1/companies`
- `GET /api/v1/companies/:id`
- `GET /api/v1/companies/:id/ohlcv`
- `GET /api/v1/companies/:id/financials`
- `GET /api/v1/companies/:id/chips`
- `GET /api/v1/companies/:id/announcements?days=30`
- `GET /api/v1/briefs`
- `GET /api/v1/reviews`
- `GET /api/v1/content-drafts`
- `GET /api/v1/ops/snapshot`
- `GET /api/v1/ops/trends`
- `GET /api/v1/event-history`
- `GET /api/v1/audit-logs`
- `GET /api/v1/audit-logs/summary`
- `GET /api/v1/market-data/overview`
- `POST /api/v1/paper/orders/preview`
- `POST /api/v1/paper/orders`
- `GET /api/v1/paper/orders`
- `GET /api/v1/paper/orders/:id`
- `POST /api/v1/paper/orders/:id/cancel`

Jason 5-contract first draft DONE @ 2026-05-01 ~01:58 Taipei → `evidence/w7_paper_sprint/jason_backend_contracts_2026-05-01.md`
- Contract 1 (Paper Orders preview/submit/status/cancel): READY
- Contract 2 (Portfolio positions/fills/summary): BLOCKED owner=Jason ETA=Day 4-5
- Contract 3 (Watchlist): BLOCKED owner=Jason ETA=Day 4-5
- Contract 4 (Strategy ideas/runs READY; promote-to-order): BLOCKED owner=Jason ETA=Day 5-6
- Contract 5 (KGI bidask/tick): BLOCKED owner=Operator+Jason (gateway dep); WS not implemented

Needs confirmation from Elva/Jason:

- Paper order preview/submit production contract
- Portfolio positions / fills freshness contract
- Watchlist source of truth
- Strategy idea to order handoff contract
- KGI readonly bidask/tick availability

## No-Fake UI Inventory

Initial high-risk surfaces:

- `/briefs`: DONE in Codex cycle 01:54; now binds `GET /api/v1/briefs` and renders LIVE / EMPTY / BLOCKED.
- `/reviews`: DONE in Codex cycle 01:56; now binds `GET /api/v1/reviews` as read-only ledger and marks action queue BLOCKED.
- `/drafts` and `/admin/content-drafts`: DONE in Codex cycle 02:00; now bind `GET /api/v1/content-drafts` and remove local-only audit/action mocks.
- `/quote`: DONE in Codex cycle 02:04; now binds `GET /api/v1/market-data/effective-quotes` and blocks K-line/depth/ticks instead of rendering deterministic mock market data.
- `/lab` and `/lab/[bundleId]`: DONE in Codex cycle 03:40; `radar-lab.ts` now fails closed in production and pages render BLOCKED/EMPTY instead of mock Quant Lab bundles when the lab API is unavailable.
- `/companies/duplicates`: DONE in Codex catch-up cycle 12:20; page now binds `GET /api/v1/companies/duplicates` and renders LIVE/EMPTY/BLOCKED, with merge/ignore actions hidden until migration audit + backup ACK.
- `/companies/[symbol]`: source/tick/derivatives mock feed removed in Codex cycle 01:49; remaining company-detail mock risk is `toCompanyDetailView` fallback fields.
- `DerivativesPanel`: BLOCKED until production endpoint contract exists.
- `TickStreamPanel`: BLOCKED until KGI readonly bid/ask + tick contract exists.
- `/m/kill` and portfolio KillSwitch: DONE in Codex catch-up cycle 12:10; frontend mock kill-mode toggles removed, current mode is read-only, all writes render BLOCKED pending backend governance/audit/risk approval.
- Portfolio `OrderTicket` and `/companies/[symbol]` `PaperOrderPanel`: DONE in Codex catch-up cycle 12:41; no longer use mock-shaped `radar-api.previewOrder/submitOrder`, show LIVE/EMPTY/BLOCKED ledger states, and use fresh idempotency keys for submit.
- `/` dashboard: DONE in Codex catch-up cycle 12:49; removed hardcoded TAIEX/TPEX/turnover/breadth/ops/heat-map cards and added a TWSE Market Intel/news column sourced from company announcement endpoints.
- `radar-api.ts` GET surfaces and `radar-uncovered.ts`: API failure can still fall back to mock on remaining legacy pages; order POST fallback has been removed from `radar-api.ts`.

## Overnight Log

### 2026-05-01 01:15 Taipei

Completed:

- Confirmed operator intent: Codex owns frontend real-data + Market Intel/news lane.
- Created Elva handoff and shared board.
- Defined stop-line: no silent production mock.

Next:

- Convert the inventory into code-level tasks.
- Start with production fetch wrappers and company Market Intel because TWSE announcements endpoint already exists.

Files touched:

- `evidence/w7_paper_sprint/frontend_realdata_elva_handoff_2026-05-01.md`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

### 2026-05-01 01:49 Taipei

Completed:

- Updated heartbeat automation to keep this live thread waking every 30 minutes.
- Bound company detail Market Intel panel [05] to `GET /api/v1/companies/:id/announcements?days=30` through `apps/web/lib/api.ts`.
- Converted Market Intel visible states to LOADING / LIVE / EMPTY / BLOCKED with source and updated timestamp.
- Removed no-op behavior from announcement rows: rows without body text render as static data, not inert buttons.
- Removed deterministic derivatives and tick-stream rows from the company page. Panels [08] and [09] now render BLOCKED with owner/blocker instead of synthetic data.
- Replaced source card data on `/companies/[symbol]` with live-derived source status from company master, OHLCV, TWSE announcements, and blocked KGI ticks.

Files:

- `apps/web/lib/api.ts`
- `apps/web/app/companies/[symbol]/page.tsx`
- `apps/web/app/companies/[symbol]/AnnouncementsPanel.tsx`
- `apps/web/app/companies/[symbol]/DerivativesPanel.tsx`
- `apps/web/app/companies/[symbol]/TickStreamPanel.tsx`
- `apps/web/app/globals.css`

Endpoints:

- `GET /api/v1/companies`
- `GET /api/v1/companies/:id/ohlcv?interval=1d`
- `GET /api/v1/companies/:id/announcements?days=30`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- Need Jason canonical contracts for derivatives exposure and KGI readonly tick/bidask before panels [08]/[09] can move from BLOCKED to LIVE.

### 2026-05-01 01:54 Taipei

Completed:

- Converted `/briefs` from `mockBrief` to production `GET /api/v1/briefs`.
- The page now renders latest DailyBrief sections from DB when LIVE, a real zero-row EMPTY state, or a BLOCKED state with owner/detail when the API fails.
- Removed fake market metrics / fake theme heat / fake ideas from the brief page because no production contract was backing those fields.

Files:

- `apps/web/app/briefs/page.tsx`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/briefs`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

### 2026-05-01 01:56 Taipei

Completed:

- Converted `/reviews` from local `mockReviewQueue` / `mockReviewLog` state to production `GET /api/v1/reviews`.
- The page now renders a read-only review ledger when LIVE, a real zero-row EMPTY state, or a BLOCKED state when API fetch fails.
- Removed local-only ACCEPT / REJECT buttons. The action queue now renders BLOCKED until Jason/Elva provide a production accept/reject contract.

Files:

- `apps/web/app/reviews/page.tsx`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/reviews`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

### 2026-05-01 02:00 Taipei

Completed:

- Converted `/drafts`, `/admin/content-drafts`, and `/admin/content-drafts/[id]` from local `mockDrafts` / `mockDraftAudit` to production `GET /api/v1/content-drafts`.
- Added shared content draft view helpers for payload title/body/status rendering.
- Removed local-only approve/reject/reassign action simulation from the detail page. Persisted actions now render BLOCKED until a deliberate UI mutation slice is scheduled.
- Kept role/permission behavior on the API side: 401/403 surfaces as BLOCKED with owner/detail instead of fake draft data.

Files:

- `apps/web/app/drafts/page.tsx`
- `apps/web/app/admin/content-drafts/page.tsx`
- `apps/web/app/admin/content-drafts/[id]/page.tsx`
- `apps/web/app/admin/content-drafts/[id]/ContentDraftDetailClient.tsx` (deleted)
- `apps/web/lib/content-draft-view.ts`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/content-drafts`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

### 2026-05-01 02:04 Taipei

Completed:

- Converted `/quote` from client-side `fallbackQuote`, `mockBidAsk`, and `mockTicks` to server-rendered `GET /api/v1/market-data/effective-quotes`.
- Removed deterministic bid/ask ladder, generated tick tape, and mock-kbar chart from the quote page.
- K-line, bid/ask depth, and tick tape now render BLOCKED until production bars/depth/tick contracts are deliberately wired.

Files:

- `apps/web/app/quote/page.tsx`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/market-data/effective-quotes`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Deploy:

- PASS Railway web deployment `3261ca7a-09dd-4af7-b6d7-72dfaff5a982` reached SUCCESS at 02:06 Taipei.

### 2026-05-01 02:48 Taipei

Completed:

- Fixed B10: `radar-uncovered.ts` no longer converts production API failure / invalid shape / missing API base into mock success. Dev/build mock fallback is preserved only outside production runtime.
- Fixed B11: `use-readonly-quote.ts` no longer falls back to mock bid/ask or ticks in production. KGI endpoint failure now returns `endpointUnavailable=true` with empty data.
- Updated `BidAskLadder`, `TickTape`, and `FreshnessBadge` so unavailable KGI depth/ticks render BLOCKED / NO DATA and hide synthetic rows instead of showing deterministic ladders/tapes.
- Tightened `radar-api.ts` missing-base and `api.company()` failure behavior so production fails closed rather than returning mock companies.

Files:

- `apps/web/lib/radar-uncovered.ts`
- `apps/web/lib/use-readonly-quote.ts`
- `apps/web/lib/radar-api.ts`
- `apps/web/components/chart/BidAskLadder.tsx`
- `apps/web/components/chart/TickTape.tsx`
- `apps/web/components/chart/FreshnessBadge.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/kgi/quote/bidask?symbol=...` remains BLOCKED when unavailable.
- `GET /api/v1/kgi/quote/ticks?symbol=...` remains BLOCKED when unavailable.
- Existing `radarUncoveredApi.*` endpoints now fail closed in production when backend data is unavailable.

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- KGI bidask/tick stays B3 BLOCKED pending Operator + Jason gateway/WS contract.
- Remaining mock audit moves next to `/m/kill`, `radar-api.ts` force-mock hard-line surfaces, and dashboard/plans portfolio pages.

### 2026-05-01 03:40 Taipei

Completed:

- Fixed B12: `radar-lab.ts` no longer converts production API failure / invalid shape / missing API base into mock Quant Lab bundle success. Dev/build mock fallback is preserved only outside production runtime.
- `/lab` now renders LIVE only from `GET /api/v1/lab/bundles`, EMPTY on a real zero-row result, or BLOCKED when the Quant Lab API contract is unavailable.
- `/lab/[bundleId]` now renders a BLOCKED detail page when `GET /api/v1/lab/bundles/:bundleId` is unavailable, instead of serving a mock bundle.
- Lab approve/reject actions only mutate local UI state after a successful `POST /api/v1/lab/bundles/:bundleId/action`; errors surface as BLOCKED action feedback.
- Push-to-portfolio remains disabled with an explicit blocker until Athena + Jason define the strategy-bundle-to-paper-order handoff. No broker order, no live submit, and no migration 0020 behavior changed.

Files:

- `apps/web/lib/radar-lab.ts`
- `apps/web/app/lab/page.tsx`
- `apps/web/app/lab/LabClient.tsx`
- `apps/web/app/lab/[bundleId]/page.tsx`
- `apps/web/app/lab/[bundleId]/LabBundleDetailClient.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/lab/bundles` remains BLOCKED until Athena + Jason publish the backend route/contract.
- `GET /api/v1/lab/bundles/:bundleId` remains BLOCKED until Athena + Jason publish the backend route/contract.
- `POST /api/v1/lab/bundles/:bundleId/action` fails closed in production when unavailable.

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- New backend blocker B13: Quant Lab bundle API contract/routes are not implemented yet; owner Athena + Jason. Frontend is truthful and ready to bind once routes exist.

### 2026-05-01 12:10 Taipei

Completed:

- Removed fake kill-switch writes from `/m/kill`. The mobile kill page now reads current session kill mode when available, renders all mode changes as BLOCKED, and documents owner/blocker instead of simulating a mode transition.
- Removed local mock mode changes from the portfolio `KillSwitch` component. It is now a read-only 4-state display with all write controls disabled and explained.
- Hardened `api.killMode()` so mock-only kill-mode fallback cannot be used in production runtime.
- No backend kill-route wiring was added. No live submit, no migration 0020, no broker path, no Railway secret touched.

Files:

- `apps/web/app/m/kill/page.tsx`
- `apps/web/components/portfolio/KillSwitch.tsx`
- `apps/web/lib/radar-api.ts`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/session` is used only to show the current kill mode on `/m/kill`.
- Kill-switch write path remains BLOCKED until Jason + Bruce provide approved backend governance, audit log, 4-layer risk regression, and operator approval.

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- B14: Kill-switch write governance remains BLOCKED, owner Jason + Bruce. Frontend is now truthful and read-only.

### 2026-05-01 12:20 Taipei

Completed:

- Converted `/companies/duplicates` from client-side `mockDuplicatePairs` to real `GET /api/v1/companies/duplicates`.
- The page now renders LIVE duplicate groups from DB, EMPTY when the API returns zero groups, or BLOCKED when the duplicate report API is unavailable.
- Removed local-only merge / not-duplicate / ignore buttons. The page now shows read-only duplicate groups and explicitly blocks write actions until governance is approved.
- No destructive merge route was wired. No migration 0020 promotion, no backup-affecting action, no DB write, no Railway secret touched.

Files:

- `apps/web/app/companies/duplicates/page.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/companies/duplicates`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- B15: Duplicate merge / ignore write actions remain BLOCKED, owner Mike + Jason + Pete. Required: migration audit, backup ACK, merge contract, and desk review.

### 2026-05-01 12:30 Taipei

Completed:

- Mitigated the highest build-time mock risk: pages that still use legacy `apps/web/lib/radar-api.ts` now opt into request-time rendering with `export const dynamic = "force-dynamic"`.
- Removed `generateStaticParams()` from `/themes/[short]` so theme detail pages do not call the legacy API client at build time and bake fallback data into static HTML.
- Confirmed production build output changed the affected routes from static `○` to dynamic `ƒ`.

Files:

- `apps/web/app/page.tsx`
- `apps/web/app/ideas/page.tsx`
- `apps/web/app/runs/page.tsx`
- `apps/web/app/runs/[id]/page.tsx`
- `apps/web/app/signals/page.tsx`
- `apps/web/app/themes/page.tsx`
- `apps/web/app/themes/[short]/page.tsx`
- `apps/web/app/plans/page.tsx`
- `apps/web/app/m/page.tsx`
- `apps/web/app/m/kill/page.tsx`
- `apps/web/app/portfolio/page.tsx`
- `apps/web/app/ops/page.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- Existing legacy `radar-api` GET endpoints are now evaluated at request time instead of build time.

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`
- Build route check: `/`, `/ideas`, `/runs`, `/runs/[id]`, `/signals`, `/themes`, `/themes/[short]`, `/plans`, `/m`, `/m/kill`, `/ops`, `/portfolio` are `ƒ Dynamic`.

Blockers:

- B16: Several legacy `radar-api` pages still need component-level LIVE/EMPTY/BLOCKED polish, but they no longer ship build-time mock HTML.

### 2026-05-01 12:41 Taipei

Completed:

- Wired Contract 1 Paper Orders into the frontend with a dedicated no-mock API client.
- Portfolio `OrderTicket` now uses real paper order preview, submit, status polling, list, and cancel endpoints with LIVE / EMPTY / BLOCKED states.
- Company detail `PaperOrderPanel` now shares the same real paper endpoint path and shows symbol-scoped paper ledger rows instead of treating submit as an isolated local acknowledgement.
- Removed legacy mock-shaped paper order POST methods from `radar-api.ts`; order submit/preview now use the Contract 1 payload (`idempotencyKey`, `symbol`, `side`, `orderType`, `qty`, `price`) instead of RADAR mock ticket shape.
- Live broker submit remains untouched. No KGI SDK import, no `/order/create`, no migration 0020, no Railway secrets.

Files:

- `apps/web/lib/paper-orders-api.ts`
- `apps/web/lib/api.ts`
- `apps/web/lib/radar-api.ts`
- `apps/web/components/portfolio/OrderTicket.tsx`
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `POST /api/v1/paper/orders/preview`
- `POST /api/v1/paper/orders`
- `GET /api/v1/paper/orders/:id`
- `GET /api/v1/paper/orders`
- `POST /api/v1/paper/orders/:id/cancel`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`
- PASS `git diff --check -- apps/web/lib/paper-orders-api.ts apps/web/lib/api.ts apps/web/lib/radar-api.ts apps/web/components/portfolio/OrderTicket.tsx apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`

Blockers:

- Paper ledger remains backend in-memory until Jason completes persistence/freshness work. Frontend labels this as real paper endpoint state, not live broker state.
- Contract 2/3/4-promote/5 remain BLOCKED per Jason contract board.

### 2026-05-01 12:49 Taipei

Completed:

- Converted `/` from the legacy `radar-api` mock-shaped dashboard into a real-data dashboard.
- Removed hardcoded market cards for TAIEX/TPEX/turnover/breadth/risk budget, static ops health rows, and decorative heat-map points.
- Added `GET /api/v1/market-data/overview` to the shared API client and uses it for quote counts, freshness, providers, paper-usable counts, top gainers/losers, and most-active symbols.
- Dashboard themes now come from `GET /api/v1/themes`, ideas from `GET /api/v1/strategy/ideas?decisionMode=paper`, runs from `GET /api/v1/strategy/runs`, and signals from `GET /api/v1/signals`.
- Added Market Intel/news column: selects active/idea-linked companies and aggregates `GET /api/v1/companies/:id/announcements?days=14` TWSE material announcements.
- Every dashboard panel now renders LIVE / EMPTY / BLOCKED with source and updated time instead of silently filling with mock rows.

Files:

- `apps/web/app/page.tsx`
- `apps/web/lib/api.ts`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/market-data/overview`
- `GET /api/v1/themes`
- `GET /api/v1/companies`
- `GET /api/v1/strategy/ideas?decisionMode=paper`
- `GET /api/v1/strategy/runs`
- `GET /api/v1/signals`
- `GET /api/v1/companies/:id/announcements?days=14`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`
- PASS `git diff --check -- apps/web/app/page.tsx apps/web/lib/api.ts`

Blockers:

- Market Intel is limited to company-linked TWSE material announcements until Jason exposes a global news endpoint or broader market-news source.

## Elva Notes

### 2026-05-01 01:42 Taipei — Operator final ACK + Elva 20min cycle started

Operator (楊董) final ACK 全部 6 條（Jim D1 handoff A / contract 由 Jason 寫 B / Codex hybrid PR 流程 C / Elva cycle OK / 跑到 07:00 Taipei A / Bruce 立刻 4-state harness A）.

**Elva 20min cycle protocol**（每輪固定 6 段）:
- t+0~5：讀 board / git log / evidence INDEX / Codex 上一輪 commit
- t+5~8：評估 Codex diff + blocker，確認沒踩 stop-line
- t+8~12：派工 — backend→Jason / verify→Bruce / migration→Mike / review→Pete
- t+12~15：更新 board 4 區（Backend Ready / Path Locks / Elva Notes / Blockers）
- t+15~18：許可範圍內 review/merge PR；重大事件 memory writeback
- t+18~20：schedule next wakeup
- 每輪驗：Codex 是否把 visible UI 標 LIVE/EMPTY/BLOCKED/HIDDEN；有無 fake mock 回流

**Merge 權限規則**（Elva 自主，無需 operator）:
- non-destructive PR + CI 全綠 + Pete review PASS（or Elva 明確記 why bypass）
- 不碰 stop-line / secrets / destructive migration / live submit
- production rollback path 清楚

**叫醒 operator 條件**:
- Yellow: production down / agent 跨 stop-line / destructive ACK / Railway secret 需求 / live submit 風險 / 0020 promote / auth 失效
- Red: 真實下單風險 / secret 外洩 / 全站不可用 / DB destructive 已發生
- 一般 UI blocker / shape 不明 / mock cleanup → 寫 board 繼續推，不叫

### Cycle 0 (01:42) — 派工已發
- Jason → `evidence/w7_paper_sprint/jason_5_backend_contracts_workorder_2026-05-01.md`
- Bruce → `evidence/w7_paper_sprint/bruce_4state_harness_workorder_2026-05-01.md`
- Pete → `evidence/w7_paper_sprint/pete_codex_pr_review_standby_2026-05-01.md`
- Mike → 0020 migration audit lane（不變）
- Jim → halted on new frontend scope（deprecated branch dispositioned 上方）

### Cycle 14 (06:38) — FINAL；Codex 185min idle；ready for operator handover at 07:00
- `git fetch origin main`：HEAD `7711a38` (Cycle 13 commit) — 與本地一致，無新 commit。
- `git status apps/web/`：5 files unchanged，mtime: `radar-lab.ts` 03:29:53 / `LabClient.tsx` 03:33:55（185min idle since latest touch）。
- 無新 PR；PR #39 (Jason 0020) 仍 DRAFT，未 promote。
- Codex 整夜未響應 Cycle 8 checkpoint hint；working tree 5 files diff 已在 closeout doc + handoff 完整 carry-over，白班可接手（Option 1 接手 / Option 2 等 Codex）。
- Stop-line scan **PASS** — no broker write / no migration / no secrets / no live submit / no KGI SDK touch / no fake mock。
- 不主動接手 Codex WIP（保留 lane 邊界）；不夜跑 Bruce regression（沒新 code，低價值）。
- **總結**：14 × 20min cycles + closeout，5h18min（01:42 → 07:00），8 src commits + 13 governance commits = 21 commits on main，**0 destructive merges、0 stop-line violations、0 force-pushes、0 secret rotations、0 PR merges、0 Yellow events、0 Red events**。
- 最終交付：(a) `elva_morning_closeout_2026-05-01.md` — 5 sections + appendix（white-shift quick-start dual-path）; (b) `session_handoff.md`（user memory dir）— 開頭已 prepend overnight closeout 章節; (c) 本 board — Cycle 0 → Cycle 14 完整 log。
- ~07:00 Taipei operator-facing summary 將於下一輪 turn 直接以文字回應 楊董，不再 schedule wakeup。

### Cycle 13 (06:18) — Closeout polish DONE + handoff section prepended；Codex 165min idle；T-40min
- `git fetch origin main`：no new commit since `1f978da` (Cycle 12 closeout draft commit)。
- `git status`：5 files unchanged（Codex WIP），mtime latest 03:33（165min idle）。
- **Closeout doc polish pass DONE** → `elva_morning_closeout_2026-05-01.md` 5 處編修：(1) header `13 cycles` → `14 × 20min cycles + closeout`; (2) B12 mtime range `03:14-03:33` → `03:29-03:34`（依實 mtime evidence）; (3) idle duration 145min → 165min; (4) governance commits 補 Cycle 12 `1f978da` + Cycles 13-14 占位，total 20 commits; (5) Yellow/Red section 補 `B10/B11 fix 633d00e 是 safety net；B12 是 polish-not-hotfix`; appendix 替換為 white-shift quick-start 雙路徑（Option 1 接手 Codex WIP、Option 2 等 Codex commit）。
- **`git log --oneline -30 origin/main` cross-check**：closeout 引用的 8 src commit hash + 12 governance commit hash 全部對得上，無錯置。
- **`session_handoff.md` 同步**：在 user memory dir `C:\Users\User\.claude\projects\C--Users-User\memory\handoff\session_handoff.md` 開頭 prepend 新章節「2026-05-01 dawn — Overnight Codex frontend real-data lane closeout (Cycles 0-14)」，one-line state + white-shift 第一動作清單 + open PR + stop-line status + board pointer。注意：handoff 在 user memory dir，不在 git repo，無 commit footprint。
- Stop-line scan **PASS** — 無新 diff，no broker write / no migration / no secrets / no live submit。
- 無新 PR。PR #39 (Jason 0020) 仍 DRAFT。
- Codex 整夜 idle ~165min；Cycle 8 checkpoint hint 仍無響應。closeout 已將 B12 carry-over 寫得很完整，白班可接手。
- Yellow/Red: **0 / 0**。
- Cycle 14 finalize plan：(a) memory writeback (`elva_memory.md` overnight learnings 加一筆) (b) 最終 board entry (c) 準備 ~07:00 operator-facing 文字回應（merged commits + carry-over + production smoke + next 3 priorities + Yellow/Red 0/0）。

### Cycle 12 (05:58) — Closeout draft DONE；Codex 145min idle；T-60min
- `git fetch origin main`：no new commit since `95dfaf4` (Cycle 11 board commit)。
- `git status`：5 files unchanged，mtime 03:33（145min idle）。
- **Closeout draft DONE** → `evidence/w7_paper_sprint/elva_morning_closeout_2026-05-01.md` (5 sections + appendix, ~120 lines)，引 commit hash + 完整 B12 fix pattern + carry-over instruction。
- Stop-line **PASS**。無新 PR。Yellow/Red 無觸發。
- Cycle 13 polish pass：cross-check 引用 hash 正確、white-shift 順序合理、handoff/session_handoff.md 是否需同步更新。
- Cycle 14 finalize：commit closeout doc、最終 board entry、~07:00 operator-facing summary 文字回應。

### Cycle 11 (05:38) — Codex 125min idle，silent wait；morning closeout T-80min
- `git fetch origin main`：no new commit since `aecbc22` (Cycle 10 board commit)。
- `git status`：5 files unchanged，mtime latest 03:33（125min idle）。
- 持續 silent wait。stop-line **PASS**。無新 PR。Yellow/Red 無觸發。
- **Closeout outline draft**（Cycle 12-13 polish, ~07:00 deliver）:
  1. Merged commits overnight: `633d00e` (Codex B10/B11 production fail-closed) + 11 board commits (Cycles 1-10) — 0 destructive merges, 0 stop-line violations.
  2. Remaining blockers: **B12 carry-over** (Codex WIP 5 files uncommitted, source-fix pattern verified, instructions on board); Jason contracts 2-5 still BLOCKED ETA Day 4-6; KGI WS (Operator+Jason); PR #39 0020 destructive DRAFT awaiting 楊董 ACK.
  3. Production smoke: `633d00e` deploy stable since 02:48; no incident overnight; Bruce v1 4-state harness + Cycle 3 cumulative regression sweep PASS.
  4. Next 3 priorities for white-shift: (a) Codex B12 checkpoint commit + Bruce post-merge regression, (b) Jason 5-contract production wiring (esp. Contract 1 Paper Orders ready), (c) PR #39 0020 destructive ACK decision (楊董 → Mike audit → Pete review → squash).
  5. Yellow/Red overnight: 0 / 0 — protocol clean.

### Cycle 10 (05:18) — Codex 105min idle，silent wait 持續；morning closeout T-100min
- `git fetch origin main`：no new commit since `d6cb476` (Cycle 9 board commit)。
- `git status`：同一 5 files，同一 mtime（latest 03:33）；105min 沒 touch。
- 持續 silent wait — 無 prod risk、無 stop-line 跨界、無 yellow/red 觸發。
- Stop-line scan **PASS** — 無新 diff。
- 無新 PR；PR #39 (Jason 0020) DRAFT。
- **Morning closeout 預備**：T-100min。若 Codex 整夜不動，B12 carry-over 會包含：
  - source-level fix instruction（已在 board B12 行）
  - Codex working tree 5 files diff（白班可 git diff 看到完整 patch）
  - Bruce v1 4-state harness + cumulative regression sweep evidence
  - Jason 5 contracts draft（pending production wiring）
- Yellow/Red: 無觸發。

### Cycle 9 (04:58) — Codex 85min idle，hint 未響應；繼續等待（無 prod risk）
- `git fetch origin main`：no new commit since `29e9705` (Cycle 8 board commit)。
- `git status`：同一 5 files、同一 mtime（latest 03:33）；85min 沒 touch。
- **Cycle 8 checkpoint hint 未被響應**：3 選項都沒走（沒 commit / 沒 PR / 沒 board heartbeat）。
- 評估：依 Cycle 9 rule，**繼續 silent 等候**，不主動觸碰 Codex working tree、不升級 operator。idle 是節奏問題不是 production risk；Codex `633d00e` 已部署 production，B12 fix 是 polish 不是 hotfix。
- 不重派 Bruce production smoke：last deploy `633d00e` ~130min 前 stable，沒新 code → re-verify 同 surface 低價值；Bruce cycles 留給 Codex 真的 commit 時用。
- Stop-line scan **PASS** — 無新 diff。
- 無新 PR；PR #39 (Jason 0020) DRAFT 等楊董 ACK。
- Yellow/Red: 無觸發。
- 觀察期延續到 morning closeout (~07:00 Taipei)。若 Codex 整夜不動，morning closeout 會把 B12 列為 carry-over，附完整 fix instruction（已在 board）讓白班接手。

### Cycle 8 (04:38) — Codex idle 65min，**checkpoint hint** 上板（非 escalation）
- `git fetch origin main`：no new commit since `6d1cfc2` (Cycle 7 board commit)。
- `git status`：同一 5 files、同一 mtime（latest 03:33）；65min 沒 touch。
- **Threshold 觸發**：64-65min ≥ 60min → board checkpoint hint。
- **HINT TO CODEX**（如果你下輪讀 board）：B12 working tree fix 已 65min 未 commit。建議三選一：
  1. **Checkpoint commit** — 即使還沒完工，把目前 source-level 改動先 commit（fix(web): wip B12 production fallback for radar-lab + lab pages），typecheck 過就先 push，後續 polish 再追加 commit
  2. **Open DRAFT PR** — branch 出去開 DRAFT，CI 跑起來，Pete 可以 standby；Elva 不會 merge DRAFT
  3. **Heartbeat note** — 在 board 寫 Codex 30min heartbeat（"B12 still in progress, ETA HH:MM, blocker=…"），讓 Elva 知道 lane 沒卡死
  以上沒選，Cycle 9 (~04:58) Elva 會 default 維持等候，不主動觸碰你 working tree。
- Stop-line scan **PASS** — 無新 diff。
- 無新 PR；PR #39 (Jason 0020) DRAFT 等楊董 ACK。
- 沒新 src commit → Bruce 不重派；沒新 PR → Pete standby；Jason 5 contracts 無變動。
- Yellow/Red: 無觸發（idle 是節奏問題，非 prod risk）。

### Cycle 7 (04:18) — Codex idle 45min，B12 working tree 不變
- `git fetch origin main`：no new commit since `9b73b91` (Cycle 6 board commit)；Codex `633d00e` 已 90min 沒新 src commit。
- `git status`：同樣 5 files modified，無新增/減少，無新 untracked apps/web 檔。
- **mtime 不變**：radar-lab.ts 03:29、lab/page.tsx 03:30、`[bundleId]/page.tsx` 03:31、`[bundleId]/LabBundleDetailClient.tsx` 03:31、LabClient.tsx 03:33。Codex 從 03:33 之後 ~45min 沒 touch 工作檔。
- 評估：45min < 60min escalation threshold，**不放 board hint**。可能在跑 typecheck / build / 寫 PR body / 切換到別 surface 思考。
- Stop-line scan **PASS** — 無新 diff。
- 無新 PR；PR #39 Jason 0020 destructive DRAFT 不在 cycle scope。
- 無 Bruce 重派（沒新 commit 可驗）；無 Pete dispatch（沒新 PR）；Jason 5 contracts 無變動。
- Yellow/Red: 無觸發。
- Cycle 8 (~04:38) 重評：若 mtime 仍 03:33 = 65min idle → board 加 checkpoint hint（依然不叫 operator，這只是進度節奏問題不是 prod risk）。

### Cycle 6 (03:58) — Codex 仍在 active edit B12，working tree mtime 03:33（剛 25min 前）
- `git fetch origin main`：no new commit since `3e16c14` (Cycle 5 board commit)；Codex `633d00e` 之後仍無新 src commit。
- `git status`：同一 5 files 仍 modified（radar-lab.ts / lab/page.tsx / LabClient.tsx / [bundleId]/page.tsx / [bundleId]/LabBundleDetailClient.tsx）。
- **mtime 證據 Codex 仍活躍**：`radar-lab.ts` 03:29、`lab/page.tsx` 03:30、`LabClient.tsx` 03:33。距離 cycle 開頭只 25min，**不是 stuck**，是 mid/large scope（+247/-110、5 files）正常編輯時間。
- Bonus check：`apps/web/lib/radar-api.ts` 已有 `IS_PROD` guard（line 45/68/98/119/149/166），不在 B12 fix scope。
- Stop-line scan **PASS** — diff 全在 `apps/web/{app,lib}/**` Codex lane。
- No new PR；唯一 open PR #39 是 Jason `jason/0020-dedup-companies-unique-2026-04-30` DRAFT（destructive，等楊董 ACK，不是這 cycle scope）。
- Bruce regression sweep 不重派（沒有新 commit；上次 sweep `a23e9c9a0ad8585b7` 已涵蓋 B12 source-pattern instructions）。
- Jason backend contract 5 條無變動，沒有新 BLOCKED 升級。
- Yellow/Red: 無觸發。

### Cycle 5 (03:38) — Codex B12 fix in-flight (uncommitted local WIP)
- `git fetch origin main`：no new commit since `633d00e` @ 02:48 (Elva commits 之後是 board update only).
- **`git status` 發現 Codex 已有 uncommitted local edits**: `apps/web/app/lab/LabClient.tsx`, `apps/web/app/lab/[bundleId]/LabBundleDetailClient.tsx`, `apps/web/app/lab/[bundleId]/page.tsx`, `apps/web/app/lab/page.tsx`, `apps/web/lib/radar-lab.ts`（5 files, +247/-110）。
- **Source-level verify**: `apps/web/lib/radar-lab.ts` 已加 `const IS_PROD = process.env.NODE_ENV === "production"` (line 3) + `shouldAllowMockFallback()` helper (line 46-47) + production throw at lines 60/73/78/86/100。Pattern 與 `radar-uncovered.ts` 對齊。**B12 source-level fix in working tree but not yet committed**。
- Stop-line scan **PASS** — diff 全在 `apps/web/{app,lib}/**` Codex lane。
- Elva 不動 Codex working tree（lane 分界）；等 Codex 自己 commit。
- 無 mid/large PR → Pete standby。
- Yellow/Red: 無觸發。

### Cycle 4 (03:17) — Bruce sweep consumed / B12 OPEN HIGH waiting on Codex
- Read board / `git fetch origin main`. **No new Codex commit** since `633d00e` @ 02:48 — Codex 安靜 ~30 min（1.5 cycle）。
- Bruce regression sweep（agent `a23e9c9a0ad8585b7`）completed @ ~02:54 — B10/B11 二次 verify RESOLVED；B12 NEW / HIGH / `apps/web/lib/radar-lab.ts` 沒 `IS_PROD` guard，`/lab` + `/lab/[bundleId]` 直接 import `radarLabApi.*` → production API failure 會 silent serve mock bundle。Bruce 已寫完整 fix-pattern instruction 到 board B12 行。
- Stop-line scan **PASS** — 無新 commit。
- B12 是 Codex lane 內，不主動 dispatch，等 Codex 下一輪 heartbeat 接手；若 Cycle 5 (~03:37) 仍未動作 = 2+ cycles，再 escalate board hint。
- 無 mid/large PR → Pete standby。
- Yellow/Red: 無觸發。

### Cycle 3 (02:55) — Codex B10/B11 fix landed + Bruce regression dispatched
- Read board / `git fetch origin main`. New commit: `633d00e fix(web): fail closed on production quote mocks` — Codex 02:48 cycle.
- **B10/B11 source-level verify (Elva 02:55)**: `apps/web/lib/radar-uncovered.ts` 加 `IS_PROD` guard + `shouldAllowMockFallback()` → production catch path 改 throw `productionFallbackError`；`apps/web/lib/use-readonly-quote.ts` `IS_PROD` guard 加在 line 142/173，production path 設 `endpointUnavailable: true` + `error` 不再 fallback `mockBidAsk`/`mockTicks`。修法看起來正確 — **本輪 Elva source-level mark RESOLVED；待 Bruce regression sweep 二次確認**。
- Stop-line scan **PASS** — `633d00e` 只動 `apps/web/lib/**`，全在 Codex lane。
- **Dispatch**: Bruce regression sweep（Cycle 3）— 跑 sweep A-E + 二次 verify B10/B11；output 寫到 board `Backend Ready` + 任何新 FAIL 寫 B12+。
- 無 mid/large PR → Pete 持續 standby。
- Yellow/Red: 無觸發。

### Cycle 2 (02:34) — Codex 安靜期 / Bruce sweep 未自動續跑
- Read board / `git fetch origin main` → no new commits since `bc8e94d` (Elva Cycle 1 board update at 02:11)。Codex 最近 commit 仍是 `e0f92df` @ 02:06。Codex ~30 min 無動作 — 可能在做大改 or 暫停。
- 開啟 PR list（`gh pr list --state open`）：只有 PR #39（Jason 0020 dedup destructive migration DRAFT，Mike lane，尚未 ready）。**無 Codex mid/large PR**。
- Bruce 02:30 sweep **未觸發** — Bruce agent v1 交付後已 terminate，30-min cadence 是 promise 不是 auto-loop；目前無 new code 須驗，先 hold；Codex 下波 commit 落地時再 dispatch Bruce regression sweep。
- B10/B11 仍 OPEN — 只 1 cycle，未達 ">2 cycles 升級 prompt" 門檻；繼續觀察。
- Stop-line scan **PASS** — 無新 commit。
- Dispatch: 無。Yellow/Red: 無。

### Cycle 1 (02:11) — 觀察期
- Read board / `git log -20` / Jason output / Bruce output. Codex commits 6 condensed ones: `8abfc13 / f463069 / 3fa0feb / 11c2b9a / b64a875 / e0f92df`，全在 `apps/web/**` lane，stop-line scan **PASS**.
- Jason 5-contract 完成（Contract 1+4-read READY；Contract 2/3/4-promote/5 BLOCKED with ETA Day 4-5/5-6）→ Backend Ready 已附 link。
- Bruce harness v1 完成 + 第一輪 sweep 寫了 B5~B11 七項 FAIL → cross-check 後 B5~B9 已被 Codex 同期 cycle 修掉，標 RESOLVED；B10/B11 wrapper-level fallback 仍 OPEN，HIGH priority，等 Codex 下輪 cycle 接走。
- 無 mid/large PR → Pete 持續 standby。
- 無 dispatch this cycle — 4 lanes 自走。
- Yellow/Red zone: 無觸發。

## Blockers

- **B12 CURRENT STATUS**: [Rule 7] `apps/web/lib/radar-lab.ts` production fallback guard is **RESOLVED @ Codex 03:40**. This supersedes the older OPEN line below from Elva Cycle 4-5. `getMaybe`/`postMaybe` now use production fail-closed behavior matching `radar-uncovered.ts`; `/lab` and `/lab/[bundleId]` render BLOCKED/EMPTY instead of mock bundles when lab API routes are unavailable.
- **B13**: Quant Lab bundle API contract/routes ??**OPEN / BLOCKED / owner: Athena + Jason**. Frontend expects `GET /api/v1/lab/bundles`, `GET /api/v1/lab/bundles/:bundleId`, and `POST /api/v1/lab/bundles/:bundleId/action`; until implemented, production UI shows BLOCKED and push-to-portfolio remains disabled.
- **B14**: Kill-switch write governance ??**OPEN / BLOCKED / owner: Jason + Bruce**. `/m/kill` and portfolio KillSwitch no longer simulate mode changes; frontend requires approved backend governance route, audit log, 4-layer risk regression, and operator approval before any write control is re-enabled.
- **B15**: Duplicate merge / ignore write actions ??**OPEN / BLOCKED / owner: Mike + Jason + Pete**. `/companies/duplicates` now reads real duplicate groups but hides destructive/local-only actions until migration audit, backup ACK, merge contract, and desk review are complete.
- **B16**: Legacy `radar-api` page-level 4-state polish ??**OPEN / owner: Codex**. Build-time mock static HTML risk is mitigated by force-dynamic routes; remaining work is per-page catch/empty rendering for dashboard, ideas, runs, signals, themes, plans, ops, mobile brief, and portfolio.

- **B1**: Jason 5 條 backend contract 未交（owner: Jason / due: cycle 1 = 02:00 Taipei first draft / **status: RESOLVED @ ~01:58**）
- **B2**: Bruce 4-state harness spec 未交（owner: Bruce / due: cycle 1 = 02:00 first version / **status: RESOLVED @ 02:00**）
- **B3**: KGI bidask/tick readonly endpoint — write-side `libCGCrypt.so` blocked；read-side BLOCKED per Jason Contract 5（gateway operator dep + WS not impl）；Codex 標 BLOCKED owner="Operator + Jason"
- **B4**: Pete standby — Codex 至今 cycle (01:49 → 02:04) 全部 direct-commit `fix(web)`，無 mid/large PR，Pete 仍 standby
- **B5~B9**: [Rule 5] mock-in-production page-level violations — **status: RESOLVED @ Cycle 1 verify (Elva 02:11)**. Codex commits f463069/3fa0feb/11c2b9a/b64a875/8abfc13 已將 briefs/reviews/drafts/admin-content-drafts/quote 全部從 mock 直賦轉成 LIVE/EMPTY/BLOCKED API 綁定；`ContentDraftDetailClient.tsx` 已刪除（per cycle 02:00 board entry）；mock constants 仍存於 `lib/radar-uncovered.ts` 但 page-level 直接 import 已消失。
- **B10**: [Rule 7] `apps/web/lib/radar-uncovered.ts` production fallback guard — **RESOLVED @ Codex 02:48 / verified by Bruce Cycle 3 @ ~02:54**. `getMaybe`/`postMaybe` now guarded by `shouldAllowMockFallback()` which returns `false` in production; `devOnlyValue()` rejects in production; all catch paths throw in prod instead of returning fallback. No app-level callers of `radarUncoveredApi.*` found in `apps/web/app/**` (zero matches Sweep A).
- **B11**: [Rule 7] `apps/web/lib/use-readonly-quote.ts` quote fallback — **RESOLVED @ Codex 02:48 / verified by Bruce Cycle 3 @ ~02:54**. `!API_BASE` branch and catch branch both set `endpointUnavailable: true` + empty data in production instead of returning `mockBidAsk`/`mockTicks`. `BidAskLadder` and `TickTape` confirmed to gate on `endpointUnavailable` before drawing any synthetic rows.
- **B12**: [Rule 7] `apps/web/lib/radar-lab.ts` production fallback guard — **OPEN / HIGH / owner: Codex**. `getMaybe` line 44-45 returns fallback unconditionally when `!API_BASE` (no IS_PROD check). Catch block at lines 55-57 also returns fallback unconditionally. No `IS_PROD` or `NODE_ENV` variable declared anywhere in file. Pages `/lab` and `/lab/[bundleId]` consume `radarLabApi.bundles()` / `radarLabApi.bundle()` / `radarLabApi.bundleAction()` directly — these will silently serve mock bundle data in production on any API failure. Fix required: add `IS_PROD = process.env.NODE_ENV === "production"` and guard identical to `radar-uncovered.ts` `shouldAllowMockFallback()` pattern.

Backend ready 將隨 Jason contract 落地逐條補入上方 `Backend Ready` 區.
### Codex cycle (2026-05-01 13:43 Taipei) - dormant quote mock layer removed
- Files changed: deleted unused `apps/web/components/chart/*`, `apps/web/components/kgi-quote-panel.tsx`, `apps/web/components/kgi-broker-status.tsx`, `apps/web/lib/mock-kbar.ts`, `apps/web/lib/kbar-adapter.ts`, `apps/web/lib/kgi-quote-mock.ts`, `apps/web/lib/kgi-quote-types.ts`, `apps/web/lib/use-readonly-quote.ts`, and `apps/web/lib/radar-uncovered.ts`; updated `apps/web/app/quote/page.tsx` K-line BLOCKED reason.
- Endpoints / data behavior: no endpoint contract changed. `/quote` keeps real `getEffectiveQuotes` for LIVE/EMPTY/BLOCKED and explicitly blocks K-line, bid/ask depth, and tick tape until promoted production contracts exist.
- Behavior change: dormant synthetic K-line, bid/ask, tick tape, KGI quote panel, broker-status demo, and radar-uncovered fallback utilities are no longer present in the web bundle. No visible UI can import those old mock paths by accident.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact mock import scan for `mock-kbar`, `kbar-adapter`, `kgi-quote-mock`, `kgi-quote-types`, `use-readonly-quote`, `radar-uncovered`, `components/chart`, `kgi-quote-panel`, and `kgi-broker-status` returned 0.
- Blockers: production K-line/bidask/tick remains BLOCKED pending Jason/Operator real read contracts. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:46 Taipei) - unused legacy UI shells removed
- Files changed: deleted unused legacy client components `app-shell`, `boot-sequence`, `ticker-tape`, old CRUD boards, `openalice-ops`, `RightInspector`, dormant RADAR candlestick widgets, stale KPI strip, and KGI position placeholder.
- Endpoints / data behavior: no active route changed. Exact import scan confirmed no visible page imports these files; active routes continue using `PageFrame`, `RadarWidgets`, portfolio widgets, company detail panels, and real API clients.
- Behavior change: removes dormant deterministic spark/radar mock UI, old local-only forms, old placeholder broker/position widgets, and unused shell chrome that could be accidentally reintroduced as production UI.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact import scan for the deleted component names returned 0.
- Blockers: none introduced. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:51 Taipei) - company fundamentals wired to real FinMind routes
- Files changed: rewrote `apps/web/app/companies/[symbol]/FinancialsPanel.tsx` and `ChipsPanel.tsx`; added typed client functions in `apps/web/lib/api.ts`; added table styles in `apps/web/app/globals.css`.
- Endpoints / data behavior: Financials now calls the actual backend contracts: `GET /api/v1/companies/:id/financials?limit=8`, `GET /api/v1/companies/:id/revenue?limit=12`, and `GET /api/v1/companies/:id/dividend?years=5`. Flows now calls `GET /api/v1/companies/:id/chips?days=30`. The old wrong monthly/dividend calls to `/financials?period=M|DIV` are gone.
- Behavior change: company fundamentals and flows now use LIVE/EMPTY/BLOCKED states with source and updatedAt. No localhost-only panel fetcher, no vague placeholder copy, no tab that implies data from the wrong endpoint.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for `/financials?period=M`, `/financials?period=DIV`, and panel-local `NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"` returned 0 in these panels.
- Blockers: FinMind data freshness depends on API-side `FINMIND_API_TOKEN` and backend route health. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:54 Taipei) - dev preview and duplicate command UI removed
- Files changed: deleted unused lowercase `apps/web/components/command-palette.tsx`, unused `Pulse.tsx`, private `_dev/empty-state-preview`, and unused empty-state preview components.
- Endpoints / data behavior: no active route changed. The active command palette remains `apps/web/components/CommandPalette.tsx`, which reads real pages/themes/companies/ideas/runs. The deleted preview components were not imported by production pages.
- Behavior change: removes duplicate UI code and dev-only preview surfaces that could drift from the 4-state production contract.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact import scan for deleted names returned 0.
- Blockers: none introduced. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:55 Taipei) - Quant Lab dev mock bundles removed
- Files changed: rewrote `apps/web/lib/radar-lab.ts` to remove embedded lab bundle mock data and all dev mock fallback helpers.
- Endpoints / data behavior: `/lab` and `/lab/[bundleId]` now require real `GET /api/v1/lab/bundles`, `GET /api/v1/lab/bundles/:bundleId`, and `POST /api/v1/lab/bundles/:bundleId/action` responses. Missing API base, non-2xx, or invalid shape throws into the existing BLOCKED/EMPTY UI instead of returning sample bundles.
- Behavior change: no fake Quant Lab backtest/equity/promotion memo data remains in the web client. Lab pages stay useful as real intake surfaces and honest blockers.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for `mockLabBundles`, `dev mock fallback`, and `shouldAllowMockFallback` returned 0.
- Blockers: real lab bundle API remains owner Athena + Jason. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:59 Taipei) - Market Intel route made real
- Files changed: added `apps/web/app/market-intel/page.tsx`; rewrote `apps/web/components/Sidebar.tsx` labels and added INTEL navigation.
- Endpoints / data behavior: `/market-intel` aggregates real `GET /api/v1/companies`, `GET /api/v1/strategy/ideas?decisionMode=paper`, and `GET /api/v1/companies/:id/announcements?days=30`. It prioritizes companies from current paper strategy ideas, then fills from the company universe.
- Behavior change: the existing Command Palette `/market-intel` route now resolves to a real page. Sidebar includes the same page. Feed rows link back to company detail and render LIVE/EMPTY/BLOCKED with source, updatedAt, failures, and selected ticker universe.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; build route table includes `/market-intel`.
- Blockers: news freshness depends on TWSE announcement route health and authenticated company universe. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:03 Taipei) - production API base fails closed
- Files changed: hardened `apps/web/lib/api.ts`, `apps/web/lib/auth-client.ts`, and `apps/web/lib/paper-orders-api.ts`.
- Endpoints / data behavior: production no longer silently defaults frontend API clients to `http://localhost:3001` when `NEXT_PUBLIC_API_BASE_URL` is missing. Shared data requests throw a clear API base configuration error, auth returns `api_base_unconfigured`, and paper order preview/submit/cancel returns a blocked `PAPER_ORDER_API_BASE_UNCONFIGURED` error instead of touching a wrong host.
- Behavior change: missing production API configuration is now BLOCKED, not fake-empty or localhost leakage. The dev fallback remains available only outside production.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for the old unconditional `NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"` pattern returned 0.
- Blockers: production deploy still requires `NEXT_PUBLIC_API_BASE_URL` set by environment. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:13 Taipei) - company detail diagnostics made readable
- Files changed: cleaned user-visible mojibake in `apps/web/app/companies/[symbol]/page.tsx` and `error.tsx`.
- Endpoints / data behavior: no endpoint contract changed. `/companies/:symbol` still uses real `GET /api/v1/companies` plus company OHLCV and keeps missing/failed data in BLOCKED or not-found states.
- Behavior change: API failure, ticker not found, back navigation, company header, and company error boundary now render readable diagnostics instead of corrupted text. This makes Bruce/Elva production smoke actionable when auth, workspace, API base, or backend errors occur.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; company page mojibake scan only returned legitimate nullish-coalescing code and industry dictionary Chinese strings.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:20 Taipei) - idea-to-ticket anchor repaired
- Files changed: added the missing `order-ticket` anchor wrapper in `apps/web/app/portfolio/page.tsx`.
- Endpoints / data behavior: no API contract changed. `SendToTicketButton` already writes a real local handoff and routes to `/portfolio#order-ticket`; the portfolio page now exposes that target around the real paper order ticket.
- Behavior change: clicking PAPER TICKET from an idea now lands on the actual paper order panel instead of only loading the portfolio page top. This preserves the paper-only Contract 1 flow without touching broker/live submit.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; hash-link scan confirms `/portfolio#order-ticket` has a matching `id="order-ticket"` target.
- Blockers: paper submit remains gated by preview/risk/quote endpoint responses. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:27 Taipei) - Market Intel category mapping tightened
- Files changed: updated `apps/web/app/market-intel/page.tsx` category badge mapping.
- Endpoints / data behavior: no endpoint contract changed. `/market-intel` still reads real company universe, paper ideas, and TWSE announcement endpoints.
- Behavior change: important-news rows now classify dividend, financial/revenue, and material-announcement categories with maintainable keyword sets instead of brittle legacy category fragments. Unknown categories remain neutral badges and are not invented.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; Market Intel mojibake scan returned 0.
- Blockers: TWSE announcement freshness remains API/data-source dependent. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:33 Taipei) - global frame fake run metadata removed
- Files changed: rewrote `apps/web/components/PageFrame.tsx` header metadata.
- Endpoints / data behavior: no endpoint contract changed. Shared page chrome no longer displays a hard-coded run id, scan timer, or stale fixed clock.
- Behavior change: all pages now show actual Taipei date/time plus `SESSION / REAL-DATA`; exec pages are labelled `EXEC LAYER / PAPER`. This removes decorative status text that looked operational but was not backed by real state.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for `RUN-2026`, `T-06S`, `14:32:08`, and old live glyph text returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:39 Taipei) - sidebar labels and status wording cleaned
- Files changed: updated `apps/web/components/Sidebar.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Sidebar remains navigation-only and does not claim live health state.
- Behavior change: nav subtitles are readable, INTEL stays visible, and the old static `PAPER ARMED` / `REV RADAR-0.8` wording is replaced by conservative `PAPER MODE / RISK GATED` and `Frontend / real-data lane`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sidebar scan for corrupted text fragments and stale RADAR/PAPER ARMED labels returned 0.
- Blockers: real kill-switch state remains visible on `/portfolio` and `/m/kill`, not in static sidebar chrome. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:44 Taipei) - frame timestamp wording clarified
- Files changed: refined `apps/web/components/PageFrame.tsx` metadata labels.
- Endpoints / data behavior: no endpoint contract changed. Shared chrome now labels the timestamp as `RENDERED` and separately shows read/paper mode, avoiding the impression of a live ticking clock on statically rendered routes.
- Behavior change: global frame metadata remains truthful on both dynamic and static pages: it reports render/build time, real-data session policy, and route mode.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sequential `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS. Earlier parallel typecheck failed only because `.next/types` was being regenerated during build; rerun after build passed.
- Blockers: CI for `f272cb3` still in progress as of this cycle; previous CI/deploy runs green. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:50 Taipei) - auth footer fake version removed
- Files changed: updated `apps/web/app/login/page.tsx`.
- Endpoints / data behavior: no auth contract changed. Login still calls the real auth API and fails closed through `api_base_unconfigured` if the production API base is missing.
- Behavior change: the login footer no longer displays the static `RADAR-0.8` version-like label. It now describes the real auth session surface.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sequential `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; scan for `RADAR-0.8`, old fake run id, and old scan timer in auth pages returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:00 Taipei) - local production smoke and CI closeout
- Files changed: evidence board only.
- Endpoints / data behavior: started latest web production build on local port 3002 for smoke, then stopped it. Used a fake local `iuf_session` cookie only to pass middleware and verify route rendering; no API secrets or live order endpoints touched.
- Behavior check: `/login`, `/market-intel`, `/portfolio`, `/quote?symbol=2330`, `/companies/2330`, and `/lab` all returned HTTP 200. With no local `NEXT_PUBLIC_API_BASE_URL`, `/market-intel` rendered honest BLOCKED state (`NEXT_PUBLIC_API_BASE_URL is not configured`) instead of fake news rows.
- Tests: local `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sequential typecheck PASS before smoke. GitHub Actions: latest `1d3b507` CI success and Railway deploy success; preceding `1e48c98` CI/deploy success; older superseded deploy run cancelled by newer deploy, not a failure.
- Blockers: production data freshness still depends on Railway env and backend route health. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:07 Taipei) - document title cleaned
- Files changed: updated `apps/web/app/layout.tsx`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: browser title now uses `IUF Trading Room`; the old decorative separator is removed from metadata and the next/font comment is plain ASCII.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sequential `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; layout scan for old separator/title fragments returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:15 Taipei) - company source status no longer overclaims Market Intel
- Files changed: updated `apps/web/app/companies/[symbol]/page.tsx`, `SourceStatusCard.tsx`, and `AnnouncementsPanel.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Company detail still fetches company master/OHLCV server-side and announcements panel fetches `GET /api/v1/companies/:id/announcements?days=30` client-side.
- Behavior change: Source Status no longer marks Market Intel as LIVE just because the panel is mounted. It now marks that row STALE/panel-level and points users to panel [05], where the actual announcement request reports LIVE/EMPTY/BLOCKED. The source card title and detail separators were also made readable.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; company detail mojibake scan returned 0.
- Blockers: true announcement health remains owned by the TWSE announcement endpoint. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:20 Taipei) - OHLCV chart scan noise removed
- Files changed: updated `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Company page still filters out `source === "mock"` before chart rendering.
- Behavior change: removed stale mock/comment wording and old decorative separators from the OHLCV chart source badge helpers so automated truthfulness scans only flag the intentional server-side mock filter.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:25 Taipei) - static post-close session label removed
- Files changed: updated `apps/web/components/PageFrame.tsx`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: non-exec page chrome no longer hard-codes `SESSION / POST-CLOSE`; it now reports `SESSION / REAL-DATA`, while exec pages remain `EXEC LAYER / PAPER`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for `POST-CLOSE`, old fake run id, old scan timer, and old static clock returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:32 Taipei) - company master panel labels made readable
- Files changed: rewrote `apps/web/app/companies/[symbol]/CompanyInfoPanel.tsx` labels and cleaned `CompanyHeroBar.tsx` quote metadata.
- Endpoints / data behavior: no endpoint contract changed. Company detail still uses real company master rows and real OHLCV-derived quote data only.
- Behavior change: company page [01] no longer renders corrupted label text; it now shows readable COMPANY MASTER, TICKER, MARKET, COUNTRY, CHAIN POSITION, exposure, validation, source, VOL, AS OF, and EMPTY states.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:40 Taipei) - command palette state rows no longer pretend to be actions
- Files changed: updated `apps/web/components/CommandPalette.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Palette still probes real themes, companies, paper ideas, and strategy runs.
- Behavior change: BLOCKED/EMPTY palette status rows now render as `role="note"` information rows instead of disabled buttons. Real navigation rows remain buttons and continue to route to actual pages.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:48 Taipei) - unused decorative widget helpers removed
- Files changed: updated `apps/web/components/RadarWidgets.tsx`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: removed unused Sparkline/Pill/TimeText exports from the shared metric helper, leaving only the real-data metric strip helpers currently imported by production pages. This reduces dead decorative UI that could be mistaken for wired data later.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; import scan found no remaining Sparkline/Pill/TimeText consumers.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:55 Taipei) - unused block spark helper deleted
- Files changed: deleted `apps/web/lib/block-spark.ts`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: removed an unreferenced legacy sparkline helper with corrupted text/block glyphs. No visible route behavior changes; this prevents a dead decorative chart helper from being reintroduced into production data surfaces.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; import scan for `blockSpark` / `block-spark` returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 16:02 Taipei) - draft/review LIVE panels include freshness
- Files changed: updated `apps/web/app/admin/content-drafts/[id]/page.tsx`, `apps/web/app/admin/content-drafts/page.tsx`, `apps/web/app/drafts/page.tsx`, and `apps/web/app/reviews/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Draft and review pages still read `GET /api/v1/content-drafts` and `GET /api/v1/reviews`.
- Behavior change: LIVE draft/review panels now show both source and Updated time, satisfying the 4-state rule for source + freshness instead of only showing row counts.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 16:08 Taipei) - company paper order panel source text tightened
- Files changed: updated `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`.
- Endpoints / data behavior: no endpoint contract changed. The panel still calls paper-order preview/submit/ledger endpoints only and never broker/live routes.
- Behavior change: removed decorative middle-dot separators from the company paper-order source/ledger labels and made the source bar explicitly name the paper order ledger. This keeps Contract 1 visible as paper-only operational state, not styling text.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for middle-dot/garbled separator in this panel returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 16:16 Taipei) - paper ledger zero rows classify as EMPTY
- Files changed: updated `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` and `apps/web/components/portfolio/OrderTicket.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Both surfaces still read/preview/submit paper orders only through Contract 1 endpoints; no broker/live route is touched.
- Behavior change: paper order ledger headers now show EMPTY when the real ledger request succeeds with zero rows, instead of showing LIVE beside an empty ledger. Portfolio ticket handoff/TIF/preview labels also use plain ASCII separators.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for middle-dot/garbled separators in both paper order surfaces returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:04 Taipei) - dashboard market overview strip shows source freshness
- Files changed: updated `apps/web/app/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Top dashboard metrics still derive from `GET /api/v1/market-data/overview`.
- Behavior change: dashboard market overview quote strip now renders the shared source/updatedAt line before LIVE/EMPTY/BLOCKED cards, so LIVE metric cards no longer stand alone without freshness/source evidence.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:08 Taipei) - dashboard Market Intel shows partial coverage honestly
- Files changed: updated `apps/web/app/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Dashboard Market Intel still fans out to `GET /api/v1/companies/:id/announcements?days=14` for selected company ids.
- Behavior change: if some announcement calls fail but others succeed, the dashboard now marks the source line as partial coverage. If successful calls return zero rows while some calls failed, EMPTY now says coverage is partial instead of claiming TWSE returned zero rows for the full selected set.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. Announcement endpoint availability still belongs to Jason/Elva. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:10 Taipei) - Market Intel page exposes partial coverage and freshness
- Files changed: updated `apps/web/app/market-intel/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. The page still reads `GET /api/v1/companies`, optional strategy ideas, and selected company announcement calls through `GET /api/v1/companies/:id/announcements?days=30`.
- Behavior change: the standalone Market Intel page now shows Updated time in the source block. LIVE feeds with partial announcement-call failures display a visible PARTIAL note, and EMPTY state no longer claims full selected-universe zero news when some selected company calls failed.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. Announcement endpoint availability still belongs to Jason/Elva. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:12 Taipei) - companies page removes static catalog count
- Files changed: updated `apps/web/app/companies/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Companies page still reads `GET /api/v1/companies` client-side and derives KPI counts from the returned rows.
- Behavior change: removed the hard-coded `3470 symbols` text from page chrome and loading state. The visible count now comes only from the real API response.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. PR #39 migration 0020 remains blocked by Mike/Pete P0 and was not touched. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:13 Taipei) - companies registry gets explicit 4-state source line
- Files changed: updated `apps/web/app/companies/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Companies registry still reads `GET /api/v1/companies` client-side; the client-side ticker dedup remains visible as a temporary defensive banner until Jason replaces PR #39 migration 0020 with a safe v2.
- Behavior change: company registry now exposes LOADING/LIVE/EMPTY/BLOCKED state, source, updated time, and owner/detail for failed API calls. Empty API results show an EMPTY note instead of silently rendering an empty table.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. PR #39 migration 0020 remains blocked by Mike/Pete P0 and was not touched. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:15 Taipei) - mobile brief hides non-live metric placeholders
- Files changed: updated `apps/web/app/m/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Mobile brief still reads briefs, themes, paper ideas, market overview, and kill-switch state through existing read endpoints.
- Behavior change: `/m` no longer renders zero-valued market metrics when the combined mobile source is BLOCKED/EMPTY or when the market overview payload is absent. Theme and paper idea sections now render explicit EMPTY cards instead of blank sections.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:16 Taipei) - dashboard market overview freshness uses API generatedAt
- Files changed: updated `apps/web/app/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Dashboard still reads `GET /api/v1/market-data/overview`.
- Behavior change: when the market overview is LIVE and includes `generatedAt`, dashboard source freshness now uses the API payload timestamp instead of the SSR render/request time.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:18 Taipei) - draft/review EMPTY and BLOCKED states include query freshness
- Files changed: updated `apps/web/app/briefs/page.tsx`, `apps/web/app/drafts/page.tsx`, `apps/web/app/reviews/page.tsx`, `apps/web/app/admin/content-drafts/page.tsx`, and `apps/web/app/admin/content-drafts/[id]/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. These pages still read `GET /api/v1/briefs`, `GET /api/v1/content-drafts`, and `GET /api/v1/reviews`.
- Behavior change: EMPTY/BLOCKED state panels now show the query timestamp beside source and reason, matching the LIVE panels' source/freshness behavior.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:21 Taipei) - portfolio fails closed when kill-switch state is unavailable
- Files changed: updated `apps/web/app/portfolio/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Portfolio still reads paper trading, risk, and kill-switch endpoints for `paper-default`.
- Behavior change: missing backend kill-switch state now maps to `FROZEN` instead of `PEEK`, so the paper ticket fails closed when the portfolio snapshot is BLOCKED. Downstream positions/risk/orders/events panels show BLOCKED notes instead of `0 ROWS` when the snapshot is unavailable.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. This remains paper-only UI; no live broker submit, migration 0020, Railway secrets, or destructive DB action touched.
### Codex cycle (2026-05-01 15:24 Taipei) - plans dependent panels no longer turn BLOCKED into EMPTY
- Files changed: updated `apps/web/app/plans/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Plans still reads production plans plus briefs/reviews/signals/themes/companies and paper strategy ideas.
- Behavior change: when the combined plans context source is BLOCKED/EMPTY, dependent idea, brief, review, and signal panels now show BLOCKED instead of rendering emptyData as `0 ROWS` or EMPTY. True EMPTY notes are only shown after the source is LIVE.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, or destructive DB action touched.
### Codex cycle (2026-05-01 15:26 Taipei) - portfolio top kill card reflects fail-closed state
- Files changed: updated `apps/web/app/portfolio/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: when no backend kill-switch payload is available, the top portfolio KILL card now shows `FROZEN` instead of `--`, matching the fail-closed order ticket and kill-switch panel behavior.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, or destructive DB action touched.
### Codex cycle (2026-05-01 15:58 Taipei) - ops snapshot no longer renders blocked data as zero
- Files changed: updated `apps/web/app/ops/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Ops still reads `GET /api/v1/ops/snapshot?auditHours=24&recentLimit=12`.
- Behavior change: when the ops snapshot is BLOCKED, KPI cells now show `--` instead of fake zero counts, and OpenAlice/latest/audit panels show BLOCKED notes rather than EMPTY or `0 ROWS`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, or destructive DB action touched.
### Codex cycle (2026-05-01 16:05 Taipei) - theme detail dependent panels no longer render blocked data as zero
- Files changed: updated `apps/web/app/themes/[short]/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Theme detail still reads `GET /api/v1/themes`, `GET /api/v1/companies`, `GET /api/v1/signals`, and `GET /api/v1/strategy/ideas?themeId=...`.
- Behavior change: when the theme detail source is BLOCKED or EMPTY, KPI counts and dependent member/idea/signal panels no longer render `emptyData` as zero rows; dependent panels show the BLOCKED/EMPTY reason until the source is LIVE.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:06 Taipei) - themes ladder blocked state no longer reports fake totals
- Files changed: updated `apps/web/app/themes/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Themes ladder still reads `GET /api/v1/themes`.
- Behavior change: when the themes endpoint is BLOCKED, TOTAL/ATTACK/DEFENSE/CORE/OBS/P1 KPI cells show `--` instead of calculating zeros from the fail-closed empty array. True EMPTY endpoint responses can still show real zero counts with the EMPTY reason.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:09 Taipei) - strategy run pages no longer render blocked ledgers as zero rows
- Files changed: updated `apps/web/app/runs/page.tsx` and `apps/web/app/runs/[id]/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Run list/detail still read `GET /api/v1/strategy/runs?decisionMode=paper&sort=created_at` and `GET /api/v1/strategy/runs/:id`.
- Behavior change: BLOCKED strategy run sources now show `--` or BLOCKED reason for summary/output/lineage panels instead of fallback zero totals, empty output rows, or fake quality counts. True EMPTY run payloads still show EMPTY with reason.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. Pages remain read-only; no broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:11 Taipei) - ideas and signals blocked state no longer reports fake counts
- Files changed: updated `apps/web/app/ideas/page.tsx` and `apps/web/app/signals/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Ideas still read `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`; signals still read `GET /api/v1/signals + /api/v1/themes + /api/v1/companies`.
- Behavior change: BLOCKED strategy idea and signal sources now show `--` or blocked freshness text instead of fallback zero totals, 1970 generated timestamps, fake direction counts, or fake quality counts. True EMPTY endpoint responses still show EMPTY with reason.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. Idea-to-order handoff remains BLOCKED per Contract 4; no broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:15 Taipei) - company K-line distinguishes blocked OHLCV from true empty
- Files changed: updated `apps/web/app/companies/[symbol]/page.tsx` and `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Company detail still reads `GET /api/v1/companies` and `GET /api/v1/companies/:id/ohlcv?interval=1d`.
- Behavior change: OHLCV request failures now surface as BLOCKED with the raw request reason, while successful zero production bars surface as EMPTY. The K-line panel no longer renders a generic no-data message that hides whether the endpoint failed or was truly empty.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:18 Taipei) - quote page K-line now uses production OHLCV instead of a decorative blocked panel
- Files changed: updated `apps/web/app/quote/page.tsx`.
- Endpoints / data behavior: quote page still reads `GET /api/v1/market-data/effective-quotes`; it now also resolves the symbol through `GET /api/v1/companies` and, when available, reads `GET /api/v1/companies/:id/ohlcv?interval=1d` for the K-line panel.
- Behavior change: the quote page K-line panel is now LIVE/EMPTY/BLOCKED from the real OHLCV source instead of a static blocked placeholder claiming no bars contract exists. Bid/ask depth and tick tape remain BLOCKED pending their own contracts.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: KGI readonly bid/ask and tick contracts remain Jason/Elva blockers. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:20 Taipei) - Market Intel blocked state no longer reports fake news counts
- Files changed: updated `apps/web/app/market-intel/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Market Intel still reads `GET /api/v1/companies`, optional strategy ideas, and `GET /api/v1/companies/:id/announcements?days=30`.
- Behavior change: when Market Intel is BLOCKED, NEWS/COMPANIES/FAILURES KPI cells and the feed panel header no longer render fallback zero rows as if TWSE returned real empty coverage. LIVE and true EMPTY states keep their explicit source and reason.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: announcement endpoint availability remains Jason/Elva-owned. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:22 Taipei) - mobile dependent sections follow source state
- Files changed: updated `apps/web/app/m/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Mobile brief still reads briefs, themes, strategy ideas, market overview, and kill-switch read endpoints.
- Behavior change: when the combined mobile brief source is BLOCKED/EMPTY, latest brief, theme sweep, and paper idea sections now show the same non-live source state instead of rendering dependent empty arrays as independent EMPTY sections.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:25 Taipei) - plans and lab metrics stop deriving fake averages from blocked data
- Files changed: updated `apps/web/app/plans/page.tsx` and `apps/web/app/lab/LabClient.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Plans still read production plan context; Lab still reads/acts only through the lab bundle API.
- Behavior change: BLOCKED plans context no longer renders plan/review/brief/idea/signal KPI cells as zero. BLOCKED Quant Lab no longer renders NEW/APPROVED/PUSHED or AVG CONF/AVG RETURN/MAX DD as zero-valued metrics; empty lab data keeps true queue counts but hides averages.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: Lab push-to-portfolio remains BLOCKED until the Jason/Athena handoff contract exists. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 16:28 Taipei) - companies registry KPIs fail closed on API error
- Files changed: updated `apps/web/app/companies/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Companies registry still reads `GET /api/v1/companies` client-side.
- Behavior change: when the company registry request is BLOCKED, TOTAL/TWSE/TPEX/CORE/FILTERED KPI cells now show `--` instead of deriving zeros from the empty client state. Loading and true EMPTY states remain distinct.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: PR #39 migration 0020 remains blocked by Mike/Pete P0 and was not touched. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 17:07 Taipei) - portfolio risk surface scaffold fails closed on missing Contract 2 endpoint
- Files changed: added `apps/web/components/portfolio/RiskSurface.tsx`, added `apps/web/components/portfolio/PositionRiskBadge.tsx`, updated `apps/web/lib/api.ts`, and updated `apps/web/app/portfolio/page.tsx`.
- Endpoints / data behavior: added a frontend reader for `GET /api/v1/risk/portfolio-overview`. This is read-only and does not mutate risk limits, paper orders, broker state, migrations, Railway env, or secrets. If Jason's Contract 2 backend route is absent or errors, `/portfolio` renders the Risk Surface as BLOCKED with the raw request reason instead of showing fake OK or fake 0% utilization.
- Behavior change: `/portfolio` now has a top-level 4-layer Risk Surface panel for account / strategy / symbol / session. Position rows include a `RISK_NEXT` 4-character badge sourced from live `positionAttribution` when available; if attribution is missing or the endpoint is BLOCKED, the row shows `----` or `????` with tooltip reason instead of implying the next order is safe.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: Jason still owns the backend `GET /api/v1/risk/portfolio-overview` implementation and 30s live polling can be added after that endpoint exists. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 17:44 Taipei) - dashboard watchlist surface scaffold fails closed on missing Contract 3 endpoint
- Files changed: added `apps/web/components/watchlist/WatchlistSurface.tsx`, `apps/web/components/watchlist/WatchlistTable.tsx`, `apps/web/components/watchlist/QuoteCellRender.tsx`; updated `apps/web/lib/api.ts` and `apps/web/app/page.tsx`.
- Endpoints / data behavior: added a frontend reader for `GET /api/watchlist/overview` and placed the Watchlist panel on the dashboard. This is read-only. If Jason's Contract 3 aggregator route is missing or errors, the dashboard renders Watchlist as BLOCKED with owner/blocker text instead of fake symbols, fake quotes, or fake risk badges.
- Behavior change: when the endpoint becomes LIVE, dashboard watchlist rows render symbol/name, last/bid/ask/change cells with per-cell LIVE/BLOCKED handling, and risk advisory using the existing Contract 2 `PositionRiskBadge` component. PROMOTE is intentionally disabled with a tooltip until Contract 4's promote route is live, so there is no no-op button and no pretend execution path.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: Jason still owns `GET /api/watchlist/overview`; Contract 4 still owns promote-to-paper preview. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 18:23 Taipei) - idea and run outputs show Contract 4 promote as BLOCKED
- Files changed: updated `apps/web/app/ideas/page.tsx`, `apps/web/app/runs/[id]/page.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. `/ideas` still reads `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`; `/runs/[id]` still reads `GET /api/v1/strategy/runs/:id`. No paper submit route, broker route, or migration was touched.
- Behavior change: strategy idea rows and run output rows now render a visible non-action `PROMOTE BLOCKED` cell with the missing Contract 4 route and owner context. This removes the ambiguity where the page note said handoff was blocked but each row only exposed a detail link.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; stop-line grep on the changed files found 0 broker/write-side/order-create hits.
- Blockers: Jason + Bruce still own Contract 4 `POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-preview` and P1-9 idempotency verification before any real promote action can be rendered. No broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, or destructive DB action touched.
### Codex cycle (2026-05-01 19:30 Taipei) - emergency product-language repair after operator visual review
- Files changed: updated `apps/web/components/PageFrame.tsx`, `apps/web/app/portfolio/page.tsx`, `apps/web/components/portfolio/OrderTicket.tsx`, `apps/web/components/portfolio/KillSwitch.tsx`, `apps/web/components/portfolio/RiskSurface.tsx`, `apps/web/app/quote/page.tsx`, and company detail files under `apps/web/app/companies/[symbol]/`.
- Endpoints / data behavior: no endpoint contract changed. Portfolio remains on paper trading/risk/kill-switch read endpoints plus paper preview/submit; quote and company K-line still read production OHLCV; company announcements still read official announcements. No live broker route, KGI write-side SDK, migration, Railway env, or secret path touched.
- Behavior change: user-facing portfolio, paper ticket, company detail, quote, source status, and Market Intel copy moved back to Traditional Chinese Taiwan-stock product language. Engineering labels such as `EXEC LAYER`, `PAPER ORDER TICKET / CONTRACT`, `Owner`, raw endpoint strings, and raw `LIVE/EMPTY/BLOCKED` labels were replaced with product-level Chinese. K-line now offers 日K / 週K / 月K from real daily bars, expands visible range, and marks intraday intervals as waiting for real-time data instead of rendering fake candles.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Local dev booted on `127.0.0.1:3007`, but protected routes redirected to `/login` without an operator browser cookie, so authenticated visual QA remains pending in a logged-in browser session.
- Blockers: authenticated visual QA still needed before production push/merge confidence. KGI `libCGCrypt.so` remains the only live-submit blocker; readonly bid/ask and tick panels stay visibly pending real data. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action.
### Codex cycle (2026-05-01 20:29 Taipei) - full zh-TW product-language sweep and paper unit fix
- Files changed: updated shared web chrome (`PageFrame`, `Sidebar`, `CommandPalette`, `DataSourceBadge`, `globals.css`), major app routes under `apps/web/app/**`, watchlist/portfolio components, `radar-lab`, `paper-orders-api`, and `plan-to-order`.
- Endpoints / data behavior: no backend contract changed. Company OHLCV now requests a wider historical range and renders 日K/週K/月K from real daily bars; intraday 分K remains visibly pending KGI readonly data. Paper order payloads now default visible `股數` to `quantity_unit=SHARE` so the UI does not treat user-entered share counts as board lots.
- Behavior change: remaining visible English/governance jargon was converted to Traditional Chinese product language across login/register, dashboard, companies, company detail panels, quote, paper trading, watchlist, Market Intel, briefs, drafts, reviews, mobile brief/kill, themes detail, runs detail, and Quant Lab. Raw `LIVE/EMPTY/BLOCKED`, `Owner`, `Source`, `Approve/Reject/Push`, and missing-contract labels are now product-level 正常/無資料/暫停/核准/退回/轉入 labels where visible.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web` PASS except line-ending warnings. Local production server booted on `127.0.0.1:3017`; Playwright screenshots for `/login` and `/register` show zh-TW layout. Protected routes redirect to login without an operator browser cookie, so authenticated visual QA is still pending in a logged-in browser session.
- Blockers: no new blockers introduced. KGI `libCGCrypt.so` remains the only live-submit blocker; readonly bid/ask/tick stays pending real KGI data and is not faked. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, and no credential storage.
### Codex cycle (2026-05-01 20:54 Taipei) - CI unblock after zh-TW repair push
- Files changed: updated `apps/api/src/__tests__/risk-engine.test.ts` and this board.
- Endpoints / data behavior: no runtime endpoint contract changed. The API change is test-only and narrows the inline risk-engine test quote market from generic string inference to the existing TWSE literal union.
- Behavior change: unblocks repository CI that failed after the web repair push because `market: "TWSE"` in the API test fixture was inferred as `string` on GitHub Linux. No trading, risk, broker, migration, database, Railway, or secret behavior changed.
- Tests: `pnpm.cmd typecheck` PASS across all 9 packages. `pnpm.cmd build` on local Windows hit a no-output timeout while Next/Turbo build processes stayed resident; the stale build processes were stopped. Prior web build for the same frontend patch passed locally, and GitHub CI remains the source of truth for Linux build/test/smoke.
- Blockers: no new blockers introduced. This is a CI unblock only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, and no credential storage.
### Codex cycle (2026-05-01 21:03 Taipei) - CI test unblock for risk store and demo cap fixtures
- Files changed: updated `apps/api/src/risk-store.ts`, `tests/ci.test.ts`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Risk store still uses `RAILWAY_VOLUME_MOUNT_PATH` in Railway; CI/test-only fallback now writes to `.tmp/risk-store` when no Railway volume path exists. R17 quoteGate tests now size demo-paper fixtures below the 20k SHARE cap or use a non-demo account when intentionally testing `max_per_trade`.
- Behavior change: GitHub Linux tests no longer silently lose risk-limit writes to unwritable `/data`, and quoteGate advisory tests no longer get preempted by the W7 demo absolute-notional guard. Production risk behavior and the demo 20k cap remain intact.
- Tests: `pnpm.cmd typecheck` PASS; `pnpm.cmd test` PASS (122/122); `$env:CI='true'; pnpm.cmd test` PASS (122/122); `pnpm.cmd smoke` PASS. Local `secret_regression_check.py` failed only because the dirty local `.claude/worktrees/**/node_modules` tree contains a transient missing path; clean GitHub checkout should not include that tree. `w6_no_real_order_audit.py` timed out locally while scanning the dirty workspace.
- Blockers: wait for GitHub CI on the next push to confirm Linux build/test/smoke and then Railway deploy. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, and no credential storage.
### Codex cycle (2026-05-01 22:24 Taipei) - operator-requested UI repair pass
- Files changed: updated portfolio layout/typography and paper ticket styling (`apps/web/app/portfolio/page.tsx`, `apps/web/components/portfolio/OrderTicket.tsx`, `KillSwitch.tsx`, `ExecutionTimeline.tsx`), shared chrome (`apps/web/app/globals.css`, `PageFrame.tsx`, `DataSourceBadge.tsx`), company K-line and order side panels, and small route copy fixes under ideas/plans/ops/admin drafts.
- Endpoints / data behavior: no endpoint contract changed. Portfolio still reads real paper/risk/kill-switch endpoints; paper ticket still only previews/submits paper orders; K-line still uses real OHLCV daily bars and derives 週K/月K client-side. No live broker route, KGI write-side SDK, migration, Railway env, secret, or destructive DB path was touched.
- Behavior change: removed visible engineering/English labels from key operator surfaces, stopped rendering kill-switch state as disabled fake buttons, widened the paper execution layout to a two-column desk with a full-width ledger row, enlarged Traditional Chinese/monospace typography, preserved the black-gold trading room style, kept `libCGCrypt.so` casing readable by removing forced uppercase, translated workspace/status details, and made K-line default to a longer 2-year view with wider daily/weekly/monthly visible ranges.
- Tests: local authenticated-dev visual QA used only a dummy local `iuf_session` cookie against memory-mode API; no operator credentials were used, stored, or logged. Screenshots captured for `/portfolio` and `/quote?symbol=2330`. `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: production authenticated visual QA still needs a live browser session after deploy. KGI `libCGCrypt.so` remains the live-submit blocker; readonly bid/ask/tick stays pending real KGI data and is not faked. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, and no credential storage.
### Codex cycle (2026-05-01 22:49 Taipei) - remove visible engineering panel codes and widen K-line viewport
- Files changed: updated `apps/web/components/PageFrame.tsx`, `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. K-line still uses real OHLCV daily bars, derives weekly/monthly locally, and keeps intraday intervals visibly pending real KGI readonly data.
- Behavior change: shared page/panel chrome now displays Traditional Chinese short section labels instead of raw engineering codes such as `ORD-TKT`, `RISK-BASE`, `QTE`, or `MKT-INTEL`; numeric page IDs remain but route suffixes like `06-PORT` render as product language. Company K-line now shows `K線` instead of `K-LINE`, uses tighter bar spacing, and opens wider visible ranges so daily/weekly/monthly views show materially more candles.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. First repair commit `4d1e239` CI and Railway deploy both completed successfully.
- Blockers: none introduced. KGI `libCGCrypt.so` remains the live-submit blocker; readonly bid/ask/tick stays pending real KGI data and is not faked. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, and no credential storage.
### Codex cycle (2026-05-01 22:43 Taipei) - replace blocked fake buttons with truthful status labels
- Files changed: updated `apps/web/components/watchlist/WatchlistTable.tsx`, `apps/web/app/m/kill/page.tsx`, `apps/web/app/lab/LabClient.tsx`, `apps/web/app/lab/[bundleId]/LabBundleDetailClient.tsx`, `apps/web/app/globals.css`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Watchlist promote, mobile kill-switch mode changes, and Quant Lab transfer-to-paper remain visibly BLOCKED/awaiting contracts; this patch only changes the rendered affordance from disabled/no-op buttons to read-only status labels.
- Behavior change: blocked controls no longer look clickable. Watchlist `待啟用`, mobile kill-switch mode cards, and Lab `待契約` all expose blocker text through status/title semantics. The mobile kill page also hides the raw `paper-default` engineering account id behind the Traditional Chinese product label `紙上帳戶`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: production authenticated visual QA still needs a live browser session after deploy. KGI `libCGCrypt.so` remains the live-submit blocker; readonly bid/ask/tick stays pending real KGI data and is not faked. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, and no credential storage.
### Codex cycle (2026-05-01 22:58 Taipei) - company detail remaining English data labels translated
- Files changed: updated `apps/web/app/companies/[symbol]/CompanyHeroBar.tsx`, `apps/web/app/companies/[symbol]/CompanyInfoPanel.tsx`, `apps/web/app/companies/[symbol]/page.tsx`, `apps/web/lib/company-adapter.ts`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Company detail still uses production company, OHLCV, FinMind financials, chips, announcements, paper preview, and risk-read endpoints. This patch only translates display labels and status text.
- Behavior change: company hero and breadcrumb no longer show raw `Semiconductors / Observation`; they display `半導體 / 觀察`. The company KPI strip no longer renders `BLOCKED` for momentum and displays `暫停`. Company note lines now translate `Sector`, `Industry`, `Market Cap`, and `Enterprise Value` labels to Traditional Chinese. Foreign-flow unit text now uses `十億` instead of `BN`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Production authenticated smoke before this patch found `/companies/2330` otherwise healthy: status 200, FinMind K-line and financial/chip panels live, daily chart displayed 491 official OHLCV rows.
- Blockers: KGI `libCGCrypt.so` remains the live-submit blocker; readonly bid/ask/tick stays pending real KGI data and is not faked. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, and no credential storage.
### Codex cycle (2026-05-02 02:07 Taipei) - demo-critical UI repair branch after operator review
- Files changed: updated `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/page.tsx`, `apps/web/app/companies/page.tsx`, `apps/web/app/themes/page.tsx`, `apps/web/app/signals/page.tsx`, `apps/web/app/portfolio/page.tsx`, `apps/web/components/portfolio/OrderTicket.tsx`, `apps/web/lib/paper-orders-api.ts`, and `.gitignore`.
- Endpoints / data behavior: no endpoint contract changed. Companies/themes/signals/portfolio still read the existing real endpoints and fail closed when auth/API is unavailable. Paper order ticket still sends `quantity_unit` explicitly; zero-lot remains `SHARE` and board-lot remains `LOT`.
- Behavior change: demo-critical pages now use Traditional Chinese product typography (`Noto Sans TC` for dense UI, serif retained for title accents), theme/dashboard rows no longer overlap, raw browser/API errors such as `Failed to fetch` no longer leak into user-visible copy, paper order outcome/history displays unit plus actual shares, and source labels are localized.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; Playwright visual sweep on local `127.0.0.1:3002` captured `/login`, `/`, `/themes`, `/portfolio`, `/companies`, `/signals`, `/lab` and found 0 raw `Failed to fetch`, `fetch failed`, `ECONNREFUSED`, `PAPER_ORDER_`, `market-data`, `Cannot find module`, or `Runtime Error` strings.
- Blockers: real authenticated production smoke is still pending after PR/deploy. KGI `libCGCrypt.so` remains the live-submit blocker. Freeze banner read: this branch is limited to `demo-critical-ui`; no RSS/news feature, broker write, migration 0020, Railway secrets, live submit, KGI SDK/write-side, destructive DB action, or credential storage was touched.
### Codex cycle (2026-05-02 02:35 Taipei) - dashboard layout system repair after operator screenshot
- Files changed: updated `apps/web/app/globals.css`, `apps/web/app/page.tsx`, `apps/web/components/Sidebar.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Dashboard still reads the existing market overview, watchlist, themes, ideas, signals, announcements, and run endpoints; the patch only changes information hierarchy, spacing, and display-language cleanup.
- Behavior change: dashboard switched from a cramped 3-column layout to a 2-column command layout so right-side signals no longer wrap into vertical word stacks. Added a truthful dashboard hero band using existing live/empty/blocked state, widened panel padding/line-height, cleaned sidebar copy by removing numeric nav noise, translated additional category/reason display strings (`industry`, `missing_bars`), and made the portfolio execution grid collapse safely on 1365px desktop widths.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; rerun `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS after build. Playwright 1365px sweep across `/login`, `/register`, `/`, `/themes`, `/companies`, `/companies/2330`, `/ideas`, `/runs`, `/portfolio`, `/quote?symbol=2330`, `/signals`, `/plans`, `/ops`, `/market-intel`, `/lab`, `/briefs`, `/drafts`, `/reviews`, `/m`, `/m/kill` found 0 horizontal overflow and 0 raw `Failed to fetch`, `fetch failed`, `ECONNREFUSED`, `PAPER_ORDER_`, `market-data`, `Cannot find module`, `Runtime Error`, `missing_bars`, `undefined`, or `null` strings.
- Blockers: authenticated production smoke remains pending after deploy. Automation `iuf-25` remains ACTIVE at 25-minute cadence and was tightened to keep fixing all pages before any new feature/animation work. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.
### Codex cycle (2026-05-02 02:58 Taipei) - auth entry access and company error copy repair
- Files changed: updated `apps/web/middleware.ts`, `apps/web/app/companies/[symbol]/page.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Public `/login` and `/register` routes now remain accessible even when an `iuf_session` cookie exists, so an operator can intentionally switch accounts or create an invited account without first clearing cookies. Company detail still reads the same company and OHLCV endpoints.
- Behavior change: fixed the operator complaint where visiting login/register after prior login immediately redirected back to the dashboard. Company detail failure states no longer render engineering diagnostics such as `API_BASE`, workspace slug, or raw browser/network error text; user-visible copy is Traditional Chinese and action-oriented.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Playwright 1365px captured `/login` and `/register` both with and without dummy local session cookie, plus `/companies/2330`; all had 0 horizontal overflow and 0 raw `Failed to fetch`, `fetch failed`, `ECONNREFUSED`, `PAPER_ORDER_`, `market-data`, `Cannot find module`, `Runtime Error`, `API_BASE`, `WORKSPACE`, or `工程診斷` strings.
- Blockers: production authenticated smoke remains pending after deploy. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.
### Codex cycle (2026-05-02 03:12 Taipei) - dashboard density repair for 1365px operator view
- Files changed: updated `apps/web/app/page.tsx`, `apps/web/app/globals.css`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Dashboard still reads the same market overview, themes, companies, ideas, runs, signals, announcements, and watchlist endpoints; this patch only changes responsive layout and signal-row rendering.
- Behavior change: at 1450px and below, the dashboard command surface collapses to a single readable column instead of forcing right-side panels into a narrow strip. Signal rows now use a two-line metadata/title layout so English or mixed-language signal titles wrap by words rather than turning into one-word vertical stacks. Page header metadata also wraps under the title on narrower desktops, and the sidebar width was increased slightly for Traditional Chinese labels.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Local Playwright 1365px smoke on `127.0.0.1:3003` captured `/`, `/portfolio`, and `/companies/2330`; all had 0 horizontal overflow and 0 raw `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `工程診斷`, `Failed to fetch`, `ECONNREFUSED`, or `Runtime Error` strings.
- Blockers: local dashboard could not render live signal rows because the local dev server had no authenticated backend API, but CSS and DOM layout were verified in the blocked state. Production authenticated smoke remains pending after deploy. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.
### Codex cycle (2026-05-02 03:31 Taipei) - remove raw frontend error leakage from app routes
- Files changed: added `apps/web/lib/friendly-error.ts`; updated dashboard, companies, themes, signals, ideas, runs, plans, portfolio, quote, Market Intel, ops, mobile brief, and Quant Lab route/client files plus this board.
- Endpoints / data behavior: no endpoint contract changed. All changed pages still call their existing read endpoints and fail closed when auth/API/data is unavailable.
- Behavior change: visible page failure reasons no longer render raw browser or backend strings such as `Failed to fetch`, `ECONNREFUSED`, generic `error.message`, or route-specific raw exception text. They now map to Traditional Chinese operator-facing reasons: API unreachable, session expired, permission denied, endpoint missing, timeout, or a page-specific fallback.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Static grep over `apps/web/app/**/*.tsx` and `apps/web/app/*.tsx` found 0 remaining direct `error.message`, `String(error)`, `String(caught)`, or `return message` app-route leaks after the patch. Local Playwright 1365px smoke on `127.0.0.1:3003` swept `/`, `/themes`, `/signals`, `/ideas`, `/runs`, `/plans`, `/ops`, `/market-intel`, `/lab`, `/m`, `/portfolio`, and `/quote?symbol=2330`; all returned 0 horizontal overflow and 0 raw `Failed to fetch`, `fetch failed`, `ECONNREFUSED`, `NetworkError`, `TypeError:`, `API_BASE`, `WORKSPACE`, `工程診斷`, `PAPER_ORDER_`, or `Runtime Error` hits.
- Blockers: production authenticated smoke remains pending after deploy. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.
### Codex cycle (2026-05-02 03:43 Taipei) - auth/register error fallback cleanup
- Files changed: updated `apps/web/lib/auth-client.ts`, `apps/web/app/register/page.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Login still calls `POST /auth/login`; registration still calls `POST /auth/register-with-invite`. The page is a real invite-code registration flow, not a decorative placeholder.
- Behavior change: login and registration no longer expose raw `server_error_###` style fallback strings when the auth endpoint returns an unexpected error. Unknown login failures now show a generic Traditional Chinese retry message; unknown registration failures show `註冊暫時無法完成，請稍後再試。`
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Local Playwright 1365px smoke on `/login` and `/register` found 0 horizontal overflow and 0 visible `server_error_`, `註冊失敗：`, `登入失敗：`, `API_BASE`, `Failed to fetch`, or `ECONNREFUSED` strings.
- Blockers: self-service public signup remains a product/backend policy decision; current production flow is invite-code account creation. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-02 04:06 Taipei) - chrome spacing and Taiwan unit safety repair
- Files changed: updated `apps/web/app/globals.css`, `apps/web/components/Sidebar.tsx`, `apps/web/components/portfolio/OrderTicket.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Paper orders still call only the existing preview/submit/cancel paper endpoints; live broker submit, KGI SDK write-side, Railway secrets, migration 0020, and destructive DB paths were not touched. The order ticket still sends `quantity_unit` explicitly.
- Behavior change: shared page header now keeps the right-side state pill compact at 1365px instead of stretching into a long horizontal bar. Sidebar no longer decorates the trading-room item with a permanent `/ 執行` suffix. The order review modal now makes Taiwan stock units explicit with `SHARE 零股` and `LOT 整張` badges, shows the full notional formula (`SHARE x price` or `LOT x 1,000 股/張 x price`), displays simulated fee and paper-only status, and shortens modal actions to the two hard choices `取消` / `確認送出`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Local Playwright 1365px smoke after restarting the dev server captured `/`, `/portfolio`, `/themes`, `/ideas`, and `/signals`; all had 0 horizontal overflow, loaded styled dark UI, no raw `missing_bars`, `Balanced`, `Discovery`, `Validation`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `Failed to fetch`, `ECONNREFUSED`, `Runtime Error`, `undefined`, `null`, `BLOCKED`, `EMPTY`, `LIVE`, `paper-default`, or `market-data` strings, and the sidebar no longer rendered `交易室 / 執行`.
- Blockers: production authenticated smoke remains pending after deploy. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-02 04:47 Taipei) - plans/ops/signals raw-code cleanup
- Files changed: updated `apps/web/app/plans/page.tsx`, `apps/web/app/ops/page.tsx`, `apps/web/app/signals/page.tsx`, `apps/web/lib/paper-orders-api.ts`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Plans/ops/signals continue reading their existing real endpoints; paper order client behavior is unchanged except that unconfigured API-base errors are translated before reaching the operator UI.
- Behavior change: `交易計畫` no longer shows raw strategy reason strings like `missing_bars`; it uses the shared Traditional Chinese strategy vocabulary. Plan signal context now includes date+time and localized signal category labels. `營運監控` hides workspace slugs/OpenAlice wording/action/entity codes behind product-language labels, and audit/latest rows show date+time. `/portfolio` no longer leaks `NEXT_PUBLIC_API_BASE_URL is not configured` into the market preview area.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Local 1365px Playwright smoke on `/`, `/plans`, `/ops`, `/signals`, `/themes`, and `/portfolio` found 0 horizontal overflow and 0 visible `missing_bars`, `OpenAlice`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `Failed to fetch`, `fetch failed`, `ECONNREFUSED`, `Runtime Error`, `undefined`, or `null` strings.
- Blockers: production authenticated smoke remains pending after deploy. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-02 05:18 Taipei) - secondary content/mobile error copy cleanup
- Files changed: updated `apps/web/app/briefs/page.tsx`, `apps/web/app/drafts/page.tsx`, `apps/web/app/reviews/page.tsx`, `apps/web/app/m/kill/page.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Briefs/drafts/reviews/mobile kill still read their existing official endpoints and fail closed when unavailable.
- Behavior change: secondary content pages now route backend/API errors through the shared Traditional Chinese friendly-error mapper instead of exposing `API_BASE`, `NEXT_PUBLIC_API_BASE_URL`, or network diagnostics. Drafts page no longer shows the internal `OpenAlice` product codename; mobile kill-switch state also hides raw API-base failures.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Full local 1365px Playwright sweep on `/login`, `/register`, `/`, `/themes`, `/companies`, `/companies/2330`, `/ideas`, `/runs`, `/plans`, `/ops`, `/signals`, `/market-intel`, `/portfolio`, `/quote?symbol=2330`, `/lab`, `/briefs`, `/drafts`, `/reviews`, `/m`, and `/m/kill` found 0 horizontal overflow and 0 visible `missing_bars`, `OpenAlice`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `Failed to fetch`, `fetch failed`, `ECONNREFUSED`, `Runtime Error`, `undefined`, `null`, raw `BLOCKED/EMPTY/LIVE`, or `paper-default` strings.
- Blockers: production authenticated smoke remains pending after deploy. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-02 14:58 Taipei) - deploy verification + internal label cleanup
- Files changed: updated `apps/web/app/admin/content-drafts/page.tsx`, `apps/web/app/lab/[bundleId]/page.tsx`, `apps/web/lib/auth-client.ts`, `apps/web/lib/radar-lab.ts`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Content drafts, auth, and lab still call their existing endpoints and fail closed through user-facing Traditional Chinese copy.
- Behavior change: verified latest `main` commit `fd9fc2a` deployed through GitHub Actions run `25245972855`; Railway web/api/worker jobs all completed successfully at 2026-05-02 14:39 Taipei. Public production smoke on `/login` and `/register` returned 200 with 0 raw `OpenAlice`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `missing_bars`, `undefined`, `null`, or runtime error strings. Also removed remaining visible `OpenAlice` labels from admin draft/lab surfaces and replaced a raw lab detail error path with `friendlyDataError`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Production public Playwright 1365px smoke captured `/login`, `/register`, and confirmed protected `/market-intel` redirects to login without raw diagnostics.
- Blockers: local Railway CLI OAuth token is expired (`invalid_grant`), so CLI status cannot be used until operator re-logins; GitHub Actions deploy remains healthy and is the current deployment proof. Authenticated production visual smoke still requires a live browser session or non-secret test account flow. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-02 15:15 Taipei) - page chrome de-noise and company count clarity
- Files changed: updated `apps/web/components/PageFrame.tsx`, dashboard/home route `apps/web/app/page.tsx`, primary route panels under `apps/web/app/{ideas,market-intel,ops,plans,portfolio,runs,signals,themes}/**`, company registry pages `apps/web/app/companies/page.tsx` and `apps/web/app/companies/duplicates/page.tsx`, plus this board.
- Endpoints / data behavior: no endpoint contract changed. All pages still call the same read endpoints and fail closed; duplicate-company merge actions remain hidden behind the migration/backup/review stop-line. No new news/RSS/commercial data feature was added.
- Behavior change: shared page chrome now maps page ids to product names (`頁 / 戰情台`, `頁 / 公司板`, etc.) instead of showing `頁 / 01` style labels. Dashboard and major route panels no longer use update time as the visual title; titles are semantic Traditional Chinese labels while update time stays in the source/status line. Company registry now explains the raw row count versus de-duplicated Taiwan-stock company count, including how many duplicate rows are temporarily hidden until Mike/Jason database audit gate clears. Remaining visible `migration audit/gate` wording on company duplicate pages was localized.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS after build. Local production server on `127.0.0.1:3023` swept 21 routes at 1365px (`/login`, `/register`, `/`, `/themes`, `/companies`, `/companies/duplicates`, `/companies/2330`, `/ideas`, `/runs`, `/plans`, `/ops`, `/signals`, `/market-intel`, `/portfolio`, `/quote?symbol=2330`, `/lab`, `/briefs`, `/drafts`, `/reviews`, `/m`, `/m/kill`) with 0 horizontal overflow and 0 visible raw `頁 / 01..11`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `NEXT_PUBLIC_API_BASE_URL`, `missing_bars`, `migration audit`, `migration gate`, `Failed to fetch`, `fetch failed`, `ECONNREFUSED`, `Runtime Error`, `undefined`, `null`, `paper-default`, `OpenAlice`, or raw `BLOCKED/EMPTY/LIVE` strings.
- Blockers: production authenticated visual smoke still depends on a safe non-secret browser session after deploy. KGI `libCGCrypt.so` remains the live-submit blocker only; frontend order-unit safety stays explicit (`SHARE` zero-lot vs `LOT` board-lot). Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-02 15:45 Taipei) - visible backend-language and mobile badge cleanup
- Files changed: updated secondary route copy under `apps/web/app/admin/content-drafts/**`, `apps/web/app/briefs/page.tsx`, `apps/web/app/companies/**`, `apps/web/app/lab/LabClient.tsx`, `apps/web/app/signals/page.tsx`, `apps/web/app/themes/page.tsx`, shared status/error helpers `apps/web/components/DataSourceBadge.tsx`, `apps/web/lib/{api,friendly-error,paper-orders-api,radar-lab}.ts`, and mobile CSS in `apps/web/app/globals.css`.
- Endpoints / data behavior: no endpoint contract changed. Pages still call the same real read endpoints and fail closed when backend/auth is unavailable. Paper-order payload and Taiwan unit logic were not changed; `SHARE` and `LOT` remain explicit. No Railway secret, migration 0020, broker write, KGI SDK/write-side, live submit, RSS/news, commercial data, or destructive DB path was touched.
- Behavior change: remaining visible `API` / `migration` / env-style wording was replaced with Traditional Chinese product language such as `後端`, `正式資料`, and `資料庫去重流程`. Generic request helpers now emit friendly Traditional Chinese backend errors instead of `NEXT_PUBLIC_API_BASE_URL` strings. Mobile routes hide the fixed data-source badge so `/m` and `/m/kill` no longer show a full-width red status strip on 1365px desktop QA.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS. Local production server on `127.0.0.1:3024` swept 21 routes at 1365px (`/login`, `/register`, `/`, `/themes`, `/companies`, `/companies/duplicates`, `/companies/2330`, `/ideas`, `/runs`, `/plans`, `/ops`, `/signals`, `/market-intel`, `/portfolio`, `/quote?symbol=2330`, `/lab`, `/briefs`, `/drafts`, `/reviews`, `/m`, `/m/kill`) with 0 failures: no horizontal overflow, no narrow vertical text stacks, no visible raw `API`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `NEXT_PUBLIC_API_BASE_URL`, `missing_bars`, `migration audit`, `migration gate`, `Failed to fetch`, `fetch failed`, `ECONNREFUSED`, `Runtime Error`, `undefined`, `null`, `paper-default`, `OpenAlice`, or raw `BLOCKED/EMPTY/LIVE` strings. Screenshots and `summary.json` are in `evidence/w7_paper_sprint/local_visual_qa_pass10_2026-05-02-final/` and remain local evidence.
- Blockers: production authenticated visual smoke still depends on a safe non-secret browser session after deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-02 21:29 Taipei) - sparse K-line truth state
- Files changed: updated `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx` and this board.
- Endpoints / data behavior: no endpoint contract changed. Company K-line still renders only real OHLCV returned by the existing endpoint and still derives weekly/monthly locally from real daily bars. When the selected interval/range has fewer than 12 real bars, the UI now shows a Traditional Chinese `資料不足` truth state with the actual returned bar count and a compact latest-bar list instead of stretching a few candles into a misleading trend chart.
- Behavior change: company detail K-line no longer pretends a sparse backend response is a usable chart. The copy explicitly says it is using real OHLCV only and that the full chart will return automatically after backend history is filled. This addresses the operator complaint that K-line was showing too few candles while preserving the no-fake-data rule.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx` PASS with only CRLF normalization warning. Local Playwright 1365px QA against `127.0.0.1:3035/companies/2330` with a fake read-only local API returning exactly 3 OHLCV bars confirmed status 200, visible `資料不足`, visible `正式 K 線目前只回傳 3 根`, visible real-only copy, 0 horizontal overflow, 0 narrow vertical text stacks, 0 page errors, and 0 raw `Failed to fetch`, `ECONNREFUSED`, `Runtime Error`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `undefined`, or `null` strings. Screenshot/report are in `evidence/w7_paper_sprint/local_visual_qa_pass16_kline_insufficient_2026-05-02/` as local evidence.
- Blockers: this patch fixes UI truthfulness only; it does not create historical OHLCV data. Full multi-timeframe depth still depends on the backend/data lane returning enough official bars. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-02 22:11 Taipei) - LOT board-lot second confirmation guard
- Files changed: updated `apps/web/components/portfolio/OrderTicket.tsx`, `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Both paper order entry surfaces still submit the same existing paper-preview / paper-order payloads and still require explicit `quantity_unit=SHARE` or `quantity_unit=LOT`. No broker write, live submit, KGI SDK, Railway env, migration, database write, news/RSS, or commercial data path was touched.
- Behavior change: if an operator chooses `LOT 整張`, the final review modal now disables `確認送出` until the operator checks a second acknowledgement: `我知道這是整張委託，1 張會送出 1,000 股；不是零股測試。` The existing `SHARE 零股` path remains direct after preview, and both modals still show actual share count plus notional formula. This directly reduces the Taiwan-stock fat-finger risk where high-priced stocks such as NT$800 could accidentally be treated as 1 board lot = NT$800,000.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web/components/portfolio/OrderTicket.tsx apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` PASS with only CRLF normalization warnings. Local browser QA attempted with a fake read-only API and Next production server, but the current sandbox blocked spawning the local Next process with `spawn EPERM`; recorded as tooling blocker and bypassed with compile/static verification for this cycle.
- Blockers: shell network is currently blocked (`git fetch origin main` failed to connect to github.com), so remote push/PR may need the GitHub connector path or the next unrestricted cycle. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-03 03:22 Taipei) - theme/dashboard spacing and raw slug cleanup
- Files changed: updated `apps/web/app/themes/page.tsx`, dashboard route `apps/web/app/page.tsx`, shared row spacing in `apps/web/app/globals.css`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Dashboard/themes still read the same official endpoints and keep the 4-state truth model; this patch only changes operator-facing labels, spacing, and table layout.
- Behavior change: the theme board no longer exposes raw theme slug codes as a user-facing table column, dashboard theme summaries no longer prepend raw slugs, and the internal cleanup note no longer shows English words such as `placeholder`, `broken`, or `deprecated`. Shared row/table/button-adjacent spacing was widened across dashboard, themes, signals, ideas, timeline, positions, lab rows, source rows, market-intel rows, and content rows so text and icons have breathing room and no longer sit tight against separator lines.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web/app/themes/page.tsx apps/web/app/page.tsx apps/web/app/globals.css` PASS with only CRLF normalization warnings.
- Blockers: production authenticated visual smoke is pending after this patch is merged and deployed. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-03 03:47 Taipei) - global panel/form breathing-room pass
- Files changed: updated shared chrome/form/table spacing in `apps/web/app/globals.css`, company detail order form spacing in `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`, portfolio trading-room order form spacing in `apps/web/components/portfolio/OrderTicket.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Company and portfolio order forms still use only paper preview/submit endpoints with explicit `SHARE` / `LOT` units; this patch changes layout and hit-area spacing only.
- Behavior change: sidebar icon rows, panel headers, terminal notes, metric cards, data tables, company source details, K-line/company panels, paper-ticket banners, segmented controls, inputs, preview boxes, review rows, order history rows, and final confirmation modal actions now have wider padding and clearer vertical rhythm. The goal is to eliminate the operator-visible issue where Chinese labels, icons, and controls sit too close to separator lines or panel borders.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web/app/globals.css apps/web/app/companies/[symbol]/PaperOrderPanel.tsx apps/web/components/portfolio/OrderTicket.tsx` PASS with only CRLF normalization warnings. Local 1365px Playwright QA on `127.0.0.1:3042` swept `/login`, `/register`, `/`, `/themes`, `/portfolio`, and `/companies/1101`: all returned 200, 0 horizontal overflow, 0 narrow vertical text stacks, 0 page errors, and 0 visible raw `Failed to fetch`, `ECONNREFUSED`, `Runtime Error`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `NEXT_PUBLIC_API_BASE_URL`, `missing_bars`, `OpenAlice`, `placeholder`, `deprecated`, or `broken`. Evidence remains local at `evidence/w7_paper_sprint/local_visual_qa_pass25_spacing_2026-05-03/`.
- Blockers: production authenticated visual smoke is pending after this patch is merged and deployed. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-03 04:33 Taipei) - clean Traditional Chinese dashboard/company repair
- Files changed: rewrote clean Traditional Chinese operator copy and spacing for `apps/web/components/PageFrame.tsx`, `apps/web/components/Sidebar.tsx`, dashboard `apps/web/app/page.tsx`, company registry `apps/web/app/companies/page.tsx`, duplicate-company report, company info/K-line/derivatives/tick panels, strategy ideas, watchlist components, and shared CSS. Also removed internal staff names from several secondary read-only/error surfaces under admin drafts, briefs, drafts, lab, reviews, and run detail.
- Endpoints / data behavior: no endpoint contract changed. Dashboard, company registry, company detail, strategy ideas, duplicate-company report, watchlist, and order surfaces still call the existing read/paper endpoints and keep the LIVE/EMPTY/BLOCKED truth model. No broker write, KGI SDK/write-side, migration, Railway env, secret, RSS/news feature, commercial-data feature, or destructive DB path was touched.
- Behavior change: sidebar/page chrome now uses readable 台股/繁中 product labels instead of garbled or numeric labels; dashboard was rebuilt into a clean command surface with real market tape, source states, watchlist, themes, ideas, signals, market intel, and ops panels; company registry explains raw row count versus de-duplicated displayed companies; company info and K-line panels use clear labels, wider spacing, and no fake intraday/KGI data; watchlist labels and blocked actions no longer look like clickable fake buttons.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check` PASS for the main changed files with only CRLF normalization warnings. Local 1365px Playwright QA on `127.0.0.1:3044` swept `/login`, `/register`, `/`, `/companies`, `/companies/1101`, `/companies/duplicates`, `/ideas`, and `/portfolio`: all returned 200, 0 horizontal overflow, 0 narrow vertical text stacks, 0 page errors, and 0 visible internal owner names or raw `API_BASE` / `WORKSPACE` / `PAPER_ORDER_` diagnostics.
- Blockers: this pass verifies local blocked-state and static production build. Authenticated production real-data visual smoke remains pending after merge/deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-03 05:19 Taipei) - global breathing-room and company-side panel polish
- Files changed: updated shared spacing in `apps/web/app/globals.css`, company-side paper order layout in `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`, portfolio ticket layout in `apps/web/components/portfolio/OrderTicket.tsx`, and internal industry label mapping in `apps/web/lib/industry-i18n.ts`.
- Endpoints / data behavior: no endpoint contract changed. Company detail, K-line, paper-preview, and portfolio ticket still use the existing read/paper endpoints and explicit Taiwan order units (`SHARE` for odd-lot shares, `LOT` for board lots). No broker write, KGI SDK/write-side, migration, Railway env, secret, RSS/news feature, commercial-data feature, or destructive DB path was touched.
- Behavior change: sidebar rows, global panels, panel headers, terminal notes, tables, K-line controls, company info sections, paper-order forms, and final review modals now have wider gutters and clearer line spacing so Chinese labels/buttons do not sit tight against separator lines or borders. Internal slugs such as `building-materials` now render as Traditional Chinese industry labels like `建材` on company detail pages.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check` PASS with only CRLF normalization warnings. Local production Playwright QA at 1365px swept 21 routes on `127.0.0.1:3046`: `/login`, `/register`, `/`, `/themes`, `/companies`, `/companies/1101`, `/companies/duplicates`, `/ideas`, `/runs`, `/plans`, `/ops`, `/signals`, `/market-intel`, `/portfolio`, `/quote?symbol=2330`, `/lab`, `/briefs`, `/drafts`, `/reviews`, `/m`, and `/m/kill`; all returned 200 with 0 horizontal overflow, 0 narrow vertical text stacks, 0 page errors, and 0 visible raw diagnostics. A read-only fake local API was used only for visual QA of `/companies/1101` K-line/company/order panels; it was not committed and did not touch real data.
- Blockers: production authenticated visual smoke remains pending after merge/deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news feature, and no credential storage.

### Codex cycle (2026-05-03 06:40 Taipei) - authenticated border breathing-room verification
- Files changed: tightened the current spacing patch in `apps/web/app/globals.css`, `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`, `apps/web/components/portfolio/OrderTicket.tsx`, and this board. No API contract, payload, database, or broker path changed.
- Endpoints / data behavior: no endpoint contract changed. Local QA used an ephemeral read-only fake API only to render authenticated company and portfolio pages; no real data was written, no credentials were stored, and the fake API was not committed.
- Behavior change: fixed the remaining top metric strip crowding on the trading-room page by widening quote cards and reducing numeric overlap risk. Shared panels now keep at least 10px top breathing room before bordered content, while company-side order controls, K-line controls, source rows, terminal notes, review modals, and trading-room ticket controls retain the wider gutters from the prior pass.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS. Authenticated local production Playwright QA at 1365px on `127.0.0.1:3052` swept `/companies/1101` and `/portfolio` with middleware session cookies set locally: both returned 200, did not redirect to login, and had 0 page errors, 0 console errors, 0 failed requests after ignoring Next aborted prefetches, 0 horizontal overflow, 0 narrow vertical text stacks, 0 detected text-too-close-to-border cases, and 0 visible raw diagnostics (`Failed to fetch`, `ECONNREFUSED`, `Runtime Error`, `PAPER_ORDER_`, `API_BASE`, `WORKSPACE`, `NEXT_PUBLIC_API_BASE_URL`, `undefined`, `null`, `placeholder`, `deprecated`, `broken`). Evidence remains local at `evidence/w7_paper_sprint/local_visual_qa_pass31_border_breathing_authed_rerun_2026-05-03/`.
- Blockers: production authenticated visual smoke remains pending after merge/deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news/commercial-data feature, and no credential storage.

### Codex cycle (2026-05-03 08:33 Taipei) - secondary route and mobile raw-copy cleanup
- Files changed: updated `apps/web/app/ops/page.tsx`, `apps/web/app/briefs/page.tsx`, `apps/web/app/drafts/page.tsx`, `apps/web/app/reviews/page.tsx`, `apps/web/app/m/page.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. Ops, briefs, drafts, reviews, and mobile brief still read their existing production endpoints and remain read-only. This patch only normalizes displayed source copy through existing Traditional Chinese helper vocabulary. No broker write, live submit, KGI SDK/write-side, Railway secret, migration, RSS/news, commercial-data feature, or destructive DB path was touched.
- Behavior change: secondary pages no longer leak raw source phrases such as `Audit Trail Live Check`, `AI Optics (->CPO)`, `Balanced`, `BROKEN`, `DEPRECATED`, `Risk/Reward`, `Hit T1`, or `missing_bars`. Mobile `/m` now localizes brief status, brief headings/bodies, theme labels, and strategy rationale; `/ops` latest rows, `/briefs` sections, `/drafts` rows, and `/reviews` outcomes/lessons use the same operator-facing Chinese cleanup.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `git diff --check -- apps/web/app/ops/page.tsx apps/web/app/briefs/page.tsx apps/web/app/drafts/page.tsx apps/web/app/reviews/page.tsx apps/web/app/m/page.tsx` PASS with only CRLF normalization warnings. Authenticated local production Playwright QA at 1365px on `127.0.0.1:3062` swept `/ops`, `/briefs`, `/drafts`, `/reviews`, and `/m`: all returned 200 with 0 horizontal overflow, 0 clipped elements, 0 narrow vertical text stacks, 0 page errors, 0 console errors, and 0 targeted raw source-language hits. Evidence remains local at `evidence/w7_paper_sprint/local_visual_qa_pass37_secondary_rawcopy_2026-05-03/`.
- Blockers: production authenticated visual smoke remains pending after merge/deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news/commercial-data feature, and no credential storage.

### Codex cycle (2026-05-03 08:09 Taipei) - brief status and confidence label localization
- Files changed: updated `apps/web/app/plans/page.tsx`, `apps/web/app/signals/page.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. The patch only changes operator-facing labels for existing daily-brief and signal rows. No broker write, live submit, KGI SDK/write-side, Railway secret, migration, RSS/news, commercial-data feature, or destructive DB path was touched.
- Behavior change: daily-brief status strings now render as Traditional Chinese (`已核准` / `草稿` / `封存`) instead of raw backend values such as `approved`. Signal confidence values now render as `信心 3` / `信心 4` instead of `C3` / `C4`, and unlinked signal rows show the theme display name instead of a raw slug.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS after the build regenerated `.next/types`; `git diff --check -- apps/web/app/plans/page.tsx apps/web/app/signals/page.tsx` PASS with only CRLF normalization warnings. Authenticated local production Playwright QA at 1365px on `127.0.0.1:3061/plans` and `/signals` returned 200 with 0 horizontal overflow, 0 narrow vertical text stacks, 0 clipped elements, 0 page errors, 0 console errors, no `approved`, no `C1-C5` confidence leakage, and no targeted raw source-language hits. Evidence remains local at `evidence/w7_paper_sprint/local_visual_qa_pass36_status_confidence_2026-05-03/`.
- Blockers: production authenticated visual smoke remains pending after merge/deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news/commercial-data feature, and no credential storage.

### Codex cycle (2026-05-03 07:44 Taipei) - plans page copy and overflow repair
- Files changed: updated `apps/web/app/plans/page.tsx`, `apps/web/lib/operator-copy.ts`, and this board.
- Endpoints / data behavior: no endpoint contract changed. The plans page still reads the existing trade-plan, brief, review, signal, company, theme, and strategy-idea endpoints. This patch only changes display copy and table geometry; no broker write, live submit, KGI SDK/write-side, Railway secret, migration, RSS/news, commercial-data feature, or destructive DB path was touched.
- Behavior change: the trade-plan ledger now uses a wider, wrapping grid so plan text and risk/reward text no longer clip or squeeze against table separators. Risk/reward source strings such as `Risk 8% / Reward 35% = 4.4:1` render as `風險 8% / 報酬 35% / 風報比 4.4:1`. Daily-brief and signal context copy now maps remaining source-language labels such as `Audit Trail Live Check`, `AI Optics (->CPO)`, `Balanced`, `BROKEN`, `DEPRECATED`, `company`, and `market` into Traditional Chinese operator language.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `git diff --check -- apps/web/lib/operator-copy.ts apps/web/app/plans/page.tsx` PASS with only CRLF normalization warnings. Authenticated local production Playwright QA at 1365px on `127.0.0.1:3060/plans` using the production API read-only session returned 200 with 0 horizontal overflow, 0 narrow vertical text stacks, 0 clipped text elements, 0 page errors, 0 console errors, 0 targeted raw source-language hits, and no visible `company` category leakage. Evidence remains local at `evidence/w7_paper_sprint/local_visual_qa_pass35_plans_textcopy_2026-05-03/`.
- Blockers: production authenticated visual smoke remains pending after merge/deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news/commercial-data feature, and no credential storage.

### Codex cycle (2026-05-03 07:10 Taipei) - Traditional Chinese source-copy cleanup
- Files changed: added `apps/web/lib/operator-copy.ts`; updated dashboard `apps/web/app/page.tsx`, `apps/web/app/themes/page.tsx`, `apps/web/app/plans/page.tsx`, `apps/web/app/signals/page.tsx`, and this board.
- Endpoints / data behavior: no endpoint contract changed. This is a display-only cleanup for real rows already returned by the backend: English-heavy theme theses, signal headlines, trade-plan entries, review notes, and dashboard market-intel snippets now either map to Traditional Chinese operator copy or show a truthful "待中文化 / 保留來源紀錄 / 不納入正式判讀" state. No news/RSS/commercial data feature was added.
- Behavior change: known English demo rows such as silicon-wafer supply, TSMC Kumamoto/Arizona, AI CoWoS, AI server demand, EML yield, CPO optics, HBM, `Buy ... on pullback`, and `Hit T1 ... breakeven stop` no longer surface as raw English on the trading room. Theme cards use Taiwan-product Traditional Chinese descriptions instead of source-language snippets when known.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS after build; `git diff --check` PASS with only CRLF normalization warnings. Local 1365px Playwright QA on `127.0.0.1:3055` swept `/`, `/themes`, `/plans`, and `/signals`: all returned 200, with 0 horizontal overflow, 0 narrow vertical text stacks, 0 page errors, 0 console errors, and 0 targeted raw English/source diagnostic hits (`Audit verification theme`, `Co-packaged optics`, `High Bandwidth Memory`, `Silicon wafer supply tightens`, `TSMC Kumamoto`, `AI CoWoS demand`, `AI server demand`, `Buy 3081`, `Hit T1`, `bruce-wave`, `test signal for dryRun`). Next.js aborted RSC prefetches were ignored as non-page failures. Evidence remains local at `evidence/w7_paper_sprint/local_visual_qa_pass32_textcopy_2026-05-03/`.
- Blockers: production authenticated visual smoke remains pending after merge/deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, no deferred RSS/news/commercial-data feature, and no credential storage.
### Codex cycle (2026-05-03 09:53 Taipei) - border breathing-room and ops count clarity
- Files changed: updated shared spacing in `apps/web/app/globals.css`, company-side ticket spacing in `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`, trading-room ticket spacing in `apps/web/components/portfolio/OrderTicket.tsx`, and ops display cleanup in `apps/web/app/ops/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Company detail, K-line, portfolio ticket, and ops still read the same production endpoints. Paper tickets still send explicit Taiwan units (`SHARE` = odd-lot shares, `LOT` = board lots = 1,000 shares). No broker write, KGI SDK/write-side, Railway secret, migration, RSS/news/commercial-data feature, or destructive DB path was touched.
- Behavior change: widened all key panel/header/table gutters so labels, icons, K-line controls, source bars, order controls, review notes, and company info rows do not sit tight against separators or borders. Ops no longer labels raw company master rows as just `公司`; it now says `主檔列數` and explains `原始列數 3,470；去重後公司數以公司板為準`. Ops latest rows also hide `[ORPHAN]`, `TWSE / Observation`, `Primary Desk`, `database`, trailing `/ --`, and `To Fix` source fragments behind Traditional Chinese operator copy.
- Tests: `git diff --check` PASS for the changed files; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS. Authenticated local production Playwright QA at 1365px swept `/companies/1101`, `/portfolio`, `/ops`, `/`, and `/themes`; all returned 200 with 0 horizontal overflow, 0 narrow vertical text stacks, 0 detected text-too-close-to-border cases, 0 page errors, 0 console errors, and 0 targeted raw diagnostic hits. Follow-up `/ops` rerun also verified 0 hits for `[ORPHAN]`, `TWSE / Observation`, `Primary Desk`, `To Fix`, `database`, and trailing `/ --`. Evidence: `evidence/w7_paper_sprint/local_visual_qa_pass43_border_ops_2026-05-03/` and `evidence/w7_paper_sprint/local_visual_qa_pass43_ops_copy_rerun_2026-05-03/`.
- Blockers: production authenticated smoke is pending after merge/deploy. KGI `libCGCrypt.so` remains the live-submit blocker only. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no KGI SDK/write-side, no destructive DB action, and no deferred RSS/news/commercial-data feature.
