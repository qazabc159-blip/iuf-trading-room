# Codex Evidence - Company Page Layout Truth

## Scope
- Page: `/companies/2330`
- Task: prevent the company right rail from collapsing into unreadable vertical text.
- Files changed:
  - `apps/web/app/companies/[symbol]/CompanyPageStyleBlock.tsx`

## Root Cause
- `CompanyPageStyleBlock` forced the company page into a two-column desktop layout with a 320-360px right rail.
- Global CSS also applied a 901-1500px rule that split `.company-side-column` into two internal columns, one of which required ~310px.
- The right rail therefore exceeded its own 320-360px parent and was clipped, making lower company modules appear as narrow vertical text.

## Fix
- Keep `.company-side-column` as a single readable column on desktop (`min-width: 320px`).
- Stack the whole company layout below 1180px.
- Use two readable side-rail columns only after the layout has stacked, then one column on mobile.
- Preserve existing LIVE/EMPTY/BLOCKED data states and do not inject fake company data.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local browser smoke against `http://127.0.0.1:3123/companies/2330`:
  - desktop 1366x900
  - tablet 1024x900
  - mobile 390x844
- Layout checks passed:
  - route status 200
  - company page content visible
  - AI report panel visible
  - no company cards below 250px width
  - no horizontal overflow
  - no page errors

## Evidence
- `local-companies-2330-desktop.png`
- `local-companies-2330-tablet.png`
- `local-companies-2330-mobile.png`
- `local-company-layout-smoke.json`

## Known Non-Frontend Blocker
- Production KGI `ticks` / `bidask` can return 503 when the gateway/session is unavailable.
- Frontend keeps these as BLOCKED with owner and next action, and does not show fake quote/tick data.
