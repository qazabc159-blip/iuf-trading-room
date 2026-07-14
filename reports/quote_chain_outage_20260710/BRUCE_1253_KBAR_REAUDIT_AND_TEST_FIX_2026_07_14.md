# PR #1253 路 B 盤前前置工 — K-bar 補審 + gateway 測試修復 — 2026-07-14 (Bruce)

分支：`fix/pathb-gateway-tests-bruce-20260714`（起於 PR #1253 head `efe777f8`，未 push/未 merge）

## 任務範圍
1. 修綠既有 3 個紅 gateway pytest
2. 對 K-bar 4 端點（Hunk 10-13, commit `efe777f8`）獨立六不變式安全補審
3. 更新路 B 部署前置 checklist

---

## Part 1 — 3 個紅 gateway 測試

`python -m pytest services/kgi-gateway/tests/ -q` on PR head `efe777f8`（修復前）：

```
FAILED tests/test_login_failure.py::test_sdk_show_account_only_shape_is_accepted_as_success
FAILED tests/test_login_failure.py::test_missing_state_flag_reports_attr_path_not_unknown
FAILED tests/test_quote_object_hydration.py::test_subscribe_tick_route_returns_503_for_missing_quote_auth
3 failed, 96 passed
```

### 根因分流（重要：3 個不是同一種問題，逐一查證，非照單全收轉述）

**① `test_subscribe_tick_route_returns_503_for_missing_quote_auth` — 真的是 Hunk 1-9 遺留的舊 mock，✅ 已修綠**

`app.py:808`（Hunk 1-9 起）把 `/quote/subscribe/tick` 的 auth gate 從 `session.is_logged_in`
改成 `quote_session.is_logged_in`；測試仍 patch 舊的 `gateway_app.session._api`，導致
`quote_session` 保持登出狀態，route 在到達本測試要驗的 `KGI_QUOTE_AUTH_UNAVAILABLE`（503）
判斷之前就先被 401 NOT_LOGGED_IN 短路。**純測試 mock 更新**（`session._api` → `quote_session._api`），
零 app.py 改動。修復後：

```
python -m pytest services/kgi-gateway/tests/ -q
2 failed, 97 passed   # 只剩下面 ②③，跟 origin/main 基準完全一致
```

Diff（唯一改動檔）：`services/kgi-gateway/tests/test_quote_object_hydration.py`
（3 行 `gateway_app.session._api` → `gateway_app.quote_session._api`，加註解說明根因）

**② ③ `test_login_failure.py` 兩個測試 — 🔴 不是 Hunk 1-9/K-bar 遺留，是與本 PR 無關、更早就存在的
production 邏輯 regression，我沒有動它**

先查證這兩個測試是否跟 dual-track 有關：在 `origin/main`（PR #1253 完全沒 merge 前）獨立跑同一測試檔：

```
（origin/main HEAD 5fb56778，PR #1253 未觸及）
FAILED tests/test_login_failure.py::test_sdk_show_account_only_shape_is_accepted_as_success
FAILED tests/test_login_failure.py::test_missing_state_flag_reports_attr_path_not_unknown
2 failed, 97 passed
```

**兩個測試在 main 上本來就是紅的，跟 PR #1253／K-bar／dual-track 完全無關。** 往回 `git blame` /
`git show` 找到真根因：

- `kgi_session.py` 的 `_safe_attr_name()` 正規化函式 + login() 的「show_account-only shape 視為成功」
  分支，是 commit `00846435`（#825，2026-05-31）加的，**當時這兩個測試是綠的**。
