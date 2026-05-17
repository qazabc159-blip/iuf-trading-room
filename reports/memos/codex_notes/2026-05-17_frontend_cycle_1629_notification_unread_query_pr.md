# 2026-05-17 Frontend Cycle 16:29 - HeaderDock unread query compatibility

## Elva / Jason / Bruce sync

- Latest merged state: `origin/main` is at `fde6a59` (`fix(web): accept notification envelope payloads`). Recent frontend PRs #603-#606 shipped quant candidate containment, HeaderDock alert layout preservation, unread prefetch, and notification envelope parsing.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.
- Blocked items / owner: market-data overview backend perf remains with Jason via #549. No frontend blocker found for HeaderDock notification proxy follow-up.
- Chosen frontend-safe task this cycle: harden the HeaderDock same-origin notification proxy so unread-only requests are compatible with both `unread_only` and `unread` query names. This keeps the frontend ready for the existing alerts API convention without touching `apps/api`.

## Guardrails

- Frontend-only scope under `apps/web`.
- No broker/risk contract changes, no KGI live write path, no `PAPER_LIVE`, no default live execution mode.
- Preserve tactical ASCII/CRT/amber shell and the trading-room homepage layout.
