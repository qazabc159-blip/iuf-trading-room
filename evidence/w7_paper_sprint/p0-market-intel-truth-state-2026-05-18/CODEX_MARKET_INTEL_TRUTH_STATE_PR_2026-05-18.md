# Codex Market Intel Truth State PR Evidence

Date: 2026-05-18

## Scope

- Page: `/market-intel`
- Files:
  - `apps/web/lib/final-v031-live.ts`
  - `apps/web/public/ui-final-v031/market_intel/index.html`

## Shipped Behavior

- The market intel feed no longer exposes static demo news as visible page content.
- Empty/degraded state now names:
  - `GET /api/v1/market-intel/news-top10`
  - `GET /api/v1/market-intel/announcements?days=30&limit=20&scope=market`
  - owner `Jason / Elva`
  - next action for sourceState / owner-session verification.
- Static header/readiness/drawer defaults no longer claim fake counts, fake freshness, fake score, fake source rows, or fake countdown refresh.
- When real items are returned, each row includes next-step links to company, theme, and AI recommendations.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- `git diff --check` passed, CRLF warning only.
- Local browser smoke against `http://localhost:3112/market-intel`:
  - desktop `1366x900`
  - mobile `390x844`
  - endpoint and owner text visible
  - no visible static demo feed (`N3 / N2`, `GB200`, `台積電 · TSMC` absent)
  - fake next-fetch countdown absent
  - no page errors
  - dummy-session backend calls returned expected 401; owner-session production verification remains Bruce/Elva.

## Evidence Files

- `browser-smoke.json`
- `screens/market-intel-desktop.png`
- `screens/market-intel-mobile.png`

## Pending

- Bruce/Elva owner-session production check must confirm whether `news-top10` returns live AI-selected items with real cookies.
- Jason/Mike own open PR `#705` for backend raw heatmap zh-TW labels; this PR intentionally does not touch that backend lane.
