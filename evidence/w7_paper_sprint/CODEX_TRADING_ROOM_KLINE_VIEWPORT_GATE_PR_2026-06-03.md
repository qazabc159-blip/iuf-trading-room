# Codex Evidence — Trading Room K-line Viewport Gate

Date: 2026-06-03
Owner: Codex frontend
Scope: Trading Room product QA gate

## Why

Yang reported that the Trading Room chart felt unstable and that chart controls could look real without proving useful behavior. The UI fix for zoom/latest/full-range controls already landed in PR #926. This PR adds an owner-session Playwright gate so the Trading Room cannot regress back into decorative chart controls.

## Change

- Extended `packages/qa-playwright/tests/portfolio.spec.ts`.
- The `/portfolio` owner-session smoke now asserts:
  - the embedded real K-line iframe is mounted;
  - the K-line viewport controls are visible;
  - the visible/total bar count is rendered;
  - `放大`, `縮小`, `回最新`, and `全覽` can be clicked;
  - clicking these controls does not remount or navigate the real K-line iframe.

## Verification

Local checks:

```powershell
pnpm.cmd --filter @iuf-trading-room/qa-playwright typecheck
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: both passed.

Browser owner-session verification:

- Local owner credentials/storage state are not present in this workspace session.
- The Playwright P0 Smoke workflow has the required GitHub secrets and will run this gate on PR.

## Product Boundary

This PR does not change broker execution, KGI live order paths, strategy logic, contracts, migrations, or Quant Lab. It only strengthens the product QA gate for the Trading Room K-line experience.
