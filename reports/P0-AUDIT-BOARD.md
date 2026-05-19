# IUF Trading Room P0 Audit Board

**Generated**: 2026-05-18 TST (Elva 骨架)
**Schema**: 17 columns × N routes（楊董 §5 明示）
**Roles**:
- **Elva**: 主管收 / 驗收頁面 / 守 hard rule
- **Frontend Codex**: 主筆填 UI / Frontend / Screenshot 欄
- **Backend Codex**: review API endpoint / Backend status 欄
- **Bruce**: live verify + screenshot evidence
- **Jason**: backend gap 修補
- **Mike**: schema/migration audit
**Cell legend**:
- UI state: `OK / TOO_RAW / BROKEN / OLD_UI / MOBILE_WRONG`
- Blank: `Y / N`
- Fake/demo: `Y / N / UNCLEAR`
- Backend: `LIVE / PARTIAL / MISSING / BROKEN / UNKNOWN`
- Frontend: `LIVE / PARTIAL / NOT_WIRED / FAKE_ONLY`
- Empty state: `OK / BAD / MISSING`
- PR: `A` (AI 推薦+新聞) / `B` (熱力圖+情報) / `C` (交易室) / `D` (公司頁) / `E` (routing) / `F` (admin)
- Decision: `PASS / FAIL / NEEDS_FIX`
- `PENDING_CODEX` = Codex 主筆待填

---

## CORE 19 — 楊董明示主導航 routes

