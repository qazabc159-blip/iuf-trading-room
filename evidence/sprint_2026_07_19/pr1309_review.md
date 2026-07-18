# PR #1309 Desk Review — Pete 2026-07-19

## 1. PR Intent
- Round 2 修復：#1307（round 1）merge+deploy 後，Elva prod 複驗發現 `GET /effective-quotes?symbols=2330,2454`
  在 deploy 重啟後回傳 `items: []` / `summary.total: 0` — 不是「個別 blocked item」，是整個消失。根因：
  `resolveMarketQuotes()` 的 `grouped` map 只收「曾被任一 provider 快取過」的 symbol；deploy 重啟洗空
  `providerQuoteCache` 後，從未被快取過的 requested symbol 完全不會產生 item，round 1 的
  `_applyOfficialCloseFallback` 只能補「已存在」的 item，對這種情況無能為力。
- 修法：新增 `_synthesizeItemForMissingSymbol()`，對每個 requested-but-missing symbol 從 `quote_last_close`
  無中生有合成一個完整 item；DB 也沒有時，合成一個誠實的 BLOCKED item（保證「N in N out」，不再靜默消失）。
- 對應 sprint task：#1307 的直接 round-2 修復，同一症狀鏈（週末/deploy 重啟後 desk-exact/quote 全空白）。
- Base branch：`main`（`merge-base == origin/main tip`，非 stacked chain 中段，單一 commit）。

## 2. Diff Summary
- 改 2 個檔：`apps/api/src/market-data.ts`（+338/-〈inline，見下〉）、
  `apps/api/src/__tests__/effective-quotes-official-close-fallback.test.ts`（+227，含 8 個新測試）。
- LOC：+526 / -39（`git diff --stat`）。
- 主要改動：`_parseRequestedSymbols()`（鏡射 `resolveMarketQuotes()` 的 symbol 解析）、
  `_resolveMarketForMissingSymbol()`（合成 item 的 market 猜測）、`_synthesizeItemForMissingSymbol()`
  （純函式，合成完整 item 或誠實 BLOCKED item）、`_recomputeEffectiveQuotesSummary()`（items[] 變動後
  重算 summary）、`getEffectiveMarketQuotesWithOfficialCloseFallback()` 改寫（同時處理 existing-blocked
  augment + missing-symbol synthesize 兩條路徑）。`server.ts`/`packages/contracts` 零改動（route wiring
  沿用 #1307 已接好的 `getEffectiveMarketQuotesWithOfficialCloseFallback`，只有這支 route 呼叫，grep 確認）。

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety — PASS
- diff 全文 grep `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|kgi.order.create|order/create` 零命中。
- 純讀路徑（quote 合成），零下單/風控觸碰。`quoteProviderSources`（5 個真實來源）字面陣列未被本 PR
  改動，`official_close` 仍被排除在外 — 沿用 #1307 已驗證的風控隔離設計。
- `strategyUsable`/`paperUsable`/`liveUsable` 在 `_synthesizeItemForMissingSymbol` 兩個分支都硬編 `false`，
  跟 round 1 架構一致，未新增下單鏈風險。

### B. Auth / Secret Hygiene — PASS
- Route 未變動（沿用 #1307 的 `c.get("session")`），無新 endpoint。
- 無 hardcoded secret/token；無新 env var。新用到的 `listMarketDataProviderStatuses()` 是既有 in-memory
  `getStatus()` 讀取（非新網路呼叫，docstring 誠實註明），不觸發掛死三連問（無新 fetch/timeout 疑慮）。

### C. State / Schema Integrity — PASS（無 migration，enum 無變動）
- `git diff --stat` 對 `packages/contracts` 零命中 — 無新 enum member。
- 無新 module-level Map/Set；`_recomputeEffectiveQuotesSummary`/`_resolveMarketForMissingSymbol` 皆純函式。
- SQL 注入面：`missingSymbols` 併入既有 `getLastCloses(db, lookupSymbols)`（round 1 已審過的手工轉義
  raw SQL），symbol 來源皆經 `_parseRequestedSymbols`（trim/uppercase/dedupe，鏡射
  `resolveMarketQuotes()` 既有解析）— 未新增可注入字串，PASS，無新增面。

