# IUF Trading Room 多租戶邊界審計 v1

- 審計日期：2026-07-12
- 基線：`origin/main@35753656`
- 範圍：`apps/api/src/**`；並以 `packages/db/src/schema.ts`、`packages/db/migrations/**` 核對資料表租戶欄位與約束
- 判定原則：租戶擁有的資料必須由 session-derived `workspace_id` 限縮；只有 ID、角色或「Owner-only」都不是租戶邊界
- 限制：本報告是靜態程式碼審計，未讀 production data、未 deploy；「待確認」項在第二個 workspace 上線前仍應視為阻擋事項

## 結論

目前不可安全建立第二個 workspace。最高風險是 `iuf_events` 沒有 `workspace_id`，但 alerts、notifications、SSE、email digest、decision orchestrator 與 web push 都讀同一個全域事件池；任何 workspace 產生的事件都可被其他 workspace 讀取、ack 或推播。`push_subscriptions` 同樣沒有 workspace 維度，`dispatchAlertPush()` 會枚舉全表。

第二層風險是 paper/continuous ledger、Brain/AI recommendation、LLM/ToolCenter observability 的資料表或讀路徑仍是全域；其中部分 endpoint 雖是 Owner-only，第二個 workspace 也會有自己的 Owner，因此角色閘門無法防止跨租戶讀取。排程器普遍只選第一個或 DEFAULT workspace，會造成其他 workspace 沒資料、錯誤 dedupe，或把 primary workspace 的結果當成系統結果。

本次檢查也確認 watchlist、workspace invites、event-log stream、paper broker state、unified order 的主要 create/list/get 路徑已有 session workspace 條件，可作為修復範本；但 unified order 的內部 update helpers 仍只以 order ID 更新，應補 defense-in-depth。

## 風險等級與修復難度

- P0：第二個 workspace 建立前必修；可直接造成資料外洩或跨租戶狀態污染。
- P1：邀請制擴大前修；Owner/admin observability、排程或衍生資料會跨租戶。
- P2：強化與資料模型演進；目前有上游保護，但 DB/內部 helper 沒有完整租戶不變量。
- S：單模組/小 migration；M：跨 schema、store、route、tests；L：跨多張表、排程或歷史資料語意。

## 完整清點表

