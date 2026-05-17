# 2026-05-17 Frontend Cycle 18:03 - HeaderDock severity aliases

## Elva / Jason / Bruce sync

- Latest merged state: `origin/main` is at `2eed687` (`fix(web): normalize notification field aliases (#609)`). The HeaderDock notification proxy now covers alert card layout, unread prefetch, envelope parsing, unread query aliases, empty success responses, and snake_case field aliases.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.
- Blocked items / owner: #549 market-data overview backend perf remains with Jason. No frontend blocker found for HeaderDock severity normalization.
- Chosen frontend-safe task this cycle: make HeaderDock notification severity normalization case-insensitive and compatible with common live payload aliases (`danger`, `error`, `warn`, `WARN`, `CRITICAL`) so drawer visual severity does not silently downgrade risk notifications to info.

## Guardrails

- Frontend-only scope under `apps/web`.
- No backend, broker/risk contract, KGI live write, `PAPER_LIVE`, live execution mode, OpenAlice source, or homepage layout changes.
