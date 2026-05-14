# CODEX_OVERNIGHT notification center 2026-05-15

## Scope

- Branch: `feat/web-codex-notification-center-2026-05-15`
- Worktree: `IUF_TRADING_ROOM_APP_dock_draggable_worktree`
- Files changed:
  - `apps/web/components/header-dock.tsx`
  - `apps/web/app/globals.css`
- Product request: turn the Day 1 header bell stub into a usable notification drawer without inventing fake notification data.

## Implementation

- Header dock bell now fetches the existing alerts engine through `getAlerts({ limit: 50 })`.
- Drawer shows recent 7-day events from the fetched `AlertEntry[]`.
- Bell badge uses real unacknowledged alert count only; no static red dot.
- Drawer supports loading, error, empty, and list states.
- Alert rows show acknowledged state, rule name, ticker/system, Taipei timestamp, severity styling, and a short payload summary.
- Alert rows and the footer action route to `/alerts`.
- Existing draggable dock behavior and localStorage position memory are preserved.

## Verification

Command:

```text
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Browser smoke:

```text
Local URL: http://127.0.0.1:3013/
Cookie gate: local smoke cookie only, no real credentials.
```

Observed:

- Bell click opens the notification drawer.
- Drawer visible: true.
- Local alert rows: 0.
- Empty/error state visible: true.
- Visible page text contains no fake event wording such as `mock`, `sample`, or `placeholder`.
- Screenshot: `evidence/w7_paper_sprint/screenshots/overnight_notification_drawer.png`.
- Screenshot SHA256: `3D86EB88B4DA8C472FE63F113E73F0F131BB3546F7103737868F2C953194082F`.

Known local limitation:

- The local web app attempted `http://localhost:3001/api/v1/alerts?limit=50`, but port 3001 in this desktop session was occupied by an unrelated process and did not provide the expected local API/CORS headers. The drawer degraded to a sync state and did not synthesize alert data.

## Safety

- No KGI live broker write path touched.
- No execution mode defaults changed.
- No `apps/api` broker/risk/contracts files touched.
- No IUF_QUANT_LAB or IUF_SHARED_CONTRACTS files touched.
- This change reads alerts only and does not dispatch orders or acknowledge alerts.