| ID | 優先 | 檔案:行號 | 資料表/狀態 | 現狀行為 | 第二個 workspace 的外洩或污染場景 | 難度 |
|---|---|---|---|---|---|---|
| T-01 | P0 | `packages/db/src/schema.ts:1308`、`apps/api/src/push/push-subscriptions.ts:46` | `push_subscriptions` | 表只有 `user_id/endpoint/keys`；store 的 upsert、list、delete 沒有 workspace。 | A 的 endpoint 會進入全域裝置集合；B 事件可推到 A 裝置，410/404 也能依 endpoint 刪掉另一租戶的列。 | M |
| T-02 | P0 | `apps/api/src/push/alert-push.ts:156`、`:174` | `push_subscriptions` | `dispatchAlertPush()` 呼叫 `store.listAll()`，節流 key 也只有 `ruleId`。 | A/B 同類事件互相節流；任一事件廣播到所有 workspace 裝置。 | M |
| T-03 | P0 | `packages/db/migrations/0025_iuf_events.sql:12` | `iuf_events` | 事件表沒有 `workspace_id`，索引與 unread 狀態全域。 | 無法證明事件擁有者，也無法在 SQL 層安全列出、ack、dedupe 或推播。 | L |
| T-04 | P0 | `apps/api/src/openalice-event-rule-engine.ts:1273`、`:1314` | `iuf_events` | `listEvents()` 沒有 workspace 參數，列出全表事件。 | A 的 `/alerts`、`/iuf-events` 可看見 B 的 ticker、payload、時間與狀態。 | L |
| T-05 | P0 | `apps/api/src/openalice-event-rule-engine.ts:1355`、`:1363` | `iuf_events` | acknowledge 只用 event UUID 更新。 | 從 SSE/通知/猜得 ID 後，A 可把 B 的警示設為已讀，污染 B 的 unread 狀態。 | M |
| T-06 | P0 | `apps/api/src/server.ts:15363`、`:15414`、`:15497` | `iuf_events` | alerts、SSE、raw diagnostic route 只檢查登入/角色，不傳 workspace。 | 任何登入者可收全域事件；SSE 每 15 秒持續外洩其他租戶的新事件。 | M（依賴 T-03） |
| T-07 | P0 | `apps/api/src/server.ts:20935`、`:21105` | `audit_logs`、`daily_briefs`、`iuf_events` | audit/brief 已按 workspace，但合併的 `listEvents()` 是全域。 | 通知抽屜混入其他租戶事件；event acknowledged 狀態與 unread badge 跨租戶共用。 | M（依賴 T-03） |
| T-08 | P0 | `apps/api/src/server.ts:21166`、`:21173` | `iuf_events` | mark-read 接受 `event-<uuid>` 後直接全域 ack。 | A Owner 可用 B 的 event ID 改寫 B 狀態；audit 只記在 A，形成錯誤稽核歸屬。 | M（依賴 T-03） |
| T-09 | P0 | `apps/api/src/openalice-email-digest.ts:84`、`:89` | `iuf_events` | digest 依日期查全域事件，沒有 workspace 或 per-workspace recipient。 | A 的 digest 可能包含 B 的事件內容；收件人與資料租戶無法對齊。 | L |
| T-10 | P0 | `apps/api/src/openalice-event-rule-engine.ts:957`、`:988`、`:1028` | `iuf_events` | 一小時/每日 dedupe 與 INSERT 都不含 workspace。 | A 已觸發的 rule+ticker 會壓掉 B；寫入後也失去來源租戶。 | L |
| T-11 | P0 | `apps/api/src/openalice-event-rule-engine.ts:654`、`:655` | `workspaces`、KGI SIM smoke history | 明寫 single-tenant，使用 `SELECT id FROM workspaces LIMIT 1`。 | 只監控不穩定排序下的第一個 workspace；其他 workspace 故障不會產生正確事件。 | M |
| T-12 | P0 | `apps/api/src/openalice-event-rule-engine.ts:1039`、`:1050` | `iuf_events`、`push_subscriptions` | event 寫入後只傳 `ruleId/ticker` 給 push，沒有 workspace provenance。 | 即使只修 push table，事件鏈仍無法選出正確訂閱者；只能安全地 fail closed 或暫綁 primary。 | L |
| T-13 | P0 | `apps/api/src/openalice-event-rule-engine.ts:1170`、`:1175`、`:1214` | `audit_logs` | force-dispatch 的 start/per-event audit 都 `FROM workspaces LIMIT 1`。 | B Owner 觸發 force-dispatch，稽核卻寫到 A；責任歸屬與 incident timeline 被污染。 | M |
| T-14 | P0 | `packages/db/src/schema.ts:1133`、`apps/api/src/openalice-orchestrator.ts:294` | `iuf_decisions`、`iuf_events`、`signals` | `iuf_decisions` 無 workspace；orchestrator 全域掃 events/signals 並全域 dedupe。 | B signal 可在 A 的運算/決策面出現；trigger ID 的全域唯一會壓掉租戶語意，決策無法授權。 | L |
| T-15 | P1 | `apps/api/src/openalice-orchestrator.ts:462`、`:477` | `iuf_decisions` | observability 對全表 group/list。 | A Owner 可看見 B 的 decision reasoning、outcome 與操作類型。 | M（依賴 T-14） |
| T-16 | P1 | `apps/api/src/signal-auto-emitter.ts:115`、`:119` | `signals`、`workspaces` | auto emitter 快取第一個 workspace，所有自動訊號寫入該處。 | B 永遠收不到自己的訊號；重啟/資料順序改變時訊號可能改寫到另一 workspace。 | M |
| T-17 | P1 | `apps/api/src/theme-refresh.ts:295`、`:296` | `themes`、`workspaces` | refresh 每次只選第一個 workspace。 | 只有 A 題材更新；排序改變時 cron 目標漂移，B 的題材可能長期 stale。 | M |
| T-18 | P1 | `apps/api/src/openalice-event-rule-engine.ts:698`、`:705` | `themes` | R14 freshness 用全域 `MAX(updated_at)`。 | A 今天更新過即可掩蓋 B 的 stale；或 B 更新令 A 誤判正常。 | M（與 T-03 同步） |
| T-19 | P1 | `apps/api/src/server.ts:19508`、`:19529` | scheduler workspace resolution | DEFAULT 不存在時退回 DB 第一個 workspace；多個 cron 共用單一 slug。 | 第二個 workspace 不會執行 pipeline/AI/market cron；fallback 目標不具決定性。 | L |
| T-20 | P1 | `apps/api/src/openalice-strategy-brief.ts:852`、`:858` | strategy briefs、`workspaces` | `workspaceSlug` input 未用於解析，直接取第一個 workspace ID。 | B 要求產生 brief 時可能讀/寫 A 的 source pack 或 audit provenance。 | M |
| T-21 | P0 | `packages/db/src/schema.ts:489` | `paper_orders`、`paper_fills` | paper order 沒 `workspace_id`；以 `user_id` 關聯但 schema 無 FK，idempotency key 全域唯一。 | workspace 邊界依賴 user 永不搬移且 ID 永不誤用；相同 idempotency key 可跨租戶互相阻擋。fills 只能經 order 間接歸屬。 | L |
| T-22 | P0 | `apps/api/src/server.ts:12978`、`:13009` | `paper_orders`、`audit_logs` | `/paper/e2e` 對所有 paper orders/audit logs 做全域統計。 | A 可觀察 B 是否有下單/填單與活動量，並把 B 活動當成 A readiness。 | M |
| T-23 | P0 | `apps/api/src/server.ts:13058`、`:13071` | `paper_orders` | `/portfolio/preview` 對所有租戶 FILLED buy 統計 distinct symbols。 | A 的部位數含 B；即使不回明細，也洩漏活動並造成錯誤帳務畫面。 | M |
| T-24 | P0 | `apps/api/src/server.ts:14038`、`:14070`、`:14083` | `paper_orders` | unauthenticated paper health 回傳全系統 last fill 與 pending queue depth。 | 外部人可觀察所有租戶交易活動時間/量；多租戶後不再只是安全的服務健康值。 | M |
| T-25 | P0 | `apps/api/src/server.ts:14151`、`:14204`、`:14235` | `paper_orders`、`audit_logs` | detail health 以全表聚合 fill 與 audit。 | 公開端點洩漏全租戶交易/操作活動，且 readiness 被其他租戶資料污染。 | M |
| T-26 | P0 | `packages/db/src/schema.ts:1208`、`:1230`、`:1253` | `sim_ledger_weeks/holdings/nav` | 三張 continuous ledger 表都沒有 workspace。 | 第二個 workspace 無法擁有獨立 NAV/部位/損益；任何寫入都污染同一帳本。 | L |
| T-27 | P0 | `apps/api/src/track-record-handlers.ts:123`、`:131`、`:144` | `sim_ledger_nav`、`sim_ledger_weeks` | NAV read helper 全表讀取，供 Owner/public track-record 共用。 | A/B 讀到同一條 NAV，且任何租戶回補都改變其他租戶對外績效。 | L |
| T-28 | P2 | `apps/api/src/broker/unified-order-store.ts:126`、`:160`、`:189`、`:220` | `unified_orders` | create/list/get 已 workspace scoped；submitted/rejected/cancel/fill update helper 只用 order ID。 | 目前呼叫者多從 scoped list 取得 ID，但未來 callback、reconcile 或誤傳 ID 可跨租戶更新狀態。 | M |
| T-29 | P0 | `apps/api/src/brain/react-loop.ts:964`、`:996` | `brain_decisions` | listRecentDecisions 與 getDecisionByRunId 不帶 workspace filter。 | A Owner 可列舉 B run ID，再讀完整 prompt、trace、report、cost。 | M |
| T-30 | P0 | `apps/api/src/server.ts:22616`、`:22666` | `brain_decisions` | route 有 Owner role gate，但不把 session workspace 傳給 list/detail。 | 每個 workspace 的 Owner 都能讀其他 workspace 的 AI reasoning 與輸入資料。 | M |
| T-31 | P1 | `apps/api/src/ai-recommendation-v2/orchestrator.ts:75`、`:83` | `ai_recommendations_runs` | v2 latest read 只依 trigger 排除 v3，不過濾 workspace。 | A Owner 可能取得 B 最新 run 的選股、trace、report 與成本。 | M |
| T-32 | P0 | `apps/api/src/ai-recommendation-v2/orchestrator-v3.ts:660`、`:668`、`apps/api/src/server.ts:20409` | `ai_recommendations_runs` | v3 latest read 全域；GET route 甚至不驗 session，並回 trace/report/debug。 | 公開取得任一租戶最新 AI run 與完整 reasoning；B run 會覆蓋 A product surface。 | M |
| T-33 | P1 | `apps/api/src/ai-recommendation-v2/orchestrator-v3.ts:475`、`:514` | `ai_recommendations_runs` | stale sweep 與每日已有 run 判定均未按 workspace。 | A 的 run 阻止 B 當日生成；A refresh 可把 B 的 running row 標 failed。 | M |
| T-34 | P1 | `packages/db/src/schema.ts:1081`、`apps/api/src/ai-rec-perf-store.ts:233`、`:295` | `ai_rec_pick_snapshots` | pick snapshots 沒 workspace；upsert/backfill/price lookup 全域。 | A/B 同日同 ticker 互相覆寫績效樣本；company price 可從另一 workspace 同 ticker 取值。 | L |
| T-35 | P1 | `apps/api/src/admin-brain-llm.ts:81`、`:110`、`:153` | `llm_calls`、`llm_cost_daily` | API 接受 `workspaceId` 但查詢完全忽略；server 也未傳 session workspace。 | A Owner 看見 B 的 model/module 使用量、token 與成本；成本預算/告警被混算。 | M |
| T-36 | P1 | `apps/api/src/tools/tool-registry-store.ts:129`、`:157`、`:292`、`:321` | `tool_calls` | registry 是全域合理，但 execution history、calls、stats 不按 workspace。 | A Owner 可讀 B 的 tool caller/status/error/timing；也可能從 summary 推知 B 的工作內容。 | M |
| T-37 | P2 | `apps/api/src/auth-store.ts:162`、`:167` | `users`、`workspaces` | legacy/null `users.workspace_id` 會被自動綁到第一個 workspace。 | 遺留或異常 user 登入後進入不確定 workspace；新增 workspace 後歸屬會隨查詢順序漂移。 | S |
| T-38 | P2 | `apps/api/src/auth-store.ts:171`、`apps/api/src/invite-store.ts:233` | `users` | email 全域唯一、user 僅一個 `workspace_id`，沒有 membership join table。 | 目前可支援「不同人各屬一 workspace」，不能讓同一帳號受邀加入多 workspace；若產品要 workspace switch，需另案資料模型。 | L |
| T-39 | P2 | `packages/db/src/schema.ts:166`、`apps/api/src/theme-refresh.ts:143` | `company_theme_links` | link table無 workspace 欄位；讀取多依賴已 scoped 的 theme/company ID，DB 不保證兩端同 workspace。 | 任一錯誤 insert 可建立 A company → B theme 邊，之後題材成員、pool count、Brain tool 結果跨租戶污染。 | M |
| T-40 | P2 | `packages/db/src/schema.ts:293`、`:308`、`apps/api/src/openalice-bridge.ts:631` | `openalice_devices` | device 本身有 workspace，但 `external_device_id` 全域唯一，初始 lookup 只看 external ID。 | 若外部裝置 ID 只在客戶環境內唯一，B 無法註冊相同 ID；更新/配對流程可能誤認 A 裝置。需確認 device ID contract。 | M（待確認） |
| T-41 | P2 | `packages/db/migrations/0026_iuf_notification_preferences.sql:13` | `iuf_notification_preferences` | preference 只有 user_id；註解/檔名狀態不一致，需確認 migration 實際套用。 | 單 workspace user 模型下間接隔離；若未來同 user 多 workspace，通知偏好會互相覆蓋。 | M（待確認） |
| T-42 | P2 | `apps/api/src/server.ts:20710`、`:20760`、`:20861` | filesystem coverage/wiki | 註解明寫 multi-tenant deferred；Owner route 搜尋共用 filesystem coverage，不使用 workspace。 | 若 coverage 是平台共用市場資料則合理；若租戶可自訂 coverage，A 會看見 B 的研究語料。需先定義 data ownership。 | S（待確認） |
| T-43 | P1 | `packages/db/migrations/**`（全樹無命中） | DB access control | 沒有 `ROW LEVEL SECURITY`/policy；租戶邊界完全依賴應用查詢。 | 任一漏掉 workspace predicate 的新 route/store 立即成為跨租戶洞，沒有 DB 第二道防線。 | L |

