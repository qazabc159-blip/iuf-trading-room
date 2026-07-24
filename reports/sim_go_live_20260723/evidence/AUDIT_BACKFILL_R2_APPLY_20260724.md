# audit_logs backfill Round 2 APPLY 執行記錄 — 2026-07-24 13:5x TST（Elva 親自執行）

## 授權鏈
- 工具：#1360（Pete-10 審 0 邏輯 blocker、Elva ACK guard 政策、merge 231b0b6a）
- 資料前提：13:55 EOD 終驗證實 **EOD 與 09:40 snapshot 零差異**（deals_eod_0724.json 逐檔全同、零 overfill）＝#1360 committed ground truth（trades_manual_0724.json）即終版，Pete-10 🟡#2（bucket[0] 對 EOD 檔未測）自然解消
- 執行環境：ssh railway-api 容器 /app（round2 script 隨 #1360 deploy 在 image 內；4 個 evidence 輸入檔由 Elva 從 origin/main 取出上傳，byte 數核對吻合）

## 執行結果
1. 容器 DRY RUN：與 PR committed dry-run 完全一致（Batch A 45／Batch B v51 24／Batch B v34 4，3 rows）
2. APPLY（2026-07-24T05:56:24Z）三筆全 INSERT：
   - `d740b3e2` v51_sim.order_submit entityId=2026-07-13:adhoc-20260723（45 results）＝**昨日 v51 缺口補平**
   - `aa5536b6` v51_sim.order_submit entityId=2026-07-24:adhoc-resend（24 results）
   - `97b7351f` v34_sim.order_submit entityId=2026-07-24:adhoc-resend（4 results）
3. idempotency 二跑：三 SKIP 零寫入 ✅
4. 唯讀核對：新 3 rows 形狀正確；歷史 rows（a851467f 30 筆／9df694a1 8 筆／2f617f6e 9 筆）逐一確認未動 ✅

## 收官狀態
兩日 ad-hoc 送單（7/23 53 單＋7/24 殘量 28 單）audit_logs 覆蓋 100%：81 筆 order-results 落 4 rows（含昨日 round 1 的 9df694a1）。#1345 cron 自此對 v51/v34 取 latest 會拿到 adhoc rows（tradeId 在 gateway 隔夜清記憶體後查無＝誠實 unconfirmed 維持，設計內）。

## 註記
- 容器 /app/reports 上傳檔隨下次 deploy 蒸發＝零殘留
- ad-hoc 查詢 payload->>'source' 回 null＝provenance 標記不在該 key path（Pete-10 已驗 provenance 存在於 payload 內另一位置，非缺失）
