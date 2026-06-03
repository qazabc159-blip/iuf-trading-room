# Codex Product Readiness Board Sync - 2026-06-03

## Latest State

- `origin/main` is green after the latest CI/deploy run.
- Latest main includes MIS full-universe intraday quote sweep (#935), company K-line readout layout (#929), trading-room K-line viewport tools (#926), and recent trading-room quote/K-line polish.
- No open GitHub PR was found at cycle start.
- Production API `/health` returned 200.
- Protected product data APIs correctly require authenticated session; anonymous checks return 401.

## Coordination Notes

- Do not duplicate Daily Smoke/CI workflow repair work. The workflow is currently green.
- Do not touch F-AUTO/S1 backend, KGI SIM backend, broker/risk/contracts, migrations, or Quant Lab in this lane.
- Trading Room remains the highest-value customer-facing surface, but the latest fixes are fresh; the next code PR must use owner-session browser evidence instead of blind CSS edits.
- Homepage/sidebar still mix customer navigation and OpenAlice/admin operations. This is acceptable for owner rescue mode, but not for paid subscription launch.

## Chosen Task

Create a formal product readiness board for subscription launch:

- route-by-route customer/admin classification;
- paid-product readiness gaps;
- Trading Room flagship acceptance criteria;
- AI decision stack acceptance criteria;
- subscription/entitlement spine;
- Yang decisions required before paid launch.

## Next Frontend Task After Board

`P0-B Trading Room as Flagship Product`

Implement only after owner-session visual verification confirms the current remaining defects:

- layout fit and scrollbar behavior;
- iframe/K-line non-remounting during quote pulse;
- indicator source/freshness presentation;
- order ticket panel polish;
- paper/KGI SIM/KGI read-only boundary clarity.

