# 2026-05-17 13:48 Frontend cycle - AI handoff href safety

- Latest merged state: `origin/main` is `d8032d2 fix(web): disable invalid ai handoff cta (#601)`, following the AI prefill symbol gate and label safety chain.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite`, owned by Jason/API and outside this frontend lane.
- Recent frontend evidence: #601 invalid ticker CTA, #600 AI prefill symbol gate, #599 AI handoff label safety, #598 quant subscription mobile containment, #597 portfolio handoff param safety.
- Blocked items / owners: backend market-data perf remains Jason/API; no frontend blocker for this cycle.
- Chosen frontend-safe task: sanitize AI recommendation handoff href parameters at the source for valid ticker handoffs. Keep valid `/ai-recommendations -> /portfolio` links active, but strip angle brackets and cap `from_rec`, `entry`, `stop`, and `tp` before they reach the outer portfolio wrapper. Scope stays in `apps/web`, consumes existing backend output only, and does not touch broker/risk/contracts, `apps/api`, or homepage layout.
