# KGI SIM Manual Order Frontend PR — 2026-06-01

## Scope

- Wire the production final-v031 trading room ticket to the KGI SIM manual order endpoint.
- Keep platform Paper submit as a separate button.
- Keep real/live broker orders locked: all KGI submit traffic goes through `/api/v1/kgi/sim/order`, which is owner-only and requires `KGI_ENV=sim`.

## Endpoints

- Paper preflight: `POST /api/v1/paper/preview`
- Paper ledger submit: `POST /api/v1/paper/submit`
- KGI SIM submit: `POST /api/v1/kgi/sim/order`
- Same-origin final-v031 proxy: `POST /api/ui-final-v031/backend?path=/api/v1/kgi/sim/order`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web test`
- Browser smoke against local final-v031 trading room:
  - URL: `http://localhost:3010/api/ui-final-v031/paper-trading-room`
  - Filled ticket price `2355`
  - Confirmed Paper and KGI SIM buttons are both visible and enabled after a valid ticket.
  - Console errors: none.
  - Network failures: none.

## Screenshots

- `evidence/w7_paper_sprint/kgi-sim-final-v031-ticket-20260601.png`
- `evidence/w7_paper_sprint/kgi-sim-final-v031-ticket-ready-20260601.png`
