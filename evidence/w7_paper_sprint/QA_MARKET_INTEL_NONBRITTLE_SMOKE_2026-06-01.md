# QA Market Intel Non-Brittle Smoke - 2026-06-01

## Scope

Fix the production Playwright P0 smoke false red on `/market-intel`.

The API gate still verifies:

- `selection_mode` is `ai` or enriched `fallback`
- AI mode must have `ai_call_success=true`
- at least 9 real items
- at least 9 items with `source`, `impact_tier`, and `why_matters`
- strict gate has no `stale_reason`, null `why_matters`, null `impact_tier`, or duplicate ranks

The browser gate no longer requires the iframe/page text to contain the first API ticker, because the production page can render a market-state surface whose primary visible copy does not include that exact ticker even when the backend payload is healthy.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/qa-playwright typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web test` PASS, 246 tests
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS

## Deployment Context

PR #868 web deploy completed successfully in run `26731835607`; this evidence only addresses the main CI P0 smoke false red observed after that merge.