- 後續 commit `1232d47b`（#840，同日稍晚，「reconcile SIM login race-fix + order enum mapping +
  watchdog re-login」——是把 3 個「EC2 上驗證過但沒進 source control」的修復一次補進 repo）在補登入
  race-fix（FIsLogon poll-wait）時，**疑似用了 #825 之前的舊底稿去疊修復**，連帶把 #825 的兩處修正
  整段蓋掉：
  1. `_safe_attr_name()` 的 regex 從 `re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]{0,63}", candidate)`
     退回舊版 `candidate.replace("_","").isalnum()`——舊版遇到含 `.` 的合法診斷字串（如
     `"_ObjOrder.FIsLogon"`）一律吐 `"unknown"`，診斷品質倒退。
  2. Layer 2 positive-confirmation guard 裡「`show_account` 可呼叫就視為成功」的 fallback 分支被整段
     刪掉，變成無條件 `raise KgiLoginObjectMissingAttr`。
  - commit `1232d47b` 的 commit message 完全沒提到要移除/收回這兩項——三個描述的修復（poll-wait/
    enum mapping/watchdog re-login）都跟這兩處無關，判斷是**疊修復時意外蓋掉，非刻意設計收緊**。

**為什麼我沒有動手修（即使只需要改 `kgi_session.py` 幾行）**：
- `kgi_session.py` 不在我被允許改的檔案清單內；且 PR #1253 自己的 commit message 明確把它列為
  「Real-money-gateway lock files (app.py/kgi_session.py/config.py/schemas.py)」，需楊董授權才能動。
- 這是**登入狀態判定邏輯**（trade leg 跟 quote leg 共用同一個 `KgiSession.login()`），屬性質敏感——
  不是我能自行判斷「改回 #825 那版」在今天的 SDK 行為下一定安全的層級。
- 硬性規則：「若發現非改 app.py 本體不可 → 停下回報需楊董授權，別自行動鎖檔」——這正是那個情況。

**跟路 B 部署的關聯性評估（風險，非阻斷）**：`quote_session` 是同一個 `KgiSession` class 的另一個
實例，走同一個 `login()`。如果 live 模式 KGI SDK 在某些情況回傳「只有 `show_account` 可呼叫、沒有
`_ObjOrder.FIsLogon`/`IsSucceed`」這種歷史上真的發生過的殼形狀（否則 #825 不會存在），quote_session
的登入會被這個回歸擋下，且診斷訊息只會顯示 `attr=unknown`（不會顯示 `_ObjOrder.FIsLogon`，除錯變難）。
**但**：commit `1232d47b` 本身聲稱「login + order both proven working 2026-05-31」——這之後 trade leg
在 EC2 SIM 環境是有被驗證過走 FIsLogon poll-wait 正常路徑，代表這個 edge case 至少在 SIM 環境沒有
實際觸發。quote leg 是全新 live 模式登入，是否會撞到這個殼形狀無法只憑程式碼判斷，需要實際 live 登入
觀察（部署時的 EC2 live CA 確認窗口本來就會看到登入成敗）。

**建議處理方式（三選一，需 Elva/楊董裁決，非我可以自行拍板）**：
- (a) 部署前授權 Jason/楊董對 `kgi_session.py` 補一個小修復（把 #825 的 regex + show_account fallback
  救回來），走正常 lock-file 暫解流程；或
- (b) 接受目前風險（EC2 部署時本就會人工盯 live CA/登入結果，若 quote_session 登入卡在這個殼形狀，
  現場會直接看到 `unknown` 診斷 + 401，可即時排查而非靜默失敗）；或
- (c) 標記這 2 個測試為已知缺陷（`xfail` + reference 這份報告），列入下一輪 gateway 技術債，不卡這次
  部署——**但這仍是改測試檔本體，我不擅自做這個判斷**，因為 xfail 本質上是「接受降級後的行為」，
  屬產品/風控政策層級的決定。

我對這 2 項**只查證、不下手**，維持紅燈狀態，原始未改。

---

## Part 2 — K-bar 4 端點（Hunk 10-13, commit `efe777f8`）獨立安全補審

對照設計文件 `reports/quote_chain_outage_20260710/KGI_DUAL_TRACK_PATCH_PLAN_v1.md` §3.4 Hunk 10-13，
逐條核對已落地實作（非信 commit message，自己 diff/grep 驗證）：

