# 2026-05-17 12:16 Frontend cycle - AI handoff label safety

- Latest merged state: `origin/main` is `45ed641 fix(web): contain quant subscriptions table (#598)`.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite`, owned by Jason/API and outside this frontend lane.
- Recent frontend evidence: #598 quant subscription mobile containment, #597 portfolio handoff param safety, #596 AI list data-quality summary, #595 AI handoff activation telemetry, #594 feedback proxy hardening, #592-#593 AI handoff side/direction.
- Blocked items / owners: backend market-data perf remains Jason/API; no frontend blocker for this cycle.
- Chosen frontend-safe task: harden the AI recommendation handoff link `aria-label` / `title` so unusual ticker, price, target, or recommendation id values are stripped/capped before display. This keeps the `/ai-recommendations -> /portfolio` handoff accessible label aligned with the portfolio wrapper safety added in #597 without changing hrefs, backend contracts, broker/risk code, or homepage layout.
