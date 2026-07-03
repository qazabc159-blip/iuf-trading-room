# Phase 4 真金安全閘 SPEC v1 — 2026-07-03（Fable 5 定版）

**地位**：Phase II「真金第一單」的前置設計。楊董核准前，本 spec 的任何實作不得動工。實作者=sonnet 級 session 照本文逐節執行，每節附驗收。
**設計原則**：①縱深防禦 — 既有四層鎖（見 §1）一層都不拆，新閘疊加其上 ②default-deny — 真金能力不存在「開著」的狀態，每一筆都是獨立授權 ③停下永遠安全 — kill 不需要確認，恢復才需要 ④可觀察性優先 — 任何真金動作先有審計，再有執行。

---
## §1 現況盤點（origin/main @ bf5711fa，Explore 實掃 2026-07-03）

既有防線（全部保留，本 spec 不改動任何一項的預設值）：
| 層 | 位置 | 機制 |
|---|---|---|
| L1 TS 常數鎖 | `apps/api/src/broker/trading-service.ts:37` | `KGI_MANUAL_ORDER_WRITE_LOCKED = true` 硬編碼；`assertKgiSimOnly()`(47-54) 無條件 throw |
| L2 env sim 鎖 | `apps/api/src/broker/kgi-sim-env.ts:33-38` | `KGI_ENV` 預設 "sim"；非 sim → `prod_write_blocked` |
| L3 route 級 | `apps/api/src/server.ts:4611-4626` | `/kgi/sim/order` Owner-only＋env 二次檢查 → 409 |
| L4 gateway 硬線 | `services/kgi-gateway/app.py:1221-1260`＋`read_only_guard.py` | `LIVE_ORDER_BLOCKED` 三閘＋`KGI_READ_ONLY_MODE` 預設 true |
| CI 防線 | `.github/workflows/ci-security.yml` → `scripts/audit/w6_no_real_order_audit.py` | 6 檢查（三閘字面量/paper 隔離/executionMode/killSwitch 形狀/UI flag/secret） |
| 開關前例 | `apps/api/src/domain/trading/execution-mode.ts:22-71`；`apps/api/src/risk-engine.ts:182` | env 三重 AND gate；帳戶層 KillSwitchState（DB-backed） |
| 審計 | `apps/api/src/audit-log-store.ts:199` → `audit_logs` 表 | 送單已記完整 payload |

下單分流：`POST /trading/orders` → `submitOrder()` → `broker-account-resolver.ts` 分 kgi/paper。Fubon adapter 未存在，照結構應為 `apps/api/src/broker/fubon-{broker-adapter,broker,gateway-client}.ts`＋resolver 加 case。

## §2 Threat Model（十威脅，每條→對應防線節）

| # | 威脅 | 場景 | 防線 |
|---|---|---|---|
| T1 | 弱模型 session 誤觸 | bypassPermissions 環境下 session 被誤導直接翻 L1 常數或改 env | §7 permissions deny＋W6＋L4 在另一進程（gateway），單點翻不穿 |
| T2 | prompt injection | 新聞/LLM 內容管線夾帶指令，誘導 agent「幫楊董下單」 | §4 逐筆授權：無 token 無單；token 只能由 Owner 在 UI 人工產生，agent 拿不到 |
| T3 | API 繞道／API 層被攻陷 | 繞過 web 直打 API 或 gateway；SSRF；API server 本身被拿下 | 繞道：token 綁單摘要＋gateway 只受理配對通道。API 被攻陷=**已知殘餘風險**：G-AUTH 驗證在 API 層，故 gateway 側必須獨立複製 G-LIMIT 硬上限（notional/單數，讀 gateway 自己的 env 設定）＋保留 L4 sim/live 閘＋`KGI_READ_ONLY_MODE` — API 全失守時損害仍被 gateway 上限封頂（見 §5 末） |
| T4 | 重放/重複下單 | 重送同一授權、retry storm、雙擊 | token 單次性（jti 一次性消耗）＋TTL 120s＋idempotency key＋§5 頻率上限 |
| T5 | 半單（斷線於送出後） | gateway timeout，成交狀態未知 | §6 對帳協議：未知態=凍結新單直到 reconciliation 完成；不自動重送 |
| T6 | 人為誤操作 | 楊董 fat finger（多打一個 0） | §5 金額/偏離上限硬擋＋UI 二段確認顯示 notional 全額 |
| T7 | 憑證/配對 token 竊取 | 客戶側 gateway 憑證外洩 | 既有架構（憑證不上傳、pair token 一次性 hash、revoke 即失效 #1144）＋§5 上限使損害有界 |
| T8 | 供應鏈/CI 篡改 | PR 悄改 W6 腳本或鎖檔 | §7 deny 覆蓋 W6 檔案本身＋板規「動 W6=需楊董 ACK」＋pete 審查清單加此項 |
| T9 | 跨帳戶錯單（Phase III） | 多用戶後單下到別人帳戶 | 授權摘要含 accountId＋workspace；gateway 配對綁定單一帳戶（既有 partial unique） |
| T10 | kill switch 自身失效 | 想停停不下來 | §6 kill 為 DB flag＋每筆 submit 前必查（fail-closed：查不到=視同 false=擋）；另有 L2/L4 env 兩條獨立停線 |

