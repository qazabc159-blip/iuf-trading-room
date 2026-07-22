# AI 推薦／AI 分析報告「簡陋」根因診斷 — 2026-07-22（Jason，診斷限定，未動手改）

## 結論（三選一）

**閘門過嚴（且兩層閘門判準不一致）— 是主因。** 其次，即使通過閘門的內容，門檻本身也偏低，兩者疊加才是使用者看到「簡陋」的完整成因。不是 LLM 輸出普遍 drift（prompt 明確要求 9 段+數字+來源，且後端已有一次重試機制），也不是「內容設計上本來就這麼薄」（prompt 要求密度不低，備援樣板才薄）。

涉及兩個面：`AI 分析師報告`（公司頁）與 `/ai-recommendations`（v3 orchestrator）——兩者各自有獨立的品質閘門與獨立的備援/降級輸出，但結構上是同一類問題：**閘門判準比 LLM 真實輸出更容易漏接，一旦沒過，使用者看到的是機械式備援內容而非 LLM 的真實分析。**

---

## 證據鏈

### A. 公司頁「AI 分析師報告」（9 段格式）

1. **Prompt 定義 9 段固定格式**：`apps/web/app/companies/[symbol]/aiAnalystReportContract.ts:3-13`（`COMPANY_AI_ANALYST_REQUIRED_SECTIONS`，逐字要求 `"## 1. 公司概況與定位"` 等 9 個標題字串）。

2. **後端合成後驗證用「寬鬆 regex」**：`apps/api/src/brain/react-loop.ts:91-101`（`COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS`，例如 `/##\s*1[.\s]*公司概況與定位/u`——標題後的句點/空白/數字間距全部容許變形）。失敗只重試一次（`react-loop.ts:857-878`）；重試仍不過，直接改用機械組裝的「保守分析版」樣板（`buildCompanyAiAnalystContractFallbackReport`，`react-loop.ts:267-326`，內容由 `collectCompanyAiTraceFacts()` 抽取的固定欄位拼字串產生，非 LLM 原文）。

3. **前端顯示前再驗證一次，用「嚴格逐字比對」**：`apps/web/app/companies/[symbol]/aiAnalystReportQuality.ts:89`（`md.includes(section)`，`section` 是 `COMPANY_AI_ANALYST_REQUIRED_SECTIONS` 裡逐字的 `"## N. 標題"`，句點、空格、數字格式必須完全一致，沒有任何容錯）。

4. **後果**：後端判定「已通過（`validateSynthesisSections(finalReport).length === 0`，`react-loop.ts:1038`）」並存下的**真實 LLM 報告**，只要標題格式跟前端要求的逐字字串有一絲落差（例如模型少打句點、多一個空格、或用全形句號），就會在前端被 `assessCompanyAiReportQuality()` 判 `missing_sections` 再次攔下（`AiAnalystReportPanel.tsx:470-474`），顯示「報告品質未通過…已停止當作正式分析展示」，使用者看到的不是備援樣板，而是**完全空白的品質攔截狀態卡**——比備援樣板更貧乏。這是一個**兩層閘門互不校準**造成的架構性漏洞，不是模型輸出普遍變薄。

5. **Bruce 7/16 已抓到的實測**：一次真觸發花 $0.0229，因「缺九段格式」被判不合格（`team_status_archive_202607.md` 7/16 段，750 行；本輪重新對照代碼確認機制）。

6. **即使通過，門檻本身也低**：`validateCompanyAiAnalystQualityIssues()`（`react-loop.ts:468-489`）只要求全文 ≥600 字（9 段平均每段約 65-90 字），加上「至少 3 個可驗證數字、3 種來源類型」（`aiAnalystReportContract.ts:15-16`）。這個地板夠低，**剛好卡過門檻的內容本身讀起來仍會偏簡略**——這是第二成因，疊加在「閘門互不校準」之上。

### B. `/ai-recommendations`（v3 orchestrator）

