# Gate 3 同步拒單誤記 accepted — 修復說明（app.py 硬鎖檔，patch 未套用）

**作者**: Jason-4（backend strategy lane）
**時間**: 2026-07-24
**狀態**: 🔴 **BLOCKED — harness hook 仍鎖 `services/kgi-gateway/app.py`，patch 未套用、未 commit、未部署**
**派工依據**: Elva 轉授權「楊董原話：Gate 3 准修」；但 `.claude/hooks/protect_real_money_paths.py`
的 PROTECTED 清單截至本輪查證（2026-07-24）**仍包含** `"kgi-gateway/app.py"`，且該行註解寫著
「2026-07-15 重鎖（路 B 部署完成，楊董 chat 指示「那你鎖吧」）；2026-07-13 曾暫解供 KGI 雙軌實作」
——也就是說：這個檔案曾經被暫解過一次（7/13），事後又被楊董本人明確要求重鎖（7/15）。本輪派工的口頭
授權與 hook 的實際檔案狀態不一致，依規範（Edit 前必先查證，不可只信派工訊息）本輪**未嘗試繞過**，
改為產出完整 patch + 本說明文件，交由 Elva/楊董決定是否要對 hook 檔本身再做一次暫解。

---

## 一、卡點（Blocked）

嘗試用 Edit 工具修改 `services/kgi-gateway/app.py` 時，PreToolUse hook 直接擋下：

```
[protect_real_money_paths] BLOCKED: '...\services\kgi-gateway\app.py' is a
real-money lock file. See reports/phase4_safety_gate/PHASE4_SAFETY_GATE_SPEC_v1.md
section 7. Changes require the owner (Yang) to temporarily lift this guard.
```

依派工指示「若 harness hook 擋你編輯 app.py：不要硬試繞過」——本輪**沒有**嘗試用 Bash 直接寫檔或其他
繞道方式修改該檔案，改為在 scratchpad 建立完整沙盒（複製 `services/kgi-gateway/` 全目錄+替換
`app.py`/`tests/test_order_gate.py` 兩份修改後的版本）驗證邏輯正確、跑過全部既有+新增測試，再產出
`git apply --check` 驗證過可乾淨套用的 unified diff。**0 行真正落地到鎖檔本身。**

---

## 二、根因（本輪用已安裝的 kgisuperpy==2.0.3 SDK 原始碼直接驗證，非猜測）

環境裡剛好裝了 `kgisuperpy` 套件（`C:\Users\User\AppData\Local\Programs\Python\Python311\Lib\
site-packages\kgisuperpy`），可以直接讀 proprietary SDK 原始碼（repo 內、Jason-2 鑑識報告都沒有
這個管道），拿到比 forensics 報告更確定的根因：

1. **`Order.create_order()`（`kgisuperpy/trading/Order.py:59-222`）呼叫一個原生 TradeCom DLL
   方法 `self._Order.SecurityOrder(...)` 後立刻回傳，有兩種結果**：
   - `rt != 0`（DLL 呼叫本身就被拒）→ `create_order()` 在這個分支**沒有 `return` 陳述式**
     （`Order.py:218-220`，只有 `print(...)`）→ Python 隱式回傳 `None`。這是**真正同步**的拒單。
   - `rt == 0`（已排入非同步佇列）→ `create_order()` 回傳一個 `Trade` 物件，
     `operations=[Operation(nid=RequestId, status=Status.Pending)]`（`Order.py:187-197`）——
     這**不代表 KGI 接受**，只代表送出去排隊而已。
2. **KGI 自己的驗證回覆（股票代號錯誤 MAT0015／委託價超過漲跌範圍 MAT0024 等）是透過 SDK 的
   push callback `_OnOrderPending`（`Order.py:456-534`）非同步送達**，這個 callback 用
   `self._rid[rid]` 找回「同一個」`Trade` 物件（`rid` 就是我們已經拿到的 `RequestId`），若
   `data['ErrorCode'] != '0'`，直接把 `operation.status` 改成 `Status.Failed`、
   `operation.msg` 改成 `"<代碼>: <文字>"`（例如 `"MAT0024: 價格超出漲跌範圍"` ——這個確切範例字串
   就是 kgisuperpy 自己 `Operation.msg` 欄位的 docstring 範例，見
   `kgisuperpy/trading/_trade_base.py:344-388`）——**原地修改我們手上已經持有參照的同一個物件**。
3. **舊版 Gate 3 在呼叫 SDK 後立刻讀取 `sdk_response`，只要沒有 Python exception 就無條件回
   HTTP 200 `status:"accepted"`**——完全沒有檢查上述兩種「其實已經被拒」的狀態。這在
   Jason-2 的鑑識報告裡已經用 8 筆真實 INVALID 單證實過（全部拿到 HTTP 200 accepted，即使
   KGI 回的是 `order_id="0000"`/`quantity=0`/「無效單」桶）。

