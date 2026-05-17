# Codex Evidence - Company Graph Labels

Date: 2026-05-18
Branch: fix/web-company-graph-labels-2026-05-18
Scope: `apps/web/app/companies/CompanyGraphTab.tsx`

## Shipped

- Localized remaining visible company graph labels:
  - `COMPANY GRAPH` -> `公司圖譜`
  - `SEARCH` -> `搜尋`
  - `RELATION TYPES` -> `關係類型`
  - `TOP KEYWORDS` -> `熱門關鍵字`
  - `TOP CONNECTED COMPANIES` -> `高連結公司`
  - `score` -> `分數`
- Hardened the graph tab against partial stats/search envelopes:
  - search results now fall back to an empty array if the payload is malformed.
  - relation-type metric uses the already normalized relation list instead of assuming `stats.relationTypes` is always present.

## Safety

- Frontend-only change inside `apps/web`.
- No backend API, broker/risk/contracts, live order, execution-mode, or vendor homepage changes.
- No fake My-TW-Coverage data added; browser smoke used a local mock API only.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- `rg -n "COMPANY GRAPH|SEARCH|RELATION TYPES|TOP KEYWORDS|TOP CONNECTED COMPANIES|score " apps/web/app/companies/CompanyGraphTab.tsx` returned no matches.
- Browser smoke with local mock API and owner-session cookie:
  - `/companies?tab=graph&q=2330` desktop 1366x900 returned 200.
  - `/companies?tab=graph&q=2330` mobile 390x844 returned 200.
  - Required visible labels found: `公司圖譜`, `搜尋`, `關係類型`, `熱門關鍵字`, `高連結公司`, `分數 98.4`, `台積電`.
  - Forbidden visible labels absent: `COMPANY GRAPH`, `SEARCH`, `RELATION TYPES`, `TOP KEYWORDS`, `TOP CONNECTED COMPANIES`, `score 98.4`.
  - Console warnings/errors, page errors, failed requests, and >=400 responses: none.

## Screenshots

- `evidence/w7_paper_sprint/company-graph-labels-1366x900.png`
- `evidence/w7_paper_sprint/company-graph-labels-mobile-390x844.png`

## Known External Blocker

- Deploy to Railway remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
