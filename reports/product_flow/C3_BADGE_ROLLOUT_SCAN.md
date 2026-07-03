# C-3 DataStateBadge 全站待替換位置掃描清單

**產出**：Jim，2026-07-04（feat/decision-flow-c3-c4-jim-20260704）
**依據**：`reports/product_flow/DAILY_DECISION_FLOW_DESIGN_v1.md` §5 四態誠實詞彙表
**範圍**：`apps/web/app/**`（grep 掃描，只列位置，不動手改）
**方法**：`rg` 關鍵字 = `載入中|讀取中\.\.\.|資料更新中|Loading\.\.\.|資料尚未|尚無資料|尚未取得|暫無資料|暫時無法讀取|資料延遲|收盤資料|今日收盤|資料截至|略舊|偏舊`

本輪（C-3）示範採用兩處（見下方「已示範採用」），本清單是**其餘位置**，供之後逐頁替換排優先序，本身不改任何行為。

---

## 分類 1 — 「載入中…」永駐風險（灰態，應改「尚無資料：<原因>」，禁止永駐 loading）

| 檔案:行號 | 現況文案 |
|---|---|
| `apps/web/app/m/MobileKgiWatchlist.tsx:189` | `<div className="_mob-kgi-vol">載入中…</div>` |
| `apps/web/app/themes/wiki/[name]/page.tsx:315` | `<span className="_wk-spin" /> 資料載入中...` |
| `apps/web/app/ops/f-auto/FAutoSimPanel.tsx:950` | `<div className="_fauto-panel-loading">資料載入中…</div>` |
| `apps/web/app/ops/f-auto/FAutoNavPanel.tsx:426` | `<div className="_fnav-state">NAV 曲線載入中…</div>` |
| `apps/web/app/companies/ThemesRadarTab.tsx:77` | `<p style={footerStyle}>讀取中...</p>` |
| `apps/web/app/settings/broker/broker-connections.tsx:313` | `<div>讀取中...</div>` |
| `apps/web/app/admin/events/page.tsx:540` | `{streamsLoading && <div className="_ev-empty">載入中…</div>}` |
| `apps/web/app/admin/events/page.tsx:608` | `{eventsLoading ? "載入中…" : ...}` |
| `apps/web/app/admin/team/page.tsx:799` | `<PageFrame ... note="載入中…">` |

**風險**：這些字串目前多半只在初次 fetch 的短暫瞬間出現（不算「永駐」），但沒有一致的「拉太久=無資料+原因」升級路徑；換 `<DataStateBadge state="empty" reason="..." />` 可統一「短暫載入」跟「真的沒資料」的視覺分野。

## 分類 2 — 收盤日期標示寫法不一致（close 態，應統一「MM/DD 收盤」用資料自身日期）

| 檔案:行號 | 現況文案 |
|---|---|
| `apps/web/app/page.tsx:462` | `taipeiDate(updatedAt) === todayTaipeiDate() ? "今日收盤" : "昨日收盤"` |
| `apps/web/app/page.tsx:2222` | `「暫顯 TWSE 收盤資料」`（無日期） |
| `apps/web/app/quote/page.tsx:268` | `` `（${d} 收盤資料）` ``（已用資料自身日期，符合 §5，可直接套皮） |
| `apps/web/app/quote/page.tsx:338` | `` `顯示 TWSE ${d} 收盤資料，非今日即時行情。` ``（同上，符合精神） |
| `apps/web/app/quote/page.tsx:361` | `"今日收盤"`（LegacyKgiRealtimePanel，未帶日期 — §5 禁止「今日收盤」配舊資料的風險點） |
| `apps/web/app/companies/[symbol]/CompanyHeroBar.tsx:280-285` | 已有註解提醒「不能對昨日價格宣稱今日收盤」，用 `"收盤資料"` 泛用字 |
| `apps/web/app/companies/[symbol]/page.tsx:447` | `realtimeQuote?.state === "CLOSE" ? "今日收盤" : "略舊"`（同 quote/page.tsx:361 風險） |
| `apps/web/app/components/industry-heatmap.tsx:822` | `sourceState === "twse_eod" ? "收盤資料" : ...` |

**風險**：`quote/page.tsx:361` 與 `companies/[symbol]/page.tsx:447` 寫死「今日收盤」不帶日期，是 §5 明確禁止的模式（今日收盤配舊資料）；換 `DataStateBadge state="close" asOf={...}` 可強制帶日期。

## 分類 3 — 「暫時無法讀取」錯誤/延遲文案（大量，多半走 `friendlyDataError()` 共用 helper）

這一批已經有共用 helper（`apps/web/lib/friendly-error.ts` 的 `friendlyDataError()`），文案風格已算一致，但視覺上多半是純文字 `<p>`／`<div>`，沒有跟 §5 的「延遲/部分」琥珀色態綁定。約 30 個呼叫點，代表性位置：

