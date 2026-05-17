# CODEX Portfolio Handoff Param Safety PR - 2026-05-17

## Scope

- Branch: `fix/web-portfolio-handoff-param-safety-2026-05-17`
- Frontend-owned surfaces:
  - `apps/web/app/portfolio/page.tsx`
  - `apps/web/app/final-v031/portfolio/page.tsx`
- Task: align outer portfolio handoff title/src handling with the existing `paper-trading-room` parser limits.
- Out of scope: backend broker/risk/contracts, order execution, homepage layout, and vendor source rewrites.

## Change

- Added shared local handoff guards in both portfolio wrappers:
  - `ticker` / `symbol`: uppercase whitelist, `A-Z`, digits, `.`, `_`, `-`, max 16 chars.
  - `prefill`: only forwards `true`.
  - `side`: only forwards `buy` or `sell`.
  - `from_rec`, `from_strategy`, `from_home`, `from_run`, `entry`, `stop`, `tp`: trim, strip angle brackets, cap to the existing parser limits.
- The iframe `title`, outer `aria-label`, forwarded iframe `src`, and `rev` token now use sanitized values consistently.
- Invalid handoff values are dropped instead of being shown in the title or forwarded to the embedded paper room.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- First `pnpm.cmd --filter @iuf-trading-room/web typecheck` failed because the fresh worktree had not built `@iuf-trading-room/contracts`; no code-specific error.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- Final `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke on `http://127.0.0.1:3134` with a temporary backend on `127.0.0.1:3001` passed:
  - `/portfolio` rejected invalid `ticker=23<script>` and invalid `side=hacker`.
  - `/portfolio` fell back to valid `symbol=2317`.
  - `from_rec` was stripped of angle brackets and capped to 96 chars.
  - `entry` was stripped of angle brackets and capped to 40 chars.
  - embedded `#rec-prefill-box` showed sanitized AI handoff metadata only.
  - `/final-v031/portfolio` preserved valid `ticker=0050`, `side=sell`, and stripped `from_strategy=<home_strategy>` to `home_strategy`.
  - browser console errors: none.
  - failed browser requests: none.
- Screenshot: `evidence/w7_paper_sprint/portfolio-handoff-param-safety-1366x900.png`

## Safety

- No paper/live promotion wording added.
- No live execution-mode default added.
- No KGI live broker write path touched.
- No secrets, tokens, database connection URL, KGI password, or restricted external source introduced.
- Did not touch `apps/api`, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.