7. **前端實際打的是 v3 endpoint**，不是舊版 v1 fixture 合成（`apps/web/app/ai-recommendations/v3-view.ts:19` `const ENDPOINT = "GET /api/v1/ai-recommendations/v3"`；後端路由 `apps/api/src/server.ts:21718`，對應 `ai-recommendation-v2/orchestrator-v3.ts` 的 ReAct LLM pipeline）。

8. **同款「未達門檻→降級」設計**：`MIN_V3_RECOMMENDATION_ITEMS = 5`、`MIN_V3_TECHNICAL_CALLS = 5`（`orchestrator-v3.ts:329,333`），若模型提前收斂或工具呼叫不足，ReAct loop 會用系統訊息強制續跑（`orchestrator-v3.ts:3182-3239`），跑到底仍不足則整批標記 `insufficient_tools`/`synthesis_format_error`（`orchestrator-v3.ts:279,415-427`）。

9. **前端有獨立的 `usedFallback`/`degraded` 分支**：`apps/web/app/ai-recommendations/v3-view.ts:438-467`——`usedFallback===true` 或 `fullAiReportParsed===false` 時仍會顯示卡片但標記「AI 推薦資料尚未完整…此頁不會補假資料」。這條路徑目前**未逐行核對「已解析」與「已達標」的判斷是否跟後端真正的完整輸出一致**（時間關係，本輪未深入 orchestrator-v3.ts 全部 3000+ 行的評分/解析細節，只確認了門檻常數與外層狀態機）——列為未查證項目。

---

## 修法建議（≤5 行，兩案；不實作，等 Elva 裁）

**閘門側（優先，risk 低、直接解決兩層不一致）**：
1. 把 `apps/web/app/companies/[symbol]/aiAnalystReportQuality.ts` 的 9 段檢查，從逐字 `.includes(literal string)` 改成跟後端同一組寬鬆 regex（或直接把 `react-loop.ts` 的 `COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS` 抽成 contracts 共用常數，前後端同一份判準，不要各寫一套）。
2. 視需要調升 `COMPANY_AI_ANALYST_MIN_NUMERIC_FACTS`/`MIN_SOURCE_MENTIONS`/降低 `too_short` 的 600 字門檻寬容度，讓「過門檻」跟「讀起來像正式報告」的認知一致。

**Prompt 側（次要，touch 面積較大）**：
3. 若楊董要的是「更長、更有敘事感」而非單純格式對齊，可以在 `buildCompanyAiAnalystPrompt`/v3 orchestrator 的段落內容要求（`aiAnalystReportContract.ts:46-56`）裡把「每段至少 2 個重點」上修到 3-4 個，並要求每段附一句延伸解讀。
4. 對 v3 的 `MIN_V3_RECOMMENDATION_ITEMS`/`MIN_V3_TECHNICAL_CALLS` 觀察是否常態性壓線或超時，若是，代表門檻設得比模型能力上限更高，會反覆觸發 `insufficient_tools` 強制續跑，浪費 budget 又不保證更豐富的輸出——需要抓幾次真實 run 的 trace 長度才能下修或維持。

---

## 未查證 / 留給 Elva 或下一輪

- 未實測觸發一次真實 company AI report 或 v3 run 來直接復現「前端嚴格比對擋掉後端已通過報告」這個場景（本輪為代碼靜態分析，非 live trigger；觸發要 Owner session + 花費真實 LLM 費用，超出「先診斷不動手改」的授權範圍）。
- `orchestrator-v3.ts` 全文只看了門檻常數與外層狀態機，`enrichV3Items`/`applyIncompleteFlag`/`completeItemCount` 等解析細節未逐行核對是否也有類似「兩套判準」問題。
- 未查證 prod 近期實際 run 的 `usedFallback`/`missing_sections` 觸發頻率（無 prod DB 存取），無法量化「多常發生」，只能確認「機制上會發生」。
