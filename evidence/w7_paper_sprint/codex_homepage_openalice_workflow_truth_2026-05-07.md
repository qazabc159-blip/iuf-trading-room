# Codex Homepage OpenAlice Workflow Truth Repair

Time: 2026-05-07 TPE
Branch: `investigate-homepage-workflow-truth-2026-05-07`
Trade Capability Score: `+1`

## Why

The dashboard homepage was still too close to an engineering status wall. It showed OpenAlice runner / dispatcher / queue state, but did not expose whether the autonomous daily brief workflow had actually produced useful source-traced content for the operator.

## Files

- `apps/web/app/page.tsx`
- `apps/web/app/globals.css`

## Behavior

- Homepage OpenAlice panel now carries the latest published daily brief object, not only counts.
- If today's published brief exists, homepage shows it as the current formal brief.
- If today's brief is missing but an older published brief exists, homepage labels it as stale instead of pretending it is today's output.
- Homepage shows the first two published brief sections with Traditional Chinese cleanup and unsafe-advice masking.
- If no formal brief section exists, homepage explains that the operator should inspect the draft queue / reviewer state.
- Added a contained homepage brief preview layout to avoid horizontal white scrollbars and text overflow in the command cockpit.

## Sources / Endpoints

- `GET /api/v1/briefs`
- `GET /api/v1/content-drafts?status=awaiting_review`
- `GET /api/v1/ops/snapshot`

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check -- apps/web/app/page.tsx apps/web/app/globals.css` PASS (CRLF warnings only)
- Stop-line grep: no `/order/create`, no token key, no KGI write-side. Advice words only appear in the mask list.

## Stop-Lines

No token display, no fake-live brief, no fake strategy metric, no order route, no KGI write-side, no use of FinMind/K-line as fill price.
