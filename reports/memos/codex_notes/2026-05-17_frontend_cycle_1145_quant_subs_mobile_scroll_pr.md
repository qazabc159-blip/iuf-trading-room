# 2026-05-17 11:45 Frontend cycle - Quant subscriptions mobile scroll

- Latest merged state: `origin/main` is `fa8a61a fix(web): sanitize portfolio handoff params (#597)`.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite`, owned by Jason/API and outside this frontend lane.
- Recent frontend evidence: #597 portfolio handoff param safety, #596 AI list data-quality summary, #595 AI handoff activation telemetry, #594 feedback proxy hardening, #590-#593 owner-session IA and AI handoff fixes, #588-#589 quant readiness/mobile fixes.
- Blocked items / owners: backend market-data perf remains Jason/API; no frontend blocker for this cycle.
- Chosen frontend-safe task: contain the `/quant-strategies?tab=subscriptions` SIM-only subscription table on mobile with an internal keyboard-focusable horizontal scroller. This is a bounded visual/accessibility QA follow-up for quant readiness and does not touch backend broker/risk/contracts or the homepage.
