# PR #268 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：新增 `openalice-email-digest.ts`，每日 17:00 TST（post-market close）透過 Resend REST API 寄出 iuf_events 摘要 email。無 Resend key 時進入 dry-run mode（log to stdout）。另加 DRAFT migration 0026 儲存未來 per-user 通知偏好。
- 對應 sprint task：BLOCK #6 Jason BG 第三輪 Ship C — email digest worker
- Base branch：main（直接接，非 stacked）
- 依賴：iuf_events table（PR #267 DRAFT migration 0025，未 promote）

## 2. Diff Summary
- 改了 6 個檔：`openalice-email-digest.ts`（新建 349L）、`server.ts`（+2 endpoints +17L scheduler）、`0026_iuf_notification_preferences.DRAFT.sql`（新建 43L）、`0026_iuf_notification_preferences.down.sql`（新建 3L）、`tests/ci.test.ts`（+3 tests）、`.env.example`（+5L）
- 另包含 `0024_finmind_market_intel.DRAFT.sql → .sql` rename（見 §3 C 項）
- LOC: +501 / -1

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] PASS — diff 無 KILL_SWITCH / EXECUTION_MODE toggle
- [x] PASS — diff 無 place_order / submit_order / kgi.order.create
- [x] PASS — email digest 是純 read-side（查 iuf_events）+ outbound 通知；不觸及下單路徑
- [x] PASS — feature flag 無改動；RESEND_API_KEY absent → dry-run（不 block pipeline）
- [x] PASS — 5min interval scheduler 在 17:00-17:30 TST window 外 silently return；不會異常觸發

### B. Auth / Secret Hygiene
- [x] PASS — `POST /api/v1/internal/openalice/email-digest/trigger`：`session.user.role !== "Owner"` → 403；Owner-only gate ✓
- [x] PASS — `GET /api/v1/internal/openalice/email-digest/state`：同上 Owner-only ✓
- [x] PASS — RESEND_API_KEY 只做 truthy check；不 log key 值；Authorization header 只在 fetch body 發出，不寫 console
- [WARN] **DIGEST_EMAIL 預設值為楊董 email 明碼寫在 .env.example 中**：`DIGEST_EMAIL=qazabc159@gmail.com`。這是 楊董 config per PR description，但 .env.example 通常是公開在 git repo 的。個人 email 出現在 committed file 中屬於 PII 洩漏的邊界案例。
  - 位置：`.env.example:29`、`openalice-email-digest.ts:30`（`process.env["DIGEST_EMAIL"] ?? "qazabc159@gmail.com"` hardcoded default）
  - 原因：.env.example 的 value 應該是佔位符（如 `your@email.com`）不應是真實 email；另外 source code 裡的 hardcoded default 也包含明文 email
  - 建議：(a) `.env.example` 改為 `DIGEST_EMAIL=your_email@example.com`；(b) `openalice-email-digest.ts:30` 改為 `process.env["DIGEST_EMAIL"] ?? ""` 並在 digest function 開頭加 guard：若 DIGEST_EMAIL 為空則 skip（dry-run）
  - 嚴重性：此 repo 若是 private repo 則風險低；但 IUF 所有 PR 都走 github，PR diff 公開可見時問題升高。Pete 判定為 blocker（§B 規則：log / response 不得洩漏 userId — email 等同 PII identifier）
- [x] PASS — digest email HTML body 含 ticker + rule metrics，無 person_id / session / auth token
- [x] PASS — `formatDigestHtml` 不 escape user-controlled strings（ticker 來自 DB rule_name/ticker_symbol）；在 operator-only email context 可接受，但注意 ticker 值如來自外部輸入可能有 XSS 風險（HTML email client 一般沙箱化，風險低）

