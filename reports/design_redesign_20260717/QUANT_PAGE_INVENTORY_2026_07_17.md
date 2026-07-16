# QUANT 頁原版盤點 — 2026-07-17

**驗證者**: Bruce（verifier/release lane）。**性質**: 純唯讀蒐證，未改任何產品代碼。
**Ground truth 依據**: `IUF_QUANT_LAB/reports/trading_room/QUANT_PAGE_GROUND_TRUTH_2026_07_17.md`（Athena，已讀取全文，見下方逐區對照）。
**蒐證方式**: owner session（`packages/qa-playwright/storageState.json`）+ headless Chromium 1920×1400、
`--force-device-scale-factor=1`，全部打 **prod** `https://app.eycvector.com`（非本地/非 fixture）。截圖時間戳見圖內
右上角「台北 / 2026/7/17 00:1x」。代碼引用一律 `git show origin/main:<path>`（本地 tree 落在
`feat/fauto-sim-ledger-phase1-jason-20260701` 分支且有未 commit 改動，未動主 tree）。

## 產物清單（本目錄）
- `quant_strategies_list_1920.png` / `quant_strategies_list_innerText.txt` — `/quant-strategies`（S1 策略 tab，預設）
- `quant_strategies_subscriptions_1920.png` / `quant_strategies_subscriptions_innerText.txt` — `/quant-strategies?tab=subscriptions`
- `quant_strategy_detail_1920.png` / `quant_strategy_detail_innerText.txt` — `/quant-strategies/cont_liq_v36`（唯一 strategy id，見下方「謊點」#1）
- `ops_f_auto_1920.png` / `ops_f_auto_innerText.txt` — `/ops/f-auto`（側邊欄「F-AUTO SIM / S1 持倉／損益」，與量化策略頁共用同一條 S1 敘事，一併盤點）
- `_debug_strategy_href.txt` — 確認 detail route 真實 href

---

## 一、逐區盤點表

### A. `/quant-strategies`（S1 策略 tab，預設進入頁）

| 區塊 | 顯示內容 | 資料來源（代碼） | 現況值（實測） |
|---|---|---|---|
| 頁頭 | 標題「量化策略」／副標「S1 F-AUTO / KGI SIM」／note「目前正式產品只開 S1。其他研究策略先留在 Lab，不混進正式量化頁。」 | `apps/web/app/quant-strategies/page.tsx` L200-202（PageFrame props） | 靜態文案，無條件渲染 |
| Tabs | 「S1 策略」／「資金配置紀錄」／「開啟 F-AUTO 持倉與損益」(→`/ops/f-auto`) | `page.tsx` L262-269 | 靜態 |
| Panel 標題 | 「S1 F-AUTO」／「唯一正式量化策略，接 KGI SIM 觀察線」 | `page.tsx` L274 | 靜態 |
| 防呆 banner | 「僅模擬資金防呆」／說明資金寫入 S1 runner | `page.tsx` L275-277 | 靜態 |
| 策略卡 — 名稱 | **shortName「S1」／name「S1 連續動能流動性策略」** | `strategy-data.ts` L70-76 `QUANT_STRATEGIES[0]`，`id: "cont_liq_v36"` | 硬編碼單一物件，非陣列渲染多策略 |
| 策略卡 — role/cadence | 「F-AUTO KGI SIM 觀察主策略」／「每週二 08:30 產生訊號、09:00-09:20 送出 SIM」／「最新 8 檔」 | `strategy-data.ts` L77-79，動態 basketSize 來自 `hydrateQuantStrategy` | 實測：`最新 8 檔` |
| 策略卡 — F-AUTO 實盤模擬 | 「S1 F-AUTO 實盤模擬（含成本）+3.07%」 | `live-strategy-data.ts` `getTrackRecordNav()` → `/api/v1/track-record/nav`；`strategy-data.ts` L279 `realSimReturnPct` | 實測 **+3.07%**（與 `/ops/f-auto` NAV 累計報酬一致，交叉核對 OK） |
| 策略卡 — 產品狀態 | 「僅開放 S1」／「目前正式量化只開 S1，不再混入其他研究策略」 | `page.tsx` L149-152（硬編碼字串，非資料驅動） | 靜態 |
| 策略卡 — SIM 資金 | 「10,000,000 TWD」／「最新訂閱設定」 | `getS1SimStatus()`，`capitalSourceLabel()` | 實測 1000萬 TWD |
| 策略卡 — 命中率/回撤 | 「命中率(研究回測) +92.31%」／「最大回撤 -10.51%」 | `getLabStrategySnapshot("cont_liq_v36")` → `metrics.hitRatePct/maxDrawdownNetPct` | **資料源函式呼叫硬編碼字串 `"cont_liq_v36"`**（`live-strategy-data.ts` L30, L38），非變數化 strategy id |
| 研究窗揭露 | 「研究回測．未經驗證／歷史回測（未經驗證）...研究窗 2025-04-10 ~ 2026-03-06...共同窗...為三策略共用比較基準窗口」 | `TrackRecordDisclosure` component，`headlineDisclosureZh` | 文字本身提到「三策略共用比較基準窗口」——暗示過去曾有 three-strategy 比較框架殘留措辭 |
| CTA | 「設定 S1 SIM 資金」→ `/quant-strategies/cont_liq_v36` | `page.tsx` L184 `Link href={"/quant-strategies/" + strategy.id}` | route 直接曝露 legacy id |