### D. PR Hygiene — PASS
- Branch/commit message 符合慣例（`fix(market-data): ...`）；base = main tip，單一 commit，非疊層衝突態。
- PR 描述誠實列出 prod repro（Elva 複驗）+ 根因調查（含已排除的 `loadPersistedQuoteEntries` 假說）+
  主動揭露 out-of-lane 發現（`risk-store.ts` 疑似同款 `RAILWAY_VOLUME_MOUNT_PATH` ephemeral 風險，未修，
  已 flag 給 Elva）— 見 Praise。

### E. IUF 不可越線 — PASS（lane 邊界），但見 🔴 #1 對「這支 PR 自稱解決的症狀是否真正解決」的質疑
- 無 lane 越界（Jason 動 `market-data.ts` 屬其 backend lane）；無 governance bypass；無 KGI
  `/order/create` 呼叫；無 redaction 違規。

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)

1. **合成/擴充後的 item `reasons[]` 對 `/quote` 單symbol頁會渲染出未映射的原始工程字串（違反「UI 禁工程
   語意」硬規則），且本 PR 讓這條路徑從「邊緣情境」變成「本票主打的黃金路徑」全面命中**
   - 位置：`apps/api/src/market-data.ts` 的 `buildEffectiveQuoteReasons()`（未改動，既有函式）產生的
     `reasons` 陣列（如 `"fallback:no_fresh_quote"`、`"stale:age_exceeded"`、`"non_live_source"`、
     `"provider_disconnected"`、`"missing_quote"`、`"official_close_snapshot"`）與
     `apps/web/app/quote/page.tsx:68-72` 的 `reasonLabel()` 對照——`reasonLabel()` 只認得
     `"no_quote"`/`"no_fresh_quote"`/`"age_exceeded"`/`"missing_last"`/`"provider_unavailable"`/
     `"higher_priority_*"` 這幾個**裸字串**，完全沒有對到 `buildEffectiveQuoteReasons()` 實際吐出的
     `"fallback:xxx"`/`"stale:xxx"` 前綴字串或 `"non_live_source"`/`"provider_disconnected"`/
     `"missing_quote"`/`"official_close_snapshot"` 這些值，未命中一律 `return reason`（原字串照印）。
     `quote/page.tsx:150-160` 的 `QuoteSnapshot` 元件把 `reasons.map(reasonLabel)` **不論 `quote` 是否為
     null 都會渲染**（`{reasons.length > 0 && <div>...{reasons.map(...)}</div>}` 在 quote-grid/state-panel
     之後、非互斥分支）。
   - Failure scenario：週六打開 `/quote?symbol=2330`（本票+round1兩張PR共同宣稱要修好的正是這個場景）
     → `item.selectedQuote` 非 null（official_close 填值）、`item.reasons` = `["fallback:no_fresh_quote",
     "stale:age_exceeded", "non_live_source", "provider_disconnected", "official_close_snapshot"]` →
     `QuoteSnapshot` 在真實成交價旁邊，用 badge 逐字印出這 5 個原始工程字串。這正是
     CLAUDE.md「UI 禁工程語意（model 名/enum/debug 字串）...違反=退件」明文禁止的情況。
   - **重要澄清（誠實揭露 non-blocking 的另一面）**：`buildEffectiveQuoteReasons()`／`reasonLabel()`
     兩端都是既有代碼，**本 PR 一行都沒碰 apps/web**，這個 reasons-label 對不上的洞從 #1307
     merge+deploy 那一刻就已經在 prod 活著（任何「原本就在 items[] 裡但 selectedQuote:null」的舊症狀
     symbol 早就會踩到）——round 2 本身沒有製造新的字串或新的映射缺口。**但 round 2 把觸發前提從
     「symbol 曾經被快取過但目前 blocked」（窄）放寬成「任何從未被快取過的 requested symbol」
     （寬，含所有冷門/新加入自選股/剛重啟後的整個宇宙）**，等於把這個已存在但機率低的 bug 變成
     本票（以及本票延續的 #1307）宣稱要解決之目標場景（週末/重啟看報價）的**主線路徑**，實質上讓
     「不再空白」的修復代價變成「不空白但滿版工程字串」——對「desk/quote 頁拿到合成 blocked item
     會不會渲染出錯」這個本輪指定查核點，答案是：不會 crash，但會違反產品硬規則，比修前的「空白」
     體感更差（原本的 `QuoteStatePanel` EMPTY 分支是乾淨的「缺資料」訊息；現在改走
     `QuoteSnapshot`，兩者互斥、由 `item === null` 與否決定，round 2 讓幾乎所有 requested symbol 都會
     "item !== null"，因此幾乎必然改走會漏字串的那個分支）。
   - 建議：這不是本 PR 診斷/修法本身的錯（backend 合成邏輯正確、誠實），是前端 `reasonLabel()` 映射表
     不完整這個既有缺口被本票大幅擴大曝光面。建議：(a) 立刻請 Jim/Codex 開一張同日 fast-follow
     hotfix，把 `reasonLabel()` 改成白名單制（未知字串一律回傳 `""` 而非原樣字串，寧可少顯示也不
     洩漏工程字串）；(b) 若 Elva 判斷「這本來就是 #1307 已經上線的舊洞，不該卡本票」，可以接受
     NEEDS_FIX 降級為緊急 🟡 平行處理——但無論哪種處理路徑，這件事必須在本票 ready 前有明確決定
     和 owner，不能被默默略過（目前 PR 描述沒有提到這個前端後果）。

