# 2026-05-17 11:12 Frontend cycle - Portfolio handoff param safety

- Latest merged state: `origin/main` is `bead25b fix(web): clarify ai list quality states (#596)`.
- Open PRs: #549 `fix(api): market-data/overview perf - switch to listCompaniesLite`, owned by Jason/API and outside this frontend lane.
- Recent frontend evidence: #596 AI list data-quality summary, #595 AI handoff activation telemetry, #594 feedback proxy hardening, #593/#592 AI handoff direction/side, #591 sidebar active route, #590 HeaderDock drawer scroll.
- Blocked items / owners: backend market-data perf remains Jason/API; no frontend blocker for this cycle.
- Chosen frontend-safe task: align `/portfolio` and `/final-v031/portfolio` outer handoff query handling with the existing paper-room parser limits. The goal is to sanitize and cap handoff params before they are used in iframe title/ARIA/src, keeping AI recommendation-to-portfolio handoff robust without touching backend broker/risk/contracts.