| # | Route | Title | Main user job | UI | Blank | Fake | Endpoint | Backend | Frontend | Empty | User問題 | PR | Owner | Required fix | Screenshot | Smoke | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/` | 戰情台 Home | 一眼看到 AI 推薦 Top 3 + AI 精選新聞 + 熱力圖 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/heatmap/kgi-core` + `/ai-recommendations` + `/market-intel/news-top10` | PARTIAL (#696 items=3 fallback) | PENDING_CODEX | PENDING_CODEX | #1#2#3 (AI 選股/新聞/熱力圖) | A+B | FE Codex+Backend | 首頁顯示 AI Top 3 卡片 + 熱力圖 40 檔 + AI 新聞 | PENDING | `curl /v1/ai-recommendations` | NEEDS_FIX |
| 2 | `/market-intel` | 市場情報 | AI 精選新聞 + 重大公告 + 熱力圖 | PENDING_CODEX | N (5/18 14:25 Bruce 驗) | UNCLEAR (announcements 仍可能含 finmind_stock_news fallback) | `/market-intel/news-top10` + `/market-intel/announcements` | PARTIAL (#694 收緊，但 announcements scope) | PENDING_CODEX | OK (誠實 empty state) | #4 (亂報導沒挑選) | A+B | FE Codex+Backend | 分層 4 區(AI精選/官方公告/產業事件/資料來源) + 抓取頻率明示 | reports/qa_2026_05_18_yang_stage1/B_*.png | `curl /v1/market-intel/news-top10` | NEEDS_FIX |
| 3 | `/ai-recommendations` | AI 推薦股票 | 5+ 檔推薦卡 + entry/stop/target/reason/risk | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/ai-recommendations/v3` | PARTIAL (items=3 deterministic fallback) | PENDING_CODEX | PENDING_CODEX | #1 (AI 選股看不到) | A | FE Codex+Backend | items >=5 真 AI path + 推薦卡 entry/SL/TP/reason + 帶入交易室 | reports/qa_2026_05_18_PRA/E4 (login 頁) | `curl /v1/ai-recommendations/v3` | NEEDS_FIX |
| 4 | `/ai-recommendations/[id]` | 單一推薦詳細 | 詳細推薦理由 + 反饋 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/ai-recommendations/:id` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | (派生 #1) | A | FE Codex | feedback 反饋按鈕 | PENDING | PENDING | NEEDS_FIX |
| 5 | `/ideas` | 策略候選 | 看到 strategy ideas + 推薦 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/ideas` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | (派生 #1) | A | FE Codex | 不可冒充 AI 推薦；候選分 ideas vs AI rec | reports/qa_2026_05_18_PRA/E5 (login) | PENDING | NEEDS_FIX |
| 6 | `/portfolio` | 交易室 / Paper Trading Room | 搜尋任意台股 + 行情 + K線 + 資金 + 庫存 + 委託 + 成交 + 風控 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/companies/lookup` + `/companies/:id/ohlcv` + `/companies/:id/quote/realtime` + `/paper/*` + `/kgi/*` | PARTIAL (Bruce STAGE 1 D code path 確認 但真 browser 截圖缺) | PENDING_CODEX | PENDING_CODEX | #5 (只能交易幾檔/不能搜尋/K線指標裝飾) | C | FE Codex+Backend | 5 檔換股真實互動 + K線 timeframe + 指標 toggle + 庫存 + KGI SIM 區分 | reports/qa_2026_05_18_yang_stage1/D_* (code path only) | manual: 點 2330→2454→2317→1809→1723 | NEEDS_FIX |
| 7 | `/companies` | 公司列表 | 列公司 + 主題雷達入口 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/companies` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | #8 (跳到 mobile + 卡舊版) | D+E | FE Codex | 列表 + 主題雷達 link 不跳 /m | PENDING | PENDING | NEEDS_FIX |
| 8 | `/companies/[symbol]` | 公司詳細 | 行情+K線+成交明細+權證選擇權+盤中報價+AI分析師報告+主題 | PENDING_CODEX | Y (多 panel 空白) | UNCLEAR | `/companies/:id/*` + `/companies/:id/quote/realtime` + `/ai-analyst-report/:id` | BROKEN (Bruce 之前 get_company_technical 全 null 已修；analyst report unknown) | PENDING_CODEX | PENDING_CODEX (BAD — 多 panel 空白) | #6#7 (空白模組 + AI分析師報告壞) | D | FE Codex+Backend | 所有 panel 三選一: LIVE/DEGRADED/COMING_SOON_DISABLED + 不空白 | PENDING | manual: /companies/2330 點各 panel | NEEDS_FIX |
| 9 | `/themes` | 主題雷達 | 主題列表 + 切主題詳細 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/themes` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | #8 | E | FE Codex | 不跳 /m | PENDING | PENDING | NEEDS_FIX |
| 10 | `/themes/[short]` | 主題詳細 | 主題下公司 + 事件 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/themes/:short` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | #8 (返回卡死) | E | FE Codex | back button 回正確頁 | PENDING | PENDING | NEEDS_FIX |
| 11 | `/quant-strategies` | 量化策略列表 | 看策略名/狀態/績效/SIM-only | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/quant-strategies` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | #9 (一團糟) | F | FE Codex | 卡片含 ID/狀態/績效/風險/SIM-only | PENDING | PENDING | NEEDS_FIX |
| 12 | `/quant-strategies/[strategyId]` | 策略詳細 | 策略說明+回測+風險 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/quant-strategies/:id` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | #9 (滿版紅字) | F | FE Codex | 紅字分類: data missing/schema/retired/stale/risk | PENDING | PENDING | NEEDS_FIX |
| 13 | `/lab` | Quant Lab | Lab 入口 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/lab/*` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | #9 | F | FE Codex | 同 quant-strategies 規範 | PENDING | PENDING | NEEDS_FIX |
| 14 | `/lab/strategies` | Lab 策略 | 三策略 list | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/lab/strategies` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | #9#15 | F | FE Codex | Strategy Lanes 不滿版紅字 | PENDING | PENDING | NEEDS_FIX |
| 15 | `/lab/three-strategy` + `/lab/three-strategy/[id]` | 三策略詳細 | S1/v36/Class5 | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | static (Bruce 5/18 C 驗) | LIVE (static ground-truth) | LIVE | OK | #15 | F | FE Codex | 維持 phantom 標「不可引用」 | reports/qa_2026_05_18_yang_stage1/C (HTTP) | manual | NEEDS_FIX |
| 16 | `/alerts` | 警報 | 看 alert list | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/alerts` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | (未提，需 audit) | F | FE Codex | PENDING_CODEX | PENDING | PENDING | NEEDS_FIX |
| 17 | `/signals` | 訊號 | 看 signal stream | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/signals` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | (未提) | F | FE Codex | PENDING_CODEX | PENDING | PENDING | NEEDS_FIX |
| 18 | `/plans` | 計畫 | 看 trading plan | PENDING_CODEX | PENDING_CODEX | PENDING_CODEX | `/plans` | UNKNOWN | PENDING_CODEX | PENDING_CODEX | (未提) | F | FE Codex | PENDING_CODEX | PENDING | PENDING | NEEDS_FIX |
| 19 | `/briefs` + `/briefs/[id]` | 簡報 | 看 daily brief | PENDING_CODEX | N (Bruce v4 確認 16 published FFFD=0) | N | `/briefs` | LIVE | PENDING_CODEX | PENDING_CODEX | (未提) | F | FE Codex (only verify) | maintain FFFD=0 | PENDING | `curl /v1/briefs` | NEEDS_FIX |

## ADMIN 5 — 楊董 §10-#14 明示

| # | Route | Title | Main user job | UI | Blank | Fake | Endpoint | Backend | Frontend | Empty | User問題 | PR | Owner | Required fix | Screenshot | Smoke | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20 | `/admin/brain/llm` | Brain LLM 費用總覽 | 看 LLM cost + tokens | PENDING_CODEX | N (Bruce 5/18 C ✅ 真資料) | UNCLEAR (估算 vs 真帳單) | `/admin/llm/usage` + `/llm/models` + `/llm/calls` | LIVE | PENDING_CODEX | OK | #10 (不知真假) | F | FE Codex+Backend | 每數字標 source + estimated/actual + lastUpdated | reports/qa_2026_05_18_yang_stage1/C | manual | NEEDS_FIX |
| 21 | `/admin/events` | EventLog | 看 audit/exec/alert/openalice events | PENDING_CODEX | Y (Bruce streams=0) | N (誠實 empty「請從左側選擇一個事件流」) | `/event-streams` | PARTIAL (streams=0 backend) | PENDING_CODEX | OK (read-only 明示) | #11 (一片空白) | F | Jason + FE Codex | 接 audit/paper/alert/openalice 真事件源 + empty state 含「最近檢查時間/source 正常」 | reports/qa_2026_05_18_yang_stage1/C | manual | NEEDS_FIX |
| 22 | `/admin/portfolio/snapshots` | Portfolio 快照 | 看 paper/KGI 倉位 + diff | PENDING_CODEX | Y (Bruce 確認 backend 404) | UNCLEAR (UI 看似可互動但 backend 缺 route) | `/portfolio/snapshots` (**404 缺**) | **MISSING** | PENDING_CODEX (FAKE_ONLY) | MISSING | #12 (一片空白 / 裝飾品) | F | Jason (補 route) + FE Codex | 補 `/api/v1/portfolio/snapshots` route + 接 paper portfolio/positions/orders/fills | reports/qa_2026_05_18_yang_stage1/C | `curl /v1/portfolio/snapshots` | NEEDS_FIX |
| 23 | `/admin/tools` | ToolCenter | 看可用工具 + 執行紀錄 | PENDING_CODEX | N (Bruce 5/18 ✅ 12 tools) | UNCLEAR (真功能 vs 展示?) | `/tools/registry` + `/tools/calls` | LIVE | PENDING_CODEX | OK | #13 (不知真假) | F | FE Codex | 每 tool card 標 DEMO/COMING_SOON/LIVE + 真 endpoint + 執行紀錄 | reports/qa_2026_05_18_yang_stage1/C | manual | NEEDS_FIX |
| 24 | `/admin/uta/accounts` | UTA 帳號管理 | user list + role + permission | PENDING_CODEX | N (Bruce 確認 Phase A read-only 明示) | N (誠實「Phase A 僅讀」) | `/uta/adapters` + `/uta/orders` | PARTIAL | PENDING_CODEX | OK | #14 (沒架好) | F | Elva 決策 | **二選一**: A 真補完(user/role/workspace/perm/session/api-key) 或 B 從主導航移除 → admin only | reports/qa_2026_05_18_yang_stage1/C | manual | NEEDS_FIX |

## ADMIN extras（楊董未明示但需 audit）

| # | Route | Owner | 風險 |
|---|---|---|---|
| 25 | `/admin/strategies` | Codex | static page，Bruce 已驗 OK，phantom 標「不可引用」 |
| 26 | `/admin/content-drafts` + `/[id]` | Codex | Brief drafts admin（low priority） |
| 27 | `/admin/invites` | Codex | low priority |
| 28 | `/companies/duplicates` | Codex | low priority |

## RISK ROUTES（楊董明示禁 / 舊版）

| # | Route | 風險 | 處理 |
|---|---|---|---|
| 29 | `/m/*`（mobile 頁） | 楊董 §8 明示「點公司 → 主題雷達 → 隨便點 → 變手機頁」 | 桌面 desktop UA 必須不能跳 /m/* → 修 routing guard |
| 30 | `/final-v031/*`（外包 demo） | 楊董明示「不准把舊頁、手機頁、外包 demo、工程頁混在正式產品裡」 | iframe 嵌入正式 route 需檢查；若被 /market-intel + /portfolio 嵌用為產品入口 → 必須 audit + 收編 |
| 31 | `/login` `/register` `/settings/account` | low risk | 略 |
| 32 | `/quote` `/drafts` `/reviews` `/ops` `/runs` `/runs/[id]` | 工程頁 / 開發工具 | audit 是否該對 owner 隱藏 |

---

## Known evidence (已 verify)

### Bruce 5/18 PR-A verify (`runId=bc53e971-2989-45ed-b961-eaefef04ed99`)
- `/api/v1/ai-recommendations/v3`: status=complete, items=3, deterministic fallback, companyName=聯發科/鴻海/中華電
- `/api/v1/market-intel/news-top10`: items=10, ai_call_success=true
- `/market-intel` `/ai-recommendations` `/ideas`: HTTP 200 但 Bruce headless 截到 login 頁

### Bruce 5/18 STAGE 1 A/B/C/D
- A `/heatmap/kgi-core`: tileCount=40, sourceState={twse_eod:39, no_data:1}
- B `/market-intel`: 誠實「資料同步中」empty state, 無媒體 fallback
- C admin 4 pages: brain/llm + tools + strategies LIVE; events + uta read-only; **portfolio/snapshots 404**
- D `/portfolio`: code path 確認 selectPaperSymbol → /companies/lookup → hydratePaper → drawChart, **真實 browser 截圖 unable**

### Mike 5/18 migration 0031 audit: GREEN
- 0031 LIVE in prod (5/14 08:23 UTC apply)
- Blocker = 0032-0041 gap（Railway `RAILWAY_MIGRATION_REQUIRED` env 未設）

---

## Action items（按 PR 順序）

### PR-A — AI 推薦股票 + AI 選新聞
- ✅ #693/#694/#696/#697 backend already merged
- ❌ items=3 deterministic fallback 不滿足楊董「最好 >= 5」+ rationale 寫「Deterministic fallback」非 full AI path → Backend Codex 第二輪
- ❌ Frontend 是否真顯示推薦卡未驗 (login 頁截不到) → Frontend Codex 接 Playwright cookie inject
- ❌ Top 3 是否在 / 首頁顯示 → Frontend Codex audit row #1

### PR-B — 熱力圖 + 市場情報
- ✅ heatmap tileCount=40 (Bruce STAGE 1 A)
- ❌ 楊董明示「產業熱力圖每產業 10-15 檔」+ 「全市場熱力圖不要亂塞英文」 → 需 `tw_industry_representatives.ts` config + 中文產業名 + 顏色（漲紅跌綠中性灰）
- ❌ 市場情報分 4 區（AI 精選/官方公告/產業事件/資料來源）

### PR-C — 交易室 (`/portfolio`)
- ✅ Codex #693 KGI whitelist 對齊
- ❌ 楊董 §6 明示 K線 timeframe(1d/1w/5m/15m/60m) + 指標 toggle 真實 + 庫存/倉位/資金 + paper preview/submit + KGI SIM 明確區分
- ❌ 真 browser 截圖驗 5 檔換股

### PR-D — 公司頁空白模組
- ❌ 成交明細 / 即時行情 / 權證選擇權 / 盤中報價 / AI 分析師報告 全要三選一
- ❌ AI 分析師報告必須能生成

### PR-E — Routing bug
- ❌ desktop → 主題雷達 → 跳 /m mobile → 卡舊版 (楊董 §8 明示)
- ❌ 統一所有主題 route + back button 修

### PR-F — 量化策略 + admin 5
- ❌ /quant-strategies + /lab/* 紅字分類
- ❌ Brain LLM 數字標 estimated/actual
- ❌ EventLog 接 audit/paper/alert/openalice 事件
- ❌ Portfolio snapshots **backend route 缺** (`/api/v1/portfolio/snapshots` 404)
- ❌ ToolCenter 工具卡標 DEMO/COMING_SOON/LIVE
- ❌ UTA 二選一 (真補完 or 隱藏)

---

## 下一步分派

1. **Frontend Codex 主筆**: 把 24 routes 中所有 `PENDING_CODEX` cell 填滿（UI 狀態 / Frontend wiring / Empty state / Screenshot path）
2. **Backend Codex**: review API endpoint 欄 + Backend status（特別是 portfolio snapshots 404 + items=3 fallback）
3. **Bruce**: 等 audit board 填完，逐 row live verify + 補真實 browser screenshot
4. **Jason**: 接 backend gap fix（PR-F admin portfolio snapshots route 缺）
5. **Mike**: 待命（schema/migration 變更時進場）
6. **Elva**: 每 30 min 重審 audit board + 對齊 Codex 進度 + 矯正偏差

---

**Next update**: Frontend Codex 填完 `PENDING_CODEX` cells（預計第一輪 ~30 min）

---

## 2026-05-19 Codex P0 cycle update — PR-C `/portfolio` paper price gate

- **Latest base**: `18819c9` / PR #727.
- **Production scan evidence**: `evidence/w7_paper_sprint/p0-next-task-scan-2026-05-19-round2/portfolio.png`.
- **Finding**: `/portfolio` owner-session screenshot showed the paper ticket CTA as `送出紙上單 2330 買進 1 lot @ 0.00` and the estimate as `0 NTD` while the trading room otherwise had selected quote context. This is a P0 product safety issue because an invalid price is presented as a ready paper/KGI SIM order.
- **Route row affected**: #6 `/portfolio`, PR-C.
- **Decision**: `NEEDS_FIX` until the UI blocks invalid price/quantity, renders an honest pending-input state, and browser smoke proves the CTA no longer shows `@ 0.00`.
- **Owner**: Frontend Codex for UI gate; backend remains unchanged.

---

## 2026-05-19 Codex P0 cycle update — PR-F `/quant-strategies` score pending copy

- **Latest base**: `ad99ba8` / PR #728.
- **Production scan evidence**: `evidence/w7_paper_sprint/p0-quant-prod-scan-2026-05-19-round1/quant-strategies.png`.
- **Finding**: `/quant-strategies` renders `量化分數 / 讀取中` on strategy cards even though the page says formal quant score numbers will only appear after the official `quant-strategies` endpoint returns. This is not an active loading state; it is a pending backend data contract.
- **Route row affected**: #11 `/quant-strategies`, PR-F.
- **Decision**: `NEEDS_FIX` until the UI stops implying an endless loader and shows an honest pending source state.
- **Owner**: Frontend Codex for copy/state; Jason/Elva for real numeric score endpoint.

---

## 2026-05-19 Codex P0 cycle update - `/market-intel` and `/companies/[symbol]`

- **Latest base**: `9a99307` / PR #729.
- **Production scan evidence**: `evidence/w7_paper_sprint/p0-market-intel-ai-news-debug-2026-05-19/market-intel.png`.
- **Finding**: `/market-intel` production iframe now shows 10 AI-selected news cards from `GET /api/v1/market-intel/news-top10`; keep it `PARTIAL` until official announcements/source governance is clean, but do not count it as "frontend cannot see AI news" anymore.
- **Company route finding**: `/companies/2330` was still at risk because the detail route fetched broad `GET /api/v1/companies` and scanned locally before rendering any panel.
- **Current action**: PR in progress changes `/companies/[symbol]` to resolve the requested ticker through `GET /api/v1/companies?ticker=...`.
- **Route rows affected**: #2 `/market-intel`, #8 `/companies/[symbol]`.
- **Decision**: `/market-intel` = `PARTIAL`; `/companies/[symbol]` = `NEEDS_FIX` until deployed and production browser screenshot proves the company page renders formal panels.
- **Owner**: Frontend Codex for the ticker lookup change; Jason only if ticker endpoint fails in production.
