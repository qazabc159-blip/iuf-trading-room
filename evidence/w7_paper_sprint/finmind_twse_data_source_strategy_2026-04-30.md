# FinMind + TWSE OpenAPI 資料源整合策略

**Date**: 2026-04-30
**Author**: Elva
**Trigger**: 楊董痛點 — 公司頁假 K 線 + 沒財報/新聞/消息面；3 資料源評估後拍板 FinMind 主 + TWSE 副。

---

## 1. 為什麼需要

| 痛點 | 既有狀態 | 採用後 |
|---|---|---|
| 公司頁 K 線 source=mock | seeder 假 OHLCV | FinMind `TaiwanStockPriceAdj` 真歷史含調整 |
| 沒財報 | 無 | FinMind `FinancialStatements + BalanceSheet + CashFlowsStatement` |
| 沒月營收 | 無 | FinMind `MonthRevenue` (24 個月歷史) |
| 沒法人籌碼 | 無 | FinMind `InstitutionalInvestorsBuySell + MarginPurchaseShortSale` |
| 沒股利 | 無 | FinMind `Dividend` |
| 沒重大訊息/公告 | 無 | TWSE OpenAPI `t187ap46_L_*` 系列 |
| 沒新聞 | 無 | **本 sprint 不解** — 留後續 RSS lane (鉅亨/cnYES) |

**最大 win**：公司頁真資料化跟 KGI 整合**完全脫鉤**。FinMind 立刻給歷史 + 財報；KGI 那段純粹是「即時下單路徑」。

---

## 2. 資料源比較矩陣

| 維度 | FinMind | twstock | TWSE OpenAPI |
|---|---|---|---|
| 資料 breadth | OHLCV / 財報 / 法人 / 融資券 / 股利 / 期權 / tick / 即時 snapshot | OHLCV + 基礎技術指標 | 公告 / ESG / 治理 / 除權息 |
| 即時 / EOD | 兩者 | EOD（即時要打 TWSE，3 req/5s 限制太緊） | EOD only |
| 認證 | JWT token (query param) | 無 | 無 |
| Rate limit | 300/hr (unauth) / **600/hr (auth)** | TWSE 3 req/5s（嚴重瓶頸） | 友善（無公告數值） |
| Language | REST + Python SDK | Python only | REST |
| License | Apache-2.0（注意非商業條款待釐清） | MIT | TWSE 官方 |
| 維護 | 活躍 | v1.5.1 (2026-04-23) 活躍 | 官方持續 |
| **採用** | ✅ PRIMARY | ❌ 跳過 | ✅ SECONDARY |

**twstock 跳過原因**：(a) Python only — 我們後端 TS 為主 (b) TWSE 3 req/5s rate limit 對 3470 公司 batch 致命 (c) FinMind 已涵蓋且更快 (d) 沒有財報/新聞/法人。

---

## 3. FinMind 細節

- **Base URL**: `https://api.finmindtrade.com/api/v4/data`
- **Auth**: query param `?token=<JWT>`（**不是 Bearer header**）
- **Token policy**: 楊董提供的 JWT 只放：
  - Windows local: `[Environment]::SetEnvironmentVariable("FINMIND_API_TOKEN", "<token>", "User")`
  - Railway api/worker service: env var `FINMIND_API_TOKEN`
  - **禁止**：repo / chat / commit message / log / evidence 任何文字檔
- **Rate limit**: 600/hr authenticated；600 / 3600s = **每 6 秒 1 req 上限**（concurrent 用 token bucket 限 9 reqs/min 為安全邊際）
- **License caveat**: 楊董 IUF 是個人 founder/trader 自用 paper trading，**非對外 SaaS**，落在「教育/個人研究」邊界。後續若要對外發行需重新評估。本 sprint 確認 internal-use 範圍。

### 3.1 採用的 FinMind dataset（8 個）

| Dataset | 用途 | Cache TTL |
|---|---|---|
| `TaiwanStockPriceAdj` | 公司頁 K 線（取代 mock） | 600s |
| `TaiwanStockFinancialStatements` | 季報三表 | 3600s |
| `TaiwanStockBalanceSheet` | 資產負債表 | 3600s |
| `TaiwanStockCashFlowsStatement` | 現金流量表 | 3600s |
| `TaiwanStockMonthRevenue` | 月營收 sparkline | 3600s |
| `TaiwanStockInstitutionalInvestorsBuySell` | 三大法人 | 1800s |
| `TaiwanStockMarginPurchaseShortSale` | 融資融券 | 1800s |
| `TaiwanStockDividend` | 股利 | 86400s |

### 3.2 Fallback 行為

- Token missing → log warn + return source=mock (既有行為)，**不 throw**
- 429 → exponential backoff 1/2/4/8s max 3 retries
- Zod parse fail → log + return empty array + UI 顯示「資料來源異常」placeholder
- 無 token unauth call → 300/hr 仍可用，**只在 token 完全沒設時 fallback 到 unauth call**（夜間 cron 同步可用此模式）

---

## 4. TWSE OpenAPI 細節