### B. `/quant-strategies?tab=subscriptions`（資金配置紀錄）

| 區塊 | 顯示內容 | 資料來源 | 現況值 |
|---|---|---|---|
| Panel 標題 | 「S1 資金配置紀錄」／「讀取最新一筆模擬資金設定紀錄」 | `QuantSubsPanel.tsx` | 靜態 |
| 說明 | 「已讀取 8 筆後端設定紀錄。系統只會套用最新一筆 S1 策略配置，不會把舊研究策略混入正式產品」 | `QuantSubsPanel.tsx` | 實測 8 筆 |
| **策略卡片** | 名稱「S1 連續動能流動性策略」／狀態「已配置」／**原始 id「`cont_liq_v36`」逐字顯示**／最新資金 1000萬／寫入時間 2026/06/01 18:48／紀錄數 8 | `QuantSubsPanel.tsx` L169 `<div style={strategyIdStyle}>{summary.strategyId}</div>` | **🔴 工程語意直接洩漏到 UI**（違反產品鐵律「UI 禁工程語意/enum/debug 字串」） |

### C. `/quant-strategies/cont_liq_v36`（策略詳情頁，唯一存在的 strategyId route）

| 區塊 | 顯示內容 | 資料來源 | 現況值 |
|---|---|---|---|
| Topbar | 標題「S1 連續動能流動性策略」／狀態列（狀態/最新basket/研究樣本） | `[strategyId]/page.tsx` | 狀態＝`最新2026-07-14 basket：sideways/50%曝險/8檔`；研究樣本 13 |
| 頁內宣稱 | 「S1 是目前唯一正式量化策略。本頁的資金設定會接到後端 S1 runner；其他研究策略先不放進正式產品頁」 | `StrategyDetailClient.tsx`（靜態文案） | 靜態 |
| 策略邏輯 | 4 條 bullet，含「目前 Trading Room 正式量化只開 S1」 | `strategy-data.ts` `logic[]` | 靜態 |
| 觀察指標(研究回測) | 研究期淨值曲線 +400.89%／相對0050 +305.64%／Sharpe 3.03／最大回撤 -10.51%／命中率 +92.31%／再平衡樣本 13 | `getLabStrategySnapshot("cont_liq_v36")` | 全走 legacy id 快照 |
| 研究曲線 | Forward observation curve +222.02% / Monthly returns | `snapshot.equityCurve` | — |
| 預估配置預覽 | 8 檔 table（代號/名稱空白--/權重/basket價格/說明） | `getS1SimBasket()` | **名稱欄全部顯示「--」**（另一個資料缺口，非本次謊點主題但值得記） |
| 部位與風控／限制與下一步 | 靜態文字 | `strategy-data.ts` `riskControls[]`/`caveats[]` | 靜態 |
| S1 SIM 資金配置（寫入表單） | Capital TWD 輸入＋8 檔預估股數／確認勾選／「寫入 S1 SIM 資金」 | `StrategyDetailClient.tsx` | 唯讀蒐證未觸發寫入 |

### D. `/ops/f-auto`（F-AUTO SIM 觀察台，側邊欄「S1 持倉／損益」連過來，同一敘事面）

