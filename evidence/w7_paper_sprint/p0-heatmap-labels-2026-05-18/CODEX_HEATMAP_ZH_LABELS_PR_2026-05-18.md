# P0 Heatmap Chinese Industry Labels - 2026-05-18

## Scope
- Page: `/` all-market heatmap.
- Problem: P0 audit found backend sector buckets leaking English labels such as `Computer Hardware`, `Banks`, and `Semiconductors` into the product UI.
- Fix: normalize the rendered homepage heatmap industry label through `heatmapIndustryLabel()` before showing the tile text or tooltip.

## Data Truth
- This change does not invent heatmap rows, prices, or percentages.
- It only normalizes the display label for backend-provided industry buckets.
- Unknown ASCII-only sector dumps fall back to `其他產業` instead of leaking raw English into the tactical UI.

## Verification
- `pnpm.cmd install --offline --frozen-lockfile`
- `pnpm.cmd --filter @iuf-trading-room/web test -- heatmap-industry-label`
  - 9 test files passed, 155 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local SSR smoke on `http://localhost:3108/` with a middleware-only dummy session rendered the homepage shell and confirmed the HTML did not contain:
  - `Computer Hardware`
  - `Semiconductors`
  - `Banks`

## Browser Smoke Limitation
- The available temp cookie jar had no usable `iuf_session` entry, so I could not perform an owner-session visual screenshot in this worktree.
- With a dummy local session, production API calls that require a real session can degrade or return empty; I did not treat that as live product evidence.
- Bruce/Elva owner-session production verification should confirm the same label behavior after merge/deploy.

## Files
- `apps/web/lib/heatmap-industry-label.ts`
- `apps/web/lib/heatmap-industry-label.test.ts`
- `apps/web/app/page.tsx`
- `reports/memos/codex_notes/2026-05-18_codex_heatmap_label_start.md`