| # | 端點 | 設計要求 | 實作核對 | 結果 |
|---|---|---|---|---|
| Hunk 10 | `GET /quote/kbar/recover` | gate + api handle 換 `quote_session` | `app.py:1035` gate、`:1053` api None 檢查、`:1063` `recover_kbar_from_sdk(quote_session.api,...)` | PASS |
| Hunk 11 | `POST /quote/subscribe/kbar` | 同模式換 `quote_session` | `app.py:1117` gate、`:1151` api None、`:1155` `kbar_manager.subscribe_kbar(quote_session.api,...)` | PASS |
| Hunk 12 | `GET /quote/kbar` | gate 換 `quote_session`（不需 api handle） | `app.py:1211` gate（`is_kbar_subscribed`/`get_recent_kbars` 走 buffer 讀取，不碰 api） | PASS |
| Hunk 13 | `GET /quote/kbar/status` | additive `kgi_quote_logged_in`，`kgi_logged_in` 語意不變 | `app.py:1257` 兩欄位並存，`kgi_logged_in: session.is_logged_in` 未改 | PASS |

**逐項全域確認掃描**（`sed -n '1015,1260p' app.py | grep session.`）：4 個 K-bar route 內的
`session.`/`quote_session.` 呼叫，除 `kbar_status` 刻意保留的 `session.is_logged_in`（語意=交易腿，
設計如此）外，其餘全部是 `quote_session.`，**沒有殘留半套遷移**。

### 六條安全不變式重驗（獨立於 Jason/前次 Bruce 審查，自己重跑證據）

1. **交易腿仍 SIM，K-bar hunk 零觸碰下單/帳戶面**：`git diff origin/main..HEAD -- services/kgi-gateway/app.py`
   全篇 grep `order/create|LIVE_ORDER_BLOCKED|/position|/trades|/deals|set-account|set_Account|Order(`
   → 僅 1 處命中，是一行**刪除的 log 訊息字串**（"session.api not available — call POST
   /session/set-account first" 被換成新訊息文字），非功能呼叫。`LIVE_ORDER_BLOCKED` 出現次數
   `origin/main` 6 處 vs 本分支 6 處，**完全相等，零淨變動**。PASS
2. **行情腿呼叫全部唯讀市場資料，不觸下單**：K-bar 4 端點裡 `quote_session.api` 只傳入
   `recover_kbar_from_sdk()`、`kbar_manager.subscribe_kbar()`（`kgi_kbar.py` 這兩個函式本身
   `git diff origin/main..HEAD` **完全無改動**，PR 沒有碰過 `kgi_kbar.py`，K-bar SDK 呼叫邏輯是既有
   已上線程式碼，未被本次 PR 觸及）。PASS
3. **LIVE_ORDER_BLOCKED / read_only_guard / w6_audit 三檔零差異**：`git diff origin/main..HEAD` 對
   `read_only_guard.py`、`scripts/audit/w6_no_real_order_audit.py`、`.github/workflows/ci-security.yml`
   三檔**全部輸出為空**。本機重跑 `python3 scripts/audit/w6_no_real_order_audit.py` → **6/6 PASS**
   （非只看 CI badge）。PASS
4. **CA thread-local 隔離**：K-bar hunk 本身**沒有新增任何 CA 相關程式碼**（`_CA_OVERRIDE`/
   `_ca_env_values()` 邏輯是 Hunk 1-9 就已經審過的既有機制，K-bar 端點只是重用已存在、已審過的
   `quote_session` 物件，未新增登入/CA 呼叫點）。PASS（inherited，非本 hunk 新增風險面）
5. **行情腿失敗降級不阻斷、不靜默**：`recover_kbar` 對 `quote_session.api is None` 回傳空
   `bars=[]` + 明確 `note` 字串（非拋例外崩潰、非假造資料）；`subscribe_kbar` 對未登入回 401 + 明確
   guidance 訊息（設定 `KGI_QUOTE_PERSON_ID`/`AUTO_LOGIN`）；三個 gate 端點 pattern 一致。PASS
