# Jason — TW-Coverage Endpoints Evidence
**Date:** 2026-05-15  
**Branch:** feat/api-coverage-endpoints-2026-05-15  
**PR:** #479 (pending)  
**Closes:** Follow-up to PR #478 (tw-coverage-loader merged 9ce301c)

## 新增能力

| Endpoint | 函式 | 說明 |
|---|---|---|
| `GET /api/v1/companies/:ticker/coverage` | `getCompanyCoverageBrief(ticker)` | 單股完整 coverage brief (404 if not found) |
| `GET /api/v1/themes/:token/companies` | `findCompaniesByWikilink(token)` | 主題/公司反查，URL-decode 自動處理 |
| `GET /api/v1/sectors/:sector/companies` | `listSectorCompanies(sector)` | 板塊下所有公司清單 |

Auth: Owner-only v1 (multi-tenant 等 P1).

## Response shape

### GET /api/v1/companies/:ticker/coverage (200)
```json
{
  "ticker": "2330",
  "companyName": "台積電",
  "sector": "Semiconductors",
  "industry": "晶圓代工",
  "metadata": { "marketCap": "...", "enterpriseValue": "..." },
  "businessOverview": "...",
  "supplyChain": { "upstream": [], "midstream": [], "downstream": [] },
  "majorCustomers": [],
  "majorSuppliers": []
}
```

### GET /api/v1/themes/:token/companies (200)
```json
{
  "token": "光阻液",
  "count": 5,
  "matches": [{ "ticker": "8299", "companyName": "...", "sector": "...", "relation": "supplier" }]
}
```

### GET /api/v1/sectors/:sector/companies (200)
```json
{
  "sector": "Semiconductors",
  "count": 42,
  "companies": [{ "ticker": "2330", "companyName": "台積電" }]
}
```

## 修改檔案

- `apps/api/src/server.ts` — 新增 import + 3 endpoints (行 13590~13660 範圍)
- `apps/api/package.json` — build script 前置 `pnpm tsx ../../scripts/sync-tw-coverage.ts`

## Build / Typecheck

- `pnpm --filter @iuf-trading-room/api typecheck` → green (0 errors)

## Railway sync 機制

`apps/api/package.json` build:
```
"build": "pnpm tsx ../../scripts/sync-tw-coverage.ts && tsc -p tsconfig.json"
```
Railway 每次 deploy 執行 `pnpm build`，先 sync 1735 md files 到 `apps/api/data/tw-coverage/`，再 tsc。若 My-TW-Coverage sibling repo 不存在（Railway build context），sync script exit 0 with warning，已有 bundled files 照用。

## Lane 邊界

- 未動 risk-engine / broker / market-data / frontend
- 未動 contracts (loader 已在 PR #478 定義)
- 3 endpoints 全在 strategy/data lane — 符合 Jason 允許修改範圍

## 下一步

1. Bruce: smoke verify 3 endpoints with Owner cookie
2. 楊董確認 Railway deploy 後 sync script log 輸出
