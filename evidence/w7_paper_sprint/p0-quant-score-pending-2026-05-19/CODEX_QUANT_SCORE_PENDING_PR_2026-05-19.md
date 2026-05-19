# CODEX QUANT SCORE PENDING PR — 2026-05-19

## Scope

- Route: `/quant-strategies`
- PR lane: PR-F / quant strategies product rescue
- Change type: frontend copy/state honesty only
- Backend changes: none

## Problem

Production scan showed each strategy card rendered `量化分數 / 讀取中`.
The page already says numeric scores will appear only after the formal `quant-strategies` endpoint returns, so the card state was misleading: this is not an active loading spinner, it is a pending backend data contract.

## Fix

- Replaced the hard-coded `讀取中` score with `待正式分數`.
- Added `endpoint 未回傳` as the source-state hint under the metric.
- Added a small unit test so this exact regression does not come back.

## Endpoints

- No new endpoint was connected in this PR.
- Pending backend owner: Jason/Elva for the formal numeric quant score endpoint.
- Existing page data still renders SIM-only strategy metadata and Lab fallback state.

## Browser Evidence

- Local owner-cookie URL: `http://127.0.0.1:3022/quant-strategies?codexVerify=quant-score-pending-local-3`
- Local screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_quant_score_p0_20260519\evidence\w7_paper_sprint\p0-quant-score-pending-2026-05-19\local-quant-score-pending-owner-cookie-v3.png`
- Local result JSON: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_quant_score_p0_20260519\evidence\w7_paper_sprint\p0-quant-score-pending-2026-05-19\local-browser-owner-cookie-result-v3.json`

Result summary:

- HTTP status: 200
- `待正式分數`: 3
- `endpoint 未回傳`: 3
- old metric loading state: 0
- console errors: 0
- document/xhr/fetch network failures: 0

## Tests

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- quant-strategies-page.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Scope Guard

- Did not touch KGI broker write paths.
- Did not promote live trading.
- Did not add mock scores or fake live data.
- Did not redesign the tactical homepage.
