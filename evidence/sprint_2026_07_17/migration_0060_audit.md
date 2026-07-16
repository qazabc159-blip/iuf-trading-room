# Migration 0060 Audit — Mike 2026-07-17

## 1. Migration Intent
- 想加什麼 / 改什麼 schema：新增 `password_reset_tokens` 表（admin-mediated 忘記密碼流程）＋ `users.session_epoch` 欄位（reset 後一次性作廢舊 session cookie）
- 對應 sprint task：PR #1288 feat(auth): admin-mediated password reset flow
- forward + down pair: **PRESENT**（`0060_password_reset_tokens.sql` + `0060_password_reset_tokens.down.sql`，兩檔皆在 branch 上，非本地磁碟——按 P10 規則以 `git show origin/feat/password-reset-jason-20260716:<path>` 唯讀審查）

## 2. Schema Changes Summary
- New tables: `password_reset_tokens` (id UUID PK, user_id FK→users CASCADE, token_hash TEXT UNIQUE nullable, requested_at/generated_at/expires_at/used_at/revoked_at TIMESTAMPTZ, generated_by FK→users no explicit ON DELETE)
- New columns: `users.session_epoch` INTEGER NOT NULL DEFAULT 0
- New FKs: `password_reset_tokens.user_id → users(id) ON DELETE CASCADE`；`password_reset_tokens.generated_by → users(id)`（**無顯式 ON DELETE，落 implicit NO ACTION**）
- New indexes: `password_reset_tokens_user_id_idx ON (user_id)`；`password_reset_tokens_requested_at_idx ON (requested_at)`（`token_hash` 靠 UNIQUE 約束自動建索引，未額外聲明）
- Drops: none

## 3. IUF Audit Checklist (§A-G)

**A. Forward+Down Pair**
- down.sql 存在：PASS
- reverse-dependency order（child DROP TABLE 先於 parent ALTER users）：PASS
- 每個 DROP 用 IF EXISTS：PASS（`DROP TABLE IF EXISTS` / `DROP COLUMN IF EXISTS`）
- forward→down→forward 互逆無 orphan：PASS（forward 全用 `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`，down 全用 `IF EXISTS`，來回可重跑）

**B. FK Cascade**
- `user_id` 顯式 `ON DELETE CASCADE`：PASS
- `generated_by` **無顯式 ON DELETE**（落 default NO ACTION）：**FAIL**（見 §4 W1）
- FK 指向的 parent（users）在此 migration 前已存在：PASS
- CASCADE 連鎖風險：user 被刪除時連帶刪光其密碼重設歷史列，屬預期（token 表本質短期/一次性，非 audit-class）：PASS

**C. Idempotency / UNIQUE**
- `token_hash` 為冪等性關鍵欄位，有 UNIQUE：PASS（nullable UNIQUE 在 Postgres 下允許多筆 NULL 並存，正確對應「多筆 pending request 同時存在」的設計意圖）
- UNIQUE 有索引配對：PASS（UNIQUE 約束自動建 btree 索引，`token_hash` 查找路徑即靠此索引，非 seq scan）
- composite UNIQUE 順序：N/A（此表無 composite UNIQUE）

**D. Index Coverage**
- token hash 查找（`resetPassword()` 的 `WHERE token_hash = $1`）：PASS（UNIQUE 自動索引覆蓋）
- pending 佇列查詢（`listPendingPasswordResetRequests()`：`WHERE users.workspace_id=X AND token_hash IS NULL AND revoked_at IS NULL ORDER BY requested_at DESC`）：**部分覆蓋**——`requested_at` 有索引可助 ORDER BY，但 `token_hash IS NULL AND revoked_at IS NULL` 濾除條件無索引；表預期列數極小（每工作區待審請求數，量級同 0053 scheduler_cursors 類先例），非阻擋項，列為 §4 建議
- TTL 過期掃描：`expires_at` **無索引**；目前程式碼沒有任何清理 job 實際掃描此欄位（SQL comment 稱「future cleanup job」），屬前瞻性建議非現況阻擋，列為 §4 建議
- 重複 index：無
- PK：surrogate UUID，合理

