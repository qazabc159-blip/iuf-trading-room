# 統一下單流設計 v1 — 交易台 epic 切片①（Fable 5 定版 2026-07-03）

**地位**：交易台 epic（EPIC_TRADING_DESK_EXCHANGE_GRADE.md）切片①②的實作依據；同時是 Fubon adapter 介面與 Phase 4 安全閘（`reports/phase4_safety_gate/PHASE4_SAFETY_GATE_SPEC_v1.md`）的接入軌道。實作者照 §4 切片逐 PR 執行。
**證據基礎**：Explore 實掃 origin/main（2026-07-03），檔案:行號皆實查非推測。

---
## §1 現況診斷（比板上認知更碎）

1. **三條 ticket 並存**：
   - iframe 紙上單：`apps/web/lib/final-v031-live.ts:2727-2803` → `/api/v1/paper/preview`＋`/api/ui-final-v031-paper/submit`
   - iframe KGI SIM 單：同檔 `:2805-2894` → paper/preview 預檢後打 `/api/v1/kgi/sim/order`（經 backend proxy allowlist）
   - **孤兒 React ticket** `apps/web/components/portfolio/OrderTicket.tsx`：有全站最好的確認 UX（`OrderReviewModal` :624-731、LOT 需勾 checkbox 二次確認）＋產品化錯誤詞彙表（`paper-order-vocab.ts`），但**零頁面掛載**（#866 後被 iframe 取代）；`SendToTicketButton.tsx:12` 還指向不存在的錨點。
2. **#1127 統一端點 `POST /trading/orders` 零前端呼叫端**；且對 kgi 帳號 `assertKgiSimOnly()` 無條件擋（`trading-service.ts:247-253`）→ 現在「統一管道」連 SIM 單都送不出去。
3. **委託回報三套讀法**：`/trading/orders`(GET)＋`/paper/orders`＋`/kgi/sim/orders`；`GET /uta/orders`（讀 `unified_orders` 表）有 client `getUtaOrders()` 但零呼叫端。
4. **`quantity_unit` 六處三種語意**（實掃表）：paper schema 必填無 default ✅（板規正身）；`orderCreateInputSchema` default **SHARE**；`/kgi/sim/order` default **SHARE**；`unified_orders` DB default **LOT**；ui-final-v031-paper proxy 缺欄位當 **LOT**；`/uta/orders` 根本沒這欄位（用 oddLot boolean）。**SHARE vs LOT = 1000 倍金額差，這是進真金前必須殺死的 bug 類。**
5. **KGI 錯誤裸洩工程字串**（`final-v031-live.ts:2877-2879` 直塞後端 message）；iframe 送單**無確認步驟**。
6. broker strip 吃 `/uta/adapters` 非 `/uta/accounts`（後者當時空的，`final-v031-live.ts:1256-1258` 註解自承）。
7. iframe 通訊=伺服器端 hydration 注入＋client fetch 兩層代理，**無 postMessage**（全 repo 零命中）— 改造要在 `final-v031-live.ts` 的 hydration script 層動手，不是 React 層。

## §2 設計裁決（六條，D1-D6）

