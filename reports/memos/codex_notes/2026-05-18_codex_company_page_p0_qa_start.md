# 2026-05-18 Codex Sync - Company Page P0 QA Start

## Latest merged state

- `origin/main` is at `f03499f` (`#709`): `/portfolio` trading room blocked states no longer show fake paper data.
- `#707` and `#708` are merged and deployed.
- API health is 200 at cycle start.
- Open PR list is empty.

## Blocked items / owner

- Owner-session checks still require Bruce/Elva cookies.
- Backend data gaps must be labelled in UI; this frontend cycle will not invent company ticks, warrants, options, or analyst content.

## Chosen frontend-safe task

Codex will QA `/companies/2330` and fix the narrowest frontend-owned P0 issue:

- no blank panels
- no fake live data
- AI analyst report must show usable content or formal degraded state
- quote/ticks/bid-ask/ohlcv/warrant/options panels must show LIVE or explicit source/owner/next action
- mobile layout must not overlap

## Scope guard

Do not touch `IUF_QUANT_LAB`, `IUF_SHARED_CONTRACTS`, broker/risk/contracts, KGI live broker write paths, real-order promotion, or homepage tactical layout.
