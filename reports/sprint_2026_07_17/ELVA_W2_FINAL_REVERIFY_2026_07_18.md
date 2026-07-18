# Elva 最終複驗 — #1302 + #1303 prod 收口（2026-07-18 21:4x TST，週六盤休）

**驗證人**: Elva（fresh owner login，零 storageState 重用）
**環境**: prod（app.eycvector.com / api.eycvector.com）
**API buildCommit**: `6fd577c3`（= origin/main tip，含 #1302 `b52c5d75` + #1303 `6fd577c3`）
**工具**: `packages/qa-playwright/scripts/elva-w2-final-reverify-20260718.mjs` + `elva-w2-iframe-check-20260718.mjs`（基於 Bruce w2 腳本，加 settings CTA 與 iframe 內部量測）

## 結果總表 — 6/6 PASS

| # | 項目 | 來源 PR | 判定 | 證據 |
|---|---|---|---|---|
| 1 | banner 日期統一（公司頁桌機/手機 + AI 推薦頁） | #1302+#1303 | **PASS** | 三處皆「顯示 07/17 (五) 收盤資料」，日期＝末交易日、星期正確（#1303 修的 date/weekday mismatch 未現） |
| 2 | VWAP 滾動 22 根窗 | #1302 | **PASS** | 公司頁 2330 VWAP 2,263.96 vs 收盤 2,290 ≈ −1.1%（修前累積全史算法偏 +286%） |
| 3 | market-intel 手機 390 橫向溢出 | #1303 | **PASS** | iframe 內部 `body.scrollWidth=390` ＝ viewport（修前 ~734）；`.row2` 算出單欄 358px |
| 4 | market-intel 新聞卡手機單欄 | #1302 | **PASS** | `.feedrow` computed `44px 256px`（=44px 1fr 堆疊版式）×10 卡；「為什麼重要」整句正常換行非細條 |
| 5 | settings 更新密碼 CTA | #1302 | **PASS** | computed `background: rgb(200,148,63)`（--gold）`color: rgb(8,11,16)`（--night）opacity 1，實圖為亮金主 CTA |
| 6 | apiGetMe 誠實化 | #1302 | **PASS（正向路徑 prod 實證＋負向路徑 CI spec 覆蓋）** | owner 正常 session 五頁全 200 無誤鎖；「session 失效→請重新登入」負向態不在 prod 人為觸發，由 `jim_apigetme_honesty_20260718.spec.ts` 在 CI 驗 |

截圖＋bodytext＋JSON 在 session scratchpad `reverify/`（company2330 桌機/390、airec、market_390、market_390_iframe、settings_account 共 6 圖）。

## 順手發現（記佇列，非本批回歸）

1. 🟡 **側欄 MARKET INTEL 健康 widget 印內部 dataset id**：「資料健康：資料延遲：`official_daily_index`」直接渲染工程 id——踩「UI 禁工程語意」鐵律。應換人話（如「官方日線指數」）。
2. 🟡 **同 widget 週六顯「資料延遲」待判**：7/18（六）非交易日，末交易日 7/17 資料在架上；stale 判定是否未接台股交易日曆（週末誤報延遲）需查 — 若是，同款病根與 banner 日期案同族。

## 判定

**#1302 + #1303 正式收口**。7/17→18 超長 session 的 WAVE2 驗證債清償完畢。
