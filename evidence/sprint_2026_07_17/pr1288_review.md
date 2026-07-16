# PR #1288 Desk Review — Pete 2026-07-17

## 1. PR Intent
- 新增 admin-mediated 忘記密碼流程：使用者自送 email 申請 → Owner/Admin 審核產生一次性 token → 使用者用 token 設新密碼；理由是本 app 無可寄任意使用者信箱的通道，複用 workspace_invites 的「admin 產生連結、人工轉交」模式。附帶新增 `users.session_epoch` 機制讓成功 reset 後全域舊 session cookie 失效。
- 對應 sprint task：忘記密碼補件（session_handoff 7/17 佇列項目②）。
- Base branch：main（review 當下 HEAD 2c52902e = Mike migration 0060 audit APPROVED 0 blocker，比 PR base f9368eae 多的都是 docs commit，無程式碼交叉衝突；#1284-#1287 均已在 base 內）。

## 2. Diff Summary
- 改了 10 個檔（+1110 / -24）
- 主要改動：`password-reset-store.ts`（新檔，272 行，核心邏輯）、`server.ts`（+新 4 路由 + cookie payload 全域改格式 `userId` → `userId:epoch`）、`auth-store.ts`（cookie sign/parse + `getUserById` 加 epoch 比對）、migration 0060（`password_reset_tokens` 表 + `users.session_epoch`）、schema.ts 對應、`invite-store.ts`（3 行，AuthResult 型別多帶 sessionEpoch）、2 份新測試檔（277+269 行）。
- LOC: +1110 / -24

## 3. IUF Blocker Checklist
- A. Kill-switch/Real-order：diff grep `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|/order/create` 全無命中 — PASS
- B. Auth/Secret：新 public 路由用 `isPublicAuthRoute()` 明確 allowlist（非預設放行全域）；admin 路由走 `session.user.role` Owner/Admin 檢查 — PASS；無 hardcoded secret（grep 確認）— PASS；⚠️ 見下方 🔴（enumeration 時序側漏）
- C. State/Schema：migration 0060 forward+down 成對、`IF NOT EXISTS`/`IF EXISTS` 冪等，schema.ts 索引定義與 DDL 一致（無 0046/0048/0049 式 DESC 落差）— PASS；`session_epoch` 全域 cookie 格式變更已在 PR body 明確揭露（deploy 後全員需重登入一次）— disclosed, N/A blocker
- D. PR Hygiene：commit 為 conventional commits；DRAFT 狀態；base=main 正確非跨鏈汙染 — PASS；title 無 W\<n\>day\<n\> 標記 — 💭 nit
- E. 不可越線：Lane 擴大（Jason 動 auth-store.ts/server.ts）PR body 聲明「楊董 ACK，見任務派工」— 無法獨立查證但有明確揭露，非隱瞞 — PASS（trust-but-disclosed）；無 governance bypass；無 KGI `/order/create`；無 redaction 違規 — PASS

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
1. **[Auth/Security] 帳號枚舉防護的「無時序側漏」宣稱與實作不符（timing oracle）**
   - 位置：`apps/api/src/password-reset-store.ts:63-88`（`requestPasswordReset`）；宣稱位置 `apps/api/src/server.ts:20898-20900`（"no timing-sensitive branch visible to the caller"）
   - 輸入什麼→壞成什麼樣：攻擊者對同一組候選 email 清單批次打 `POST /api/v1/auth/request-password-reset`。命中真實 active 帳號的路徑會多跑 2 次 await DB round-trip（`:77` UPDATE revoke pending + `:88` INSERT 新 row）；未命中/非 active 帳號的路徑在 `:73` `if (!user || isActive===false) return;` 直接短路，只跑 1 次 SELECT。兩者 HTTP 回應（status/body）逐位元組相同（PRS-2 測試驗證的是「不寫 row」，不是「不花額外時間」），但回應延遲有結構性差異——這正是 PR 自己在 server.ts 明文宣告要防的「no timing-sensitive branch」，實作卻沒補這一塊。可用於枚舉本平台真實使用者 email（內部交易平台使用者名單本身即敏感資料）。
   - 建議：命中/未命中兩分支要跑等量 await 工作（例如未命中分支也執行一次等價形狀的 no-op UPDATE，或改用「先查是否存在，再無條件對一個 dummy/自身做等量寫入」的固定路徑），或最低限度替未命中分支加人工延遲對齊命中分支的量測延遲分布。修完需補一個時序測試或至少在 PRS-2 旁補註記此限制範圍。

