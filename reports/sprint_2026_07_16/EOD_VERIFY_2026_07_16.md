# EOD 盤後驗證包 — 2026-07-16（四）（Bruce）

驗證時間：18:5x TST（`date -u` 2026-07-16T10:50 +8）。coordinator 派工時實際時間已晚於估計，
EOD 窗（14:45-16:00 TST）本身早已於查證前結束並自然產出（`generated_at_tst:"2026-07-16T14:55:12+08:00"`
落在窗內），故本次為窗後一次性核對，未做窗中輪詢。prod = `https://api.eycvector.com`，
`railway logs --service api` 交叉核對。全程唯讀，未 apply 任何動作。

比對基準：`reports/sprint_2026_07_15/EOD_VERIFY_2026_07_15.md`（同一套判準與端點）。

---

## 結論總覽

| # | 項目 | 結論 |
|---|---|---|
| 1 | S1/F-AUTO EOD report 鏈（today_eod=今日／navCurve 新點／weeks[1..7]完整） | **PASS** |
| 2 | quote_last_close 今日首寫（TWSE 全宇宙＋TPEX skip 記錄） | **PASS（TWSE）／TPEX 仍 skip（同 7/15 pattern，非新問題）** |
| 3 | 2071 ohlcv_fallback＋STOCK_DAY_ALL self-heal | **PASS** |
| 4 | navCurve weekNumRecorded 標籤 | **記錄（非 gate）**：今日列 weekNum=7 正確，7/15 舊列仍卡 weekNum=6 誤標——同一曲線內兩種標籤狀態並存 |
| 5 | F-AUTO NAV 今日是否用 7/16 durable close | **PASS**（pricingQuality:"official"，非缺價/非 stale） |

**#1164 升格條件本日證據：達成。** EOD report 產出鏈路（#1280 窗尾放寬到 16:00 後的首個交易日）今日
`today_eod.date` 自然等於查證當日 `2026-07-16`，`generated_at_tst` 落在放寬後的窗內（14:55，非硬撐到
16:00 才擠出來），navCurve/weeks 同步寫入，連續性 sanity 正常，無需人工介入 apply——楊董裁決 #1164
升格所需的「窗尾放寬後首個交易日能否自然產出」證據本日成立。

---

## 1. S1/F-AUTO EOD report 鏈 — PASS

```
GET /api/v1/internal/s1-sim/status
→ today_tst: "2026-07-16"
→ today_eod: { date:"2026-07-16", generated_at_tst:"2026-07-16T14:55:12+08:00",
               total_unrealized_pnl_twd:306750, total_market_value_twd:4491100,
               position_count:8, data_source:"audit_log_fallback", source:"file" }
```
`today_eod.date` = 今天，非卡死舊值（對照 7/15 首查時卡在 2026-07-09 連續 4 天沒動的病灶，今日
已解除，且比 7/15 晚間回補後的狀態更進一步——這次是**自然產出**，非人工 apply）。

Railway log 確認產出時序：
```
[s1-eod] complete report already generated today, skipping   ← 本輪查證時已完成，之後 tick 均 idempotent skip
```

```
GET /api/v1/portfolio/f-auto/nav
→ weeks: [1,2,3,4,5,6,7]（無重複、無缺口，7/14 昨日回補的 week7 仍在，未被今日 cron 覆寫或重複寫入）
→ navCurve 最新列: {"navDate":"2026-07-16","equityTwd":10306750,"returnPct":3.0675,
                     "weekNum":7,"source":"live_eod","pricingQuality":"official"}
```
鄰日連續性 sanity：
```
2026-07-15: equityTwd 10,358,600 (weekNumRecorded=6，見下方第4項)
2026-07-16: equityTwd 10,306,750 (weekNumRecorded=7)
```
差額 -51,850（-0.5%），波動幅度合理，無跳崖式缺價當 0 或暴增數倍病徵，符合「帳對得起本金」鐵律。

## 2. quote_last_close 今日首寫 — PASS（TWSE）／TPEX 仍 skip

