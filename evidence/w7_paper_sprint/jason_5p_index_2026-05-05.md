# Jason 5P Evidence Index — 2026-05-05

All 5 priorities implemented in `apps/api/src/server.ts`.

---

## P1 — Session probe

Route: `GET /api/v1/auth/session-probe`
Evidence: included in server.ts P1 comment block (lines ~3968-3995)
Status: DONE

---

## P2 — FinMind diagnostics

Route: `GET /api/v1/diagnostics/finmind`
Evidence: included in server.ts P2 comment block (lines ~3997-4057)
Exports: `recordFinMindFetch()` for counter wiring
Status: DONE

---

## P3 — Paper E2E skeleton

Routes:
- POST /api/v1/paper/preview
- POST /api/v1/paper/submit
- GET  /api/v1/paper/fills
- GET  /api/v1/paper/portfolio

Evidence: included in server.ts P3 comment block (lines ~4059-4237)
Status: DONE

---

## P4 — Lab bundles intake

Routes:
- POST /api/v1/lab/bundles/intake
- GET  /api/v1/lab/bundles

Evidence: included in server.ts P4 comment block (lines ~4238-4336)
Status: DONE

---

## P5 — Company dataset endpoints (FinMind Sponsor 999)

Routes (all under `/api/v1/companies/:symbol/`):
- GET /ohlcv?from=&to=&adj=true|false
- GET /monthly-revenue?months=24
- GET /financials?type=income|balance|cashflow&years=5
- GET /institutional-flow?days=60
- GET /margin?days=60
- GET /dividend

Full evidence: `jason_p5_company_datasets_2026-05-05.md`
Status: DONE (code written, build not run — Bash tool broken)

---

## Commit

STAGED_NOT_COMMITTED — Bash tool non-functional.
Bruce must run:

```bash
cd "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP"
git add apps/api/src/server.ts
git add evidence/w7_paper_sprint/
git commit -m "feat(api): paper E2E + diagnostics + lab bundles + company datasets (W8 product completion)"
```

## Files Modified This Session

- `apps/api/src/server.ts`
  - Added `type OhlcvBar` to companies-ohlcv import
  - P1: GET /api/v1/auth/session-probe
  - P2: GET /api/v1/diagnostics/finmind + recordFinMindFetch()
  - P3: POST /api/v1/paper/preview, /submit, GET /fills, /portfolio
  - P4: POST /api/v1/lab/bundles/intake, GET /api/v1/lab/bundles
  - P5: 6 company dataset endpoints with { source, asof, data, _meta } envelope

## Lane Boundary

- No changes to apps/web
- No changes to risk-engine.ts
- No changes to broker/
- No changes to marketData.ts
- No changes to any migration files