**D1 單一管道**：前端唯一下單入口 = `POST /api/v1/trading/orders`。`/paper/submit`、`/kgi/sim/order` 降為內部/工具端點（保留不刪，F-AUTO 面板與腳本照用），前端代碼路徑退役。`backend/route.ts` POST_ALLOWLIST 加 `/trading/orders`。
**D2 通道抽象**：`submitOrder()` 按 `resolveBrokerKindForAccount` 分流到 channel adapter：
   - `paper` → `placePaperOrder`（現狀不動）
   - `kgi` → **新增 KGI SIM channel**：把 `assertKgiSimOnly`（無條件 throw）改為 `assertKgiSimChannel`，判準寫死：①`resolveKgiEnv()==="sim"`（`kgi-sim-env.ts:33-38` 既有函式，不自己讀 env）②沿用現行 `/kgi/sim/order` route 的其餘前置檢查原樣搬入（Owner 檢查在統一管道下改為帳號歸屬檢查）③gateway 側 sim session 驗證**不在 API 層重做** — 那是 L4 Gate2（`app.py` is_simulation）的職責。失敗語意：回 409 結構化 `{error:"kgi_channel_unavailable", reason:<code>}`，**不重試**（client 按 reason 顯詞彙表文案）。真單防線不減層：L2 env／L4 gateway 三閘／`KGI_READ_ONLY_MODE` 全部原樣，W6 六檢查不動。⚠️ `trading-service.ts` 是 hook 保護鎖檔。**hook 不在 repo 裡** — 位置是 harness 層 `C:/Users/User/.claude/hooks/protect_real_money_paths.py`（settings.json 掛 PreToolUse）。實作該 PR 時請楊董暫時註解 hook 內 `broker/trading-service.ts` 那行，merge 後加回；程序寫在 hook 檔頭註解。
   - `fubon` → 回 `channel_coming_soon` 結構化拒絕（UI 顯「即將開放」）。
   - **Phase 4 接點**：真金帳號走同一管道，`submitOrder` 在 channel 前插 G-KILL→G-LIMIT→G-AUTH 檢查鏈（安全閘 spec §3 順序），payload 加 `authorization_token` 欄位（僅真金帳號必填）。**epic 蓋的軌道（管道/狀態機/回報面板）Phase 4 直接插入零重工；UI 重工誠實範圍=確認 modal 對真金帳號多一個密碼重驗欄位**（token 由 modal 重驗步驟取得後隨 submit 帶出，非用戶手動輸入欄）。
**D3 狀態機**（對齊 `unified_orders` 既有 enum）：`draft →(preview: risk+gate+成本試算) confirm →(submit) pending → submitted → partial_fill → filled ∣ rejected ∣ cancelled`。**每筆單（含 paper）記一列 `unified_orders`，寫入順序與失敗語意寫死**（read-back 抓到的真金級缺口）：
   - **先記帳後送單**：`unified_orders` 列以 `status='pending'` 在呼叫 channel **之前**寫入；insert 失敗=整筆中止不送單（不存在「單送出去了帳本沒記」）。
   - channel 結果回來 → update 該列（submitted/rejected＋adapter_response）。送單成功但 update 失敗 → 列停在 pending → 對帳掃描收口（複用 `kgi-order-reconciliation.ts` 模式）＋告警，**永不自動重送**（對齊安全閘 spec §6 半單協議）。
   - `unified_orders` = source of truth；`paper_orders` 降為 paper channel 內部細節照寫（相容，不遷移）。切片④委託回報面板只讀 `GET /uta/orders`。
**D4 `quantity_unit` 定版**：全鏈 **REQUIRED、無 default、enum SHARE|LOT**。拔 `orderCreateInputSchema` 的 `.default("SHARE")`（現在零呼叫端=唯一無痛時機）；ui-final-v031-paper proxy 的「缺欄位當 LOT」三元運算刪除（缺=400）；`/uta/orders` 補欄位；DB column default 留（歷史列）但應用層永遠顯式寫。加 CI 測試斷言三個 schema 無 default。
**D5 確認流（v1.2 依楊董 7/3 裁決改）**：確認 modal **只給真金帳號**（paper/KGI-SIM 單直接送，維持現行速度）；modal UX 移植孤兒 `OrderTicket.tsx` 的 `OrderReviewModal`（全欄位＋notional 總額＋LOT 勾選二次確認＋真金密碼重驗欄位），真金流無逃生閥；錯誤呈現統一走 reason-code→`paper-order-vocab.ts` 中文映射，**後端 message 永不裸渲染**（未知 code→通用文案＋code 只進 log）。
**D6 帳號帶**（切片②）：選擇器改吃 `GET /uta/accounts`（含 gatewayStatus 徽章：unpaired/pending/reachable/paired_unreachable），與 #1128 broker strip 合併為一條；前置=帳號 seeding（每 workspace 保底 paper＋kgi-sim 兩列 `broker_accounts`，否則列表空的沒東西可選）；fubon 顯示為 disabled 即將開放；active 帳號記憶（localStorage）；`accountId` 隨單送出 — 分流已由 #1127 後端扛。

## §3 不變式（實作全程守住）

- 真單防線層數只增不減；W6 CI 綠是每個 PR 的硬條件。
- `quantity_unit` 無 default 落地後，任何新增下單相關 schema 一律必填（寫進測試）。
- iframe 層改動必過 Playwright frameLocator 真瀏覽器驗（#1102 教訓）＋before/after 截圖。
- 零工程字串進 UI（板規）。