## 已確認的安全基線（negative controls）

以下不是「已全部安全」的保證，而是本次找到可直接複用的 workspace-scoped 模式：

| 區域 | 證據 | 結論 |
|---|---|---|
| Watchlist | `apps/api/src/server.ts:6536`、`:6555`、`:6574` | list/add/remove 同時使用 session `workspace_id` + `user_id`；目前未見跨租戶 ID path。 |
| Workspace invites | `apps/api/src/invite-store.ts:121`、`:156`、`:253`、`:346` | list/revoke/users 按 workspace；claim token 以不可枚舉 hash 取得 invite，並把新 user 寫入 invite.workspace。 |
| Unified order reads | `apps/api/src/broker/unified-order-store.ts:264`、`:286` | list/get 同時限制 workspace；內部 update helper 仍見 T-28。 |
| Paper broker state | `apps/api/src/broker/paper-broker-store.ts:35`、`:55`、`:81`、`:90` | load/save/delete 皆以 session workspace 限縮。 |
| Execution events | `apps/api/src/broker/execution-events-store.ts:87`、`:134` | insert/list 使用 session workspace；可作 alerts store API 範本。 |
| EventLog stream | `apps/api/src/server.ts:22372`、`:22388` | route 把 session workspace 傳給 readStreamEvents；stream ID 不是唯一授權條件。 |
| Theme admin writes | `apps/api/src/admin-themes-manual-update.ts:95`、`apps/api/src/admin-themes-re-encode-mojibake.ts:164` | 先以 workspace 限縮目標集合，再按已驗證 ID 更新；仍應以複合 WHERE 作 defense-in-depth。 |
| Session workspace header | `apps/api/src/server.ts:402`、`:455` | middleware 會拒絕 requested workspace 與 user.workspace 不同；但不能補救下游全域 SQL。 |