## §3 新增閘總覽（在 L1-L4 之上疊三件）

- **G-AUTH 逐筆授權**（§4）：真金單必附單次性授權 token。
- **G-LIMIT 上限引擎**（§5）：金額/頻率/偏離/時段硬上限，server-side pre-submit。
- **G-KILL 真金總閘**（§6）：global `real_order_trading_enabled` DB flag（**true=放行，false=擋，預設 false**。命名刻意無歧義 — v1 read-back 抓到原案 engaged/arm 語意反轉風險，已重命名）。

真金 submit 的檢查順序（任何一步 fail = 硬拒＋審計＋告警）：
`G-KILL：real_order_trading_enabled 必須 === true → G-LIMIT 全項 → G-AUTH 驗 token → adapter 送單 → 審計寫入（送單前 intent、送單後 outcome 各一筆）`

## §4 G-AUTH 逐筆授權協議

1. **Intent**：UI 建立訂單草稿 → server 產生 `order_digest = SHA256(workspaceId|accountId|symbol|side|qty|orderType|price|timeInForce|nonce)`。
2. **Approve**：Owner 在 UI 看到全欄位＋notional 總額 → **重新驗證**（輸入密碼；TOTP 為 open question O-1）→ server 簽發 token：`HMAC-SHA256(SERVER_AUTH_KEY, digest|jti|exp)`，`exp=120s`，jti 寫入 `real_order_authorizations` 表（§8）。**重驗防爆破**：密碼錯 5 次/15 分鐘 → 鎖簽發 30 分鐘＋審計＋告警（R-rule 級 critical）— 防 cookie 劫持後無限猜密碼。
3. **Submit**：帶 token＋原欄位 → server 重算 digest 必須完全一致（任何欄位變動=授權失效）→ jti 標記 consumed（DB unique 保證單次）→ 進 adapter。
4. **agent 隔離**：簽發 endpoint 要求 UI session（cookie）＋密碼重驗，**無任何 CLI/API token 路徑可產生授權** — 這是 T2 的核心防線。
- 驗收：①同 token 二次 submit → 409 ②改任一欄位 → 401 digest_mismatch ③過期 token → 401 ④無 UI session 打簽發端點 → 401 ⑤全流程審計 rows 齊。

## §5 G-LIMIT 上限引擎（初值＝楊董決策點 O-2，以下為建議預設）

| 限制 | 預設 | 說明 |
|---|---|---|
| 單筆 notional | ≤ NT$100,000 | 首月刻意小 |
| 當日累計 notional | ≤ NT$200,000 | |
| 當日真金單數 | ≤ 5 | |
| 價格偏離 | 限價與最近成交價差 ≤ ±5%，**approve 時與 submit 時各查一次**（各用當下最新成交價；submit 時超帶=拒絕並要求重新授權，堵 120s TTL 內的 TOCTOU 視窗） | 市價單 Phase II 禁用 |
| 時段 | 台股盤中 09:00-13:30 TST 且為交易日 | 用既有交易日曆檢查 |
| 冷卻 | 兩筆真金單間隔 ≥ 60s | 擋 retry storm |
- 全部 server-side、DB 設定表存值（改值=Owner endpoint＋審計）、超限=硬拒不降級。
- **gateway 側獨立複本（T3 防線）**：單筆 notional 與當日單數上限同時寫進 gateway 的 env 設定（gateway 進程自行檢查，不信任 API 傳入值）— 兩邊上限可不同，gateway 取更嚴者；改 gateway 上限=改 env=楊董層級操作。
- 驗收：每項一個超限測試＋一個臨界通過測試；改上限動作本身出現在 audit_logs。

