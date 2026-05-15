# JIM — Remove PaperOrderPanel from Company Page
**Date:** 2026-05-15 13:00 TST
**Branch:** `refactor/web-companies-remove-paper-order-panel-2026-05-15`
**Directive:** 楊董 13:00 TST verbatim「公司頁不需要模擬下單功能 交易室負責下單即可」

## Changes

### `apps/web/app/companies/[symbol]/page.tsx`
- Removed `import { PaperOrderPanel } from "./PaperOrderPanel"` (line 26)
- Removed `<PaperOrderPanel symbol={company.ticker} lastPrice={quote?.last ?? null} />` (line 428)

### Files NOT touched
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` — preserved (交易室仍可 import)
- All other company page panels intact (hero / KPI / chart / orderbook / CoverageSection / financials / news / brief)

## Validation
- typecheck: EXIT 0 (no errors)
- PaperOrderPanel.tsx file preserved on disk
- No layout rewrite; surgical 2-line removal only

## Result
`/companies/2330` no longer renders submit button. Order flow remains only in `/portfolio` (trading room).
