# CODEX_COMPANY_REMOVE_ORDER_PANEL_CLEAN_2026-05-15

Time: 2026-05-15 11:44 TST
Branch: `refactor/web-company-page-remove-order-panel-clean-2026-05-15`

## Scope

Clean frontend-only recreation of Yang's directive:
- Company pages should be information surfaces.
- Order entry belongs in the trading room.

Changes:
- Removed `PaperOrderPanel` import from `apps/web/app/companies/[symbol]/page.tsx`.
- Removed the `PaperOrderPanel` render under the company chart/workbench.
- Preserved `PaperOrderPanel.tsx` file so existing trading/order modules are not deleted.

## Why This PR Exists

Open PR `#511` has the correct product intent but is stacked on unrelated/conflicting commits:
- includes portfolio/API commits from `#509/#510`
- GitHub reports `CONFLICTING`
- no checks reported on the current branch

This PR keeps the same product fix but applies it cleanly from latest main.

## Verification

Commands:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` -> PASS
- `rg -n "PaperOrderPanel" apps/web/app/companies/[symbol]/page.tsx apps/web/app/companies/[symbol]/PaperOrderPanel.tsx ...`
  - result: no `PaperOrderPanel` reference in company page
  - result: `PaperOrderPanel.tsx` component file still exists
- `curl.exe -s -H "Cookie: iuf_session=dev" -o tmp-company-6801.html http://127.0.0.1:3021/companies/6801`
  - bytes: 176018
  - `Acme Optics Taiwan`: true
  - `My-TW-Coverage`: true
  - `K 線`: true
  - `風控與報價預覽`: false
  - `不建立 paper order`: false
- `git diff --check` -> PASS

## Safety

- No broker/risk/contracts edits.
- No KGI live write.
- No execution mode changes.
- No company-page layout rewrite.
- No deletion of trading/order component files.

## Residual

- #509/#511/#512 remain stacked/conflicting and should be recreated/rebased by owners.
- My-TW-Coverage wikilinks backend fix remains Jason/API lane.
