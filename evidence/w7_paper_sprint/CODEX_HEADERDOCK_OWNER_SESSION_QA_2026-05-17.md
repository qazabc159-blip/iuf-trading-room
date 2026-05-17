# HeaderDock Owner-session QA - 2026-05-17

## Goal
- Verify the HeaderDock Notification Center after the merged payload-normalization chain #607-#611.
- Use the production Owner session first when available.
- If production Owner auth is unavailable in this Codex browser, document the blocker and run a local mock compatibility QA without inventing production data.

## Production probe
- Target: `https://app.eycvector.com`
- Result: blocked for true Owner-session QA in this headless Codex browser.
- Observed URL after navigation: `/login?next=%2F`
- Meaning: no usable Owner login state was available to this browser context.
- No credentials, session material, or identity data was entered or exported.
- Screenshot: `evidence/w7_paper_sprint/headerdock-owner-session-production-probe-1366x900.png`

## Local compatibility QA
- Route: local Next dev `/settings/account`
- Auth approach: a local-only test session marker was set for `127.0.0.1` to pass the web middleware. Backend calls were routed to a mock API.
- This does not create or fake production data. It only verifies the shipped web proxy and HeaderDock UI behavior against expected backend payload shapes.

## Payload variants verified
- Top-level notification array.
- `{ items: [...] }` envelope.
- `{ data: { alerts: [...] } }` envelope.
- 204 No Content response.
- 200 OK with empty body.
- snake_case fields:
  - `created_at`
  - `read_at`
  - `is_read`
  - `action_url`
- severity aliases:
  - `warn` -> `warning`
  - `ERROR` -> `critical`
  - `danger` -> `critical`
- text aliases:
  - `summary` as title
  - `description` as message
  - `event` as title
  - `text` as message
  - `content` as message

## UI behavior verified
- HeaderDock bell opened the drawer on desktop.
- Drawer rendered 3 notifications.
- Unread badge showed `2`.
- Notification titles and summaries were readable; no `undefined`, `null`, or raw-only fallback appeared.
- Warning / critical / info visual states rendered without layout break.
- Clicking the unread notification called `POST /api/header-dock/notifications/:id/mark-read`.
- The click navigated to `/alerts`.
- Mobile drawer opened at 390px width without overflowing the viewport.
- No browser console errors or page errors were observed in the successful local QA run.

## Verification commands
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Playwright mock QA:
  - production auth probe
  - local proxy payload variants
  - desktop drawer interaction
  - mobile drawer interaction

## Screenshots
- Production auth blocker: `evidence/w7_paper_sprint/headerdock-owner-session-production-probe-1366x900.png`
- Local desktop drawer: `evidence/w7_paper_sprint/headerdock-owner-qa-local-desktop-1366x900.png`
- Local mobile drawer: `evidence/w7_paper_sprint/headerdock-owner-qa-local-mobile-390x844.png`

## Conclusion
- No frontend bug was found in HeaderDock Notification Center during this QA pass.
- True production Owner-session QA is still blocked until a browser context with an Owner login session is available.
- The local mock QA confirms the frontend proxy and drawer can handle the payload variants introduced by #607-#611.
