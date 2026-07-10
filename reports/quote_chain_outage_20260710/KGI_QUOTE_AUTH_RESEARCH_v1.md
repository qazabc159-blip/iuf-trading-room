# KGI 行情訂閱 token 拿不到 — root-cause 研究報告 v1

日期：2026-07-10｜工單：quote_chain_outage_20260710｜狀態：研究完成（唯讀，未動任何代碼）

## 0. 判準（開工先註冊）

- **工程可解**＝能指出具體 SDK 參數／呼叫序／版本／環境配置改法（檔案＋參數），且有證據該路徑曾經或應當供 token。
- **帳號側才能解**＝需券商簽署／開通／allowlist，附官方文件或 KGI 來信出處，給楊董具體 action。
- **資料不足**＝列出缺哪一項證據才判得了。

## 1. 必答一：行情 token 的取得機制（代碼證據）

kgisuperpy 登入是**兩條互相獨立的驗證鏈**，一次 `login()` 同時跑：

| 鏈 | 元件 | 成功指標 | 供什麼 |
|---|---|---|---|
| 交易鏈 | TradeCom DLL（`CA.py:78` `super().Login()`） | `_ObjOrder.FIsLogon=True` | 下單／帳務 |
| 行情鏈 | `AutoRefresh`（`CA.py:61`，編譯檔 `url.pyd` 內 `TokenManager._fetch_token` HTTP 打 `__auth_url` 取 token，`token_valid_seconds`＋`auto_refresh_interval` 自動續期） | `_ObjOrder._URL.token` 非空 | 行情訂閱／歷史資料 |

`main.py:76-83`（SDK 2.0.3）：`if not URL.token: print("Token無效，停止初始化行情與資料"); return` — token 空則 `api.Quote` **根本不會掛上**。gateway `kgi_quote.py:57-67` 找不到 `api.Quote` 又發現 `_URL.token` 為空 → 丟 `KGI_QUOTE_AUTH_UNAVAILABLE`。`diagnose_sim_login.py:144-146` 早已註明 top-level `IsSucceed/RtnCode` 屬於「web-token（行情）層，非 DLL 登入」。

官方文件面：token 對用戶不可見（SDK 內部），無獨立申請入口；行情訂閱量按**會員等級**限制（官方 member 頁：「新星」最多 2 連線、訂閱 30 檔商品；三等級詳情「洽營業員」）。官方文件（含 testsuperpy 測試站）**完全沒有**「模擬環境是否供行情」的任何描述。