## §6 G-KILL 真金總閘＋半單協議

- `real_order_trading_enabled` flag（DB，單列）：**true=放行，false=擋，預設 false**。submit 檢查必須寫成 `if (flag !== true) reject` — 禁止用否定式命名或反向布林（v1 read-back 判定原 engaged/arm 命名是 sign-flip 高風險，已定版此命名，實作不得再改名）。
- **Kill**：`POST /admin/real-order/kill`（Owner）將 flag 設 false＋交易台常駐紅鈕 — 無確認、無理由欄，按下即停（停=安全）。
- **啟用**：`POST /admin/real-order/enable` 需 Owner＋密碼重驗＋reason 文字（審計）。
- **fail-closed**：flag 查詢失敗（DB 斷）=視同 false=擋。
- **半單協議（T5）**：adapter 送出後未收到明確回報 → 該帳戶標 `reconciliation_pending`，自動 engage 帳戶層 kill（複用 risk-engine KillSwitchState）→ 禁新真金單直到對帳完成（查券商回報比對 `kgi-order-reconciliation.ts` 模式）→ 對帳結果審計。**永不自動重送**。
- 驗收：kill 演練（flag=false 時 submit 被擋）納入 Stage 3 必測；DB 斷線模擬=fail-closed 測試。

## §7 harness 層 permissions deny（T1/T8 防線，套用需楊董 ACK＝決策點 O-3）

在 `~/.claude/settings.json` permissions 加 deny（bypassPermissions 下 deny 仍優先）：
```json
"permissions": {
  "defaultMode": "bypassPermissions",
  "deny": [
    "Edit(**/broker/trading-service.ts)",
    "Edit(**/broker/kgi-sim-env.ts)",
    "Edit(**/domain/trading/execution-mode.ts)",
    "Edit(**/kgi-gateway/read_only_guard.py)",
    "Edit(**/kgi-gateway/app.py)",
    "Edit(**/scripts/audit/w6_no_real_order_audit.py)",
    "Edit(**/.github/workflows/ci-security.yml)",
    "Write(**/broker/trading-service.ts)",
    "Write(**/broker/kgi-sim-env.ts)",
    "Write(**/domain/trading/execution-mode.ts)",
    "Write(**/kgi-gateway/read_only_guard.py)",
    "Write(**/kgi-gateway/app.py)",
    "Write(**/scripts/audit/w6_no_real_order_audit.py)",
    "Write(**/.github/workflows/ci-security.yml)"
  ]
}
```
- 正當開發要動這些檔（如 Phase 2 實作本 spec）：楊董當場暫時移除對應 deny 行，該 session 結束後加回 — 流程寫進 maintenance_protocol。
- 誠實標註：deny 的 glob 語法以 update-config skill 當下實測為準（上述為草案形狀）；套用時先用一個無害檔驗證 deny 生效再上正式清單。Bash 側繞道（sed 改檔）deny 擋不住 — 補償控制=W6 CI 必擋＋PR 審查，這是「機制＋制度」雙層而非單靠 deny。

## §8 審計軌跡

- 新表 `real_order_authorizations`：`id, workspaceId, accountId, digest, jti(unique), payload(jsonb 全欄位), issuedAt, expiresAt, consumedAt, approvedBy, approvalMethod, sourceIp`。migration 必經 Mike 審。
- `audit_logs` 新 action：`real_order_intent / real_order_authorized / real_order_submit / real_order_outcome / real_order_kill / real_order_enable / real_order_limit_change`，payload 含授權 id 鏈。
- 每日真金日報：當日全部真金動作摘要（含 0 筆也發）進晨報管線給楊董。

