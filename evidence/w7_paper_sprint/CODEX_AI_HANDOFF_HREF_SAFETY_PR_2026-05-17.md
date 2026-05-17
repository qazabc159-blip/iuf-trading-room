# CODEX AI handoff href safety PR - 2026-05-17

## Scope

- Frontend-owned fix in `apps/web`.
- Task: sanitize valid AI recommendation handoff href parameters at the source before `/portfolio` receives them.
- Safety: no `apps/api`, broker, risk, contracts, KGI, live-order, or homepage layout changes.

## Change

- Updated `apps/web/lib/ai-recommendation-handoff.ts`.
- Valid tickers still build active `/portfolio?prefill=true` links.
- `from_rec` is now trimmed, angle-bracket stripped, and capped at 96 chars before being written into the href.
- `entry`, `stop`, and `tp` are now trimmed, angle-bracket stripped, and capped at 40 chars before being written into the href.
- Invalid ticker behavior from #601 is unchanged: no active portfolio handoff link is emitted.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke with mock Recommendation Orchestrator + mock paper-room backend:
  - `/ai-recommendations` rendered a valid ticker recommendation whose `recommendationId` and `entryZone.primary` contained angle brackets and overlong text.
  - Active handoff href preserved `ticker=2317`, `prefill=true`, `side=buy`, `stop=111`, and `tp=180`.
  - Active handoff href stripped angle brackets and did not contain raw or encoded `<` / `>`.
  - `from_rec` was capped to 96 chars.
  - `entry` was capped to 40 chars.
  - Navigating the sanitized href to `/portfolio` preserved the cleaned values in the wrapper title, iframe `src`, and embedded SIM preview box.
  - No browser console errors, request failures, or >=400 responses during the smoke.

## Screenshots

- `evidence/w7_paper_sprint/ai-handoff-href-safety-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-handoff-href-safety-portfolio-1366x900.png`

## Notes For Elva / Jason / Bruce

- Elva: valid AI handoffs still work, but source hrefs now match the same bounded display/forwarding rules used by the portfolio wrapper.
- Jason: no backend endpoint change requested; this is defensive handling of existing Recommendation Orchestrator output.
- Bruce: the SIM-only / no real-order boundary is unchanged, and the vendor final-v031 homepage layout was not touched.