6. **CI 2/2 PASS，且針對正確 commit**：`gh pr checks 1253` → `Secret Regression Check (A2)` PASS +
   `W6 No-Real-Order Audit` PASS，`gh pr view 1253 --json headRefOid` 確認 `efe777f8`（含 K-bar hunk
   的最新 commit）就是這兩個 check 跑的 SHA，非舊 commit 殘留 badge。validate/Playwright 未跑=
   `ci.yml` path-filter 預期行為（本 PR 只碰 `services/**`）。PASS

**test_kbar.py 獨立重跑**：`python -m pytest services/kgi-gateway/tests/test_kbar.py -q` →
**19 passed**（非信 commit message 轉述）。

### K-bar 補審 Verdict：**PASS（6/6 安全不變式 + 零下單改動 + CA 隔離），可視為路 B 部署範圍的一部分**

跟 7/13 深夜 Hunk 1-9 審查合併看：PR #1253（`efe777f8`，Hunk 1-9 + Hunk 10-13 全部）整體六不變式
全 PASS，K-bar 落差（先前 NEEDS_FIX 的唯一理由）已補齊，**先前的 NEEDS_FIX 狀態已解除**。

---

## Part 3 — 路 B 部署前置 checklist（更新）

| # | 項目 | 狀態 | 備註 |
|---|---|---|---|
| 1 | Hunk 1-9（tick/bidask/health/status）安全審 | ✅ READY | 2026-07-13 深夜六不變式 PASS |
| 2 | Hunk 10-13（K-bar 4 端點）安全補審 | ✅ READY | 本輪 PASS，見 Part 2 |
| 3 | 3 個既有 gateway 測試 | 🟡 1/3 READY，2/3 待裁決 | ①已修綠（純 mock 修復）；②③是無關本 PR 的既有
    production 邏輯回歸（`kgi_session.py`，2026-05-31 commit `1232d47b` 意外蓋掉 #825 修復），需
    Elva/楊董決定 (a) 授權修 lock file (b) 接受風險部署 (c) 標記已知缺陷，見 Part 1 詳述 |
| 4 | gateway hook 暫解狀態 | ⚠️ 待現場確認 | 交接記錄提及「今早暫解目前還開著」，本輪未查證（不在授權範圍，非我 lane） |
| 5 | EC2 live CA 機制確認 | ⏳ 部署時當場做 | 按指示本輪不碰 |
| 6 | CI 狀態 | ✅ 2/2 PASS | Secret Regression + W6 Audit，對應正確 commit `efe777f8` |
| 7 | W6 audit 本機重跑 | ✅ PASS | 6/6，非只信 CI badge |

**整體判斷**：K-bar 補審通過、1 個測試修復完成後，路 B 在**程式碼安全面**已無新增阻塞。唯一有意義的
待決事項是 #3 的 ②③（既有跟本 PR 無關的登入診斷回歸）——這不是本 PR 引入的新風險，也不是 K-bar
本身的問題，是否要在這次部署窗口一併處理，是政策/範圍決定，非我能自行拍板。

---

## 檔案與分支

- 分支：`fix/pathb-gateway-tests-bruce-20260714`（起於 `efe777f8`，未 push/未 merge，交回 Elva）
- 改動檔（僅此一個）：`services/kgi-gateway/tests/test_quote_object_hydration.py`
- 未改動：`app.py`、`kgi_session.py`、`read_only_guard.py`、`config.py`、`schemas.py`、
  `scripts/audit/w6_no_real_order_audit.py`、`.github/workflows/ci-security.yml`
- 本報告：`reports/quote_chain_outage_20260710/BRUCE_1253_KBAR_REAUDIT_AND_TEST_FIX_2026_07_14.md`
