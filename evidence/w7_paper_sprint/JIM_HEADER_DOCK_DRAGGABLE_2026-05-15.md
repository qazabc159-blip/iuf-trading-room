# JIM — Header Dock Draggable

**Date:** 2026-05-15 02:20 TST
**Branch:** feat/web-header-dock-draggable-2026-05-15
**PR Title:** feat(web): header dock 可拖拉 + localStorage 記憶位置

## What was done

- Added pointer event drag logic to `header-dock.tsx` (pointer-down/move/up with capture)
- Drag only activates via `data-drag-handle` grip icon (GripHorizontal lucide) — buttons still fire normally
- Viewport clamping: `clampToViewport()` keeps dock within window bounds at all times
- localStorage key `iuf-header-dock-position` — reads on mount, writes on pointer-up
- "重置位置" menu item in account menu (only shown when position has been moved) — clears localStorage + resets to CSS default
- Mobile (< 768px): grip hidden, inline style not applied — CSS fixed top-right takes over
- `touch-action: none` added to `.header-dock` for smooth pointer events on touch
- `.header-dock-grip` CSS class added (20×36px, subtle fg-3 color, hover brightens)

## Files changed

- `apps/web/components/header-dock.tsx`
- `apps/web/app/globals.css` (2 edits: touch-action + grip CSS class)

## Typecheck

EXIT 0 (npx tsc --noEmit, no errors)

## Notes

- Drag initiates ONLY if pointer-down target has `data-drag-handle` ancestor — prevents button misfire
- Default position (null state) defers to CSS `right: 16px` — no inline style override
- After drag, position stored as absolute `{top, left}` px values
