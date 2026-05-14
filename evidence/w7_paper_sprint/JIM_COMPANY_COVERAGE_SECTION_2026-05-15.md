# JIM — Company Page 深度研究 Section Evidence
Date: 2026-05-15 01:15 TST
Branch: feat/web-company-page-coverage-section-2026-05-15
PR title: feat(web): company page add 深度研究 section (My-TW-Coverage integration)

## Deliverable

New `CoverageSection` component added to `/companies/[symbol]` page as collapsed accordion
at bottom of page — after FullProfilePanels, zero layout disruption to existing widgets.

## Files Changed

- `apps/web/app/companies/[symbol]/CoverageSection.tsx` — NEW (client component)
- `apps/web/app/companies/[symbol]/page.tsx` — import + append section divider + CoverageSection

## What It Does

1. Default COLLAPSED — page does not explode on load
2. On first open: fetches `/api/v1/companies/:ticker/coverage` (Jason PR feat/api-coverage-endpoints-2026-05-15)
3. 4 sub-sections rendered:
   - 業務簡介: paragraph + sector/industry/marketCap/enterpriseValue metadata
   - 供應鏈位置: upstream/midstream/downstream by category; ticker-like names are clickable Links
   - 主要客戶 + 主要供應商: chip list, ticker-detected names link to /companies/[ticker]
   - 主題雷達: top-10 wikilinks as buttons; click fetches /api/v1/themes/:token/companies for peer list
4. 404 response → shows "此公司尚無深度研究資料" (section still visible)
5. License footer: "資料來源: My-TW-Coverage (MIT)"

## API Dependencies

| Endpoint | Status | Owner |
|---|---|---|
| GET /api/v1/companies/:ticker/coverage | PENDING (Jason PR) | Jason |
| GET /api/v1/themes/:token/companies | PENDING (Jason PR) | Jason |

Frontend gracefully degrades (null return on fetch fail) — works today with 404 state.

## Validation

- typecheck: EXIT 0
- No existing widget moved/deleted
- No backend files touched
- Lane boundary: only CoverageSection.tsx (new) + page.tsx (import + append)