## 橫切面問題

1. **資料所有權沒有統一分類。** `companies_ohlcv`、filesystem coverage、model/tool registry 可能是平台共用；themes、signals、orders、events、decisions、cost/audit 明顯是 tenant-owned。未先分類，工程師會在「共用市場資料」與「租戶產物」間任意傳播 workspace。
2. **角色閘門被誤當租戶邊界。** 多個 route 是 Owner-only，但每個 workspace 都會有 Owner；Owner 只能管理自己的 workspace。
3. **background jobs 沒有 workspace fan-out contract。** `LIMIT 1`/DEFAULT workspace 在單租戶可用，多租戶必須明確選擇：逐 workspace 執行、平台全域執行，或 fail closed。
4. **衍生資料會遺失 provenance。** event → decision → push、AI run → pick snapshot、paper order → ledger 的下游表常沒有 workspace；只修最末端查詢無法恢復歸屬。
5. **缺少 DB guardrail。** 應用層是主要邊界，但至少需複合 unique/index/FK、一致的 repository API，以及針對 tenant-owned tables 的 RLS 可行性評估。

## 修復 roadmap

### Phase 0：第二 workspace 建立前的 launch blockers

1. 先完成 PR-B：`push_subscriptions.workspace_id`、workspace-scoped store/dispatch、跨租戶 push regression。
2. 緊接一張獨立 migration 為 `iuf_events` 加 `workspace_id`，backfill 到 primary，並把 engine writer/dedupe/list/ack/SSE/notifications/email digest 全鏈改成 required workspace。PR-B 依「一期一表」規則不做此 migration；在它完成前，非 primary event push 應 fail closed。
3. 為 `iuf_decisions` 加 workspace 並從 event/signal 傳遞；所有 observability/action executor/verifier 需按 workspace。
4. paper account model 決策：把 `paper_orders`/fills 補 workspace，或正式淘汰舊表並只用 workspace-aware broker state/unified orders。公開 health 僅回服務健康，不回全租戶活動量。
5. continuous ledger 三表補 workspace + composite unique，所有 backfill/EOD/read API 明確接收 scheduler/session workspace。