## §4 實作切片（每片一 PR、可獨立驗收、順序即依賴序）

| PR | Lane | 內容 | 驗收（機器可判） |
|---|---|---|---|
| PR-1 | jason | D2 KGI SIM channel＋D3 dual-write＋D4 schema 定版＋D5 reason-code enum 補全 | ①kgi 帳號經 `/trading/orders` 送 SIM 單成功（tradeId 回）②非 sim env 仍硬擋（測試）③每單 `unified_orders` 有列 ④三 schema 無 default 測試綠 ⑤W6 綠。**動 trading-service.ts 前先請楊董解 hook** |
| PR-2 | jason | D6 帳號 seeding＋proxy allowlist 加 `/trading/orders`、`/uta/orders` | `GET /uta/accounts` 至少回 paper＋kgi 兩列；proxy 打通（iframe 內 fetch 200） |
| PR-3 | Codex | D1+D5 前端：iframe 雙 handler 合一 → 打 `/trading/orders`；錯誤詞彙表接線（**確認 modal 依 F2-O1 裁決移出本 PR，歸 Phase 4**） | ①單一 submit 路徑（grep 無殘留舊端點呼叫）②SIM 送單節奏不變（無新增確認步驟）③錯誤場景顯中文文案非 raw message ④截圖 |
| PR-4 | Codex | D6 帳號帶：`/uta/accounts`＋gatewayStatus 徽章＋broker strip 合併 | 徽章四態渲染（fixture）；切帳號後送單 payload 的 accountId 正確；fubon disabled |
| PR-5 | jim | 清理：刪孤兒 `OrderTicket.tsx`（UX 已移植後）＋修 `SendToTicketButton` 死錨點＋刪 proxy LOT-default | grep 零引用；vitest 全綠 |

依賴：PR-1→PR-2 可並行；PR-3 依賴 PR-1+2；PR-4 依賴 PR-2；PR-5 最後。
**已知過渡態**：PR-1 merge 後、PR-3 前，iframe 仍走舊路徑（含 KGI 錯誤裸字串 `final-v031-live.ts:2877-2879`）— 既有問題非新 regression，PR-3 一併收掉。全部 merge 後=epic 切片①②完成，切片④直接吃 `GET /uta/orders`。

## §5 Open Questions（=== 需楊董 ACK，各附預設 ===）

- **F2-O1** ✅ **已裁決（楊董 2026-07-03）：SIM 不用確認 modal** — 確認流僅真金帳號（Phase 4 起）。PR-3 範圍縮小：不動 SIM 送單節奏，只收雙 handler 合一＋錯誤詞彙表；modal 移植延到 Phase 4 閘實作（PR 歸屬改掛安全閘 spec）。
- **F2-O2** ✅ **已裁決（楊董 2026-07-03）：刪** — 但 `OrderReviewModal` 的 UX 元素先抽存（Phase 4 真金確認流要用），再刪整檔。
- **F2-O3** ✅ **已預核（楊董 2026-07-03「可以」）**：PR-1 動 trading-service.ts 時暫解 hook 的程序已預先同意 — 屆時執行者仍要在回報中明列「解了哪行、何時加回、加回驗證」。

---
## 版本紀錄
- v1 2026-07-03 Fable 5 定版（Explore 實掃 origin/main 為據）。
- v1.2 同日晚：楊董三裁決入檔 — F2-O1 SIM 免確認（modal 僅真金、移出 PR-3）／F2-O2 刪孤兒 ticket（先抽存 modal UX）／F2-O3 hook 暫解程序預核。
- v1.1 同日：fresh-context read-back（sonnet 對抗，實查 repo 驗證文件宣稱）抓 6 點修 6 點 — ①hook 位置補 harness 層絕對路徑（不在 repo）②assertKgiSimChannel 判準與失敗語意寫死 ③**先記帳後送單＋dual-write 失敗語意定版**（真金級缺口）④Phase 4「UI 零重工」改誠實範圍 ⑤刪「今日不再確認」逃生閥（自我矛盾）⑥標注 PR-1→PR-3 過渡期裸字串已知態。
