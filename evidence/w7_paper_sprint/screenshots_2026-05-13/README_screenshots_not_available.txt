Screenshots Not Available — 2026-05-13

Reason: Production pages at https://app.eycvector.com are auth-protected.
All unauthenticated requests redirect to /login page (HTTP 307 → 200 login).
Browser screenshots require a valid iuf_session cookie for an Owner-level account.

Automated QA was performed via source code static analysis against origin/main commit 72f5a87.
Full source-level rendering analysis is in TR_BROWSER_QA_2026-05-13.md.

To obtain real screenshots:
1. Login at https://app.eycvector.com with Owner credentials
2. Navigate to /lab (desktop 1440px and mobile 375px)
3. Navigate to /lab/three-strategy/cont_liq_v36
4. Use browser DevTools to take screenshots at each viewport

Pages confirmed render-safe from source analysis:
- /lab — 3 strategy hero cards, Athena status panel, collapsed LabClient
- /lab/three-strategy — 3 strategy cards (cont_liq amber / MAIN blue / rs_20_60 retired gray)
- /lab/three-strategy/cont_liq_v36 — A zone (Forward Obs Period 1) + B zone (historical evidence)