### Phase 1：邀請制擴大前

1. background scheduler 改為可測的 workspace fan-out；移除 production path 的 unordered `.limit(1)`。
2. Brain、AI recommendation、pick snapshots、LLM calls/cost、tool calls 全部在 read/update/dedupe 路徑加入 workspace。
3. 對所有 `/:id` mutation 採 `WHERE id = ? AND workspace_id = ?`；service helper 必須要求 workspace 參數，不能只靠上游已查過。
4. 建立兩 workspace integration fixture，覆蓋 Owner/Admin/Analyst/Trader/Viewer 對 list/detail/mutation/SSE/background job 的負向矩陣。

### Phase 2：資料模型與共用資料分類

1. 決定 users 是否需要多 workspace membership；若需要，新增 `workspace_memberships(user_id, workspace_id, role, status)`，session 明確選 active membership。
2. 為 `company_theme_links` 加同租戶不變量（workspace 欄位 + composite FK/trigger，或由 service transaction 強制驗證）。
3. 定義 global-shared tables：market OHLCV、coverage、model/tool registry；任何租戶衍生欄位不得寫回共用 row。
4. 評估 tenant-owned tables 的 PostgreSQL RLS，至少先在 staging 做 policy/connection-pool threat model。

### Phase 3：持續防回歸

