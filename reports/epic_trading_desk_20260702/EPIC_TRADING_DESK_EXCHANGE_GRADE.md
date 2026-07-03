# EPIC: 交易台「交易所級」改造（2026-07-02 楊董令）

**Owner**: Elva（TR）／前端主力 = Codex（Frontend Real-Data Owner）
**楊董原話**: 「把交易台弄成像交易所一樣完美」
**視覺基準**: CRT phosphor/amber + HUD 高密度 + ticker tape（板規視覺識別）

## 現況（誠實盤點）
- 交易台 = 舊 paper room iframe（`ui-final-v031`），#1110/#1128 加了 broker strip + 券商選擇器，但整體仍是單券商 paper 骨架。
- 下單流有兩條（紙上單 + KGI SIM 送單流），#1127 後端已按帳號路由，前端未統一。
- UTA 多帳號（/uta/accounts）後端 live（#1113/#1143/#1144 配對鏈全通），交易台前端沒接。
- K 線/指標經 5/31-6/2 hardening 可用；五檔（MIS）在公司頁/quote 有，交易台內密度不足。
- Real order 鎖在 Phase 4（不動）。

## Slices（每片獨立 PR、可獨立驗收）
1. **S1 統一下單流**：廢雙 ticket，單一下單面板按 active 帳號路由（paper→模擬單／kgi→SIM 通道／富邦→即將開放），委託確認、錯誤文案產品級。
2. **S2 接 UTA 多帳號**：帳號選擇器接 `/uta/accounts`（含 gatewayStatus 徽章），與 #1128 券商列合併成一條「帳號帶」。
3. **S3 盤口密度**：五檔+內外盤比+分時明細（tick tape）三欄所級排版，tabular-nums、紅漲綠跌、鍵盤快捷（上下選檔、Enter 帶入價格）。
4. **S4 委託/成交回報面板**：當日委託表（狀態流轉即時刷新）、成交回報、可撤單（SIM）。
5. **S5 Ticker tape + 自選聯動**：頂部跑馬燈接自選清單真報價，點擊切換主圖商品。

## 驗收標準（每片）
- 真瀏覽器 iframe 層級驗（frameLocator，#1102 教訓）+ before/after 截圖
- 完整 CI 含 Playwright；零工程字串；繁中產品文案
- 楊董盤中實際用一輪 = 最終驗收

## 執行順序與人力
- Codex 交完 gateway 配對 UX（進行中）→ 接 S1+S2（同 iframe lane 避免撞檔）
- S3 盤口密度可與 S1 並行（不同元件）— 下一個空檔的 Jim
- S4/S5 依 S1 完成後排
