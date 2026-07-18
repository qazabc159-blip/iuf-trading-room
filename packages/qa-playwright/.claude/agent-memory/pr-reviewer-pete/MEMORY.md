# Pete (PR Reviewer) — Memory Index

- [熱力圖資料誠實 gating 審查 pattern](heatmap_data_honesty_gating_pattern.md) — 3-tier fallback 反覆病灶：某 tier 缺欄位卻冒充完整格；審查 3 要點
- [跨源取「較新日期」banner 的通用風險](banner_cross_source_date_consistency_risk.md) — 只驗日期新舊不驗資料完整度的模式；🟡 非 🔴 判準理由
- 環境備忘：本 repo 主 tree 常態髒（多 agent worktree 並行），review 一律用 `git diff origin/main...origin/<branch>` 對 refs 比對，不信 working tree；`git show <ref>:<path>` 讀單檔內容。
- **寫 evidence 到 main 的正確做法**：主 tree 髒到不能直接 `git add+commit`（會夾帶別人 worktree 的未 commit 改動/刪除）。用 `git worktree add <scratchpad路徑> origin/main --detach` 開一個乾淨副本，只在裡面 `git add <單一 evidence 檔>` + commit + `git push origin HEAD:main`，完事後 `git worktree remove --force`。比對 `git status --porcelain` 確認只 stage 到自己那個檔，別的髒東西不會被波及。
- 本輪案例：PR #1297（`fix/heatmap-data-honesty-gating-jason-20260717`，commit `3d6a07c1`）APPROVED，0 blocker，2 🟡。Evidence: `evidence/sprint_2026_07_17/pr1297_review.md`。
- 本輪案例：PR #1298（`feat/market-data-integrity-gate-jason-20260717`，commit `b47d4c8d`）——#1297 的治本升級版，新模組 `market-data-integrity-gate.ts`（4 道 invariant：算術自洽/量級異常/fail-closed 跨源驗證/單一權威交易日）+ server.ts 加 TWSE MIS 跨源驗證呼叫。APPROVED，0 blocker，3 🟡。Evidence: `evidence/sprint_2026_07_17/pr1298_review.md`（commit `9369d9d0`）。
  - **「補新外部 HTTP 呼叫時必查掛死三連問」**：查完全成立才敢放行，本輪順序可重用——①每個 fetch 有無 `AbortSignal.timeout`？②呼叫端有無再包一層 race timeout 讓 fail-open 不阻塞端點？③有無 module-level in-flight singleton promise 記憶化（今晚 #1292/#1294 `_stockDayAllInflight` 那個「一次未 bound 呼叫掛死全 process」的病灶）？三項全過才算真的沒重蹈掛死坑，光看「有 try/catch」不夠（try/catch 只接 reject，接不住永不 resolve 的 promise）。
  - **「文件宣稱 vs 實際 wiring」是這個 repo 反覆出現的 PR 描述/diff 落差型態**：本輪抓到 `verifyQuoteTuple()` 檔頭文件寫「enricher 輸出 must satisfy 這個函式」，但實際 Tier 2 迴圈根本沒 import 它，是另一份手刻等效邏輯。這不是 bug（功能有覆蓋），但屬於「模組文件把 pure-function-exported-for-future-canary 講成好像已經是生產路徑一部分」的過度宣稱——review 時看到「這個模組是 XX 的守門員」這類語氣要順手 grep 有沒有真的被 import 進實際呼叫鏈，不能只信檔頭 docstring。
  - **「同一天重複輪詢會不會重打外部 API」是新查核點**：新增的跨源驗證/新資料源呼叫，若沒有 TTL cache，即使單次呼叫有 bound，高頻輪詢下同一 symbol 當天可能被反覆打外部 API——不是掛死等級但屬同一種「未節流外部呼叫」體質，之後查這類 PR 要順手問「這個驗證結果有沒有被快取，還是每個 request 都重跑」。