---

## 三、修法（patch 內容摘要，完整內容見 `GATE3_FIX_PATCH_20260724.patch`）

**不改任何送單行為**（沒有新增/移除 SDK 呼叫、沒有重試、沒有 cancel）——只改「答案的內容和時機」：

1. `sdk_response is None` → 立即（不用等）回 **HTTP 422** `{error:{code:"KGI_ORDER_REJECTED", ...}}`
   （沿用既有 `ErrorEnvelope`/`ErrorDetail` schema，跟現有 `INVALID_ORDER_REQUEST`/
   `SESSION_API_MISSING`/`SIM_SDK_ERROR` 三個既有錯誤分支同一套 shape，**schemas.py 不用改**）。
2. `sdk_response` 有 `operations[]` 可查時，短暫（bounded）輪詢該物件本身，最多
   `_GATE3_REJECT_POLL_ATTEMPTS(8) × _GATE3_REJECT_POLL_INTERVAL_S(0.1s) = 0.8s`，看有沒有
   任何 `operation.status == Status.Failed`。有 → 422 `KGI_ORDER_REJECTED`，`message`/`upstream`
   帶真實 KGI 錯誤文字（`"MAT0015: 股票代號錯誤"` 這種）。全程都沒有 → 200 accepted（維持現行行為）。
3. **沒有 `operations` 資訊可查的回應形狀（例如既有測試的 dict mock）完全跳過輪詢**——
   零延遲，不影響現有測試/現有行為。

### 為什麼選 422 而不是 200+status:"rejected"（派工要求論證這個選擇）

逐一讀過**全部四個**目前真的會呼叫 `/order/create` 的呼叫端，結論一致：**它們全部已經是照
「非 2xx = 拒單」的邏輯寫的**，422 完全免費接上這個既有機制，不用改任何一行 TS：

| 呼叫端 | 現有邏輯 | 檔案:行號 |
|---|---|---|
| `s1-sim-runner.ts` | `catch(e)`：`e instanceof KgiGatewayUnreachableError` 才重試，否則「KGI SIM rejection → NO auto-retry」直接判拒 | `apps/api/src/s1-sim-runner.ts:886-897` |
| `v34-sim-runner.ts` | 同上 pattern | `apps/api/src/v34-sim-runner.ts:785-791` |
| `v51-sim-basket-runner.ts` | 同上 pattern | `apps/api/src/v51-sim-basket-runner.ts:681-686` |
| `resend_residual_20260724.mjs`（7/24 殘量補送一次性工具） | `if (res.status === 200 && res.body?.ok === true) status="accepted"` 否則走 `REJECTED http=${res.status}` 分支 | `reports/sim_go_live_20260723/resend_residual_20260724.mjs:379-390` |

而 `apps/api/src/broker/kgi-gateway-client.ts` 的 `classifyError()` **早就把 HTTP 422 映射成
`KgiGatewayValidationError`**（既有的 `INVALID_ORDER_REQUEST` 路徑就是走這條），跟
`KgiGatewayUnreachableError`（唯一觸發重試的類型）是不同 class——三個 runner 的
`e instanceof KgiGatewayUnreachableError` 判斷自動落到「否」那一支（無重試、判定拒單），
**完全不用改 TS**。

**唯一發現但本輪判斷不需要跟著改的既有缺口**：`apps/api/src/broker/kgi-broker-adapter.ts` 的
`submitOrder()`（第 59-82 行）目前**完全不讀** gateway 回應的 `status` 欄位，只要沒有 throw 就
硬寫 `status: "submitted"`。這是**修復前就存在**、跟本票無關的既有缺口——本票修完後它會從
「靜默回報 submitted」變成「正確地把 exception 往上拋」，這是行為上的**改善**而非需要在本票內
額外處理的破壞（且它不在真 runner 的呼叫路徑上——三個真 runner 都直接呼叫
`KgiGatewayClient.createOrder()`，繞過這個 adapter）。建議另立小票補上讀取 status 欄位的邏輯，
非本次必要範圍。

---

## 四、驗證（0 行真正落地到鎖檔，全部在 scratchpad 沙盒完成）