1. CI 靜態檢查：禁止 tenant-owned table 的裸 `select/update/delete`；允許清單需附 global-shared 設計註解。
2. migration 審計模板新增 tenancy 欄：workspace FK、backfill、composite UNIQUE、query index、DESC/schema 對齊、down symmetry。
3. 每個新事件/通知/排程需回答「workspace 從哪裡來、如何 fan-out、如何 dedupe、如何 fail closed」。
4. 定期執行兩租戶 canary：A 建資料、B list/detail/mutate 均不得觀察或影響 A。

## PR-B 的安全邊界說明

PR-B 只允許 migration 0052 修改 `push_subscriptions` 一張表。由於 `iuf_events` 在 migration 0025 沒有 workspace，PR-B 無法宣稱完整 event tenancy 已完成。可接受的一期行為是：event engine 明確取得目前 primary workspace，將其傳到 `dispatchAlertPush(workspaceId, event)`；dispatcher 只列該 workspace 訂閱。這維持現有單租戶結果，並停止全系統廣播，但第二 workspace 的真正 event provenance 必須由下一期 `iuf_events.workspace_id` migration 完成。

## 審計命令與覆蓋

```text
rg -n -i 'single[- ]tenant|primary workspace|workspace_id|workspaceId' apps/api/src --glob '*.ts'
rg -n -i -U 'FROM\s+workspaces[\s\S]{0,160}LIMIT\s+1|\.from\(workspaces\)[\s\S]{0,240}\.limit\(1\)' apps/api/src
rg -n -i 'FROM (iuf_events|paper_orders|unified_orders|brain_decisions|themes|companies|signals|trade_plans)' apps/api/src
rg -n -i 'row level security|enable row level|create policy' packages/db/migrations apps/api/src packages/db/src
```

- `apps/api/src` workspace/primary keyword候選：276 行（逐一按 target domain 追蹤；安全命中列於 negative controls）。
- target table raw-SQL 候選：89 行。
- RLS/policy 命中：0。
- 特別領域覆蓋：events、notifications、push、alerts、watchlist、paper/continuous ledger、unified_orders、invites、brain/AI/tooling、themes。

## 未解決事項

- `iuf_events` 缺 workspace 是 PR-B 之外的 P0；第二 workspace 不得在該 migration 完成前啟用 event/alerts/notification/email digest。
- `paper_orders` 與 `sim_ledger_*` 的 tenancy migration 需帳本線 owner 決定 canonical model；本報告未修改活躍帳本檔。
- filesystem coverage 與 OHLCV 是否平台共用，需產品/資料治理明確 ACK 後才能從待確認清單移除。
- users 是否需同帳號多 workspace membership 尚未定義；目前 schema 只支援一 user 一 workspace。
