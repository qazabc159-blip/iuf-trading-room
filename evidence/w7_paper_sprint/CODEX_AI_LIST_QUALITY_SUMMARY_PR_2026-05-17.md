# CODEX AI List Quality Summary PR - 2026-05-17

## Scope

- Branch: `fix/web-ai-list-quality-summary-2026-05-17`
- Frontend-owned surface: `apps/web/app/ai-recommendations/page.tsx`
- Task: polish the `/ai-recommendations` list card data-quality display using existing `dataQuality` fields.
- Out of scope: backend broker/risk/contracts, recommendation scoring, homepage layout, and external source changes.

## Change

- Added a list-page data-quality status label helper:
  - `OK` -> `正常`
  - `STALE` -> `過期`
  - `MISSING` -> `缺資料`
  - `WEAK` -> `偏弱`
- Added an accessible summary/title on each list quality badge group, for example:
  - `資料品質提醒：K線過期、籌碼缺資料、量化偏弱；信心折減 17%`
- Reused the existing `confidencePenalty`; no new score or inferred backend state was created.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke on `http://127.0.0.1:3124/ai-recommendations` with a temporary mock API on `127.0.0.1:3123` passed:
  - visible quality text included `正常`, `過期`, `缺資料`, `偏弱`, and `17%`
  - quality title was `資料品質提醒：K線過期、籌碼缺資料、量化偏弱；信心折減 17%`
  - browser console errors: none
  - failed browser requests: none
- Screenshot: `evidence/w7_paper_sprint/ai-list-quality-summary-1366x900.png`

## Safety

- No paper/live promotion wording added.
- No live execution-mode default added.
- No KGI live broker write path touched.
- No secrets, tokens, database connection URL, KGI password, or restricted external source introduced.
- Did not touch `apps/api`, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.
