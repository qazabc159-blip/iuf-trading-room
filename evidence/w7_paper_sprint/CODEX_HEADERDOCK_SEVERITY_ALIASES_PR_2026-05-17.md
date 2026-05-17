# HeaderDock severity aliases PR evidence - 2026-05-17

## Scope

- Frontend-owned change under `apps/web`.
- Hardened `app/api/header-dock/notifications` severity normalization:
  - Case-insensitive severity parsing.
  - `critical`, `danger`, `error`, `fatal`, `high` normalize to `critical`.
  - `warning`, `warn`, `medium` normalize to `warning`.
  - Unknown or non-string values normalize to `info`.
- This prevents risk or gateway notifications from silently downgrading to info styling when live payloads use alternate severity labels.
- No backend, broker, risk, KGI, contract, OpenAlice source, or homepage layout changes.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser/proxy smoke with Next dev + mock API:
  - `CRITICAL` normalized to `critical`.
  - `danger` normalized to `critical`.
  - `WARN` normalized to `warning`.
  - `medium` normalized to `warning`.
  - unknown `notice` normalized to `info`.
  - Verified unread alias forwarding remains intact for `unread_only=true`.

## Artifact

- Screenshot: `evidence/w7_paper_sprint/headerdock-severity-aliases-proxy-1366x900.png`
