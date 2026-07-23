# audit_logs backfill APPLY 執行記錄 — 2026-07-23 ~23:4x TST（Elva 親自執行）

## 授權鏈
- Script：`apps/api/src/sim-go-live-audit-backfill-20260723.ts`（PR #1351，Pete APPROVED 0🔴/4🟡）
- Elva gate 依據：insert-only（絕不 UPDATE/覆寫）＋apply 時 idempotency 真重查＋entityId 合併裁決經 Pete 獨立驗證＋盤後安全窗
- 執行環境：`ssh railway-api`（Bruce 建立的 recipe）容器內 `/app`，node 22.23.1＋tsx（容器有全 repo source；兩個輸入 evidence 檔由 Elva 從 origin/main 取出上傳，byte 數核對 11899/9864 吻合）
- Bruce（verifier lane）依角色分際拒絕執行寫入、只做 DRY RUN 重驗（逐位元組 PASS，見 BRUCE_PROD_VERIFY_5MERGE_20260723.md §8）——執行改由 Elva 親自完成，事後核對回歸 Bruce

## 執行結果
1. **容器內 DRY RUN**：53 sent orders／53 reconcile rows（v51:45, v34:8），status breakdown 與 ground truth 完全吻合；`audit_backfill_dry_run_1784816245942.json`（容器產出，已抓回本 repo 同目錄 `audit_backfill_dry_run_container_1784816245942.json`）
2. **APPLY 第一輪**（2026-07-23T14:18Z）：
   - `v34_sim.order_submit entityId=2026-07-21` → **INSERTED** `9df694a1-fea7-43b5-bcda-e8024fda4462`（8 results）
   - `v51_sim.order_submit entityId=2026-07-13` → **SKIP（既有 row 保護正確發動，未覆寫）** `a851467f-3768-43aa-8e65-33ea5dfcc9de`
3. **APPLY 第二輪（idempotency 驗證）**：雙 SKIP、零新寫入 ✅

## 🔴 新發現：v51 entityId 第三方碰撞（只有 APPLY 才看得見）
既存 row `a851467f`＝**真 v51 runner 2026-07-14T00:26Z 寫的原始提交**（30 results、全 unconfirmed、舊 qty bug 時代 shares，如 1808=11000 股）。KNOWN ISSUE #1 預見的是 c1×c3 互撞，沒預見 runner 自己的歷史 row 也佔住同一 key——dry-run 無 DB 連線看不到，APPLY 才暴露。

**後果**：今日 53 單中的 45 筆 v51 單在 audit_logs 仍無覆蓋；#1345 cron 的 `readLatestV51OrderSubmitAuditRow`（取 latest、不看 entityId）現在會抓到 7/14 舊 row（其 7/14 tradeIds 在 gateway 記憶體早已清空，reconcile 無效但無害）。

**處置（Elva 裁決）**：不即興 UPDATE 既有 audit row（超出已審 insert-only 範圍＋動稽核既有紀錄需另審）。v34 缺口已補平收下；v51 缺口**明早開 Jason 票**：建議方案＝ad-hoc backfill 改用 distinct entityId（如 `2026-07-13:adhoc-20260723`）insert 新 row——保持 insert-only、且 cron 取 latest 的行為會自然轉到新 row 開始 reconcile 今日 45 筆 tradeIds；entityId 語意偏離「runner 會寫的形狀」一事需 Pete 快審背書後才執行。

## 遺留
- 容器 `/app/reports/...` 為 ephemeral（下次 deploy 消失）＝無殘留污染
- Railway SSH 驗證服務執行中一度暫時性故障（`verification service unreachable`），backoff 重試 ~45s 後恢復，非 key 問題
