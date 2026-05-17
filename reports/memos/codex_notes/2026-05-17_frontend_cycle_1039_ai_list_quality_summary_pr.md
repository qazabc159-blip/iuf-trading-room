# 2026-05-17 10:39 Frontend cycle - AI list data quality summary

- Latest merged state: `origin/main` is `b4fc67b fix(web): track ai handoff activations (#595)`.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite`, owned by Jason/API and outside this frontend lane.
- Recent frontend evidence: #595 AI handoff activation telemetry, #594 AI feedback proxy hardening, #593/#592 AI portfolio handoff side/direction, #591 sidebar active route, #590 HeaderDock drawer scroll, #589/#588 quant detail/subscription readiness.
- Blocked items / owners: backend market-data perf remains Jason/API; no frontend blocker for this cycle.
- Chosen frontend-safe task: polish the `/ai-recommendations` list card data-quality display so list badges use the same human-readable quality labels and summary/tooltip as the detail view. This consumes existing `dataQuality` fields only, does not create fake scores, and does not touch broker/risk/contracts or homepage layout.