- SDK：`C:\Users\User\AppData\Local\Programs\Python\Python311\Lib\site-packages\kgisuperpy\`（main.py / CA.py / Quote.py / url.cp311.pyd 字串萃取）
- 官方：superpy.kgieworld.com.tw `/kgipythonapi/guide/tw/member`（新星等級表）、`/kgipythonapi/faq`、`/kgipythonapi/guide/us/prefix`

## 2. 必答二：為什麼 6/2 前活著、6/2 起死了

**轉折點找到了，不是憑證過期，是部署環境切換。**

- 6/1 前：EC2 prod gateway 跑 `KGI_SIMULATION=false`＋楊董 live 帳號（SSM `/iuf/kgi/person_id`）。live 帳號有 SuperPy＋新星行情資格 → token 正常。證據：5/8 live read-only PASS（`evidence/w7_paper_sprint/BRUCE_KGI_LIVE_READ_ONLY_PASS_2026-05-08.md`）；5/13 quota manager 用真 KGI tick（`JASON_KGI_QUOTA_MANAGER_2026-05-13.md`）；5/13 handoff 明令「Keep production EC2 in live quote mode」（`ELVA_KGI_SIM_CORRECTION_HANDOFF_2026-05-13.md:108`）。
- 轉折：**PR #829（commit `38fb231f`，2026-05-31）**把部署預設改為 `KGI_SIMULATION=true`＋SIM credentials（SSM `/iuf/kgi/sim_person_id`＝F131331910），搭配 #802（5/30）startup 自動登入 SIM。diff 可見 `install.ps1`：`KGI_SIMULATION "false"→Convert-BoolToEnv $KgiSimulation(預設true)`、`AUTO_LOGIN "false"→true`。
- 6/1（週一）起 gateway 以 SIM 身份登入：交易鏈通（TradeCom SIM 已開通，6/9 autonomous fire 8 單 accepted），**行情鏈拿不到 token** → 6/2 第一筆 `KGI_QUOTE_AUTH_UNAVAILABLE` 記錄（`CODEX_KGI_SIM_DAILY_SMOKE_AUDIT_FALLBACK_2026-06-02.md:37`），持續至今。
- SIM 行情鏈為何死：(a) 5/13 實測 EC2 → `iquotetest.kgi.com.tw:443/8000` **TCP fail**（同 handoff:29-30；trade host 後來通了，行情 host 未見復測通過的證據）；(b) 6/15 memo 記錄「歷史 gateway log 顯示 quote login 端點回 HTTP 502、trade login 正常」（`reports/memos/codex_notes/2026-06-15_codex_kgi_sim_quote_fill_closure_sync.md:15`）。二者都指向：**SIM 環境的行情 auth 對本帳號／本來源拿不到 token**。

## 3. 必答三：判定

**判定：雙軌 — 「恢復行情」工程可解（配置層，非改代碼）；「SIM 環境原生行情」帳號側才能解。**

### 工程可解（給改法，不動鎖檔）
1. **行情回 live-quote 雙軌**（首選，回到 6/1 前已驗證可行的架構）：EC2 gateway 以 `deploy/install.ps1 -KgiSimulation $false`（或對現行 service 用 `POST /session/login {simulation:false}`＋live credentials）恢復 live 行情登入；下單煙測續走 SIM（另一 instance/port 或 per-request session）。`read_only_guard.py`＋`LIVE_ORDER_BLOCKED` 不動，live 寫入仍被擋。**涉真金 lane 環境變更，執行前需楊董 ACK。**
2. **SDK 版本排查**：本機／文件鎖定 2.0.3（4/7 釋出），但 KGI 在 5/7–5/26 連發 2.0.4→2.0.8（PyPI）。若 KGI 五月底遷移了行情 auth 端點，2.0.3 的 `config.enc` 端點失效可解釋 502。低成本驗證：sandbox `pip install kgisuperpy==2.0.8` 用 SIM 帳號 `login(simulation=True)` 看 `_URL.token`。注意 `install.ps1:301` 是 `--upgrade`，**EC2 實際版本未查證**。

### 帳號側（給楊董 action）
- 問 KGI（營業員＋ec.service@kgi.com，可沿用 `services/kgi-gateway/scripts/KGI_SUPPORT_QUESTION_DRAFT.md` 格式加三問）：(1) 測試環境（itradetest/iquotetest）**是否供即時行情 token**？官方文件無記載；(2) 若供，`iquotetest.kgi.com.tw` 是否需要**來源 IP allowlist**（EC2 EIP，ap-east-2）— 5/13 KGI 來信給了 host 但 EC2 連不上；(3) 新星行情等級是否涵蓋 SIM 帳號 9228-001282-6。
- 若 KGI 答「SIM 不供行情」→ 工程路 1 是唯一解。

### 資料不足（判不死的三項）
① EC2 現行 kgisuperpy 版本與 env（`KGI_SIMULATION` 現值）；② 本地 PC（5/13 曾是 allowed source）`simulation=True` 現在能否拿 token — 5 分鐘就能測，直接二分「帳號無資格」vs「來源被擋」；③ 6/15 memo 引的 502 原始 log 未落檔，502 的確切 URL 未知。

## 4. 必答四：Steelman（最強反方）

1. **「轉折不是 #829，是 KGI 五月底改版」**：KGI 5/14-5/26 密集發 2.0.5/2.0.7/2.0.8，quote login 502 是「可達但服務錯」的 HTTP 回應 — 可能 live 模式繼續跑也會在 6 月初死。反駁：時間與 #829 部署重合太準，且 5/13 已實測 SIM 行情 host 從 EC2 連不上（SIM 行情從未在 EC2 活過）；但**無法排除兩因疊加**，所以工程路 2（SDK 升級測試）必做。
2. **「SIM 本來就不供行情，全部帳號側都白問」**：官方文件對 SIM 行情零著墨、KGI 5/13 email 雖給了 iquotetest host 但從未證明發 token — 若此說成立，allowlist 也沒用。此說**不推翻主結論**，反而強化「行情回 live 雙軌」為唯一終局解。
3. 「憑證過期」說：無證據 — 交易鏈同憑證同帳號一直通（6/9 成單），CA 過期會兩鏈齊死。排除。

## 5. 意外發現

- 官方 member 頁寫新星＝2 連線／**30 檔**，與 5/13 既有知識「2×20＝40 cap」不一致（可能改版或當時口徑不同）— 若恢復 live 行情，quota manager 的 40 上限需複核。
- `install.ps1` 裝 SDK 用 `--upgrade` 不鎖版本 — 未來重裝 EC2 會靜默跳 2.0.8，行為漂移風險。

## §本地二分實驗（2026-07-10 15:13 台北，盤後）

§3「資料不足②」的 5 分鐘二分實驗已執行。**結論：本地也拿不到行情 token，錯誤形態與 EC2 完全一致 → 「EC2 網路/allowlist 被擋」假說否定；「SIM 帳號無行情資格」假說成立。**

### 實驗設置
- 本地 PC（對外 IP `61.218.159.149`，SDK log `MyIP` 自報；5/13 曾為 allowed source），scratchpad 隔離 venv（Python 3.11.9），不碰系統 Python、不碰 EC2、不下單。
- `pip install kgisuperpy` 裝到**最新版 2.0.8**（正好同時回答工程路 2 的版本問題）。
- SIM 憑證取自 SSM `/iuf/kgi/sim_person_id`／`sim_person_pwd`（F131331910，pwd 4 碼）。
- **只 login 一次**（simulation=True），觀察後立即 logout。無重試。

### 結果（SDK 輸出原文節錄）
| 鏈 | 結果 |
|---|---|
| 交易鏈 | **通**：`OnLogonResponse IsSucceed:True ReplyString:登入成功`；`FIsLogon=True`；CA 驗證過（憑證效期至 20261206）；帳號 `9228-0012826` 正常列出 |
| 行情鏈 | **死**：`_ObjOrder._URL.token` = 空字串；`api.Quote` 不存在 — 與 EC2 `KGI_QUOTE_AUTH_UNAVAILABLE` 的觸發條件（kgi_quote.py:57-67）**逐位一致** |

關鍵 log 原文：
```
INFO - Successfully obtained ranking token for uid: F131331910
INFO - Successfully retrieved ranking for uid: F131331910, level: 
```
→ SDK 會先打「會員等級（ranking）」查詢：查詢本身成功，但 **level 回空白**。行情 token 之後就沒發下來 — `_URL` 物件上連 `_manager` 屬性都沒有（`main.py:48-50` `_set_data` 只在 `hasattr(AutoRefresh,'_manager')` 時才跑，所以連「Token無效」那行 print 都不會出現，是更上游的靜默失敗）。這把 §1「行情訂閱量按會員等級限制」跟故障接起來了：**SIM 帳號在 KGI 後台的行情會員等級是空的 = 無行情資格**。

另兩個順帶事實：
- `_URL.host = ['itradetest.kgi.com.tw', 8000, 'SPY', 'http://itradetest.kgi.com.tw/Quote/...']` — 2.0.8 SIM 模式行情 host 是 **itradetest:8000**（跟交易同主機），不是 5/13 email 講的 iquotetest。5/13「EC2 連不上 iquotetest」的舊證據對現版 SDK 已非重點。
- 本地無任何 502／連線錯誤 — token 缺失是**資格層靜默失敗**，非網路層。EC2 6/15 memo 的 502 可能是另一時期/端點的雜訊，不影響本判定。

### SDK 2.0.8 是否修了什麼（工程路 2 收案）
diff 2.0.3（系統 Python）vs 2.0.8（venv）：`main.py`、`CA.py` **完全相同**；`Quote.py` 只加了 event callback 包裝；`config.enc`（加密端點配置）與 `url.pyd`（token 取得邏輯）有更新。**但 2.0.8 在本地同樣拿不到 token** → 「2.0.3 端點過期導致 502」假說一併否定。升級 SDK 救不了 SIM 行情。

### 判定與下一步
- **判定：帳號側。** SIM 帳號 F131331910（9228-0012826）無行情會員等級，token 不會發，跟來源 IP、SDK 版本、EC2 網路無關。
- §3 工程路 1（**行情回 live 雙軌**）升格為唯一工程解，維持「執行前需楊董 ACK」。
- §3 帳號側問題可收斂為一問：請 KGI 為 SIM 帳號 9228-0012826 開通行情會員等級（若可開通，是最乾淨解）；allowlist 問題（原問 2）可撤。
- 實驗腳本與原始輸出：scratchpad `quote_token_bisect.py`（session-local，未入 repo）。

## 6. 引用

代碼：`services/kgi-gateway/kgi_quote.py:47-84`、`kgi_session.py:310-343`、`config.py:26`、`scripts/diagnose_sim_login.py:144-146`、SDK `main.py:46-83`、`CA.py:61-78`、`Quote.py:215-232`、`url.cp311-win_amd64.pyd`（字串萃取）。
Git：`38fb231f`（#829, 5/31）、`58437d8b`（#802, 5/30）、`edcf40af`（#800, 5/30）、`1232d47b`（#840, 5/31）。
Evidence：`ELVA_KGI_SIM_CORRECTION_HANDOFF_2026-05-13.md`、`BRUCE_KGI_LIVE_READ_ONLY_PASS_2026-05-08.md`、`JASON_KGI_QUOTA_MANAGER_2026-05-13.md`、`CODEX_KGI_SIM_DAILY_SMOKE_AUDIT_FALLBACK_2026-06-02.md`、`reports/memos/codex_notes/2026-06-15_*.md`×2、`reports/site_reverify_20260612/item10_kgi1.json`。
官方：https://superpy.kgieworld.com.tw/kgipythonapi/guide/tw/member ｜ https://superpy.kgieworld.com.tw/kgipythonapi/faq ｜ https://superpy.kgieworld.com.tw/kgipythonapi/guide/us/prefix ｜ https://testsuperpy.kgieworld.com.tw/kgipythonapi/guide/tw/prefix ｜ https://pypi.org/project/kgisuperpy/ ｜ https://gorich.tw/api-python-02/
