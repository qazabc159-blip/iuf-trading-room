# 2026-05-17 Frontend Cycle 17:33 - HeaderDock snake_case notification fields

## Elva / Jason / Bruce sync

- Latest merged state: `origin/main` is at `f3dffad` (`fix(web): normalize empty notification responses (#608)`). The HeaderDock chain now covers alert card layout, unread prefetch, envelope parsing, unread query aliases, and successful empty upstream responses.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.
- Blocked items / owner: #549 market-data overview backend perf remains with Jason. No frontend blocker found for HeaderDock notification payload normalization.
- Chosen frontend-safe task this cycle: make the HeaderDock same-origin notifications proxy normalize common snake_case live payload fields (`read_at`, `created_at`, `occurred_at`, `action_url`) so read-state, timestamps, and href handoff stay correct across backend variants.

## Guardrails

- Frontend-only scope under `apps/web`.
- No backend, broker/risk contract, KGI live write, `PAPER_LIVE`, live execution mode, OpenAlice source, or homepage layout changes.
