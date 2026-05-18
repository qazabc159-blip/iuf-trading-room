# 2026-05-19 Codex P0 Portfolio Paper Submit Truth Start

## Latest merged state
- `origin/main` is at `328731b` (`#718 fix(web): keep company right rail readable`) with recent P0 truth-state fixes for AI recommendations, EventLog, ToolCenter, Brain LLM cost, Strategy Lanes, and company layout.
- Open PRs: none at cycle start.
- Latest deploy checks for #718 are green.

## Production QA finding
- `/portfolio?symbol=2603` loads the final v031 trading room iframe and is not blank.
- Stock search works for at least `2454` and `2603`; price, K-line, and paper preview update.
- P0 defect found: clicking the visible Paper submit button triggers both:
  - `POST /api/v1/kgi/sim/order` (returned 409)
  - `POST /api/v1/paper/submit` (returned 422)
- This violates the product rule: Paper Submit must only write the platform paper ledger; KGI SIM must be a separate, explicit lane. Real order remains locked.

## Blockers / owners
- KGI quote bid/ask and ticks still return 503/422 in production for some symbols/off-hours. UI degrades, but browser console shows resource errors. Owner: Jason/Bruce backend gateway/session lane.
- This cycle will not touch broker/risk/contracts or KGI live write paths.

## Chosen frontend-safe task
Fix the portfolio trading room Paper submit action so the visible Paper button does not invoke `/api/v1/kgi/sim/order`. Keep KGI SIM blocked/separate and keep real-order lock copy intact.

## Verification target
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke on local/prod: Paper button posts to `/api/v1/paper/preview` and/or `/api/v1/paper/submit`, but never `/api/v1/kgi/sim/order`.
