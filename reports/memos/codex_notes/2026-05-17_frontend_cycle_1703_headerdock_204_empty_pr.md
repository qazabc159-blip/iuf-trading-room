# 2026-05-17 Frontend Cycle 17:03 - HeaderDock 204 empty notifications

## Elva / Jason / Bruce sync

- Latest merged state: `origin/main` is at `323cb3e` (`fix(web): align notification unread query aliases (#607)`). The recent HeaderDock chain now covers alert card layout, unread prefetch, envelope parsing, and unread query alias compatibility.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.
- Blocked items / owner: #549 market-data overview backend perf remains with Jason. No frontend blocker found for HeaderDock notification empty-state follow-up.
- Chosen frontend-safe task this cycle: normalize upstream `204 No Content` or empty-body success from `GET /api/v1/notifications` into the HeaderDock same-origin empty payload instead of surfacing a fetch-error empty state.

## Guardrails

- Frontend-only scope under `apps/web`.
- No backend, broker/risk contract, KGI live write, `PAPER_LIVE`, live execution mode, OpenAlice source, or homepage layout changes.
