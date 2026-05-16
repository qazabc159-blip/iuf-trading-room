# CODEX_RUN_DETAIL_TRADING_ROOM_COPY_PR_2026-05-16

## Scope
- Branch: `fix/web-run-detail-trading-room-copy-2026-05-16`
- Page: `apps/web/app/runs/[id]/page.tsx`
- Purpose: align strategy run detail with the current product boundary: company pages are research/info; simulated preview, risk checks, and order workflow belong in `交易室`.

## Change
- Changed stale `紙上預覽` run-detail CTA to `帶到交易室`.
- Changed CTA target from `/companies/:symbol#paper-order` to `/portfolio?ticker=:symbol&prefill=true&from_run=true`.
- Updated page note and promotion-blocked copy so it no longer tells users to use company pages for paper preview.
- Left company research links as `/companies/:symbol`.

## Verification
- `git diff --check origin/main..HEAD` PASS
- `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- Python Playwright browser smoke PASS:
  - fake strategy run backend on `http://127.0.0.1:3062`
  - local web on `http://127.0.0.1:3063`
  - `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3062`
  - added local-only `iuf_session=codex-local-smoke` cookie to pass middleware routing without real credentials
  - opened `/runs/smoke-run`
  - verified candidate card renders
  - verified handoff link exists: `/portfolio?ticker=2330&prefill=true&from_run=true`
  - verified stale link count is zero: `/companies/2330#paper-order`
  - verified `交易室` boundary copy is visible
  - screenshot: `evidence/w7_paper_sprint/CODEX_RUN_DETAIL_TRADING_ROOM_COPY_PR_2026-05-16.png`

## Safety
- Frontend-only page copy/link target.
- No `apps/api` broker/risk/contracts edits.
- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` or default live execution mode.
