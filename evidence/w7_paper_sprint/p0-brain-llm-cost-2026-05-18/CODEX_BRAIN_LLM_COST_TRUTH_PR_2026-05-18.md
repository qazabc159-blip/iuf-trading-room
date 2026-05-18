# Codex P0 Evidence — Brain LLM Cost Truth State

## Scope

- Route: `/admin/brain/llm`
- P0 item: Brain LLM 費用總覽真假問題
- Owner lane: frontend Codex, no backend/schema/broker/risk/KGI changes

## Shipped

- Added visible source, calculation method, owner, and next-action panels.
- Labeled `cost_usd`, token-derived cost, and model registry prices as estimates, not provider invoices.
- Added endpoint disclosure for:
  - `/api/v1/admin/llm/usage`
  - `/api/v1/admin/llm/calls?limit=50`
  - `/api/v1/admin/llm/models`
- Added formal blocked/empty states with endpoint, owner, and next action instead of blank panels or stale migration copy.
- Kept all data connected to existing Owner-only backend routes; no mock or fake live data added.

## Production Before

- `prod-brain-llm-before-smoke.json`
- `prod-brain-llm-before.png`

Before checks showed the page opened, but lacked endpoint/source/next-action disclosure and did not clearly label the displayed cost surface as estimate-only.

## Local After

- `local-brain-llm-after-smoke-v3.json`
- `local-brain-llm-after-desktop-v3.png`
- `local-brain-llm-after-mobile-v3.png`

Checks:

- route returned 200
- Brain LLM title visible
- all three admin endpoints visible
- source tables visible: `llm_calls`, `llm_cost_daily`, `llm_models_registry`
- calculation copy visible: `cost_usd`, `ESTIMATE ONLY`, `OpenAI dashboard`, `provider billing API`
- Owner / next-action visible
- no page errors

## Tests

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Playwright desktop smoke: 1366x900
- Playwright mobile smoke: 390x844

## Still Pending

- This page still depends on Owner session for live data. Without Owner credentials it correctly shows a blocked state instead of fake billing totals.
- If Yang wants actual provider bills, backend must integrate a provider billing API; this PR intentionally does not claim actual invoice accuracy.
