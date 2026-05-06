# M-2 Portfolio Local Visual QA Manifest

Generated: 2026-05-06 11:28 Taipei
Branch: `feat/web-wire-paper-portfolio-2026-05-06`
Route: `/portfolio`

## Screenshots

- Desktop 1365px: `desktop1365_final2.png`
- Mobile 390px: `mobile390_final2.png`

## Source / Endpoint

- Frontend route uses `GET /api/v1/paper/portfolio`.
- Local QA used production API base and a dummy local-only session cookie.
- API correctly returned an auth-expired / blocked state in local QA; no paper positions were invented.

## State Semantics

- LIVE: render backend paper portfolio rows.
- EMPTY: render no filled simulated orders / no positions.
- BLOCKED: render the backend/auth error, keep portfolio values safe, and do not invent rows.

## Safety Checks

- No token appears in screenshot, DOM text sample, or evidence.
- No `/order/create` route appears.
- No submit control is rendered on `/portfolio`.
- No KGI or broker write-side action is reachable from this page.
- No FinMind / K-line price is used as fill price or risk source.
- Taiwan stock unit is explicit: `1 張 = 1,000 股`; position quantities are shown as actual shares.

## Browser Results

- Desktop 1365: page rendered, `PAPER / READ ONLY` visible, endpoint label visible, no console errors.
- Mobile 390: page rendered, no horizontal overflow observed in screenshot, `PAPER / READ ONLY` visible, no console errors.
