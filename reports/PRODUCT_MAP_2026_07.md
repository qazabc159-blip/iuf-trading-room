# IUF 產品地圖 — 2026-07（Fable 5 立，配 CLAUDE.md/AGENTS.md 使用）

一頁看懂：頁面 × 使用者工作流 × 資料來源 × 風險邊界。路由真相源=`apps/web/lib/canonical-surfaces.ts`（#1158 registry，改導航先改它）。⚠️ 此檔 2026-07-03 才 merge — **本地工作區若停在舊 branch 會找不到，用 `git show origin/main:apps/web/lib/canonical-surfaces.ts` 看**（冷啟動 read-back 實測有人栽在這，correct 行為正是 CLAUDE.md 陷阱條「查現況信 origin/main 不信工作區」）。

## 正式產品面（6 頁，Sidebar/Cmd-K 唯一入口）

| 頁 | 使用者在這做什麼 | 資料來源 | 風險邊界 |
|---|---|---|---|
| `/` 戰情台 | 開盤第一眼：大盤、KPI、重大訊息 | MIS 即時指數＋TWSE EOD＋dashboard snapshot | snapshot 端點含內部聚合 — 權限矩陣豁免清單管制 |
| `/market-intel` 市場情報 | AI 精選新聞＋為什麼重要 | TWSE/TPEX 公告＋新聞源→gpt-5.4-mini 選稿 | LLM 預算閘 $8/日；選稿失敗退 fallback 要顯真狀態 |
| `/ai-recommendations` AI 推薦 | 每日 5 檔推薦＋理由＋forward 績效 | v3 cron（08:30-09:15 窗）＋FinMind 法人/量價 | 禁字 firewall；績效必真（forward return 收集中） |
| `/portfolio` 交易室 | 看倉位、下模擬單（=ui-final-v031 iframe） | paper broker＋KGI SIM＋UTA 帳號 | **下單流改造中**（S1_UNIFIED_ORDER_FLOW_DESIGN）；真單鎖 Phase 4 |
| `/companies` 公司/主題 | 個股深查：K 線、五檔、AI 分析、主題板 | MIS 即時＋FinMind 基本面＋theme refresh cron | AI 分析有品質閘門；五檔標「約 5-20 秒快照」 |
| `/quant-strategies` 量化策略 | 看 S1 策略狀態與資金配置（S1-only） | Lab sanctioned bundle（唯一合法源） | 策略數字只吃 sanctioned；S1 已凍結降級照實顯示 |

## Owner 面
- `/ops/f-auto`：F-AUTO SIM 觀察台 — 持倉/現金/NAV 連續曲線（sim_ledger，含成本真值）。帳要勾稽得回本金=鐵律。
- `/admin/team`：邀請＋用戶管理（0050 系統）；`/admin/brain/*` 主腦監控；`/admin/tools`、`/admin/uta/accounts`、`/admin/strategies`。

## 支援面
`/settings/*`（帳號/券商連線 gateway 配對/方案）、`/briefs`（AI 晨報，dock 進入）、`/alerts`（風控警示，bell 進入）、`/login`、`/register`（邀請制）、`/m`（行動入口）。

## 核心使用者工作流（依北極星）
1. **晨間**：戰情台 → 晨報（brief v2）→ AI 推薦 5 檔 → 公司頁深查 → 交易室下模擬單。
2. **盤中**：交易室看倉位（MIS 即時價）→ 警示 bell → 市場情報。
3. **盤後**：F-AUTO NAV 曲線 → 週復盤（/reviews，deep link）→ 主腦深析（Owner）。
4. **管理**（Owner）：發邀請 → 用戶管理 → brain 成本/決策監控。

## 資料鏈（四層報價 fallback，壞了照層查）
1a KGI gateway live（平日 08:20-14:10 EC2 窗）→ 1b TWSE/TPEX 官方 EOD（寫 DB）→ 1c MIS 盤後快照（寫 DB）→ 1d `quote_last_close` DB last-good（重啟/盤後兜底）。
其他：FinMind 11 dataset（sponsor 6000/hr，**不擴充**）；OpenAI 管線全走預算閘＋誠實 skip。

## 風險邊界總表
- **真金**：全鎖。解鎖流程=`reports/phase4_safety_gate/` 五 Stage，逐筆 owner 授權。
- **法規**：憑證綁人（客戶自跑 gateway）＋證交法 159 禁全權委託 → 產品只給訊號與工具。
- **策略措辭**：禁 approved/可跟單/保證獲利；策略品質判定=Lab lane，本 repo 只呈現。
- **多用戶**（Phase III 前置）：權限矩陣 PR-B2 掃雷完成前不發 Viewer/Trader 邀請。