| 區塊 | 顯示內容 | 現況值 |
|---|---|---|
| 頁頭 | 「F-AUTO SIM 觀察台」／「KGI SIM / S1 策略」 | 靜態 |
| KGI SIM 連線狀態 | 登入/下單/報價／「排程關機中」（EC2 gateway 平日08:20開14:10關） | 實測：查證時段確為排程關機窗，屬正常 |
| 自動交易觀察總覽 | 配置資金 1000萬／總資產(估) 1000萬／現金水位 550.89萬／未實現損益 +$306,750 (+3.07%) | 與量化策略頁 F-AUTO 實盤模擬 +3.07% 一致 |
| NAV-CURVE | 「S1 F-AUTO SIM · 6/2起 · 週Rebalance」／W1-W7 逐週表／累計報酬(含成本) +3.07%／累計已實現損益 -$211,562 | 7 週資料完整 |
| SIM-POS / SIM-FUND | 「持久化部位」／「配置資金/部位估值」 | **兩區塊皆顯示「資料載入中…」**（截圖當下未 resolve，可能是非交易時段或元件本身的載入態卡住，需另查非本次任務範圍） |
| S1-STAT | S1 策略狀態（自動排程/訊號排程/委託排程/市場態勢/曝險比重等） | 完整 |
| S1-BASKET | 2026-07-14 訊號籃 8 檔 table | 完整，含 `capital_source:latest_subscription subscription:e54388d0-...` 稽核字串（工程語意，但此區塊定位為稽核明細非行銷面，爭議較小） |
| S1-EOD | 「2026-07-17 當日無 EOD 報告」 | 實測（查證時段為當日盤中/盤前，尚未產生當日 EOD 合理） |
| SMOKE-7D | 近7日健診歷程 table，07/12、07/11 兩天「未通過」（gateway 無法連線） | 實測 |

---

## 二、謊點清單（對照 Athena Ground Truth 逐條核對）

| # | 謊點 | 位置 | Ground Truth 判準 | 嚴重度 |
|---|---|---|---|---|
| 1 | **策略 id 硬編碼為 legacy `cont_liq_v36`**，全站唯一策略卡、唯一 detail route、資料抓取函式呼叫全部寫死這個字串 | `strategy-data.ts` L70, `live-strategy-data.ts` L30/L38, route `/quant-strategies/cont_liq_v36` | GT §2：「three-strategy / cont_liq / Class5 → LEGACY_SUPERSEDED...這些舊名詞不得再出現在產品頁」 | 🔴 高 — 品牌/id 錯位，非只是措辭 |
| 2 | 「S1 是目前唯一正式量化策略」／「僅開放 S1」／「目前正式量化只開 S1」反覆出現 5+ 處 | list 頁 banner、卡片、detail 頁 topbar 說明 | GT §2：S1 已於 7/1 降級 `FORWARD_OBSERVATION`（過擬合、DSR深FAIL、真金真值 −7.36%）；GT §3.5 只准說「S1 已降級為過擬合案例」，不准「S1 是現行主打」 | 🔴 高 |
| 3 | 「S1 F-AUTO 實盤模擬（含成本）+3.07%」headline 數字裸秀，無 GT §3 要求的「L9 SPA 降級/不穩健」連帶揭露 | list 頁卡片、detail 頁、/ops/f-auto | GT §3.1「不得展示未經 L9 註記的 Sharpe／年化報酬單獨數字」（此為 F-AUTO 非 V5-1，但同一治理精神——本頁把 F-AUTO SIM P&L 與 S1 名稱綁死，GT §3.4 明講「不得把 F-AUTO P&L 冠 S1 之名」） | 🔴 高 — 直接踩 GT §3.4 紅線 |
| 4 | 資金配置紀錄頁把原始內部 id `cont_liq_v36` **逐字**顯示在 UI（非僅 URL） | `QuantSubsPanel.tsx` L169 `strategyIdStyle` div | 產品鐵律「UI 禁工程語意/enum/debug 字串」（CLAUDE.md 產品鐵律段） | 🟡 中（獨立於策略正確性問題之外的既有規範違反） |
| 5 | 全站找不到 V5-1／V3-4／v34 shakedown／真金 pilot 任何蹤影——GT §1 列的 4 條「真實在跑」中，本頁只反映其中一條（且掛錯名） | 全頁盤點 | GT §4 IA 建議「今日在跑：4卡（V5-1/V3-4-pre/v34 shakedown/F-AUTO SIM）＋真金 pilot 倒數」 | 🔴 高 — 缺失非僅措辭而是整體資訊架構落後 |
| 6 | 找不到「研究進行中」「已研究但終判死」「治理承諾」任何區塊——GT §2 列的 15+ 條 KILL/降級案完全未揭露 | 全頁盤點 | GT §4 建議第3/4/5區塊 | 🟡 中（屬新增缺口非「說謊」但列入對照供重設計參考） |
| 7 | 全站無任何頁首/卡尾免責標語提及「未通過 L10 forward confirmation」 | 全頁盤點 | GT §3 全站免責標語（強制） | 🟡 中 |