**E. NOT NULL / DEFAULT / Backfill**
- `users.session_epoch` NOT NULL DEFAULT 0：PASS——Postgres 11+ 對常數 DEFAULT 的 `ADD COLUMN NOT NULL` 是 metadata-only 操作，不需重寫既有列、不鎖表；對既有 row 影響=全部拿到 0（無現存 session 被中斷，因為現行 cookie 尚未帶 epoch，見 §4 意外事項）
- 表本身列數低（新表 0 列起跳）：無 lock 疑慮

**F. IUF-Specific 不可越線**
- 無 `DROP DATABASE`/`TRUNCATE`：PASS
- 無環境專屬改動夾帶：PASS
- 無偷改既有 row 資料（僅 DEFAULT 對既有 row 補值，屬正常 schema 變更）：PASS
- 無 secret/token/person_id 明碼：PASS——`token_hash` 只存 SHA-256 hash，plaintext token 只存在 `generateToken()`/`resetPassword()` 記憶體變數內組回應，從未寫入任何 INSERT/UPDATE（已逐行核對 `password-reset-store.ts` 的 `db.insert`/`db.update` 呼叫，只設定 `tokenHash` 沒有 `token` 欄位）

**G. Migration File Hygiene**
- 編號 0060 連續無跳號無撞號：PASS（per-agent memory topology 標記 max=0059、0060 為下一未分配槽；另掃描全部 remote branch 確認 `feat/forgot-password-page-jim4-20260717` 也帶同一個 0060 檔——內容位元級相同、`git merge-base` 確認該分支是疊在本 PR tip `1768684e` 上的下游分支，非平行競爭同號，非撞號）
- 檔名清楚描述意圖：PASS
- migration comment 首行講「為什麼」：PASS（開頭即說明本 app 無通用寄信通道，沿用 workspace_invites 的 admin-hands-a-link 模式）
- sprint 來源標記（`-- W<n> Day<n>`）：缺，列為 nit

## 4. Findings — Priority Ranked

### 🔴 Blockers
無。

### 🟡 Suggestions
1. **W1 — `generated_by` FK 缺顯式 ON DELETE**：`packages/db/migrations/0060_password_reset_tokens.sql:17`（`generated_by UUID REFERENCES users(id)`，schema.ts:1440 同步缺）。落 implicit NO ACTION，違反 checklist B「新 FK 必須明確標，不要 default」。目前 repo 內**完全沒有刪除 users row 的路由**（已 grep `server.ts` 確認），故非現行可觸發風險——套用 P31 精神（dead-code-path，甚至比 P31 更遠：連刪除函式本身都不存在）降級為建議而非阻擋。建議修法：`ON DELETE SET NULL`（generated_by 純粹是溯源用途，未來若做「刪除管理員」功能，不該因為他曾經產生過幾筆重設連結就卡死刪除）。
2. **W2 — pending 佇列查詢缺複合/partial index**：`listPendingPasswordResetRequests()` 的 `token_hash IS NULL AND revoked_at IS NULL` 濾除條件無索引覆蓋，現有 `requested_at` 索引只幫得上 ORDER BY。表預期列數極小（單一工作區待審請求，量級同 0053 類先例），非阻擋；若未來多租戶量體上升可考慮 `CREATE INDEX ... ON password_reset_tokens (requested_at DESC) WHERE token_hash IS NULL AND revoked_at IS NULL`。
3. **W3 — TTL 過期掃描缺索引**：`expires_at` 無索引；目前無任何 code 路徑實際做這個掃描（SQL comment 自陳是「future cleanup job」）。若之後真的加上定期清除 expired token 的 job，屆時需補 index，現在不補是合理的（YAGNI），僅記錄提醒。

