# PR #282 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：修補 BLOCK #6 §3 Gap 3 — `evaluatePipelinePublishGate` 的 rawSources 之前只帶 metadata (status/rowCount/latestDate/note)，RAG cross-validator 吃不到真實 DB 資料，導致 ragUsed=false + confidence=0 silent fallback。Jason 在每個 SourcePackEntry 補 `sampleRows`（LIMIT 3 真實 DB rows），讓 RAG pass-2 有真實數據可以比對。
- 對應 sprint task：BLOCK #6 §3 Gap 3 修補（Pete BG audit 識別）
- Base branch：main（direct，非 stacked）

## 2. Diff Summary
- 改了 1 個檔：`apps/api/src/openalice-pipeline.ts`
- LOC: +54 / -16（additive only，無刪除既有 logic）
- 主要改動：
  1. `SourcePackEntry` type 新增 `sampleRows?: Record<string, unknown>[] | null`
  2. `collectSourcePack()` OHLCV section：count > 0 時 non-fatal try/catch fetch LIMIT 3
  3. `collectTableSource()` 通用路徑：count > 0 時 non-fatal try/catch fetch LIMIT 3
  4. MOCK / ERROR / DEGRADED / market_overview fallback：sampleRows=null（明確）
  5. `evaluatePipelinePublishGate()` rawSources mapping：有 sampleRows 用真實 JSON，無則 fallback metadata JSON
- CI：validate + W6 No-Real-Order Audit + Secret Regression Check (A2) 全 SUCCESS

---

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [PASS] kill-switch grep：diff 無 KILL_SWITCH / EXECUTION_MODE toggle
- [PASS] order grep：diff 無 place_order / submit_order / kgi.order.create / paper/orders 任何觸碰
- [PASS] paper sprint：本 PR 不涉及任何下單路徑
- [PASS] feature flag 預設：無新 flag；sampleRows 是 type-additive，不是 feature flag

### B. Auth / Secret Hygiene
- [PASS] 新 endpoint：本 PR 不開新 endpoint
- [PASS] hardcoded secret grep：diff 無 API key / token / password
- [PASS] W6 CI "Secret Regression Check (A2)"：PASS
- [PASS] person_id / userId / sessionId leak：diff 無

### C. State / Schema Integrity
- [N/A] DB schema 變更：無 migration。`sampleRows` 是 TS 型別欄位，不是 DB 欄位
- [PASS] enum / status：無新 enum；SourceStatus 不變
- [PASS] state machine：無新 state
- [PASS] runtime state：無 module-level Map/Set 新增

### D. PR Hygiene
- [PASS] PR title：`feat(api): OpenAlice rawSources real rows + FinMind 11-dataset coverage confirm` — 符合 W6 sprint 格式
- [PASS] commit message：conventional commits (feat)
- [PASS] base branch：main，單層 PR，非 stacked — 正確
- [PASS] PR description：列有 evidence path（Bruce post-deploy audit）、測試結果（158/158）、已知 gap（post-deploy 需 Bruce verify ragUsed=true）

### E. IUF-Specific 不可越線
- [PASS] 無 agent 越 lane
- [PASS] 無 governance bypass
- [PASS] W6 CI "W6 No-Real-Order Audit"：PASS — 無 KGI gateway /order/create
- [PASS] 無 redaction policy 違規

---

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
None.

### 🟡 Suggestions (should fix)

1. **[SQL Injection Risk — Low Severity, Operator-Internal Only]**: `collectTableSource()` 新增的 sample fetch 使用 `drizzleSql.raw()` 搭配字串插值：
   ```
   drizzleSql.raw(`SELECT * FROM ${tableName} WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = '${workspaceId}') ORDER BY date DESC LIMIT 3`)
   ```
   - 位置：`apps/api/src/openalice-pipeline.ts` 新增 block（collectTableSource 內）
   - 原因：`tableName` 是 call-site 全部硬編碼字面量（`"tw_monthly_revenue"` / `"tw_institutional_buysell"` / `"tw_margin_short"`），不是 user input。`workspaceId` 是 `workspace.id`（DB 查到的 UUID，非外部輸入）。**實際風險極低**。但這個模式本身是 code smell — 預存的 `drizzleSql.raw` template 可以被未來維護者誤用。
   - 補充：同函數既有的 COUNT query（非本 PR 新增，pre-existing）也用同樣模式，本 PR 只是跟隨一致。
   - 建議：改為 `drizzleSql` template literal（不帶 `.raw`）搭配 SQL identifier escape，或明確加 allowlist 驗證 tableName。一行修：`const ALLOWED_TABLES = ["tw_monthly_revenue", "tw_institutional_buysell", "tw_margin_short"] as const; if (!ALLOWED_TABLES.includes(tableName)) throw new Error(...)` 加在 function 入口。
   - **不是 blocker**：runtime 路徑封閉，owner 是 operator-internal codebase，CI secret check PASS。