- **Base URL**: `https://openapi.twse.com.tw/v1/`
- **Auth**: 無（公開）
- **採用 endpoints**：
  - `/v1/opendata/t187ap46_L_*` 系列 — 重大訊息（A/B/C 類別）
  - `/v1/opendata/co/co_market` — 公司基本資料補充
  - `/v1/opendata/t187ap46_L_2` — 公司治理
  - ESG endpoint TBD（後續 D-2 補）
- **Cache TTL**: 1800s（公告每 30 分一次足夠）
- **Stop-line check**: 公開資料，無 secret，無 broker path — 全綠

---

## 5. 後端 adapter 架構（Lane H — Jason）

```
apps/api/src/data-sources/
├── finmind-client.ts          # FinMind JWT-token client + 8 dataset methods
├── finmind-client.test.ts     # 8+ tests
├── twse-openapi-client.ts     # TWSE OpenAPI client (no auth)
├── twse-openapi-client.test.ts
└── README.md                  # adapter usage doc

apps/api/src/server.ts (新 routes)
├── GET /api/v1/companies/:id/financials?period=Q&limit=8
├── GET /api/v1/companies/:id/revenue?limit=24
├── GET /api/v1/companies/:id/chips?days=30
├── GET /api/v1/companies/:id/dividend?years=5
└── GET /api/v1/companies/:id/announcements?days=30

apps/api/src/jobs/
└── ohlcv-finmind-sync.ts      # 每天 EOD cron 抓 FinMind → 寫 companies_ohlcv
                                # ENV `OHLCV_SOURCE=mock|finmind|kgi` 切換來源
```

---

## 6. 前端 panel 結構（Lane A — Jim）

公司頁 (`apps/web/app/companies/[symbol]/page.tsx`) 從上到下：

1. **CompanyInfoPanel** — 基本資料 + chainPosition + beneficiaryTier + exposure breakdown + validation snapshot
2. **OhlcvCandlestickChart** — K 線（既有 PR #36，FinMind 接通後會顯示真資料 + KGI-ORIGIN/MOCK badge 改成 FINMIND-ADJ）
3. **FinancialsPanel** — 季/年報 / 月營收 / 股利（4 tabs）
4. **ChipsPanel** — 三大法人 + 融資融券
5. **AnnouncementsPanel** — 重大訊息 + 公告
6. **PaperOrderPanel** — Paper trading shell（NO broker submit）

每個 panel 各自 ErrorBoundary，壞一個不拖累整頁。

---

## 7. Cutover 順序

| 階段 | 動作 | Owner | Gate |
|---|---|---|---|
| 7.1 | Lane H PR-H1 開 DRAFT — FinMind adapter skeleton | Jason | 立即 |
| 7.2 | Lane A PR #36 v2 — placeholder shells（API 404 fallback）| Jim | 立即（並進） |
| 7.3 | Bruce verify Lane H DRAFT + Pete review | Bruce+Pete | 7.1 完 |
| 7.4 | Elva ready Lane H + squash merge | Elva | 7.3 PASS |
| 7.5 | 楊董設 Railway env `FINMIND_API_TOKEN` | 楊董 | 7.4 後 |
| 7.6 | Lane A PR #36 rebase + verify panels 顯示真資料 | Jim+Bruce | 7.5 後 |
| 7.7 | Elva ready PR #36 + squash merge | Elva | 7.6 PASS |
| 7.8 | Production smoke + screenshot manifest | Bruce | 7.7 後 |

**目標**: 7.8 在 W7 D5 (2026-05-04) 前完成，paper E2E target 2026-05-09 不延。

---

## 8. Stop-line check

- ✅ 不違反 `feedback_path_terminology_strict` — FinMind 是 market data API，不是 broker
- ✅ 不違反 KGI SDK import 禁令 — FinMind 純 REST
- ✅ 不違反 TradingView 禁令 — FinMind 是 data source 不是顯示工具
- ✅ 不違反 `feedback_kgi_env_var_uppercase_rule` — env var 全大寫 `FINMIND_API_TOKEN` / `OHLCV_SOURCE`
- ✅ 不違反 OPENAI_MODEL pin (gpt-5.4-mini)
- ✅ Token 不入 repo / chat / evidence / log
- ✅ Paper trading shell 沒 broker submit（PaperOrderPanel 只接 paper-broker route）

---

## 9. 風險 + Mitigation

| 風險 | Mitigation |
|---|---|
| FinMind 服務中斷 | 每個 endpoint 都 try/catch + UI placeholder + Redis 30 day stale-while-revalidate cache |
| Rate limit 600/hr 不夠（3470 公司全 sync）| OHLCV cron 跑分批 batch + 60 req/min 節流；公司頁即時請求只需要當前公司 ~5 req|
| Token 旋轉 | 設 90 天提醒；env var 換值即可，無 code change |
| FinMind license commercial 限制 | 個人 paper trading internal-use OK；對外發行前再評估付費或自建 |
| FinMind data quality 漂移 | OHLCV 同步 KGI quote 後可雙源比對；目前 trust FinMind |

---

## 10. Next decision

楊董需要做：
1. ✅ 已 ACK FinMind 採用
2. 設 `FINMIND_API_TOKEN` 到 Railway api 與 worker service env（用 Railway dashboard，**不要回 Elva 值**）
3. Lane H DRAFT PR 出來後 ACK ready→merge

**Status**: STRATEGY APPROVED, EXECUTION IN FLIGHT (3 background agents running).
