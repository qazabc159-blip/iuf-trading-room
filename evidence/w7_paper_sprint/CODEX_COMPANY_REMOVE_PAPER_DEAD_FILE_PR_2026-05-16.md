# CODEX_COMPANY_REMOVE_PAPER_DEAD_FILE_PR_2026-05-16

## Scope
- Removed `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`.
- Rationale: company pages are information/coverage surfaces. Order entry belongs in the trading room, so a dead company-page order panel should not remain available for accidental resurrection.

## Pre-change audit
- `rg -n "PaperOrderPanel" apps/web -g "*.tsx" -g "*.ts"` returned only the component definition itself.
- No active route or component imported the file on `origin/main`.

## Safety boundary
- No KGI live broker write was added.
- No real-order path was promoted.
- No `PAPER_LIVE` wording was introduced.
- No `apps/api`, broker, risk, contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS` files were edited.

## Verification
- `git diff --check origin/main..HEAD`
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `rg -n "PaperOrderPanel" apps/web -g "*.tsx" -g "*.ts"` after removal returned no matches.

## Browser note
- No browser smoke was run for this deletion because the file was not mounted by any route. The verification here is import graph/static safety plus typecheck.