---

## 三、保留／改寫／刪除／新增 對照表

| 內容 | 建議 | 理由 |
|---|---|---|
| S1 F-AUTO 實盤模擬 +3.07%（NAV 曲線＋週summary，`/ops/f-auto` 全部） | **改寫**：保留數字與圖表（唯一有真金級稽核紀錄的引擎），但敘事改為 GT §3.5「S1 已降級為過擬合案例，此為反面教材揭露」，且移除「S1 是唯一正式量化策略」措辭 | GT §3.5 允許揭露 −7.36%／過擬合案例，唯一有真金真值的引擎不必砍，改包裝 |
| `cont_liq_v36` id（URL/UI 顯示） | **刪除**顯示、**改寫**底層路由用語意化 id（如 `s1-forward-observation`）；不改變已寫入的 audit log key（那是資料庫層，非本次盤點範圍） | 產品鐵律 + GT §2 legacy 名詞禁令 |
| 「僅開放 S1」／「唯一正式量化策略」全部措辭 | **刪除**，換成 GT §4 建議的「今日在跑 4 卡＋真金 pilot 倒數」IA | GT §1 明確列 4 條在跑（S1 不在其中，甚至已降級） |
| V5-1 / V3-4-pre / v34 shakedown / F-AUTO SIM 卡片 | **新增**（現況 0 卡） | GT §4 IA 第1區塊 |
| 已死策略研究紀律揭露區（S3 X2/S5/S6/Q1-Q3/V3-1..V4-5/close-auction/F-1/SSF/tick_cliff） | **新增**（現況 0） | GT §4 IA 第4區塊、GT §2 完整表 |
| 全站免責標語 | **新增**（現況 0） | GT §3 強制 |
| 資金配置紀錄頁「S1 SIM 資金配置」寫入功能（表單本體） | **保留**，功能正常且未涉及品牌措辭問題 | 純執行功能，非敘事層 |
| `/ops/f-auto` SIM-POS/SIM-FUND「資料載入中」 | **另案追查**（非本次謊點主題，列為附帶發現） | 可能為前端 loading state 未 resolve 的既有 bug，需開發者複查 |
| 預估配置預覽 table「名稱」欄全「--」 | **另案追查**（附帶發現，資料缺口非措辭問題） | 同上 |

---

## 附帶發現（非任務主題，供其他 lane 參考）

1. `/ops/f-auto` 的 SIM-POS／SIM-FUND 兩區塊在本次截圖時點顯示「資料載入中…」未 resolve；SMOKE-7D 07/11、07/12 兩天健診「未通過」（gateway 無法連線）。是否為既有已知問題未查證，僅列入盤點證據供交易台維護者對照。
2. 策略詳情頁「預估配置預覽」table 的「名稱」欄 8 檔全部顯示 `--`（股票代號有值），非本次盤點主題但屬資料完整性缺口。
3. Track record disclosure 文字提到「三策略共用比較基準窗口」，暗示過去 three-strategy 比較框架的殘留措辭，值得重寫時一併清理。

---

**未查證/範圍外**：登入牆前的公開可見程度（本次全程用 owner session 查看，未測試未登入使用者看到什麼——若有需要另開任務）；`/ops/f-auto` 資料載入中根因；後端 `quant_strategy.subscribe` audit log 的 `cont_liq_v36` key 是否可安全改名（屬資料庫遷移範圍，非本次唯讀盤點可判定）。
