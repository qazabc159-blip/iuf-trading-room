# CODEX_HEADERDOCK_DRAG_REGRESSION_QA_2026-05-17

Owner: Codex frontend (`apps/web`)
Branch: `qa/web-headerdock-drag-regression-2026-05-17`
Base: `origin/main` at `911a88c` (`docs(web): add quant owner e2e QA evidence`)

## Scope

Bounded HeaderDock draggable dock regression after recent merged frontend/global CSS work.

Verified:

- Desktop drag handle moves the HeaderDock.
- Drag writes `localStorage["iuf-header-dock-position"]`.
- Reload restores the saved dock position.
- Account menu reset clears `iuf-header-dock-position` and returns the dock to the default right edge.
- Notification bell drawer still opens after drag/reload/reset.
- Mobile viewport ignores a saved desktop drag coordinate and has no horizontal overflow.

No frontend source change was required.

## Environment

- Web app: `pnpm.cmd --filter @iuf-trading-room/web exec next dev -p <ephemeral-port> -H 127.0.0.1`
- Mock API: local HTTP server serving only notification endpoints:
  - `GET /api/v1/notifications`
  - `POST /api/v1/notifications/:id/mark-read`
- Browser: Playwright Chromium headless
- Auth gate: local cookies `iuf_session=local-smoke-session`, `iuf_auth=1`
- Test page: `/settings/account`

## Result

Pass.

Verification commands:

```powershell
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Notes:

- First `web typecheck` attempt failed because the fresh worktree had not built `@iuf-trading-room/contracts`, so TypeScript could not resolve the workspace contract package.
- After `pnpm.cmd --filter @iuf-trading-room/contracts build`, `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- No HeaderDock source files were changed.

Measured state from the passing smoke:

```json
{
  "initialRect": { "top": 16, "right": 1350, "left": 1132, "width": 218, "height": 52 },
  "draggedRect": { "top": 108, "right": 1080, "left": 862, "width": 218, "height": 52 },
  "restoredRect": { "top": 108, "right": 1080, "left": 862, "width": 218, "height": 52 },
  "resetRect": { "top": 16, "right": 1350, "left": 1132, "width": 218, "height": 52 },
  "mobileRect": { "top": 79.546875, "right": 382, "left": 208, "width": 174, "height": 48 },
  "storedAfterDrag": { "top": 108, "left": 862 }
}
```

Assertions passed:

- Dock moved more than the minimum regression threshold after pointer drag.
- Stored position was valid JSON with finite `top` and `left`.
- Reload restored the saved desktop coordinate within tolerance.
- Notification drawer showed the mocked live payload after drag/reload.
- Reset cleared `iuf-header-dock-position`.
- Reset returned the dock near the default `right: 16px` placement.
- Mobile 390px viewport kept the dock inside viewport and hid the drag grip.
- Browser console/page errors: none blocking.

Observed non-blocking dev-server warning:

- Repeated Sentry/OpenTelemetry dev warning: `Critical dependency: the request of a dependency is an expression`.
- This was emitted by Next dev compilation from `@sentry/nextjs` / `@opentelemetry` import trace, not by the browser page runtime and not introduced by this evidence-only pass.

## Screenshots

- `evidence/w7_paper_sprint/headerdock-drag-regression-desktop-1366x900.png`
- `evidence/w7_paper_sprint/headerdock-drag-reset-desktop-1366x900.png`
- `evidence/w7_paper_sprint/headerdock-drag-mobile-390x844.png`

## Blockers

- True production Owner-session HeaderDock QA remains blocked without a real production Owner browser session.
  - Owner: Yang / Elva, only if production-authenticated validation is required.
- Backend notification source and persistence remain backend-owned.
  - Owner: Jason.

## Conclusion

HeaderDock drag persistence, reload restore, reset behavior, notification drawer availability, and mobile safety are still good on latest `origin/main`.