| 檔案:行號 |
|---|
| `apps/web/app/quote/page.tsx:215,231,247,250,428,431,478` |
| `apps/web/app/companies/[symbol]/page.tsx:77,147,155,307,333` |
| `apps/web/app/companies/[symbol]/AnnouncementsPanel.tsx:292` |
| `apps/web/app/companies/[symbol]/ChipsPanel.tsx:172` |
| `apps/web/app/companies/[symbol]/BidAskPanel.tsx:86` |
| `apps/web/app/companies/[symbol]/CoverageKnowledgePanel.tsx:228` |
| `apps/web/app/companies/[symbol]/IndustryGraphPanel.tsx:370` |
| `apps/web/app/companies/[symbol]/FullProfilePanels.tsx:689,816` |
| `apps/web/app/companies/[symbol]/MarginShortPanel.tsx:95` |
| `apps/web/app/companies/[symbol]/InstitutionalPanel.tsx:81` |
| `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx:1616,1619` |
| `apps/web/app/companies/[symbol]/LiveTickStreamPanel.tsx:102` |
| `apps/web/app/companies/CompanyGraphTab.tsx:106,157` |
| `apps/web/app/companies/duplicates/page.tsx:7,288` |
| `apps/web/app/settings/broker/page.tsx:139,150` |
| `apps/web/app/settings/subscription/page.tsx:163` |
| `apps/web/app/plans/page.tsx:95` / `signals/page.tsx:31` / `themes/page.tsx:18` / `themes/[short]/page.tsx:79` |
| `apps/web/app/runs/[id]/page.tsx:57` / `briefs/[id]/page.tsx:76,430` / `reviews/page.tsx:200,263` |
| `apps/web/app/m/page.tsx:79,381` / `m/kill/page.tsx:37` / `ops/page.tsx:43` |
| `apps/web/app/admin/content-drafts/[id]/page.tsx:328` / `admin/content-drafts/page.tsx:376` |
| `apps/web/app/admin/uta/accounts/page.tsx:293,313` |
| `apps/web/app/ai-recommendations/page.tsx:238` |

**建議**：不建議逐一換成 badge（大部分是段落級錯誤說明，不是狀態徽章的位置），但新增/改版頁面遇到同類情境時，優先用 `DataStateBadge state="delayed"` 取代自由格式 `<p>`。

## 分類 4 — 略舊/偏舊/stale 用字不統一（delayed 態）

| 檔案:行號 | 現況文案 |
|---|---|
| `apps/web/app/quote/page.tsx:69,80,361,393` | `"偏舊"` / `"優先資料偏舊"` / `"略舊"`（同頁兩種字混用） |
| `apps/web/app/companies/[symbol]/page.tsx:447` | `"略舊"` |
| `apps/web/app/companies/[symbol]/MarginShortPanel.tsx:121` | `" (略舊)"` |
| `apps/web/app/companies/[symbol]/InstitutionalPanel.tsx:107` | `" (略舊)"` |
| `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx:441` | `"資料偏舊 / ${last.dt}"` |

**風險**：同一個 `/quote` 頁面同時出現「偏舊」與「略舊」兩種字（69/80 行 vs 361/393 行），是最直接的「各頁各講各的」案例，適合優先排入下一輪替換。

## 分類 5 — 已符合 §5 精神、可直接套用配色（低風險示範候選）

| 檔案:行號 | 備註 |
|---|---|
| `apps/web/app/ai-recommendations/source-mode-label.ts:8` | `if (!hasData) return "尚無資料";`（已是空狀態誠實文案，缺配色標準化） |
| `apps/web/app/components/industry-heatmap.tsx:822-902` | `staleDotLabel`/`isNoData` 已有 3 態邏輯（收盤資料/暫無資料/公開資料更新中），是全站最接近 §5 的既有實作，建議下一輪優先改採 `DataStateBadge` |
| `apps/web/app/reviews/WeeklyReviewPanel.tsx:170` | `"本週尚無加權指數收盤資料"`（empty 態格式已對） |

---

## 已示範採用（本輪 C-3，行為不變只換呈現）

| 檔案:行號 | 說明 |
|---|---|
| `apps/web/app/ops/f-auto/FAutoSimPanel.tsx:1139-1144` | 「資料截至」徽章改用 `<DataStateBadge state="close" label="..." />`，文字不變，只換視覺（border+background+色點），既有 vitest 斷言 `資料截至`／`dataAsOf` 字串不變 |
| `apps/web/app/quote/page.tsx` `KgiRealtimePanel` | 「報價不可用」badge 改用 `<DataStateBadge state="empty" label="報價不可用" />` |

## 下一輪建議優先序
1. 分類 4（略舊/偏舊混用）— 影響最直接、範圍小（5 處）。
2. 分類 5 的 `industry-heatmap.tsx` — 既有 3 態邏輯最接近，改起來風險低。
3. 分類 2 的 `quote/page.tsx:361` + `companies/[symbol]/page.tsx:447`（「今日收盤」不帶日期）— 屬於 §5 明確禁止的模式，優先度高但涉及既有 Playwright freshness-badge 測試選定的 `FreshnessBadge` 元件，需先確認 `DataStateBadge` 與 `FreshnessBadge` 的分工（後者是報價專用 5 態、含 live-pulse 動畫；前者是全站通用 4 態）再決定要不要合併，避免重工。
