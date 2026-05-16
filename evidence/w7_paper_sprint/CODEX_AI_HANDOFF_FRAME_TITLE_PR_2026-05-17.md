# AI Handoff Frame Title PR Evidence - 2026-05-17

## Scope
- Frontend-owned `/ai-recommendations -> /portfolio` handoff accessibility/QA polish.
- Updated only the two portfolio route wrappers:
  - `apps/web/app/portfolio/page.tsx`
  - `apps/web/app/final-v031/portfolio/page.tsx`
- No API, broker, risk, shared-contract, KGI, order-path, or tactical homepage changes.

## Shipped
- The outer `FinalOnlyFrame` title now carries a concrete handoff summary when AI recommendation parameters are present.
- The same summary is exposed through both:
  - `main.iuf-final-content-frame[aria-label]`
  - iframe `title`
- Summary fields are derived only from existing URL handoff parameters:
  - ticker or symbol
  - `from_rec`
  - `entry`
  - `stop`
  - `tp`
- Generic handoff routes without summary fields keep the existing title behavior.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Browser Smoke
- Dev server: `http://127.0.0.1:3075`
- Owner-session cookie set for route protection.
- Routes checked:
  - `/portfolio?ticker=2330&prefill=true&from_rec=REC-FRAME-2330&entry=950&stop=920&tp=985`
  - `/final-v031/portfolio?ticker=2330&prefill=true&from_rec=REC-FRAME-2330&entry=950&stop=920&tp=985`
- Iframe document was route-stubbed in Playwright so the test only exercised the frontend wrapper contract and did not call backend/broker services.
- Expected title:
  - `交易室 SIM 預覽 - AI 推薦帶入 / 標的 2330 / 推薦 REC-FRAME-2330 / 進場 950 / 停損 920 / 目標 985`
- Assertions:
  - `/portfolio` main `aria-label` matched expected title.
  - `/portfolio` iframe `title` matched expected title.
  - `/final-v031/portfolio` main `aria-label` matched expected title.
  - `/final-v031/portfolio` iframe `title` matched expected title.
  - Iframe `src` retained `ticker`, `prefill`, `from_rec`, `entry`, `stop`, `tp`, and generated `rev`.
  - Browser console errors: `0`.
  - Unexpected failed requests: `0`.

## Artifact
- Screenshot: `evidence/w7_paper_sprint/ai-handoff-frame-title-1366x900.png`