### 💭 Nits
1. G 項 sprint 來源標記（`-- W<n> Day<n>`）未加在 migration 開頭，diff 自己看得出來但按慣例應補。
2. **意外（單獨列）**：本 PR 同時改了 `auth-store.ts` 的 cookie 簽章格式（`userId:sessionEpoch` 取代舊版純 `userId`），任何舊格式（無冒號）的既有 session cookie 在部署後會被 `verifyAndParseCookie` 判定為「legacy pre-epoch cookie format — treat as invalid」而強制登出——這會讓**部署當下所有已登入使用者**（不只密碼重設功能的使用者）被踢出，是一次性全域登出事件。這屬於應用層行為變更（server.ts/auth-store.ts），不在 migration 的 SQL 正確性範疇內，schema 本身（`session_epoch` 欄位 DEFAULT 0）沒有問題；但因為與本次 migration 是同一次部署綁定生效，建議 Elva/Bruce 在 merge 摘要裡明確告知楊董「部署後所有人需重新登入一次」，避免被誤判成 bug。

## 5. Rollback Dry-Run Plan
- 如果這 migration 在 prod 跑壞，rollback 步驟：
  1. 確認 forward 的 app 代碼（server.ts/auth-store.ts）尚未部署，或計畫連同代碼一起 revert——**down.sql 不會被 pipeline 自動套用**（`scripts/migrate.ts` 只套用 pending forward 檔，down.sql 是純手動工具，已讀 migrate.ts:17-20 確認），必須是 op 手動執行。
  2. 手動跑 `down.sql`：`DROP TABLE IF EXISTS password_reset_tokens;` → `ALTER TABLE users DROP COLUMN IF EXISTS session_epoch;`（child 表先於 parent 欄位，順序正確）。
  3. **關鍵前提（必須同時滿足，否則造成更大範圍 outage）**：若手動跑 down.sql 時，當下部署的 app 代碼仍是「這個 PR 之後」的版本，`server.ts` 的 session middleware 每一個 `/api/v1/*` 認證請求都會呼叫 `getUserById(userId, sessionEpoch)`，其內部 SELECT 會讀 `users.session_epoch` 欄位——欄位被 DROP 掉之後，**這條 SELECT 會直接報錯，等同全站認證失效**，範圍遠大於密碼重設功能本身。正確 rollback 動作永遠是「代碼＋schema 一起 revert」，不能只跑 down.sql 卻留著新代碼在跑。
  4. 若只是想暫停密碼重設功能本身（不動 schema），改用 feature-flag / 移除路由層 handler 即可，不需要碰 migration。
- 預估 rollback 時間：SQL 本身秒級（DROP TABLE 空表 + DROP COLUMN 皆為 metadata-only 操作，`users` 表不需要重寫）；實際耗時取決於代碼一起 revert 的 deploy 流程時間，非 SQL 執行時間。
- data loss 風險：僅遺失 `password_reset_tokens` 內已產生但未使用的重設連結歷史（本質為短 TTL 一次性安全 token，可接受）；不影響任何使用者的密碼本身或既有帳號資料。

## 6. Verdict
- [x] APPROVED — schema 變更安全，可 ready（0 blocker，3 建議級 WARN，1 nit，1 需向楊董揭露的部署行為意外）

## 7. Re-audit Required
NO（除非 Jason 針對 W1 補上顯式 `ON DELETE SET NULL` 或其他改動觸及本 migration SQL 本體，才需重審；純加 index 屬 additive 不需重審）

## 額外提醒（非 checklist 項目，PR 派工明確要求）
- **Railway EXPECTED_MIGRATION_COUNT**：merge 後需 +1（沿用既有流程，見 anti-pattern P32——`scripts/migrate.ts` 對「實際套用數 > 期望值」只 `console.warn` 不會 crash，故此項是 hygiene 提醒非 deploy-blocking）。
- **Numbering 交叉確認**：另一分支 `feat/forgot-password-page-jim4-20260717` 也含 0060 檔，經 `git merge-base` 確認是疊在本 PR tip 上的下游分支（非平行競爭），非撞號。

---
Auditor: Mike
Date: 2026-07-17
Migration: 0060_password_reset_tokens.sql (+ .down.sql)
