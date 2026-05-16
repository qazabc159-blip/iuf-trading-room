# CODEX AI Detail Quality Display PR - 2026-05-17

## Scope
- Branch: `fix/web-ai-detail-quality-pr-2026-05-17`
- Base: `origin/main` at `4f13a11` (`fix(web): polish ai handoff prefill copy (#582)`)
- Frontend-owned change only: `apps/web/app/ai-recommendations/[id]/page.tsx`
- No API, broker, risk, contract, or order-path changes.

## Shipped
- Aligned the AI recommendation detail data-quality badges with the list page using Traditional Chinese labels:
  - `報價`, `K線`, `籌碼`, `新聞`, `量化`, `信心折減`
- Converted raw quality states into user-facing Traditional Chinese statuses:
  - `OK -> 正常`, `STALE -> 逾時`, `MISSING -> 缺資料`, `WEAK -> 偏弱`
- Added a concise data-quality summary derived only from existing `rec.dataQuality`.
- Updated the detail data-quality block accessibility label to `資料品質欄位狀態`.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` - pass
- `pnpm.cmd --filter @iuf-trading-room/contracts build` - pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - pass

## Browser Smoke
- Dev server: `http://127.0.0.1:3068`
- Target: `/ai-recommendations/REC-QUALITY`
- Backend handling: local smoke stub served `/api/v1/recommendations/REC-QUALITY` from existing contract-shaped fields; no backend source changed.
- Viewport: `1366x900`
- Assertions:
  - Detail title includes `2330 Smoke Semiconductor`.
  - Data-quality heading is `資料品質`.
  - Data-quality aria label is `資料品質欄位狀態`.
  - Summary includes `報價逾時`, `K線缺資料`, `量化偏弱`, and `信心折減 18%`.
  - Badges include `籌碼正常` and `新聞正常`.
  - Handoff title still includes `SIM 預覽` and `不會建立券商委託`.
  - Browser console errors/warnings: `0`.
  - Page errors: `0`.
  - Failed requests: `0`.
  - HTTP 4xx/5xx responses: `0`.

## Artifact
- Screenshot: `evidence/w7_paper_sprint/ai-detail-quality-1366x900.png`
