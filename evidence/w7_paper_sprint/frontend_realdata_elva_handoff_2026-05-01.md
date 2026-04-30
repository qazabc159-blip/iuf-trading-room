# Frontend Real-Data Handoff to Elva — 2026-05-01

Owner: Codex
Audience: Elva / Jason / Jim / Bruce / Pete / Mike / Athena
Operator direction: remove fake UI, wire visible UI to real API / DB / official external sources, add a meaningful market-news lane.

## Executive Decision

Codex now owns the Trading Room frontend real-data conversion:

- Remove or demote mock / placeholder / decorative-only UI from production-facing surfaces.
- Bind visible panels to real API / DB / official external data where endpoints already exist.
- Add a Market Intel / major-news lane using official sources first, especially TWSE OpenAPI material announcements already present in the API.
- Preserve visual direction, but every visible number, button, badge, and panel must have a real source, a real action, or an explicit blocked / empty state.

Elva continues to coordinate the existing backend / paper / risk / release lanes:

- Jason: paper execution state machine, risk gates, audit log, backend endpoints.
- Jim: any in-flight D1 binding PRs already owned by Jim. Codex will avoid overwriting active Jim-owned files unless Elva explicitly hands them off.
- Bruce: verify harness, production smoke, redaction, risk regression.
- Pete: PR desk review.
- Mike: migration 0020 backup / destructive migration audit.
- Athena: Quant Lab strategy publish bundle spec.

## Hard Rule

Production UI must not silently fall back to mock data.

Allowed production states:

1. LIVE: real API / DB / official external source, with source and updatedAt where available.
2. EMPTY: real query succeeded and returned no data, with a clear empty reason.
3. BLOCKED: feature is intentionally unavailable, with blocker and owner.
4. HIDDEN: unfinished feature is not shown.

Disallowed:

- Mock data displayed as if real.
- Buttons that do nothing.
- Disabled controls with no reason.
- Decorative panels that imply live trading or live data.
- API failure converted into fake success.

## Codex-Owned Scope

Primary write scope:

- `apps/web/app/**`
- `apps/web/components/**`
- `apps/web/lib/**`
- `apps/web/app/globals.css`
- frontend evidence under `evidence/w7_paper_sprint/**`

Conditional write scope, only if endpoint adapter is missing and change is small:

- `apps/api/src/server.ts`
- `apps/api/src/data-sources/**`
- API tests directly related to Market Intel / company announcements

Codex will not touch without explicit Elva/operator ACK:

- PR #39 / migration 0020 destructive dedup promotion
- `apps/api/src/broker/**` live submit behavior
- 4-layer risk gate semantics
- `/order/create` live enablement
- KGI SDK / `libCGCrypt.so`
- Railway secrets

## Market Intel First Version

Use official data first:

- Company detail: `/api/v1/companies/:id/announcements?days=30`
- Dashboard / watchlist: aggregate important announcements for selected / core companies
- Daily Brief: show latest published brief records from `/api/v1/briefs`
- Future media/news sources must be labeled separately from official announcements

Suggested panel labels:

- `Market Intel`
- `重大訊息`
- `Official Announcements`
- `Source: TWSE OpenAPI / MOPS`

## Coordination Protocol

Shared board:

- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Codex updates this board every 30 minutes during the overnight run.

Elva can use the board as read/write coordination:

- Add blockers under `Elva Notes`.
- Add backend endpoint readiness under `Backend Ready`.
- Add conflicts under `Path Locks`.

When Codex edits code, each status update must list:

- Files touched
- Endpoint(s) used
- Production behavior changed
- Tests / smoke checks run
- Remaining blockers

## Overnight Priority Order

P0 — Safety:

- Make stale-auth/login usable. Done in commits `20ff693` and `1dd5b44`.
- Do not introduce any secret logging.
- Do not enable live order submit.

P1 — No Fake UI Audit:

- Inventory all mock / placeholder / no-op UI.
- Classify each item: LIVE / EMPTY / BLOCKED / HIDDEN.
- Create a production no-silent-mock rule for frontend fetch wrappers.

P2 — Company Page:

- Ensure 9-panel company page uses real company, OHLCV, financials, revenue/chips where available.
- Replace derivative/tick placeholders with BLOCKED/HIDDEN unless real endpoint exists.
- Wire official announcements into a visible Market Intel card.

P3 — Dashboard:

- Add a Market Intel band using official announcements and latest internal events.
- Keep dashboard metrics tied to API snapshot endpoints, not mock constants.

P4 — Briefs / Reviews / Drafts:

- Replace `mockBrief`, `mockReviewQueue`, `mockDrafts` surfaces with real API results or empty states.

P5 — Quote / Watchlist / Paper UI:

- Remove fake KGI tick/bidask fallback from production surfaces.
- Show BLOCKED if KGI readonly data is missing.
- Keep paper order buttons disabled until backend/risk gates are truly ready.

## Message to Elva

Elva, please keep your existing backend/risk/paper execution plan running. Codex is taking over frontend real-data conversion and Market Intel/news design so Jim/Jason/Bruce do not need to context-switch into broad UI cleanup.

Please route frontend blockers through `frontend_realdata_status_board_2026-05-01.md`. If Jason exposes a new endpoint, write the endpoint shape and sample response there. If Jim has an active PR touching the same frontend file, mark it in `Path Locks` before merge so Codex can rebase or avoid that path.

Stop-lines stay intact:

- No live submit.
- No destructive migration promotion without backup ACK.
- No silent production mock.
- No fake UI success states.

