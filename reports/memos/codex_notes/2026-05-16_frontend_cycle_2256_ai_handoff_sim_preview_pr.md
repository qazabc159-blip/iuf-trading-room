# 2026-05-16 22:56 Frontend Sync - AI Handoff SIM Preview Copy

Owners: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `7f063e6 fix(web): clarify ai detail source label (#574)`.
- Recent merged frontend safety chain: #570 order flow SIM records, #571 sim event status copy, #572 login broker copy SIM-only, #573 radar Lab live-like labels closed, #574 AI detail source label neutralized.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open under Jason/API ownership.

Blocked items and owner:
- Owner-session production QA still requires authenticated owner context and real deployment checks.
- Backend endpoint, broker, risk, and shared-contract changes remain Jason/Bruce-owned.
- No frontend blocker for this cycle.

Chosen frontend-safe task for this cycle:
- Polish `/ai-recommendations -> /portfolio` handoff landing UX in the final-v031 trading room so the prefill box and preview button explicitly say SIM preview.
- During browser smoke, direct `/portfolio?...from_rec=...` also surfaced a Sidebar hydration mismatch and unstable iframe `rev`; both are frontend landing-flow polish, so this cycle will keep the fix bounded to that handoff landing path.
- Scope is limited to `apps/web/lib/final-v031-live.ts`, `apps/web/app/portfolio/page.tsx`, `apps/web/app/final-v031/portfolio/page.tsx`, `apps/web/components/Sidebar.tsx`, evidence, and this sync note. No API routes, broker/risk, shared contracts, Lab code, or homepage layout edits.