### C. State / Schema Integrity
- [FAIL] **0024 migration rename 衝突**（同 PR #266 / #267）— PR #265 merged at 03:21 TST；`CONFLICTING` merge state
- [x] PASS — 0026 DRAFT migration：filename `.DRAFT.` → migrate.ts 跳過 ✓
- [x] PASS — `0026_iuf_notification_preferences.DRAFT.sql`：`CREATE TABLE IF NOT EXISTS`（✓）、UNIQUE(user_id)（一 user 一偏好 ✓）、quarantine table 有 ✓、外鍵 `REFERENCES users(id) ON DELETE CASCADE`（正確，user 刪除時 preference 跟著刪）
- [x] PASS — `0026_iuf_notification_preferences.down.sql`：`DROP TABLE IF EXISTS _quarantine_iuf_notification_preferences; DROP TABLE IF EXISTS iuf_notification_preferences;`（順序正確）
- [x] PASS — email digest 使用 raw SQL query `iuf_events`（DRAFT 0025）；table absent → `catch { return []; }` → empty digest → dry-run log；不 crash
- [x] PASS — `_lastDigestAt` / `_lastDigestResult` 是 module-level var；process restart 重置；dedup 基於 date prefix match（`_lastDigestAt.startsWith(date)`）— 跨 process restart 不保留，即同一天重啟後會再次嘗試 send。但有 window guard (17:00-17:30) 限制，重複 send risk 僅在重啟剛好落在 window 內。可接受（dry-run 有 stdout，實際 send 用 Resend）。

### D. PR Hygiene
- [x] PASS — title `feat(api): email digest worker + notification preferences (BLOCK #6 C)` 符合 conventional commits
- [x] PASS — PR description 列出 design decisions / graceful degrade / dependencies
- [x] PASS — base branch = main（正確）
- [x] PASS — 132/132 PASS per PR description；3 新測試（window skip / no-key dry-run / state shape）

### E. IUF-Specific Non-negotiables
- [x] PASS — Pete 不修 production code
- [x] PASS — 無 governance bypass
- [x] PASS — 無 KGI gateway /order/create 呼叫
- [x] PASS — 0026 DRAFT migration 未 promote；Mike audit 尚未執行
- [FAIL] **source code hardcoded `qazabc159@gmail.com`（§B PII check）**：即使 .env.example 修正，source code `openalice-email-digest.ts:30` 仍有 `?? "qazabc159@gmail.com"` 作為 fallback。這個值進入 git history，永久可見。同上 blocker 判定。

---

## 4. Findings — Priority Ranked

### Blockers

1. **[0024 DRAFT rename merge conflict]**: 同 PR #266/#267；`mergeable: CONFLICTING`。Jason rebase origin/main 解決。

2. **[個人 email `qazabc159@gmail.com` 明碼寫入 source code + .env.example]**:
   - `openalice-email-digest.ts:30`：`process.env["DIGEST_EMAIL"] ?? "qazabc159@gmail.com"` — hardcoded default 進 git history
   - `.env.example:29`：`DIGEST_EMAIL=qazabc159@gmail.com` — 公開可見佔位符含真實地址
   - §B 規則：log / response body 不得洩漏 userId / sessionId 等 PII；email 是 PII identifier
   - 建議：(a) source code 改 `?? ""` + empty-guard；(b) `.env.example` 改 `DIGEST_EMAIL=` 或 `DIGEST_EMAIL=your_email@example.com`；(c) 若 repo 為 private + 楊董自管，Elva 可 ACK 降為 suggestion——但 Pete 需 Elva 明確拍板

### Suggestions

1. **[process restart 時 dedup 狀態丟失 → window 內重啟可能重複 send]**: `_lastDigestAt` 是 module-level var，process restart 清零。若 Railway 在 17:05 重啟，新 process boot 後在 17:10 進入 window，`_lastDigestAt === null` → 嘗試第二次 send。對 楊董 email 重複一封通知是可接受的，但要知悉。
   - 建議：如果 0026 migration 促進，可在 `iuf_notification_preferences` 或 `audit_log` 記錄 "digest_sent_today" action，用 DB 做 dedup 而非 in-memory。Post-0026-promote 改善項目。

2. **[digest 依賴 iuf_events 但 iuf_events 依賴 0025 DRAFT migration（尚未 promote）]**: PR description 已說明此依賴。實際 deploy 後 digest = dry-run + empty events，直到 Mike 審核 + promote 0025。Elva 需確認 Mike 的 audit cadence 是否已排進此 BLOCK。

3. **[0026 migration 的 rule_filter JSONB 未有 example 值]**: DRAFT migration 0026 有 `rule_filter JSONB NULL`，但 PR 沒有說明 rule_filter 的期望格式（例如 `["R01", "R05"]`）。未來 endpoint 消費這個欄位時需要自行 infer format。建議在 migration comment 加一行 `-- Expected: ["R01_REVENUE_SURGE_YOY50", ...]`。

