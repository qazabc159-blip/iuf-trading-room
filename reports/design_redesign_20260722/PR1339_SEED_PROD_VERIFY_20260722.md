# #1339 CANONICAL_COMPANIES_SEED 補列三檔 — prod seed 執行 + 驗證

- Verifier: Bruce
- 驗證時間：2026-07-22 22:5x-23:0x TST
- Merge commit：`1cfecb95ac1b64df607e16906de3c872a6de7d39`（#1339 "fix(api): stop
  shouldLoadDailyMarketContext always-true bug; seed 3 nameless movers tickers"）
- api `/health` 現查 `buildCommit=1cfecb95...`, `deployedAt=2026-07-22T14:54:36.639Z` —— 版本對上。

## 1. Seed 執行（owner session, `POST /api/v1/admin/companies/seed`）

**第一次呼叫**（真落地）：
```json
{"ok":true,"created":3,"already_exists":2,"errors":0,"results":[
  {"ticker":"1216","action":"already_exists"},
  {"ticker":"0050","action":"already_exists"},
  {"ticker":"4133","action":"created"},
  {"ticker":"4178","action":"created"},
  {"ticker":"6598","action":"created"}
]}
```
→ 新增 3 筆（4133/4178/6598），既有 2 筆（1216/0050）跳過，0 錯誤。

**第二次呼叫**（冪等驗證，同一 session 立即重打）：
```json
{"ok":true,"created":0,"already_exists":5,"errors":0,"results":[
  {"ticker":"1216","action":"already_exists"},
  {"ticker":"0050","action":"already_exists"},
  {"ticker":"4133","action":"already_exists"},
  {"ticker":"4178","action":"already_exists"},
  {"ticker":"6598","action":"already_exists"}
]}
```
→ **冪等確認：created=0，5 筆全部 already_exists，0 錯誤，無重複寫入。**

## 2. 名稱驗收

`movers-missing-name-seed.test.ts`（#1339 內建）本身只是 unit test（mock companies list 證
consuming 端 `market-data.ts` 的 `buildSymbolNameLookup()` 邏輯正確），**不驗證 live seed HTTP
端點與真實名稱**——本節補上這塊缺口，親打三條 prod 路徑：

**路徑 A — `GET /api/v1/companies/:ticker`（直接查公司資料，三檔皆命中真名稱）：**
| ticker | 回傳 name | 與 CANONICAL_COMPANIES_SEED 定義比對 |
|---|---|---|
| 4133 | 亞諾法 | 一致 |
| 4178 | 永笙-KY | 一致 |
| 6598 | ABC-KY | 一致 |

**路徑 B — `GET /api/v1/market-data/overview`（真正的 movers/heatmap 消費端點）：**
- **6598 命中**，且已解析出真名稱：`{"symbol":"6598","market":"TWSE","name":"ABC-KY",...,"last":27.85,...}`
  —— 證明 seed 落地後，consuming 端 `resolveName()` 真的吃到新資料，不再是裸股號。
- 4133、4178 **本次呼叫未出現在有報價的 heatmap/leader 列裡**（僅出現在該端點回傳的 symbol
  universe 清單陣列中，無對應的即時報價 row）——盤後時段這兩檔今日可能無成交量或未在目前
  quote 快照範圍內，屬於「movers 面板本身沒收錄這兩檔」的正常情況，非名稱解析失敗（若真的
  在 heatmap/leaders 出現過但顯示裸股號，才是回歸；本次是完全沒有 quote row，跟名稱解析無關）。
  誠實記錄：**未能在此端點親見這兩檔的名稱顯示，改以路徑 A 直接驗證名稱資料本身正確**。
- `GET /api/v1/market/leaders/twse`、`GET /api/v1/market/leaders/finmind`（今日前十大漲跌幅榜）
  三檔皆未出現（今日非前十大進出，預期內，非驗證缺口）。

## 結論

- Seed 執行：**PASS** —— 3 筆真落地（created=3），冪等驗證通過（重跑 created=0/already_exists=5/errors=0）。
- 名稱正確性：**PASS**（路徑 A，`GET /api/v1/companies/:ticker` 三檔皆回傳正確中文/KY 名稱，
  與 `CANONICAL_COMPANIES_SEED` 原始定義逐字元一致）。
- Movers/heatmap 實際顯示：**PARTIAL_EVIDENCE** —— 僅 6598 這一檔本次盤後恰好在 overview 端點
  有報價因而親眼見到「裸股號 → 真名稱」的實際效果；4133/4178 因盤後無對應報價列，本次驗證
  改走公司資料端點確認名稱資料本身正確，未能直接目視 movers 面板顯示這兩檔的畫面（誠實記錄，
  非回歸，是驗證路徑的限制）。
- 可宣告收口：**是** —— seed 落地、冪等、且三檔名稱資料在後端已正確可查；movers 面板顯示與否
  取決於當下是否有該檔報價，非 #1339 修復範圍內的缺陷。