1. **語法**：`python -c "import ast; ast.parse(...)"` 對修改後的 `app.py` 全文通過。
2. **邏輯**：在 scratchpad 建立 `services/kgi-gateway/` 完整鏡像沙盒，替換 `app.py` +
   `tests/test_order_gate.py` 兩份修改版，其餘檔案（`schemas.py`/`kgi_session.py`/
   `kgi_events.py`/`config.py`/`read_only_guard.py` 等）**完全不動**，跑：
   - `pytest tests/test_order_gate.py -v` → **20/20 全綠**（既有 15 條 Group A/B/C 全部
     不變地通過 + 本輪新增 5 條：C5 無 operations 資訊零延遲跳過輪詢 <0.5s、
     D1 正常單維持 Pending 全程輪詢完畢仍回 200 accepted、D2 MAT0015 → 422 rejected
     且錯誤碼透傳、D3 MAT0024 → 422 rejected 且錯誤碼透傳、D4 `sdk_response=None` → 422 rejected）
   - `pytest tests/ -q`（gateway 全套件）→ **102 passed, 2 failed**（原始未修改
     baseline 跑同一份測試也是 **97 passed, 2 failed**——差異剛好是本輪新增的 5 條全綠，
     那 2 個既有失敗〔`test_login_failure.py` 兩條斷言〕在**未修改的 origin/main worktree
     上跑同樣失敗**，跟本票的改動〔只碰 `app.py` + `test_order_gate.py`，完全不碰
     `kgi_session.py`〕零關聯，是既有環境缺口，非本票引入）。
3. **patch 可套用性**：`git apply --check` 對乾淨 `origin/main` worktree 執行，**兩個 hunk 都
   通過**，證明這份 diff 可以直接 `git apply` 套用，不需要手動調整。

---

## 五、如何套用（給有權限暫解 hook 的人）

```bash
# 1. 楊董/Elva 在 .claude/hooks/protect_real_money_paths.py 暫時移除
#    "kgi-gateway/app.py" 這一行（或整段 hook 註冊），仿照 2026-07-13 的先例

# 2. 在乾淨 origin/main worktree 套用 patch
cd <worktree>
git apply reports/sim_go_live_20260723/GATE3_FIX_PATCH_20260724.patch

# 3. 驗證
cd services/kgi-gateway
python -m pytest tests/ -q   # 應該是 <baseline+5> passed, 2 failed（既有 login 測試缺口）

# 4. commit + push branch
#    fix/gateway-gate3-sync-reject-honesty-jason4-20260724（本輪已建立、目前只有本
#    說明文件+patch 檔+worktree 內未 commit 的 report 檔）

# 5. 恢復 hook 鎖（照 7/15 先例，套用完立刻重鎖，不要留解鎖狀態過夜）
```

---

## 六、部署備註（不自行部署，僅記錄程序）

`services/kgi-gateway/app.py` 跑在 EC2（`i-03762 ap-east-2`，唯一一台，KGI gateway + GHA
runner 共用），走 EventBridge 平日 08:20 開機 / 14:10 關機排程（見
`reference_ec2_inventory_2026_05_19.md`）。這個 Python 服務**不是**經由 GitHub Actions
`push:main → Railway` 自動部署那條線（那條只管 `apps/api`/`apps/web`）——`services/kgi-gateway/`
的部署方式需另外查 `services/kgi-gateway/deploy/`（本輪唯讀看過目錄存在，未深入部署腳本，因為
本票尚未到能部署的階段）。merge 後誰執行部署、何時執行，建議 Elva 在 hook 解鎖+PR 走完審查後
一併排定——不應該在下一次開盤前才臨時處理，因為這張票的價值就是要在 8/11 真金前把「同步拒單被
誤記 accepted」這個八週共犯修掉。

---

## 七、失敗/未達成事項（誠實列出，四項齊）

1. **本輪完全沒有真正修改鎖檔本身**——受 harness hook 阻擋，遵照派工指示未嘗試繞過，只產出
   patch + 說明文件，不算完成，只算「已就緒待套用」。
2. **輪詢時間窗（0.8s）沒有真實 SDK 事件延遲數據佐證**——proprietary SDK 無文件，`_OnOrderPending`
   實際到達延遲只能靠架構推論（比 fill 確認快很多，因為不需要真的碰交易所撮合），沒有拿到
   即時開盤窗口實測數字。8/11 前若能在真開盤時段驗證這個窗口夠不夠/會不會太保守，應該調整。
3. **`kgi-broker-adapter.ts` 的 `submitOrder()` 忽略 status 欄位的既有缺口，本輪只記錄未修**——
   判斷不在本票必要範圍內（見上方「不需要跟著改」段落），但這是個真缺口，需要另立票。
4. **無法驗證真實部署後的行為**——所有驗證都在本機 scratchpad 沙盒完成（mock SDK 回應），
   沒有、也不可能在本輪對 EC2 上跑的真 gateway process 做端到端驗證（gateway 平日僅
   08:20-14:10 TST 開機，且即使開機，此刻 patch 也還沒套用到那台機器上的檔案）。
