# Codex Evidence - Company Detail Knowledge Grid

Date: 2026-05-18
Branch: fix/web-company-detail-knowledge-grid-2026-05-18
Scope: company detail My-TW-Coverage visibility in `apps/web/app/companies/[symbol]`

## Shipped

- Moved `IndustryGraphPanel` into the existing, previously unused `company-knowledge-grid`.
- `CoverageKnowledgePanel` and `IndustryGraphPanel` now appear together immediately below the K-line workbench.
- Removed the later duplicate full-width industry graph section so operators no longer have to scroll past the data docks to find the graph.
- Adjusted `company-knowledge-grid` CSS:
  - regular desktop/mobile stacks the panels to avoid cramped graph cards inside the company main column.
  - ultra-wide screens use two columns.
  - child panels have stable zero outer margin inside the grid.

## Safety

- Frontend-only change under `apps/web/app/companies/[symbol]`.
- No API, broker/risk/contracts, live order, execution-mode, heatmap data chain, or vendor homepage changes.
- No fake My-TW-Coverage data added; browser smoke used a local mock API only.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke with local mock API and owner-session cookie:
  - `/companies/2330` desktop 1366x900 returned 200.
  - `/companies/2330` mobile 390x844 returned 200.
  - Required visible content found: `台積電`, `知識圖譜`, `上下游圖譜`, `晶圓代工核心供應商`, `CoWoS`, `在公司圖譜搜尋 2330`.
  - DOM checks:
    - `.company-knowledge-grid` exists.
    - `._ck-panel` and `._ig-panel` both exist inside the visible detail page.
    - old bottom `供應鏈關係圖譜` title band is absent.
    - graph panel appears after coverage panel and near the K-line workbench.
  - Console warnings/errors, page errors, failed requests, and >=400 responses: none.

## Screenshots

- `evidence/w7_paper_sprint/company-detail-knowledge-grid-1366x900.png`
- `evidence/w7_paper_sprint/company-detail-knowledge-grid-mobile-390x844.png`

## Known External Blocker

- Deploy to Railway remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