### 🟡 Suggestions (should fix)
1. **兩份新測試的唯一執行位置是 CI 的 `db-tests` job，該 job 現況為「informational，非 required check」**（`.github/workflows/ci.yml` db-tests job 註解：「Status: NOT in branch-protection required checks yet... treat this job's result as informational.」）。本 PR 對外宣稱的兩個核心安全屬性（帳號枚舉防護、session 全失效）僅由 `password-reset-store.test.ts`（11 支）+ `password-reset-flow.test.ts`（4 支）覆蓋，而這兩檔只掛在 `test:db`（非 CLAUDE.md 定義的四道必過關卡之一）。CI 全綠不代表這兩個屬性被強制驗證過——未來有人改壞這條路徑，required gates 不會擋下。建議：至少把這兩個新測試檔（或整個 db-tests job）排入 required checks，或在 PR 合併前由 Bruce 手動確認一次 `test:db` 綠燈並把結果貼進 evidence（不能只信本機跑過的宣稱）。
2. **無 rate limit**：`request-password-reset`／`reset-password` 兩個公開端點都沒有 IP 或 email 維度的速率限制（與現有 `/auth/login` 同樣沒有 rate limit 一致，非本 PR 獨有退化，但因為每次命中 active email 都會 INSERT 一個 pending row，沒有節流也沒有 cleanup job，佇列可被灌爆——PR 自己的 migration 註解也承認「future cleanup job」還沒做）。建議至少加 email 維度節流（例如同 email 60 秒內只接受一次 request）。
3. **成功路徑缺 operational audit log**：`generate-link` 成功、`reset-password` 成功都沒有 `console.log` 記錄（對照同檔案內 `owner-reset-password`／`change-password` 成功時都有記 `user_id`/`ip`）。DB 層雖有 `generated_by`/`generated_at`/`used_at` 可回溯，但缺少 IP 與即時 log stream 可見度，事後鑑識（例如懷疑某 admin 濫權幫別人重設密碼）會比其他 auth 端點麻煩。建議補一行 `console.log` 比照既有端點格式。

### 💭 Nits (nice to have)
1. PR title 未帶 `W<n> day<n>` sprint 標記（其餘 PR 慣例常見但非強制）。
2. `password_reset_tokens_requested_at_idx` 為升冪索引，但應用層查詢用 `ORDER BY requested_at DESC`（`password-reset-store.ts` listPendingPasswordResetRequests）——Postgres 對 btree 索引可反向掃描，非正確性問題，純粹風格一致性可選項。

### ✅ Praise
- Migration forward/down 成對且 idempotent，schema.ts 索引定義與 DDL 完全對齊，避開了歷史上 0046/0048/0049 三次犯過的 DESC 落差陷阱。
- Atomic claim（`UPDATE ... WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() RETURNING id`）正確防雙重使用，且 PRS-8/PRS-11 測試確實覆蓋「已生成但未用的舊連結，被新一輪申請 supersede 後即失效」這種容易漏測的競態場景——比多數同型 PR 測得更細。
- `session_epoch` 設計乾淨：cookie payload 內嵌 epoch、`getUserById` 比對不符即拒，且驗證方式是實際 spawn 真 server 打 HTTP boundary（`password-reset-flow.test.ts`），不是只信 store 層單元測試——符合本 team 一貫「re-derive 不要信宣稱」的標準。
- 已知的既有限制（`change-password`/`owner-reset-password` 只清呼叫者自己 cookie、不動 session_epoch）在 PR body 與程式碼註解中都誠實揭露，未過度宣稱「全部 session 都會被強制登出」。
- 前端文案已避開「已寄出信件」措辭（PR body 明確檢查過），符合板規誠實文案要求。
- 1768684e 這個 CI-audit-false-positive 修復commit 逐行核對過：只改測試 fixture 變數名、解構寫法、字面密碼字尾，無任何斷言/邏輯/期望值變更 — 乾淨。

## 5. Verdict
- [x] NEEDS_FIX — 有 1 個 blocker（timing side-channel 與 PR 自身宣稱矛盾），owner 修完重 review

## 6. Suggested Owner for Fixes
- 🔴 #1 → Jason（password-reset-store.ts 作者）
- 🟡 #1 → Elva/Bruce（CI required-check 政策層級決定，非 Jason 一人能改 branch protection）
- 🟡 #2 → Jason
- 🟡 #3 → Jason

## 7. Re-review Required
YES

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W7 (paper sprint) — 2026-07-17