### 🟡 Suggestions (should fix)

1. **`_resolveMarketForMissingSymbol` 的 TWSE/TPEX 猜測依賴 `quote_last_close.source === "tpex_eod"`，
   但 `"mis_close"` 這個 source 值可能也對應 TPEX 股票，卻無法被這支函式分辨**
   - 位置：`market-data.ts` 新增的 `_resolveMarketForMissingSymbol()`；根因在別的既有檔案
     `s1-sim-runner.ts:1374-1420` — 寫入 `quote_last_close` 時對每個 symbol 依序嘗試
     `tse_${symbol}.tw` 再 `otc_${symbol}.tw`（MIS 端點），成功後一律寫 `source: "mis_close"`，
     **沒有記錄究竟是哪個 prefix 命中**，等於在寫入端就已經把「這是 TWSE 還是 TPEX」的資訊丟掉。
   - Failure scenario：一支 OTC(TPEX) 股票，若它在 `quote_last_close` 裡唯一的記錄剛好來自
     `mis_close`（而非 `tpex_eod`）、呼叫端又沒帶 `?market=` 篩選 → `_resolveMarketForMissingSymbol`
     判斷 `lastClose.source !== "tpex_eod"` → fall through 到預設值 `"TWSE"` → 合成 item 的
     `market` 欄位被錯標。影響範圍：僅顯示層（symbol 旁的交易所徽章/頁面 title），不影響
     `strategyUsable`/`paperUsable`/`liveUsable`（皆恆 false）——非財務風險，屬資料誠實層的
     cosmetic 缺陷，符合「顯示層仍要對得起真值」的鐵律精神但影響面小。
   - 建議：非本票必修（根因在 `s1-sim-runner.ts` 的寫入端，跨檔案/可能跨 lane），但排進下一輪
     待辦——修法可以是 write 端把命中的 prefix 一併存進一個新欄位，或至少讓 `_resolveMarketForMissingSymbol`
     承認「`mis_close` 不足以判斷市場」並更明確地 fallback（目前的行為不算錯，但 docstring 的信心
     宣稱「`tpex_eod` 是唯一 TPEX-specific 值」在 schema 定義層面成立、在資料實際來源層面不完全成立，
     建議修正 docstring 措辭）。

