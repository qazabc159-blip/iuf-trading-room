# JIM Evidence — /themes/wiki/[name] 主題板獨立頁面

**Date**: 2026-05-15  
**Branch**: feat/web-themes-detail-page-2026-05-15  
**PR title**: feat(web): /themes/wiki/[name] 主題板獨立頁面 (wikilink 反向圖譜 driven)

## Route

- New file: `apps/web/app/themes/wiki/[name]/page.tsx`
- URL pattern: `/themes/wiki/CoWoS` / `/themes/wiki/HBM` / `/themes/wiki/%E5%85%89%E9%98%BB%E6%B6%B2`
- URL note: placed under `/wiki/` sub-path to avoid Next.js dynamic segment collision with existing `[short]` (slug-based detail page at `/themes/[short]`)

## API consumed

- `GET /api/v1/themes/:token/companies` (PR #479)
- Response: `{ token, count, matches: [{ ticker, companyName, sector, relation }] }`
- Auth: Owner role required

## Features implemented

1. Hero: token name + tagline + company count
2. Search filter bar: real-time filter on ticker / companyName
3. Sector accordion groups: auto-collapse if N > 10
4. Relation chips: upstream=teal / downstream=purple / customer=blue / supplier=orange / related=slate (PR #484 pattern)
5. Click ticker → `/companies/[ticker]`
6. Empty state: "此主題尚無收錄資料" + link to `/themes`
7. Loading / error states with spinner

## Files changed

- `apps/web/app/themes/wiki/[name]/page.tsx` (new, 290 lines)
- `evidence/w7_paper_sprint/JIM_THEMES_DETAIL_PAGE_2026-05-15.md` (this file)

## Validation

- typecheck: EXIT 0
- No backend files touched
- No sidebar touched
- No [short] page touched

## Assumptions

- Route is `/themes/wiki/[name]` not `/themes/[name]` — avoids collision with existing `[short]` slug route. Both serve different data sources (wikilink graph vs IUF theme DB).
- Accordion auto-expand threshold: ≤10 members = open by default; >10 = collapsed.
- Sectors sorted by member count descending (most populous first).
