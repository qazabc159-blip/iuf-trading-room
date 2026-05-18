# CODEX Portfolio KGI Quote Degraded Proxy PR — 2026-05-18

## Scope
Normalize known `/portfolio` final-v031 KGI read-only quote degraded responses.

## Production bug found before fix
Production owner-session QA after #719 showed `/portfolio?symbol=2603` was usable, but browser console still logged resource errors because the final-v031 same-origin proxy forwarded KGI quote `422` responses directly:

- `/api/v1/kgi/quote/bidask?symbol=2603`
- `/api/v1/kgi/quote/ticks?symbol=2603&limit=16`

The UI already showed the correct non-trading-hours quote/tape degraded copy, so the browser-level 422 noise was misleading product QA.

## Shipped in this PR
- Targeted only `GET /api/v1/kgi/quote/bidask` and `GET /api/v1/kgi/quote/ticks` inside `apps/web/app/api/ui-final-v031/backend/route.ts`.
- If upstream returns non-OK for these read-only quote endpoints, return HTTP 200 with `data:null`, `degraded:true`, `source:kgi_quote_read_only`, and `upstreamStatus`.
- All other proxy allowlist paths keep their original status/body behavior.
- No raw upstream body is exposed to the browser.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build` — PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- Local browser smoke on `http://127.0.0.1:3126/portfolio?symbol=2603` with owner cookie and prod API base:
  - KGI quote bidask/ticks proxy responses: 200/200.
  - `quoteErrorResponseCount=0`.
  - `consoleErrorCount=0`.
  - pageErrors=0.
  - UI still shows 2603 and non-trading-hours quote/tape copy.

## Evidence
- `evidence/w7_paper_sprint/p0-portfolio-kgi-quote-degraded-proxy-2026-05-18/local-portfolio-kgi-quote-degraded-2603.json`
- `evidence/w7_paper_sprint/p0-portfolio-kgi-quote-degraded-proxy-2026-05-18/local-portfolio-kgi-quote-degraded-2603.png`

## Remaining blockers / owners
- Upstream KGI quote support/availability for unsupported symbols or off-hours remains Jason/Bruce backend gateway/session owner. This PR only prevents known degraded read-only quote failures from appearing as product-breaking browser errors.