2. **`_resolveMarketForMissingSymbol` 和 `_recomputeEffectiveQuotesSummary` 是純函式卻沒有 `export`，
   打破了這個檔案自己聲稱的測試慣例，也剛好是本輪唯二找到潛在問題的兩支函式**
   - 位置：`market-data.ts` 新增的兩支 helper；對照同一 hunk 的 route-level 註解自稱
     「matches this file's existing convention of leaving thin DB-fetch glue untested and
     unit-testing the pure functions it calls」——但這兩支本身就是無 I/O 的純函式，卻沒有跟
     `_parseRequestedSymbols`/`_synthesizeItemForMissingSymbol` 一樣 `export` 供直接單元測試。
   - 影響：測試檔（`effective-quotes-official-close-fallback.test.ts`）完全沒有涵蓋
     `_resolveMarketForMissingSymbol` 的任何分支（包含上面 🟡 #1 找到的 `mis_close` 邊界情況——
     若這支函式當初被 export 並直接測試，這個邊界案例很可能在寫測試時就會被想到並攔下）；也沒有
     涵蓋「既有 blocked item 被 official_close 補值後，`summary.blocked`→`summary.degraded` 是否
     正確遞移」這個 round-2 新引入行為（本輪查核點③指定要看的項目）——現有 e2e 測試只驗證
     「全部 missing」（8881/8882）與「全部 passthrough」（單一 manual quote）兩個極端，沒有「既有
     blocked item 被augment + 另一 symbol 是 missing」的混合情境，也沒有任何測試直接斷言
     `_recomputeEffectiveQuotesSummary` 對「既有 augmented item 從 blocked 變 degraded」這件事算對。
   - 建議：export 這兩支函式並各補至少 2-3 個直接單元測試（尤其是 🟡 #1 的 `mis_close` 案例、以及
     混合 augmented+synthesized 情境下的 summary 遞移驗證）。

3. **`bySource` summary breakdown 永遠不會計入 `official_close`（round 1 遺留的既有落差，round 2
   有機會一併修但選擇维持一致，屬設計選擇非新增 bug）**
   - 位置：`_recomputeEffectiveQuotesSummary()` 的 `bySource` 欄位鏡射 base
     `getEffectiveMarketQuotes()` 既有寫法，只枚舉 `quoteProviderSources`（5 個已知 provider，
     `official_close` 被刻意排除在此陣列外，見 §A）。
   - 影響：`selectedSource === "official_close"` 的 item（無論是 round 1 augment 還是 round 2
     synthesize 出來的）永遠不會出現在 `summary.bySource[]` 任何一格，`sum(bySource[].total)` 可能
     小於 `summary.total`——但 `total`/`ready`/`degraded`/`blocked`/`strategyUsable` 等其餘欄位本輪
     確實有正確重算（已用 e2e 測試驗過 total/blocked）。這是「跟 round 1 保持一致」的合理選擇，非
     本輪新增的 regression，只是既然新寫了一支 recompute helper，未來若有人拿 `bySource` 加總去
     跟 `total` 對帳會對不上，值得留一筆待辦。
   - 建議：下一輪視需要決定要不要把 `official_close` 加進 `bySource`（跨 base function 一起改，非
     本票範圍）。

### 💭 Nits
1. `requestedSymbols.length` 若超過 `limit`（預設 100）時，`missingSymbols` 判定是拿「未受限的
   requestedSymbols」對比「已被 `resolveMarketQuotes()` 內部 `.slice(0, limit)` 截斷過的
   `effective.items`」，理論上會把「其實有報價、只是被排序截掉」的 symbol 誤判成 missing 而重新從
   `quote_last_close` 合成（可能拿較舊的收盤價擠掉原本排序更靠前的活報價，最終 `.slice(0, limit)`
   二次截斷時位置可能改變）。桌面自選股/單一symbol查詢實務上遠低於 100，屬理論邊界，非急迫。
2. 根因調查文件（code comment）主動揭露 `risk-store.ts` 疑似共用同一個 `RAILWAY_VOLUME_MOUNT_PATH`
   ephemeral fallback pattern，可能導致 kill-switch/risk-limit 狀態也是「假持久化」——這不是本票
   bug，但影響面遠大於本票（風控/killswitch 狀態跨 deploy 消失是 P0 級風險），作者已誠實 flag 給
   Elva 未動手修（正確的 lane 紀律），**這裡再次強調給 Elva：這條需要儘快派工查證**，不要因為藏在
   一段 code comment 裡而被忽略。

### ✅ Praise
- **Repro test 是真的復現 prod 症狀，不是簡化版**：`ROUND 2 repro` 測試（全新 workspace、完全不
  seed 任何報價）直接斷言 `effective.items` 為空陣列、`summary.total === 0`，與 Elva 在 prod 對
  `2330,2454` 複驗看到的症狀逐字對應——這是「先寫一個會炸的測試重現真bug，再修到過」的教科書級
  goal-driven execution，而非事後編一個順著新程式碼寫的假測試。
