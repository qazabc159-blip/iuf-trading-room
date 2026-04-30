# Frontend Real-Data Status Board — 2026-05-01

Owner: Codex
Cadence: Codex update every 30 minutes during overnight run. Elva lane may update every 20 minutes.
Primary goal: make production UI meaningful, sourced, and operational.

## Current State

- Auth cookie/domain: DONE.
- Sidebar logout: DONE.
- API health: PASS after deployment.
- Company 2330 with authenticated cookie: PASS.
- Production no-silent-mock policy: OPEN.
- Market Intel/news lane: OPEN.
- Full mock/placeholder removal: OPEN.

## Path Locks

Codex active ownership:

- `apps/web/app/**`
- `apps/web/components/**`
- `apps/web/lib/**`
- `apps/web/app/globals.css`

Elva/Jason/Jim/Bruce should mark active conflicts here before editing same files.

## Backend Ready

Known usable endpoints:

- `GET /api/v1/session`
- `GET /api/v1/companies`
- `GET /api/v1/companies/:id`
- `GET /api/v1/companies/:id/ohlcv`
- `GET /api/v1/companies/:id/financials`
- `GET /api/v1/companies/:id/chips`
- `GET /api/v1/companies/:id/announcements?days=30`
- `GET /api/v1/briefs`
- `GET /api/v1/reviews`
- `GET /api/v1/content-drafts`
- `GET /api/v1/ops/snapshot`
- `GET /api/v1/ops/trends`
- `GET /api/v1/event-history`
- `GET /api/v1/audit-logs`
- `GET /api/v1/audit-logs/summary`

Needs confirmation from Elva/Jason:

- Paper order preview/submit production contract
- Portfolio positions / fills freshness contract
- Watchlist source of truth
- Strategy idea to order handoff contract
- KGI readonly bidask/tick availability

## No-Fake UI Inventory

Initial high-risk surfaces:

- `/briefs`: currently imports mock brief data.
- `/reviews`: currently imports mock review queue/log.
- `/drafts` and `/admin/content-drafts`: currently import mock drafts/audit.
- `/quote`: currently uses mock bidask/ticks.
- `/companies/[symbol]`: some panels still use `buildCompanyDetailMocks`.
- `DerivativesPanel`: explicit placeholder.
- `TickStreamPanel`: KGI live placeholder.
- `/m/kill`: says no backend in mock.
- `radar-api.ts` and `radar-uncovered.ts`: API failure can fall back to mock.

## Overnight Log

### 2026-05-01 01:15 Taipei

Completed:

- Confirmed operator intent: Codex owns frontend real-data + Market Intel/news lane.
- Created Elva handoff and shared board.
- Defined stop-line: no silent production mock.

Next:

- Convert the inventory into code-level tasks.
- Start with production fetch wrappers and company Market Intel because TWSE announcements endpoint already exists.

Files touched:

- `evidence/w7_paper_sprint/frontend_realdata_elva_handoff_2026-05-01.md`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

## Elva Notes

Elva can append notes here.

## Blockers

- Need active branch/PR awareness from Jim if he is editing company page D1 files.
- Need Jason endpoint readiness for paper E2E and portfolio binding.

