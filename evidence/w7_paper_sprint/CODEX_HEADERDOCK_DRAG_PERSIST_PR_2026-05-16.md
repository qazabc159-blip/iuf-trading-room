# CODEX_HEADERDOCK_DRAG_PERSIST_PR_2026-05-16

## Scope
- Branch: `fix/web-headerdock-drag-persist-2026-05-16`
- File: `apps/web/components/header-dock.tsx`
- Purpose: make draggable HeaderDock persist the final visible position, not a stale React state value.

## Change
- Added `lastPosition` to the active drag ref.
- Updated it on pointer move with the clamped dock position.
- On pointer up, save the ref's latest clamped position to `localStorage`.
- No API, broker, risk, contract, KGI, or real-order path changes.

## Verification
- `git diff --check origin/main..HEAD` PASS
- `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- Python Playwright browser smoke PASS:
  - started local web on `http://127.0.0.1:3210`
  - added a local-only `iuf_session=codex-local-smoke` cookie to pass middleware routing without using credentials
  - opened `/briefs`
  - dragged `[data-drag-handle]`
  - verified `localStorage["iuf-header-dock-position"]` persisted `{"top":106,"left":991}`
  - screenshot: `evidence/w7_paper_sprint/CODEX_HEADERDOCK_DRAG_PERSIST_PR_2026-05-16.png`