- **根因調查做到底、且誠實排除了一個看起來合理但錯的假說**：作者先假設是 `loadPersistedQuoteEntries()`
  的重啟回填邏輯有 bug，實際去讀那支函式 + 用 `railway variables`/`railway volume list` 查證 prod
  現況，才發現真正問題是 `RAILWAY_VOLUME_MOUNT_PATH` 未設定導致 volume 沒掛載（infra config drift，
  非這支函式的邏輯錯誤）——這個「先懷疑 A，查證後排除 A，才找到真正的 B」的紀律值得肯定，且過程中
  發現的 `risk-store.ts` 風險已誠實上報而非自行處理（lane 紀律正確）。
- **風控隔離主張延續 #1307 的驗證強度**：`official_close` 持續不進 `quoteProviderSources`；
  `strategyUsable`/`paperUsable`/`liveUsable` 在兩個新分支都硬編 false；`listMarketDataProviderStatuses`
  只在真的有 missing symbol 時才呼叫，且明確澄清是 in-memory 讀取非新網路呼叫——避免了掛死三連問
  的疑慮，也沒有讓風控相關欄位出現「架構性保證但非型別強制」的新缺口。
- **「N in N out」的 API 契約選擇本身是對的方向**：比起讓呼叫端猜「這個 symbol 是被過濾掉還是真的
  沒資料」，保證每個 requested symbol 都有一列、缺資料時給誠實 `reasons:["missing_quote"]` 而非
  沉默消失，方向上完全符合本專案「缺資料顯 EMPTY/STALE 真原因，不假綠」的精神——🔴 #1 抓到的是這個
  誠實資料在既有前端映射層被翻譯壞了，不是這個設計決策本身有問題。

## 5. Verdict
- [ ] APPROVED
- [x] **NEEDS_FIX** — 1 個 🔴（見上，效果是「backend 現在誠實吐出的 reasons，撞上既有但本票大幅擴大
      曝光面的前端映射缺口，導致 `/quote` 頁在本票+#1307 共同宣稱要修好的黃金場景下印出原始工程
      字串」）。backend 邏輯本身（合成正確性、風控隔離、fail-open）沒有發現需要卡住的問題；卡住的
      原因是「這張票宣稱解決的使用者可見症狀，實際驗證後在最主要的消費端沒有被完整解決，反而換了
      一種新的、更違反硬規則的呈現方式」。若 Elva 判斷「這是 #1307 已經上線的獨立前端債，不該卡
      這張純 backend 票」，也是合理的替代判斷——但無論哪種處理，這件事需要在 ready 前有明確決定和
      owner，目前 PR 描述沒有提到。
- [ ] BLOCKED

## 6. Suggested Owner for Fixes
- 🔴 #1（reasonLabel 白名單修復）→ Jim（或 Codex，`apps/web/app/quote/page.tsx` 範圍）；需 Elva 裁決
  是否讓本票在此修復落地前 hold，或平行處理視為緊急 fast-follow
- 🟡 #1（mis_close market 猜測 + 上游 exchange 資訊遺失）→ Jason，跨 `s1-sim-runner.ts`/
  `quote-last-close-store.ts`，排下一輪
- 🟡 #2（export + 補測試）→ Jason，同一輪內可順手補
- 🟡 #3（bySource 涵蓋 official_close）→ Jason，視需求排入下一輪，非急迫
- 💭 #2（risk-store.ts ephemeral persistence 風險）→ Elva 儘快派工查證（P0-adjacent，非本票 owner 責任
  但需要立刻被看見）

## 7. Re-review Required
YES — 待 🔴 #1 的處理路徑（修復或 Elva 明確接受風險）確定後，若有代碼變動需 Pete 重審一次；若
Elva 選擇「不卡本票、另開票處理」則本票可視為只剩 🟡/💭，NO re-review 需要。

---
Reviewer: Pete
Date: 2026-07-19
Sprint: W6 Day 19（沿用 dispatch 標記 sprint_2026_07_19）
