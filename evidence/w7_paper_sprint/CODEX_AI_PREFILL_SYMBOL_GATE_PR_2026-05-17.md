# CODEX AI Prefill Symbol Gate PR - 2026-05-17

## Scope

- Branch: `fix/web-ai-prefill-symbol-gate-2026-05-17`
- Frontend-owned surfaces:
  - `apps/web/lib/portfolio-handoff.ts`
  - `apps/web/app/portfolio/page.tsx`
  - `apps/web/app/final-v031/portfolio/page.tsx`
  - `apps/web/app/api/ui-final-v031/[screen]/route.ts`
  - `apps/web/lib/final-v031-live.ts`
- Task: prevent AI recommendation handoff metadata from activating paper-room prefill when the handoff has no valid `ticker` / `symbol`.
- Out of scope: backend broker/risk/contracts, order execution, recommendation scoring, homepage layout, and vendor source rewrites.

## Change

- Moved duplicated portfolio wrapper handoff title/src logic into `apps/web/lib/portfolio-handoff.ts` so `/portfolio` and `/final-v031/portfolio` share the same sanitizer.
- Added an AI-specific gate: when `from_rec` is present but both `ticker` and `symbol` are invalid or absent, the wrapper drops AI-dependent params (`prefill`, `from_rec`, `entry`, `stop`, `tp`, `side`) before building the iframe `src` and title.
- Reused the same parser for `/api/ui-final-v031/paper-trading-room`, so direct iframe hits also ignore invalid AI handoff metadata instead of hydrating a fallback-symbol prefill.
- Updated the embedded final-v031 client fallback parser with the same invalid-AI guard.
- Homepage, strategy, and run handoffs remain intact when they use their own `from_home`, `from_strategy`, or `from_run` params.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed for the fresh worktree.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- `git diff --check` passed with only expected Windows LF-to-CRLF warnings.
- Browser smoke on `http://127.0.0.1:3162` with mock API on `127.0.0.1:3161` passed:
  - `/portfolio?prefill=true&from_rec=REC-X&ticker=23<script>&entry=123&stop=111&tp=180&side=buy`
    - iframe `src` collapsed to `/api/ui-final-v031/paper-trading-room?rev=portfolio`.
    - wrapper `title` / `aria-label` stayed `交易室 SIM 預覽`.
    - no `#rec-prefill-box` rendered.
  - `/portfolio?prefill=true&from_rec=REC-GOOD&ticker=2317&entry=123&stop=111&tp=180&side=buy`
    - iframe kept sanitized AI handoff params.
    - `#rec-prefill-box` rendered with `2317`, `REC-GOOD`, and `方向 買進`.
    - limit price input seeded `123.00`; buy side stayed active.
  - `/final-v031/portfolio` invalid AI handoff also collapsed to `rev=portfolio` and rendered no prefill box.
  - browser console errors: none.
  - browser HTTP 4xx/5xx responses: none.
  - request failures after filtering normal navigation `net::ERR_ABORTED`: none.
- Direct iframe route check passed:
  - invalid AI URL returned 200 with `"prefill":null` and no `REC-X` in live payload.
  - valid AI URL returned 200 with `REC-GOOD` and `2317` in live payload.

## Screenshots

- `evidence/w7_paper_sprint/ai-prefill-symbol-gate-invalid-1366x900.png`
- `evidence/w7_paper_sprint/ai-prefill-symbol-gate-valid-1366x900.png`

## Safety

- No paper/live promotion wording added.
- No live execution-mode default added.
- No KGI live broker write path touched.
- No secrets, tokens, database URL, KGI password, or identity material added.
- No OpenAlice source import or fork.
- Did not touch `apps/api`, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.
