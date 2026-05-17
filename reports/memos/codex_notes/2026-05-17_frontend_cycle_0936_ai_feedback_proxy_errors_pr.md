# Frontend Sync - 2026-05-17 09:36 TST

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is `dc477ae fix(web): show ai handoff direction (#593)`.
- Recent merged frontend QA/productization chain: AI handoff CTA direction (#593), AI handoff side preservation (#592), sidebar active route (#591), HeaderDock drawer scroll containment (#590), quant detail mobile layout (#589).

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owners:
- Backend/API performance and endpoint ownership remains with Jason via #549.
- No frontend blocker found for this cycle.

Chosen frontend-safe task:
- Harden the `apps/web` same-origin AI recommendation feedback proxy so upstream outages/read failures return stable JSON status instead of an unhandled Next error.
- This supports `/ai-recommendations -> /portfolio` click-through telemetry (`acted`) and feedback buttons without touching backend broker/risk/contracts or changing SIM/order behavior.