### Nits

1. **[digest subject 含 emoji 在某些 email client 顯示異常]**: `subject` 包含 `⚠` (`⚠`)。大多數現代 email client 處理 UTF-8 subject 無問題；iOS Mail / Gmail 正常。Edge case 是企業 exchange 系統。Nit-level；不影響功能。

2. **[formatDigestHtml 中 `Time (UTC)` 列標籤不精確]**: `triggeredAt.slice(0, 16).replace("T", " ")` 截取的是 ISO string，確實是 UTC。但 column header 寫 "Time (UTC)" 而 email 收件人（楊董）位於 TST(UTC+8) 時區，顯示的時間對他來說是 UTC 不是本地時間。建議顯示時轉換為 TST 或標籤改 "(UTC, add 8h for TST)"。低優先級 UX nit。

3. **[`SEVERITY_EMOJI` 命名誤導 — 實際值是 `[CRITICAL]` 文字而非 emoji]**: 常數名 `SEVERITY_EMOJI` 但 values 是 `"[CRITICAL]"` / `"[WARNING]"` / `"[INFO]"` 純文字（用於 plain-text email）。HTML email 有顏色區分；plain-text 用文字標籤也合理。只是命名 misleading。改 `SEVERITY_LABEL` 更準確。

### Praise

- No new npm package dependency — 純 native fetch 呼叫 Resend REST API。PRN（Package Requirements None）= 0 added supply chain risk。這個設計決策值得稱讚。
- Dry-run mode 設計完整：RESEND_API_KEY absent → `sendDigestEmail` 回傳 `{ ok: false, reason: "no_resend_api_key" }` → caller log stdout digest text → operator 可在 Railway log 看到完整 digest 內容。即使沒設定 key，功能可觀察。
- HTML email template 優雅地按 severity 分組並用顏色區分（#c0392b / #e67e22 / #27ae60），同時提供 plain-text fallback。對 email client 相容性考慮周全。
- 17:00-17:30 TST window guard + date-prefix dedup 的雙重防護設計，確保每天最多發一封（除非 force=true）。Force trigger endpoint 給 Elva 手動測試用，設計合理。
- `getTaipeiDate()` 和 `getTaipeiHHMM()` 都使用 `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" })`，timezone-aware 計算正確（不依賴 server 系統 locale）。

---

## 5. Verdict
- [ ] APPROVED
- [x] NEEDS_FIX — 2 blockers：(1) merge conflict（0024 rename）；(2) 個人 email 明碼在 source + .env.example（或 Elva ACK 降為 suggestion）
- [ ] BLOCKED

Reasoning: 核心功能設計正確；dry-run / window guard / timezone handling 全部到位。Blocker #1 是機械性 rebase。Blocker #2 需 Elva 拍板：若 repo private + 楊董自管可 ACK 降為 suggestion，由 Jason 下一 PR 清理；若有公開性疑慮則必須修。

---

## 6. Suggested Owner for Fixes

- Blocker #1 (0024 rename conflict) → Jason：rebase origin/main，re-run CI
- Blocker #2 (email PII) → Elva 拍板：(a) 要求修 → Jason 改 source fallback + .env.example；(b) ACK private repo → note + 下 PR 清理
- Suggestion #1 (process restart dedup) → Jason：post-0025/0026 promote 後以 audit_log 做持久 dedup
- Nit #2 (Time UTC label) → Jason：1 行 date formatting fix + column header 更新

---

## 7. Re-review Required
NO — Blocker #1（rebase）解決後如 Elva ACK blocker #2（private repo），Elva 可直接 merge 無需 Pete 重看。若 blocker #2 需要功能修改（改 source code fallback），Pete 建議簡單 spot-check 確認修法正確後 approve。

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint / BLOCK #6 Jason BG round 3
PR: #268 feat(api): email digest worker + notification preferences (BLOCK #6 C)
Files reviewed: 6 changed (1 digest module, 1 server.ts, 2 migrations, 1 test, 1 env doc) + 0024 rename conflict
LOC: +501 / -1
