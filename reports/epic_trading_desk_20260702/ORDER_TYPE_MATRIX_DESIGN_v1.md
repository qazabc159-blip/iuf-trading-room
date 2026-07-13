# 台股下單能力完整矩陣 — 設計 spec v1（2026-07-13 楊董令「一次做到最好」）

Owner: Elva｜楊董原話：「台股交易台有很多種買法，整股 ROD/IOC/FOK、盤中零股、盤後零股，這些你都要安排進去……你自己看清楚還有沒有類似基礎問題你沒考慮設計進去」

## 0. 現況盤點（誠實）
`orderCreateInputSchema`（`packages/contracts/src/broker.ts`）目前只有：`side / type(market|limit|stop|stop_limit) / timeInForce(day|rod|ioc|fok|gtc) / quantity / quantity_unit(SHARE|LOT) / price / stopPrice`。
KGI adapter 層（`kgi-contract-rules.ts`）**已有** `TICK_SIZE_TIERS`（升降單位）與 `odd/cash/margin/short` 標籤，但**這些沒上到 unified 下單契約與 UI**。V51 runner 下單時硬寫 `orderCond:"Cash"`。

## 1. 楊董點名的缺口
| 買法 | 現況 | 缺口 |
|---|---|---|
| 整股 ROD / IOC / FOK | TIF 三值都在 schema | ❌ **市價單 TIF 約束沒做**：台股市價單只能 IOC/FOK，禁 ROD；限價才三選一。目前 schema 放行 market+rod（無效組合） |
| 盤中零股 | quantity_unit=SHARE 可表零股 | ❌ 沒有 session 維度區分「盤中零股(09:10–13:30 逐筆)」；下單路由/撮合規則不同 |
| 盤後零股 | 同上 | ❌ 「盤後零股(13:40–14:30 集合競價)」未建模；TIF 僅 ROD |

## 2. 我額外查出的同級基礎缺口（楊董要我自己找的）
1. **委託種類 orderCond 完全缺**：現股/融資(買)/融券(賣)/現股當沖 — unified 下單路徑無此欄位，UI 無法指定。這是台股最核心的下單屬性之一。
2. **盤後定價交易**（14:00–14:30 以收盤價成交）未建模。
3. **升降單位(tick)未在下單端強制**：KGI 層有 tier 表，但 entry/UI 不 snap、不擋非法檔位價 → 交易所會退。整股與零股 tick 不同帶。
4. **漲跌停 ±10% 未在下單端擋**：限價超出當日漲跌停 → 交易所退；需前收參考價。
5. **改量 reduce-only 規則**：台股改量只能減不能增，改價=刪單重下；現行 cancel 流未表達此約束。
6. **時段 gating 誠實標示**：下單當下不在該類別交易時段（如盤後才想送整股）→ UI 要誠實標，不是靜默接。
7. **融券/當沖資格與券源**：paper 可模擬，但要標「模擬，未檢核資格/券源」。

## 3. 目標契約（schema 擴充，全 additive 向後相容）
`orderCreateInputSchema` 新增：
```
orderCond:   z.enum(["cash","margin","short","daytrade"]).default("cash")
session:     z.enum(["regular","intraday_odd","afterhours_odd","afterhours_fixed"]).default("regular")
```
`type` 保留 market|limit（stop/stop_limit 台股交易所無原生對應，標為「本地觸價，非交易所單」或先隱藏）。
`quantity_unit` 與 `session` 的關係：session≠regular 時強制 SHARE 語意；規則見 §4。

## 4. 驗證規則（Zod refinement + 共用 lib，backend 權威、UI 先擋一層）
1. **市價 TIF**：`type==="market"` → `timeInForce ∈ {ioc,fok}`，否則 400 `MARKET_ORDER_TIF_INVALID`。
2. **零股 TIF**：`session==="afterhours_odd"|"afterhours_fixed"` → 只允許 rod（集合競價）；`intraday_odd` → 允許 rod/ioc/fok。
3. **tick**：限價須落在 `getTickSize(refPrice)` 檔位上（零股用零股 tier）；不合法→400 `PRICE_TICK_INVALID`（附最近合法價供 UI snap）。
4. **漲跌停**：限價須落在 `refPrice × (1±0.10)` 圓整到 tick 的區間內；超出→400 `PRICE_LIMIT_EXCEEDED`。refPrice 來源＝quote_last_close 前收（缺價則 skip 此檢查並標）。
5. **session × orderCond**：零股不支援融資融券當沖 → `session≠regular` 且 `orderCond≠cash` → 400 `ODD_LOT_CASH_ONLY`。
6. **數量**：regular 整股須整張（qty%1000==0，除非明確零股 session）；零股 1–999 股。
7. **改量 reduce-only**：cancel/modify 流增 `modifyQty` 只允許 < 原量；改價一律 cancel+new。

## 5. 切片（每片獨立 PR、可獨立驗收；backend 先於 UI）
- **T-1 契約＋驗證（backend, Jason）**：schema 擴充 orderCond/session＋上述 7 條 refinement 抽共用 `order-rules.ts`（複用 kgi-contract-rules 的 tick/lot）＋單元測試矩陣（每條 valid/invalid）＋paper adapter 認得新欄位並在回報標「模擬未檢核資格」。**不動真金鎖檔**（KGI live 下單路徑的 orderCond 對映屬 Phase 4，本片只做 paper + SIM 送單參數傳遞）。
- **T-2 KGI SIM 送單對映（backend）**：把 orderCond/session 對映到 KGI gateway createOrder 參數（Cash/Margin/Short/DayTrade、盤中/盤後零股 flag），SIM 通道驗證。
- **T-3 下單面板 UI（frontend, Jim/Codex iframe lane）**：整股/盤中零股/盤後零股/盤後定價分頁 or 選擇器＋現股/融資/融券/當沖＋限價市價＋ROD/IOC/FOK，非法組合即時灰掉、tick snap、漲跌停標示。產品級繁中文案、零工程字串、CRT/HUD 視覺。
- **T-4 委託回報擴充**：回報表顯示 orderCond/session/TIF，撤單/改量遵 reduce-only。

## 6. 驗收
每片：真瀏覽器 iframe 驗＋截圖／完整 CI 含 Playwright／驗證規則矩陣測試全綠／楊董實際下一輪各類別 paper 單＝最終驗收。真金下單路徑一律不動（Phase 4 鎖）。
