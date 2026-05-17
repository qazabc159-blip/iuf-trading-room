# CODEX_AI_SOURCE_MODE_COPY_PR_2026-05-17

Owner: Codex frontend (`apps/web`)
Branch: `fix/web-ai-source-mode-copy-2026-05-17`
Base at cycle start: `origin/main` at `6485287` (`fix(web): format AI recommendation timestamps`)

## Scope

Polish `/ai-recommendations` and `/ai-recommendations/[id]` source mode copy.

Changed:

- Added a shared `formatRecommendationSourceMode` helper for AI recommendation pages.
- List page now displays `推薦引擎`, `備援資料源`, or `同步中` instead of raw `ORCHESTRATOR`, `MOCK FEED`, or `SYNCING`.
- Detail page now displays the same user-facing labels instead of raw `ORCHESTRATOR` or `FALLBACK FEED`.

No backend, broker, risk, contracts, KGI, `IUF_QUANT_LAB`, `IUF_SHARED_CONTRACTS`, or vendor tactical homepage files were touched.

## Verification

Commands:

```powershell
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Browser smoke:

- Started local Next.js web server with a local mock Recommendation API.
- Used local authenticated smoke cookies: `iuf_session=local-smoke-session`, `iuf_auth=1`.
- Verified `/ai-recommendations` with `_mock=false` displays `推薦引擎`.
- Verified `/ai-recommendations/[id]` with `_mock=false` displays `推薦引擎`.
- Verified `/ai-recommendations` with `_mock=true` displays `備援資料源`.
- Verified `/ai-recommendations/[id]` with `_mock=true` displays `備援資料源`.
- Verified raw `ORCHESTRATOR`, `MOCK FEED`, `FALLBACK FEED`, and `SYNCING` do not appear in the rendered body.
- Verified timestamp readability from `#628` remains visible (`05/17`, `22:45`).
- Browser console/page errors: none blocking.

Observed during smoke harness tuning:

- Initial unauthenticated smoke hit `/login`; final smoke uses the same local auth-cookie approach as prior owner/local QA.
- `Intl.DateTimeFormat("zh-TW")` renders a narrow spacing glyph between date and time, so final assertions check date/time components separately.

## Screenshots

- `evidence/w7_paper_sprint/ai-source-mode-list-live-1366x900.png`
- `evidence/w7_paper_sprint/ai-source-mode-detail-fallback-1366x900.png`

## Elva / Jason / Bruce Follow-Up

- Elva: `reports/codex_notes/2026-05-17_elva_to_codex_unblock_and_priorities.md` is still not present on current main; followed merged recommendation acceptance/evidence instead.
- Jason: `#629` OpenAlice Brain Phase A merged during this cycle with security and validate checks green. `#627` EventLog Phase A is closed without merge.
- Bruce: existing AI-to-Portfolio, Quant owner E2E, HeaderDock owner, and HeaderDock drag evidence remain intact. This PR adds a narrow AI recommendation readability smoke.

## Blockers

- True production Owner-session QA still requires a production-authenticated Owner browser context.
  - Owner: Yang / Elva if production-authenticated validation is required.
- Backend Recommendation/Brain/EventLog persistence and endpoint semantics remain backend-owned.
  - Owner: Jason.

## Result

Pass. AI recommendation source mode labels are now user-facing and consistent across list/detail pages and live/fallback data modes.
