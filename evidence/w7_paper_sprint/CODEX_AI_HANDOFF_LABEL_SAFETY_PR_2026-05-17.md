# CODEX AI Handoff Label Safety PR - 2026-05-17

## Scope

- Branch: `fix/web-ai-handoff-label-safety-2026-05-17`
- Frontend-owned surface: `apps/web/app/ai-recommendations/RecommendationHandoffLink.tsx`
- Target routes:
  - `/ai-recommendations`
  - `/ai-recommendations/[id]`
- Task: align AI handoff link `aria-label` / `title` handling with the portfolio wrapper handoff safety added in #597.
- Out of scope: backend broker/risk/contracts, recommendation scoring, portfolio iframe parser, order execution, homepage layout, and vendor source rewrites.

## Change

- Added label-only sanitizers for the handoff link:
  - `ticker` / `symbol`: uppercase whitelist, `A-Z`, digits, `.`, `_`, `-`, max 16 chars.
  - `entry`, `stop`, `tp`: trim, strip angle brackets, cap to 40 chars.
  - `directionLabel`: trim, strip angle brackets, cap to 16 chars.
  - `recommendationId`: trim, strip angle brackets, cap to 96 chars, fallback to `unknown`.
- The link `href` is intentionally unchanged. The portfolio wrapper remains the final handoff gate for iframe title/src and parser limits.
- The visible link children and acted feedback telemetry are unchanged.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke against local Next dev on `127.0.0.1:3152` with a temporary mock API on `127.0.0.1:3151` passed:
  - local authenticated smoke cookie set only for middleware routing.
  - list route and detail route both rendered a malicious recommendation handoff.
  - `title` and `aria-label` matched and were non-empty.
  - label contained no `<` / `>`.
  - label contained no `script` text from the invalid ticker.
  - label capped the overlong recommendation id; no `X{100,}` run remained.
  - label length stayed `190`.
  - `href` still contained the encoded raw ticker (`23%3Cscript%3E`) so navigation behavior did not change.
  - browser console errors: none.
  - failed requests / HTTP 4xx-5xx responses: none.

## Screenshots

- `evidence/w7_paper_sprint/ai-handoff-label-safety-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-handoff-label-safety-detail-1366x900.png`

## Safety

- No paper/live promotion wording added.
- No live execution-mode default added.
- No KGI live broker write path touched.
- No secrets, tokens, database URL, KGI password, or identity material added.
- No OpenAlice source import or fork.
- Did not touch `apps/api`, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.