2. **[SELECT * 而非明確欄位列表]**: `collectTableSource()` sample fetch 使用 `SELECT *` 而非明確欄位。
   - 位置：同上，新增 block
   - 原因：`SELECT *` 在 table schema 有 sensitive column 時會把所有欄位都拉進 sampleRows JSON，然後送進 AI prompt（透過 rawSources content）。FinMind 表通常只有公開財務數據，無明顯 PII；但明確欄位列表可防止未來 schema 變動意外拉到新加的欄位。
   - 建議：跟 OHLCV section 看齊（那個用 `SELECT ticker, dt, open, high, low, close, volume`），為每個 FinMind table 列出明確欄位。

3. **[Token budget 估算有誤的小漏洞]**: `rawSources mapping` 在 `evaluatePipelinePublishGate` 內做 `.slice(0, 3)` 截斷，但 `hallucination-rag.ts` 已有 `MAX_RAW_SOURCE_CHARS = 1_200` 的 per-source 截斷。兩層截斷方向正確，但 `sourcePack.sources` 有 5 個 entries（companies_ohlcv + tw_monthly_revenue + tw_institutional_buysell + tw_margin_short + market_overview），每個最多 1,200 chars = 6,000 chars overhead，換算約 1,500 tokens。gpt-4.1 context window 夠用，但若未來 source 數目增加，token cost 的線性增長需注意。
   - 此處不是 bug，是 observability gap。建議在 PR description 明確標 estimated input token delta。

### 💭 Nits (nice to have)

1. **`sampleRows` 欄位命名**：`sampleRows` 在 OHLCV 局部變數叫 `ohlcvSampleRows`，在 collectTableSource 叫 `sampleRows`，在 type 上也叫 `sampleRows`。命名一致，nit only。

2. **post-deploy verify 沒標 owner**：PR description 的 unchecked item「Bruce audit run hallucination_check entry should show ragUsed=true」沒有明確標 "→ Bruce" owner。Bruce 可能不知道要看這個。

### Praise
- Gap 3 fix 精準對焦：僅修改一個檔案，+54/-16，無 scope creep。
- non-fatal try/catch 設計正確：sampleRows fetch 失敗不中斷既有 DEGRADED logic，符合 IUF partial-data-over-no-data 原則。
- OHLCV section 用 parameterized `drizzleSql`` template（非 `.raw`），正確避免了 SQL injection；collectTableSource 跟隨 pre-existing pattern 尚可接受。
- market_overview sampleRows=null 並附 comment 說明原因（brief-recency source），良好文件習慣。
- rawSources mapping fallback chain（sampleRows present → real JSON; absent → metadata JSON）正確向後相容，不 break memory-mode 或 DRAFT 表路徑。
- 158/158 tests PASS + CI 三關全綠。

---

## 5. Verdict

- [x] APPROVED — 可 ready，無 blocker

0 個 blocker，3 個 suggestion（均非安全性 or 功能正確性問題），2 個 nit。

---

## 6. Suggested Owner for Fixes

- 🟡 #1（tableName allowlist）→ Jason，可 post-merge hotfix PR；不 block merge
- 🟡 #2（SELECT * → explicit columns）→ Jason，同上
- 🟡 #3（token budget comment）→ Jason，PR description 補一行即可；不 block merge
- 💭 #1 → Jason，nit
- 💭 #2 → Jason / Bruce，在 post-deploy verify checklist 標 owner

---

## 7. Re-review Required

NO — suggestions 均可 post-merge hotfix，0 blocker。

---

**Note on gh pr approve**: PR author = qazabc159-blip（same as repo owner session），GitHub same-author restriction 會擋 `gh pr review --approve`。依 Pete MEMORY.md Same-author PR restriction 模式，改用 `gh pr comment` 貼審查結論。

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint (BLOCK #6 §3 Gap 3 wire)
