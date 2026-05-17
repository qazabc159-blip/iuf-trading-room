# Codex Evidence - Full Profile Empty Summary

Date: 2026-05-18
Branch: fix/web-full-profile-empty-summary-2026-05-18
Scope: company detail full-profile `[06]-[11]` empty-state density

## Shipped

- Added a compact `完整資料區狀態總覽` for the company detail full-profile area.
- When `[06]-[10]` are all non-live and non-stale, the page now shows one summary panel instead of five large empty panels.
- `[11] 重大訊息` remains visible separately because it is fetched independently and may still contain live announcements.
- The summary keeps honest source/status wording: `無可用列`, source name, update time, and the explicit note that no fake data is filled.
- When any `[06]-[10]` section has live/stale data, the existing detailed cards still render as before.

## Safety

- Frontend-only change under `apps/web/app/companies/[symbol]/FullProfilePanels.tsx`.
- No API implementation, heatmap universe, data source selection, broker/risk/contracts, live-order path, execution-mode default, secrets, or vendor tactical homepage changes.
- Browser smoke used a local mock API only.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke with local mock API and owner-session cookie:
  - `/companies/2330` desktop 1366x900 rendered successfully.
  - `/companies/2330#company-full-profile` mobile 390x844 rendered successfully.
  - Required visible content found: `台積電`, `完整資料區狀態總覽`, `無可用列`, `本區收合為摘要`, `不補假資料`, `FinMind 資料源 / 全空摘要`, `來源：FinMind`, `重大訊息`.
  - `.full-profile-grid > .panel` count is 2 on desktop.
  - `.full-profile-grid > .panel` count is 2 on mobile.
  - Page errors, failed requests, and >=400 responses: none.

## Screenshots

- `evidence/w7_paper_sprint/full-profile-empty-summary-1366x900.png`
- `evidence/w7_paper_sprint/full-profile-empty-summary-mobile-390x844.png`

## Known External Blocker

- Deploy to Railway remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
