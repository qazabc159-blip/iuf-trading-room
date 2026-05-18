# 2026-05-18 Codex Sync - Portfolio Trading Room P0 QA Start

## Latest merged state

- `origin/main` is at `fc13dfa` (`#708`): TW announcements upstream switched to `t187ap11_L`.
- Recent frontend P0 fixes are already merged: `#704` AI recommendation v3 panel, `#706` market intel truth states, `#702` portfolio snapshot state, `#700` heatmap zh labels.
- API `/health` is 200 at cycle start.

## Open PRs / team progress

- `#707` (`fix/api): unify 半導體 sector name in normalize`) remains open with validate still running; leave ownership with Jason/Elva.
- `#708` is merged and deploy is still being watched by the backend/news lane.

## Blocked items / owner

- Owner-session production validation still belongs to Bruce/Elva because dummy cookies can only prove public shell behavior, not owner-only paper/KGI account data.
- KGI live broker write paths remain off limits for this frontend cycle.

## Chosen frontend-safe task

Codex will run a bounded P0 QA/fix cycle for `/portfolio` trading room:

- Verify the route opens on desktop/mobile.
- Check whether stock search supports arbitrary Taiwan tickers or only fixed choices.
- Check quote/K-line/funds/positions/orders/fills/paper preview/paper submit states for blank panels or fake live claims.
- If the issue is frontend-owned, ship one narrow PR with evidence.
- If the blocker is backend/auth/data, write the endpoint, owner, and next action into the UI/evidence instead of inventing mock data.

## Scope guard

Do not touch `IUF_QUANT_LAB`, `IUF_SHARED_CONTRACTS`, broker/risk/contracts, KGI live broker write paths, real-order promotion, or homepage tactical layout.