```
[twse-eod-cron] persisted 1237 last-good closes to quote_last_close (trade_date=2026-07-16)
[twse-eod-cron] TPEX date mismatch: daily_close_quotes data_date != expected trade_date=2026-07-16
  — TPEX persist skipped
[twse-eod-cron] injected 1237 EOD quotes into manual cache (outside trading hours)
```
TWSE 全宇宙 1237 檔（對照昨日 1239，同量級，非驟減）今日首寫成立。**TPEX date-mismatch skip 訊息今日
確實有記錄**（跟昨日 7/15 log 其實也有同款訊息一致——coordinator 描述「昨日沒寫」若指的是 TPEX
**資料本身**沒寫入 quote_last_close 表（因 skip），則兩天狀態相同：log 訊息兩天都有記錄，
TPEX 資料兩天都因上游 `daily_close_quotes` date mismatch 沒真正落表，非今日新增/新解的問題，
仍是既有 P2 佇列項，非本輪 gate。

## 3. 2071 ohlcv_fallback＋STOCK_DAY_ALL self-heal — PASS

```
GET /api/v1/portfolio/f-auto → notes 含:
"persisted_close_fallback: 2071 priced 36 from DB (trade_date=2026-07-13, source=ohlcv_fallback)"
positions.2071 = {shares:17000, avg_cost:36, last_price:36, unrealized_pnl_twd:0, market_value_twd:612000}
```
2071 非缺價當 0，跟 7/15 同款行為（walkback 到最近可用 DB 價，非今日新鮮價，符合 TEJ tier 1e 設計）。

```
[twse-openapi-client] STOCK_DAY_ALL upstream stuck (primary_date=2026-07-15, expected=2026-07-16,
  today_is_trading_day=true) — trying www rwd afterTrading fallback
[twse-openapi-client] STOCK_DAY_ALL self-heal succeeded: 1244 rows from www rwd afterTrading
  (trade_date=2026-07-16)
```
今日上游同樣卡住（primary_date 落後一天，跟 7/15 一致的既有 pattern），self-heal 持續穩定觸發成功
（log 中重複出現多次，機制運作如常，非退化）。

## 4. navCurve weekNumRecorded 標籤 — 記錄供 Jason（非 gate）

```
2026-07-14: weekNum=7  (回補列，正確——basketDate同週)
2026-07-15: weekNum=6  (既有舊病，7/15 EOD_VERIFY 已記錄，本輪未變)
2026-07-16: weekNum=7  (正確——跟 7/14 basketDate 同週)
```
同一條 navCurve 內 7/15 跟 7/16 兩列的 weekNum 標籤不一致（6 vs 7），但兩者理論上都該屬於 week7
（7/14 週二之後、下個週二 7/21 之前）。7/16 這筆自然產出時標對了，7/15 那筆（7/15 稍早的 EOD tick
寫入，早於當晚 7/14 回補 apply）沒有被回填更新——證實 Jason 先前筆記提到的「每日 NAV row 寫入時沿用
寫入當下的 basket week、事後回補不會反向更新舊列的 weekNum 標籤」機制成立。純觀察記錄，不影響
equity/returnPct 數值本身正確性，不擋今日 gate。

## 5. F-AUTO NAV 今日是否用 7/16 durable close — PASS

`navCurve` 2026-07-16 列 `pricingQuality:"official"`（非 `mis_fallback_full`/`stale`），`source:"live_eod"`
——確認今晚 NAV 用的是今日 durable 收盤價鏈路（跟第 1 項同一份證據），缺價病未復發。

---

## 意外與未解決事項

- 派工訊息估計查證時間「~15:2x TST」，實際查證時已 18:5x TST（`date -u` 換算），EOD 窗早已自然結束，
  本次為窗後一次性核對非窗中輪詢——如實記錄此時間落差，未影響驗證有效性（today_eod 產出時間戳本身
  落在窗內，非事後補算）。
- TPEX 側連續兩個交易日（7/15、7/16）皆因上游 `daily_close_quotes` date mismatch 被 skip，OTC 持倉
  （6182/2061/4556）持續走 MIS fallback——非本輪新問題，佇列給 Jason（P2，非 gate）。
- 第 4 項 weekNumRecorded 標籤不一致（見上）留給 Jason 排查是否要補一支「回填時同步更新舊列標籤」
  的小工具，本輪僅記錄不修復（不越權碰 ledger 寫入邏輯）。

---

## 給 Elva 的 #1164 升格建議

今日（放寬窗尾至 16:00 後的首個交易日）EOD report/NAV/weeks 全鏈自然產出、無需人工 apply、連續性
sanity 正常，證據面達成 #1164 升格所需的「自然產出可信」條件。建議 Elva 據此裁決；本報告只提供
唯讀驗證證據，升格決策仍由 Elva/楊董定案。
