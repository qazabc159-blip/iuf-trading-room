# Frontend Real-Data Overnight Schedule — 2026-05-01

Owner: Codex
Coordination partner: Elva
Operator mode: autonomous overnight, 30-minute Codex heartbeat.

## Working Cadence

- Codex heartbeat: every 30 minutes.
- Elva lane heartbeat: every 20 minutes.
- Shared state: `frontend_realdata_status_board_2026-05-01.md`.
- Each Codex cycle should either ship a small safe patch or update the board with a concrete blocker.

## Timeboxes

### 01:00-01:30 — Coordination / Audit

- Publish Elva handoff.
- Create shared board.
- Inventory mock / placeholder / no-op UI.

### 01:30-02:30 — Production No-Mock Foundation

- Identify frontend fetch wrappers that silently fallback to mock.
- Add or plan production-safe behavior:
  - dev can use mock fallback;
  - production must show error / empty / blocked state.
- Avoid broad rewrites.

### 02:30-03:30 — Company Page Market Intel

- Use existing `GET /api/v1/companies/:id/announcements?days=30`.
- Make the company page show real official announcements.
- Replace placeholder wording with source-aware empty / blocked states.

### 03:30-04:30 — Dashboard Market Intel

- Add a dashboard band for recent official announcements / latest internal events.
- Use real endpoints only.
- No external news scraping in first pass.

### 04:30-05:30 — Briefs / Reviews / Drafts

- Replace mock imports where matching API endpoints already exist.
- If endpoint shape mismatch exists, show real empty/error state and document backend ask.

### 05:30-06:30 — Quote / Watchlist / Paper Surface Truthfulness

- Remove fake tick/bidask presentation from production.
- Mark KGI readonly data as BLOCKED when unavailable.
- Ensure paper order buttons remain disabled until backend/risk state is real.

### 06:30-07:00 — Smoke / Handoff

- Run typecheck/build where changed.
- Production smoke key routes.
- Final overnight handoff for Elva/Bruce.

## Acceptance Criteria

- No new mock data on production surfaces.
- Any remaining mock is either dev-only or visibly labeled BLOCKED/HIDDEN.
- Each shipped panel has a real endpoint or a documented backend blocker.
- `/companies/2330` remains authenticated and data-backed.
- No live order submit enabled.