## §9 分階段解鎖

| Stage | 內容 | 進入條件 | 退出條件 |
|---|---|---|---|
| 0（現在） | 四層鎖現狀＋§7 deny 套用 | 楊董 ACK O-3 | deny 生效驗證過 |
| 1 | Fubon read-side（行情/帳務，零 write 代碼） | 介面凍結件完成（Fable 窗 A2） | read e2e 通＋W6 擴充 Fubon 檢查 |
| 2 | write-side 代碼進 repo 但三鎖鎖死（Fubon 版 L1 常數＋env＋W6） | Stage 1 過 | CI 綠＋pete/bruce 雙審 |
| 3 | UAT 全鏈演練：G-AUTH/G-LIMIT/G-KILL＋kill 演練＋半單對帳演練（模擬） | Stage 2 過＋本 spec 全驗收項綠 | 演練報告 bruce 出、楊董過目 |
| 4 | 首單：最小單位（1 股零股級）、楊董在場手動授權、kill 演練通過且紅鈕在手、成交後與券商對帳單核對 | Stage 3 過＋楊董說 go | 首單對帳一致 → 微額運行一週無事故 → 楊董再議調升上限 |
- **任何 Stage 跳序 = 停下問楊董**（roadmap Phase II 風險條）。

## §10 Open Questions（=== 需楊董 ACK ===）

- **O-1** ✅ **已裁決（楊董 2026-07-03）：Phase II 用密碼重輸**；TOTP 列為 Phase III 進入條件之一（開放外部用戶前必升，屆時另提）。實作照 §4：簽發端點=UI session＋密碼重驗＋5 次/15 分鐘爆破鎖定。
- **O-2** ✅ **已裁決（楊董 2026-07-03）：照 §5 建議表**（單筆 ≤10 萬/日累計 ≤20 萬/日 ≤5 筆/偏離 ±5% 雙查/盤中限定/冷卻 60s），楊董授權「或研究後合適初值」— 定版維持原表（理由：Phase II 目的=驗管線非賺錢，2330 一股首單 ≈2,400 元，上限給足 40 倍餘裕已夠演練；調升走 §5 的 Owner endpoint＋審計，不用改 spec）。
- **O-3** ✅ **已裁決並執行（楊董 ACK「套」，2026-07-03 部署＋實測）**：
  - **主防線=PreToolUse hook**（`~/.claude/hooks/protect_real_money_paths.py`，settings.json 掛 `Edit|Write|NotebookEdit`）：**已在 bypassPermissions 全開權限下金絲雀實測攔截成功**（exit 2 硬擋）；正常檔案寫入實測不受影響。要正當修改鎖檔=楊董暫時註解 hook 內對應行，改完加回。
  - **副防線=permissions deny 16 條**（§7 清單）已裝入 settings.json。誠實標註：deny 單獨測試在本 session 內三種 pattern 均未攔截（與官方文件「deny 在 bypass 下仍強制＋hot-reload」說法不符，疑本版本行為差異）— 故以 hook 為主、deny 為備援層，新 session 可用金絲雀（寫 `deny_test_canary.txt` 應被擋）隨時驗證防線活著。
  - settings.json 原版備份：`~/.claude/backups/settings.json.bak-20260703`。
- **O-4** ⏳ **狀態（楊董 2026-07-03）：富邦開戶/API 尚未申請** → Stage 1 實作 blocked，楊董 action item=申請富邦開戶＋新一代 API（Neo）權限＋拿測試環境；申請期間工程照走介面凍結件（不 block）。
- **O-5** ✅ **已裁決（楊董 2026-07-03）：首單=2330 零股 1 股**。

---
## 版本紀錄
- v1 2026-07-03 Fable 5 起草（Explore 實掃 origin/main @ bf5711fa 為據）。
- v1.1 同日：fresh-context read-back（sonnet 對抗）抓 4 洞全修 — ①engaged/arm 命名反轉 → 定版 `real_order_trading_enabled`（true=放行）②T3 gateway 獨立性言行不一 → 改為誠實殘餘風險＋gateway 側 G-LIMIT 複本 ③密碼重驗加爆破鎖定 ④價格偏離 band 定版 approve+submit 雙查。
