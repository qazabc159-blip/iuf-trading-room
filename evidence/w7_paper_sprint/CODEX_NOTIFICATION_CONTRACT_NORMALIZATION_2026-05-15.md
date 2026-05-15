# CODEX Notification Contract Normalization - 2026-05-15

Owner: Frontend Codex
Branch: `fix/web-notification-contract-normalization-2026-05-15`
Scope: `apps/web`

## Why

PR #520 changed `/api/v1/notifications` from an empty stub to real event synthesis. The backend response shape is clean, but it uses backend field names:

- `body`
- `timestamp`
- `actionUrl`
- `read`
- severity `warn`

HeaderDock consumes frontend field names:

- `message`
- `createdAt`
- `href`
- `readAt`
- severity `warning`

Without normalization, real events can render with fallback copy, missing timestamps, wrong warning color, or links to non-existing frontend routes like `/paper` and `/risk`.

## Change

- Normalize notification payloads in `apps/web/app/api/header-dock/notifications/route.ts`.
- Map `body` to `message`.
- Map `timestamp` to `createdAt` and `occurredAt`.
- Map `actionUrl` to `href`.
- Map severity `warn` to `warning`.
- Map `read: true` to a `readAt` marker.
- Route legacy/non-existing backend links safely:
  - `/paper` -> `/portfolio`
  - `/risk` -> `/alerts`
  - missing paper/KGI links -> `/portfolio`
  - missing brief links -> `/briefs`
  - otherwise -> `/alerts`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- `git diff --check` — PASS
- HTTP proxy smoke with a fake #520-shaped API payload — PASS:
  - 3 notifications returned
  - `warn` normalized to `warning`
  - `/paper` normalized to `/portfolio`
  - `/risk` normalized to `/alerts`
  - unread count remains 2
- Browser smoke on `http://127.0.0.1:3022/quant-strategies` — PASS:
  - bell badge shows `2`
  - drawer renders 3 items
  - warning item links to `/portfolio`
  - critical item links to `/alerts`
  - read item shows `已讀`
  - no console errors
  - no page errors

Screenshot: `evidence/w7_paper_sprint/CODEX_NOTIFICATION_CONTRACT_NORMALIZATION_2026-05-15.png`

## Safety

- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` promotion.
- No apps/api broker/risk/contracts edits.
- No OpenAlice import/fork.
