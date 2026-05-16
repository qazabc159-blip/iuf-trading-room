# CODEX_HEADERDOCK_DRAG_PERSIST_2026-05-15

Cycle: 2026-05-15 20:48 TST
Branch: `fix/web-headerdock-drag-persist-2026-05-15`
Worktree: `IUF_TRADING_ROOM_APP_headerdock_drag_persist_worktree`

## Scope

Frontend-only reliability fix for draggable HeaderDock persistence.

## Problem

HeaderDock drag persistence previously saved from React `position` state in `onPointerUp`.

On a quick drag/release, `onPointerMove` may call `setPosition(clamped)` but React state can still be stale or `null` when `onPointerUp` runs. In that edge case, the final dock position may not be saved to `localStorage`, causing the dock to return to its default top-right position and potentially cover the user again.

## Shipped locally

Updated `apps/web/components/header-dock.tsx`:

- `dragState.current` now stores `lastPosition`.
- `onPointerDown` initializes `lastPosition` from the current dock rect.
- `onPointerMove` updates `lastPosition` with the latest clamped coordinate.
- `onPointerUp` saves `dragState.current.lastPosition` instead of reading potentially stale React state.
- Visual layout, drawer behavior, notification calls, and mobile behavior are unchanged.

## Verification

Dependency setup in the clean worktree:

```powershell
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
```

Typecheck:

```powershell
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Static behavior check:

- Drag remains restricted to `[data-drag-handle]`.
- Drag remains disabled below `MOBILE_BREAKPOINT`.
- Position is still clamped to viewport.
- `localStorage` key remains `iuf-header-dock-position`.
- Reset position still clears the same key.

## Safety

- No `apps/api` changes.
- No broker/risk/contracts changes.
- No KGI live write path.
- No real-order or `PAPER_LIVE` promotion.
- No戰情台 homepage layout changes.

## Release status

Patch is prepared locally on a clean branch.

Not pushed/opened yet because GitHub Actions is still failing at the repo/account billing or spending-limit gate.
