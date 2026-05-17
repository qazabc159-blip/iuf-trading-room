# 2026-05-17 13:16 Frontend cycle - AI invalid ticker CTA

- Latest merged state: `origin/main` is `e2c2caa fix(web): require symbol for ai prefill (#600)`.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite`, owned by Jason/API and outside this frontend lane.
- Recent frontend evidence: #600 AI prefill symbol gate, #599 AI handoff accessible label safety, #598 quant subscription mobile containment, #597 portfolio handoff param safety, #596 AI list data-quality summary.
- Blocked items / owners: backend market-data perf remains Jason/API; no frontend blocker for this cycle.
- Chosen frontend-safe task: finish the source-side half of the AI handoff safety chain. If Recommendation Orchestrator returns an invalid `ticker`, `/ai-recommendations` and `/ai-recommendations/[id]` should show a disabled SIM handoff state instead of an active "one-click" portfolio link that downstream gates must collapse. Scope stays in `apps/web`, consumes existing backend only, and does not touch broker/risk/contracts, `apps/api`, or homepage layout.
