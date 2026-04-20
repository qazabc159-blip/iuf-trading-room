# IUF Trading Room — Project Briefing

> 這份文件是為了讓新的 LLM session（claude.ai Project、新開的 Claude Code、Codex、ChatGPT 等）能在 10 分鐘內把整個專案的脈絡吃下來。以 2026-04-20 的 repo 狀態為準，定期由主 session 重寫。
>
> **不是** API docs、不是 user manual、不是 onboarding for human devs。是給**模型**讀的高密度現況快照。

---

## 0. TL;DR

- **IUF Trading Room** 是一位獨立操盤者的「研究 → 策略 → 執行 → 檢討」端到端作業系統
- TypeScript monorepo（pnpm + turbo + Next.js 15 + Hono + Drizzle + Postgres）
- 部署：Railway（5 服務：web / api / worker / pg / redis），GHA 自動 deploy
- 開發模型：**單一操盤者是唯一用戶**；Claude + Codex 雙 AI 並行 lane 開發；不是 SaaS
- 目前狀態（2026-04-20）：Wave 0–4 ✅、Phase 0 契約 ✅、Phase 1 執行骨架 ✅、Phase 2 4 層風控 ✅、Strategy Ideas/Runs 前端入口 ✅
- 下一批候選：Strategy engine 自動成單、Risk layer 持久化、KGI adapter（延後）、Session layer 風控

---

## 0.1 Delta Update（2026-04-20 之後）

> 這一節用來覆蓋 2026-04-20 之後的進度變化；若與下文衝突，**以下列狀態為準**。

### Lane 合併通知（2026-04-20 晚）

用戶宣告：**從現在起 Codex lane 由 Claude 接手**，不再雙 AI 並行。意味：
- Claude 可自由動 `apps/api/src/market-data*.ts`、`strategy-engine.ts`、`strategy-runs-store.ts`、`broker/execution-gate.ts`、`broker/trading-service.ts`、`tradingview-webhook-guard.ts` 及對應 contracts（`marketData.ts` / `strategy.ts` / `broker.ts`）
- 不再需要 `git fetch` 等對方 push，也不再需要「本地 mirror type 避開 Codex lane contract」的規避動作
- 但下文 §5.6/5.7/5.8 + §7 + §14.2 的**架構決策 / 契約不變**；只是所有者改為 Claude
- 歷史 commit 歸屬仍留在 §12 當參考

### 核心狀態更新

- **Market-data lane Phase 1 已可視為收口**
  - `decision-summary` 已 live，可作為 execution / strategy / paper 的主要 decision surface
  - `history/diagnostics`、`bars/diagnostics` 已補 quality summary
  - `overview` 已補 quality rollup（history / bars 的 strategyReady / referenceOnly / insufficient 分布）
  - backend 現況可視為：
    - quotes / providers / policy / readiness ✅
    - effective / selection / decision summary ✅
    - history / bars diagnostics + quality ✅
    - overview quality rollup ✅
    - live rollout verification ✅

- **Strategy backend 已從 ideas API 擴展到 runs persistence**
  - `/api/v1/strategy/ideas` 已是 **quality-aware strategy ideas v1.1**
    - ideas 會直接帶 `quality.grade`、`quality.primaryReason`
    - rationale 會同步反映 quality 與 marketData decision
  - `/api/v1/strategy/runs` 已是 **strategy backend v1.2**
    - 支援建立、列出、讀取 run snapshot
    - 最小 persistence 採 file-backed，不碰 DB / migration
  - list/detail summary 已擴到 **v1.3**
    - list 有 compact summary
    - detail payload 與 `/api/v1/strategy/ideas` 的 `marketData / quality / rationale / topThemes` 語義對齊
  - 目前 strategy backend 的缺口已不在 API 本身，而在「誰來 consume」

- **Execution lane Phase 1 可視為 fully closed**
  - `decision-summary → preview → submit → /trading/events` 主線已成立
  - `quote_review override` 可真正放行 `review_accepted` 單
  - `quoteContext / originalQuoteContext` 已持久化並可在 event / timeline 回放
  - `verify:execution:local` / `verify:execution:live` 已成立
  - GitHub Actions manual workflow 亦可作為 execution live verify 入口
  - 後續 execution 相關改動仍維持「非用戶明確重啟不主動開 KGI adapter」原則

- **Strategy frontend consume 已成立**
  - `/ideas` 已 consume live strategy ideas API
  - `/ideas → /portfolio` 最小 handoff 已可用
  - `/runs` list + `/runs/[id]` detail 已可 consume live strategy runs
  - `/runs/[id] → /ideas` query round-trip 已成立（可把 run snapshot 的 query 帶回 ideas）
  - 下一步較合理的是：
    - `/ideas` 直接 Save Run
    - 或讓 `/ideas` / `/runs` / `/portfolio` 的上下文更完整銜接

### 現在更準確的「下一批候選」（覆蓋下文 §6 末尾）

1. **/ideas Save Run flow** — 前端從 ideas 直接保存一筆 strategy run
2. **Strategy runs / ideas / portfolio 三者 handoff 再收口**
3. **Risk layer 持久化** — 目前 strategy/symbol layer 仍偏 in-memory
4. **Session layer 風控**
5. **Strategy engine 自動成單**
6. **Risk engine → paper broker strategy 歸屬**
7. **KGI adapter**（仍延後，不主動重啟）
8. **K 線圖**（仍延後）

---

## 1. 使命 / Mission

一個**每天真的會打開使用的 control tower**，取代散亂的研究筆記 + Excel + LINE 通知工作流。

核心理念：
1. **主題驅動投資**（theme-first）— 從主題找公司，不是從代號找主題
2. **研究 → 策略 → 執行 → 檢討的迴圈真的閉環** — 每個階段 UI 都能跳到下一步，不只展示
3. **資料品質誠實化** — 佔位值不渲染成真實評分；來源/新鮮度/信心度是一等公民
4. **風控是閘門，不是牌子** — 攔截每張 order，4 層配置（account/strategy/symbol/session）
5. **人類在 loop 裡** — `autoTrade` 預設 `false`、`requiresHumanApproval` 預設 `true`

**不做什麼：**
- 不做多用戶 SaaS（單操盤者，workspace 概念保留但不開放多租戶 UI）
- 不做社群/廣場/AI 寫作
- 不做 DeFi / 幣圈
- 不做回測平台（回測與實盤用同一套 plan 結構，但回測引擎本身不是本專案重點）

---

## 2. 用戶 / User

- **身份**：獨立操盤者 + 技術創辦人
- **語言**：繁體中文（所有 UI label、新增功能文案都用繁體中文）
- **風格**：偏好自主執行、減少來回確認；允許較高自主度
- **環境**：Windows 11 + Claude Code CLI
- **既有工具生態**：
  - `IUF_TRADING_ROOM_PRODUCT` — 產品規格文件庫（Product Spec / Tech Architecture / Delivery Roadmap / Integration Spec）
  - `IUF_TRADING_ROOM_TEMPLATES` — 模板
  - `My-TW-Coverage` — 台股覆蓋 seed 資料
  - `OpenAlice` — 本地 AI agent runtime，負責自動化研究任務（草稿產出、訊號標註）

---

## 3. 技術棧 / Tech Stack

| 層 | 技術 |
|---|---|
| Monorepo | pnpm 10.29 + turbo 2.5 |
| Language | TypeScript 5.9 |
| Web | Next.js 15.5 (App Router) + React 19 |
| API | Hono + Node 20 native `node --test` |
| Worker | Node 20，跑 cron/queue 任務 |
| DB | PostgreSQL 16 + Drizzle ORM |
| Cache | Redis 7 |
| Schema | Zod（`packages/contracts` 單一來源） |
| Deploy | Railway（5 services）via GitHub Actions |
| Tests | `node --test` + tsx；1 支統一 `tests/ci.test.ts` + 1 支 smoke |

**為什麼這組合：**
- pnpm 比 npm 快且省空間，workspace 原生
- Hono 比 Express 輕且原生 TS
- Drizzle 比 Prisma 貼近 SQL，migrations 可讀
- Next 15 App Router 支援 React Server Components（目前大部分頁面仍是 `"use client"`，SSR 目前不是重點）
- Zod 是 API 雙向契約（backend validate + frontend type infer）

---

## 4. Monorepo 佈局

```
IUF_TRADING_ROOM_APP/
├── apps/
│   ├── web/                Next.js 15 — 操盤者 UI
│   │   ├── app/            # App Router pages
│   │   │   ├── page.tsx             # /  總覽
│   │   │   ├── themes/              # 主題戰區
│   │   │   ├── companies/           # 公司資料庫 + duplicates
│   │   │   ├── signals/             # 訊號雷達
│   │   │   ├── ideas/               # 策略推薦（live API）
│   │   │   ├── runs/                # 策略歷史（list + [id] detail）
│   │   │   ├── plans/               # 交易計畫
│   │   │   ├── portfolio/           # 持倉 + 下單台 + 4 層風控
│   │   │   ├── reviews/             # 交易檢討
│   │   │   ├── briefs/              # 每日簡報
│   │   │   ├── drafts/              # OpenAlice 草稿審核
│   │   │   └── ops/                 # 系統戰情（tabs）
│   │   ├── components/     # 共享 UI（AppShell / CommandPalette / TickerTape）
│   │   └── lib/            # api.ts / idea-handoff.ts / strategy-vocab.ts / sizing.ts / plan-to-order.ts / ideas-query.ts
│   ├── api/                Hono API service
│   │   └── src/
│   │       ├── server.ts              # 主 route 檔（~2100 行，~100+ routes）
│   │       ├── risk-engine.ts         # 4 層風控 resolver + guards（~1000 行）
│   │       ├── strategy-engine.ts     # Ideas 推薦 + runs snapshot（~900 行）
│   │       ├── strategy-runs-store.ts # runs persistence
│   │       ├── market-data.ts         # QuoteProvider / effective quotes / TradingView（~2300 行）
│   │       ├── market-data-store.ts
│   │       ├── broker/
│   │       │   ├── paper-broker.ts          # in-memory paper broker
│   │       │   ├── paper-broker-store.ts    # JSONB snapshot 持久化
│   │       │   ├── execution-gate.ts        # 送 broker 前最後一道
│   │       │   ├── execution-events-store.ts # SSE event 持久化
│   │       │   ├── trading-service.ts
│   │       │   └── verify-execution-lane.ts # CLI verify tool
│   │       ├── theme-graph.ts / company-graph.ts / company-duplicates.ts / company-merge.ts
│   │       ├── audit-log-store.ts / event-history.ts / ops-snapshot.ts / ops-trends.ts
│   │       ├── openalice-bridge.ts / openalice-observability.ts
│   │       └── tradingview-webhook-guard.ts
│   └── worker/             背景 cron + queue
├── packages/
│   ├── contracts/          Zod schemas（API 雙向契約，單一真相來源）
│   │   └── src/
│   │       ├── brief.ts / signal.ts / review.ts / tradePlan.ts
│   │       ├── company.ts / companyGraph.ts / companyDiagnostics.ts / companyMerge.ts
│   │       ├── theme.ts / themeGraph.ts
│   │       ├── marketData.ts     # QuoteSource / Quote / Bar / SubscriptionRequest
│   │       ├── broker.ts         # BrokerKind / Account / Order / Fill / OrderStatus FSM
│   │       ├── risk.ts           # 4 層 limit schemas / RiskGuardKind / KillSwitchState
│   │       ├── strategy.ts       # StrategyConfig / StrategyIdea / StrategyRun
│   │       ├── workspace.ts
│   │       └── index.ts          # 扁平 re-export
│   ├── db/                 Drizzle schema + client
│   ├── domain/             domain services + memory repo
│   ├── integrations/       外部整合（OpenAlice、TradingView）
│   ├── auth/               workspace / role
│   └── ui/                 共享 UI 常數（primaryNavigation 等）
├── tests/
│   └── ci.test.ts          單一 test 檔，deterministic、純 fixture（目前 ~67 tests）
├── scripts/
│   ├── migrate.ts          # pnpm migrate
│   ├── smoke-api.ts        # pnpm smoke
│   └── sync-my-tw-coverage-*.ts  # seed data sync
├── .github/workflows/
│   ├── ci.yml              # typecheck + build + test + smoke
│   └── deploy.yml          # workflow_run on CI success → Railway
├── CLAUDE_CODE_FRONTEND_MISSION_2026-04-16.md  # 前端重設計任務書
├── RAILWAY_DEPLOYMENT.md / RAILWAY_RUNBOOK.md
├── turbo.json / pnpm-workspace.yaml / tsconfig.base.json
└── package.json            # scripts: dev / build / test / smoke / migrate / verify:execution
```

**命名慣例：**
- package name 一律 `@iuf-trading-room/<short>`
- 跨 app/package import 走 package name；app 內部走相對路徑 + `@/` alias
- contracts 用 `.js` 延伸的 TS import（ESM moduleResolution `nodenext` 要求）

---

## 5. 核心領域模型

### 5.1 研究層（Research）
- **Theme**（主題戰區）— 主題、生命週期、熱度分、火力排名；graph 化為 ThemeGraph
- **Company**（公司）— 代號、市場、名稱、supply chain、exposure 五維評分（volume/asp/margin/capacity/narrative）；graph 化為 CompanyGraph
- **Signal**（訊號）— 觀察到的事件/新聞/財報要點；綁定 theme + company
- **Brief**（每日簡報）— 彙整當日訊號

### 5.2 策略層（Strategy）
- **StrategyConfig** — 規則集；`autoTrade: false` + `requiresHumanApproval: true` 預設
- **StrategyIdea**（推薦項）— quality grade（strategy_ready / reference_only / insufficient）+ market decision（allow / review / block）+ direction（bullish / bearish / neutral）+ topThemes + rationale + marketData 來源/新鮮度
- **StrategyRun** — 一次 ideas 生成的完整快照（query + summary + items + quality 分佈），可回放
- 品質雙軸：**quality**（資料是否夠做策略執行）vs **decision**（行情是否允許現在送單），刻意分離以防資料好看但時機不對

### 5.3 交易層（Trading）
- **TradePlan** — 交易計畫，含 `execution` JSONB 欄位（entryPrice / stopLoss / takeProfitLadder / orderType / triggerCondition / validUntil / positionSizing）
- **OrderCreateInput / Order / Fill / OrderStatus FSM**（`packages/contracts/src/broker.ts`）
- **Account / Balance / Position**
- **ExecutionEvent**（SSE 推送 + DB 持久化）

### 5.4 風控層（Risk）
- **4 層 override**：account → strategy → symbol → session（後者 override 前者）
- **RiskLimit 欄位**：maxPerTrade / maxDaily / maxSingle / maxTheme / maxGross / maxOpenOrders / maxStaleMs / tradingHours / whitelist / blacklist / whitelistOnly
- **RiskGuardKind** 白名單（每種 guard 有穩定 kind 名）
- **KillSwitchState**：`trading` / `halted` / `liquidate_only` / `paper_only`
- **RiskCheckResult** 帶 `sourceLayer`（每個 guard 標記由哪層提供的 limit）
- 預設上限：per-trade 1% / daily 3% / single position 15% / gross 25%

### 5.5 Ops 層
- **Audit log**、**Event history**、**Ops snapshot/trends**（4-tab 戰情室）
- **OpenAlice bridge**（外部 agent runtime 寫入草稿、接讀回饋）

### 5.6 Market Data 子系統（**Codex lane**，`apps/api/src/market-data.ts` ~2300 行）

統整所有 quote / bar / 歷史 / 決策品質查詢，被 OrderTicket、paper broker、strategy engine、execution gate 共用。

**Source 抽象**：
- `QuoteSource`：`tradingview` / `kgi` / `paper` / `manual`
- `QuoteProviderAdapter` interface：`listQuotes` + `getStatus`
- 每 source 獨立 cache（commit `aa76f1f`：per-source cache split）
- 啟動時從 DB hydrate persisted quotes（`c075c6e`：history persistence）

**Resolve / Effective Quote**：
- `resolveMarketQuotes(input)` — 依 runtime policy 選 source
- `getEffectiveMarketQuotes(input)` — 回 effective quote 給 consumer（order / valuation / strategy scoring）
- **Freshness** 分級：`fresh` / `stale` / `missing`（按 age_exceeded、missing_last、provider_unavailable 等 reason）
- **Readiness** 分級：`ready` / `degraded` / `blocked`
- **Fallback reason** 列舉：higher_priority_stale / missing / unavailable / no_fresh_quote / no_quote
- **Quality grade**（與 strategy 對齊）：`strategy_ready` / `reference_only` / `insufficient`

**決策品質三視圖**（同一份 effective quotes，三種摘要角度）：
- `consumer-summary`：從呼叫者角度（order / valuation）看這份 quote 是否可用（commit `baa3eff`）
- `selection-summary`：哪個 source 被選上、為何（`04f0f84`）
- `decision-summary`：ready/degraded/blocked 總計 + reasons 列表（`d3f4e5a`）

**Consumer mode**（strategy / paper / execution）：
- 每 consumer 有不同 staleness 門檻與 source policy；例如 execution 要求最嚴（tradingview only），strategy 可退到 paper

**Policy API**（runtime-configurable）：
- `GET /api/v1/market-data/policy`（commit `569f991`） — 取得目前 source 優先序 + TTL + staleness 門檻；支援 consumer mode 切換

**TradingView webhook**（`tradingview-webhook-guard.ts`）：
- `validateTradingViewTimestamp`：拒絕過期/未來 timestamp
- `buildTradingViewEventKey`：symbol + timestamp 做 dedup key
- `claimTradingViewEvent` / `markTradingViewEventComplete` / `clearTradingViewEventClaim`：lease-based 處理防重入
- `checkTradingViewRateLimit`：token bucket 限流

**Ingestion endpoints**：
- `ingestTradingViewQuote`：webhook 入口（commit `c32a259`）
- `upsertManualQuotes` / `upsertPaperQuotes`：paper 與測試使用（`a00b9a1`）

### 5.7 Strategy Engine（**Codex lane**，`apps/api/src/strategy-engine.ts` ~900 行）

消費 theme / company / signal / market-data 產出可操作推薦。

**主要 functions**：
- `getStrategyIdeas(query) → StrategyIdeasView`：
  - `summary`：total / allow / review / block + quality（strategyReady / referenceOnly / insufficient）+ direction 分佈（bullish / bearish / neutral）+ quality.primaryReasons 分佈
  - `items[]`：每項含 direction、score (0–100)、confidence (0–1)、signalCount、bullishSignalCount、bearishSignalCount、topThemes[]、rationale (primaryReason + marketData.primaryReason + quality.primaryReason)、marketData (decision + selectedSource + freshnessStatus)、quality (grade + strategyUsable + primaryReason + history/bars 分項)
- `createStrategyRun(input)` / `listStrategyRuns(params)` / `getStrategyRunById(id)`：持久化快照（commits `0c0c624` + `08c97bf`）
- Query filter 組合：
  - `decisionMode`: `strategy` / `paper` / `execution`
  - `decisionFilter`: `allow` / `review` / `block` / `usable_only`
  - `qualityFilter`: `strategy_ready` / `exclude_insufficient`
  - `sort`: `score` / `signal_strength` / `signal_recency` / `theme_rank` / `symbol`
  - `limit` 1–50、`signalDays` 1–90

**雙軸設計關鍵**：
- `quality.grade` 看**資料面**（由 market-data.ts 的 history 完整度 + bars 完整度計算）
- `marketData.decision` 看**行情面**（`allow` / `review` / `block`）
- UI 把兩軸都顯示，操盤者可各自過濾，避免「資料好但時機差」或「時機好但資料少」的混淆

**Runs persistence 現況（v1.2 + v1.3）**：已有 file-backed persistence（不碰 DB / migration）、list compact summary、detail payload 與 `/strategy/ideas` 的 `marketData / quality / rationale / topThemes` 語義對齊；目前缺口不在 API 本身，而在「誰來 consume」。

### 5.8 Execution Gate（**hybrid**：Codex 定契約，Claude 接 trading-service）

`apps/api/src/broker/execution-gate.ts`：order 離開風控、進入 broker 之前，針對行情品質做最後一道攔截。

**功能**：
- `modeForBroker(brokerKind)`：paper → `"paper"` mode、kgi → `"execution"` mode
- `buildQuoteContext({symbol, side, mode, ...})`：把 effective-quote + decision-summary 打包成 `QuoteContext`（commit `6486a02` 持久化在 order / fill / execution event 上，cancel 時 replay）
- `evaluateExecutionGate(args)`：回 `ExecutionGateResult` 含 ready/degraded/blocked + 理由；blocked → 拒絕；degraded 需 override key
- `GATE_OVERRIDE_KEY = "quote_review"`：操盤者 ack 後可 push through
- `gateDecisionLabel(result)`：給 UI 顯示用的人話 label

**端到端流程**：
```
OrderTicket → POST /api/v1/trading/orders/preview → runRiskCheck (dry-run, commit:false)
OrderTicket → POST /api/v1/trading/orders → trading-service.submitOrder
  → runRiskCheck (persist) → evaluateExecutionGate → broker.placeOrder
  → quoteContext 寫入 order → Fill 時 copy 到 fill → SSE emit execution event
Cancel → trading-service.cancelOrder → evaluateExecutionGate (replay originalQuoteContext, commit `4e057d0`)
```

---

## 6. 交付階段 / Delivery Phases

```
Wave 0 (Foundation)          ✅  Monorepo scaffold / contracts / memory repo / API / web shell
Wave 1 (Research Core)       ✅  Theme / Company CRUD + graph 整合
Wave 2 (Signal & Plan Core)  ✅  Signal / TradePlan / Review / Brief CRUD UI
Wave 3 (Agent Bridge + Ops)  ✅  OpenAlice queue / observability / audit / event history
Wave 4 (War Room Redesign)   ✅  七階段 CLAUDE_CODE_FRONTEND_MISSION（2026-04-16）完成

Phase 0 (Trading contracts)  ✅  marketData / broker / risk / strategy contracts 就位
Phase 1 (Execution skeleton) ✅  5 步全 live：
  (1) trade_plans.execution 持久化
  (2) QuoteProvider + TradingView adapter
  (3) Paper broker（in-mem → JSONB snapshot 持久化）
  (4) Risk engine intercept
  (5) /portfolio 接真 API（kill switch 4 模式、可取消開放委託）
Phase 1.5 Console v1          ✅  下單台完整、execution events 持久化、strategy sizing 自動張數、
                                  risk limits CRUD UI、fill detail 展開
Phase 1.5 Console v1.5        ✅  Priority A（consume effective-quotes）+ B（plan-to-order builder）
Phase 1 execution lane        🔒  2026-04-19 用戶宣告 closed，不開 KGI adapter
Phase 2 (4-layer risk)        ✅  2026-04-20 deploy（commit b5b70d6）；account/strategy/symbol 三層
                                  in-memory store + API + UI override 編輯 + 2 deterministic tests

Strategy Ideas 前端           ✅  /ideas 消費 live API，/ideas → /portfolio handoff（sessionStorage）
Strategy Runs 前端            ✅  /runs list + [id] detail + /runs → /ideas 帶 query 回填

Market-data Phase 1 closed    ✅  decision summary / history-bar quality / overview quality rollup / live verification
Strategy backend v1.1         ✅  /api/v1/strategy/ideas quality-aware（ideas API 已可直接給下游 consume）
Strategy backend v1.2         ✅  /api/v1/strategy/runs file-backed persistence（POST / GET list / GET detail）
Strategy backend v1.3         ✅  strategy runs list compact summary + detail 與 ideas 語義對齊
Execution verify entry        ✅  verify:execution:local / verify:execution:live / manual workflow
Strategy frontend consume v1  ✅  /ideas / /runs / /runs/[id] / /runs → /ideas round-trip
```

### 下一批候選（Phase 3 以後，未鎖定順序）

1. **Strategy engine 自動成單** — 用 `plan-to-order.ts` builder 把 tradePlan.execution 轉成 OrderCreateInput
2. **Session layer 風控** — 短期風控（當日/當盤中有效）
3. **Risk layer 持久化** — 目前 strategy/symbol layer 僅 in-memory
4. **Risk engine → paper broker** — 把 `OrderCreateInput.strategyId` 自動帶進 paper broker 做 strategy-level 歸屬
5. **KGI adapter** — execution lane 真接券商（延後，須 market-data lane 成熟）
6. **K 線 chart** — 用戶明確要求延後
7. **Execution detail 進階** — 點 orderId 過濾該 order 全 timeline
8. **Risk limits strategy/symbol 編輯介面進階**
9. **Theme / Company graph search bar 擴充**
10. **ops-trends hover card / 類別切換**

---

## 7. 架構決策（Why）

### 7.1 為什麼 monorepo + contracts-first
- 前後端共用 Zod schema，改一次生兩邊型別
- contracts 是「API 合約 + 型別來源」的單一真相；PR reviewer 只要看這包就知影響面
- Codex 和 Claude 分 lane 時，只要不同時動 contracts 基本上不會衝突

### 7.2 為什麼 Railway 而不是 Vercel
- 同一平台同時跑 Next.js + Hono + Postgres + Redis + Worker，省運維
- 但 Railway 內建 GitHub webhook **2026-04-14 起失效**（原因未明），現改走 GHA workflow 自動 deploy
- RAILWAY_TOKEN secret 已在 repo 設定

### 7.3 為什麼 in-memory paper broker + JSONB snapshot，不是專屬資料表
- Phase 1 要快打通 end-to-end；paper broker 狀態（帳戶餘額、持倉、委託）寫 JSONB 快照到 `paper_broker_state` 表即可重啟還原
- 真 broker（KGI）接入時再考慮專屬表

### 7.4 為什麼 quality 和 decision 雙軸
- quality = 資料面是否足以做策略執行（歷史、K 棒、新鮮度）
- decision = 行情面是否允許現在送單（價差、成交量、流動性）
- 刻意分離：曾發生「資料看起來完美但現在時機極差」的情況，不希望 UI 只看一個指標就 go

### 7.5 為什麼 4 層風控
- 用戶明確要求：account 層寫死太粗、strategy 層不夠細、symbol 層要針對個別標的、session 層是臨時斷電閘
- 每層 override 前一層，null = 繼承
- 每個 RiskGuardResult 回報 `sourceLayer`，方便 UI 顯示「← STRAT」「← SYM」badge

### 7.6 為什麼 Claude + Codex 雙 AI 並行
- Token 經濟學：兩個 agent 各跑 lane 能把「可並行工作量」打開
- Lane 邊界通常按「touched files」區分（Claude 動 frontend + risk，Codex 動 strategy + market-data）
- Merge 衝突管理：善用 `git add` 選擇性 staging、worktree 隔離、stash/pull/pop 序列

### 7.7 為什麼 sessionStorage 做 /ideas → /portfolio handoff
- URL query 帶得動 symbol，但 score / confidence / topTheme / rationale 這種結構帶不動
- sessionStorage `iuf:ideaHandoff` 裝整包；/portfolio 讀時用 symbol match 驗證避免配到舊 handoff
- 刻意**不預填 quantity / type / stop / TP**（要靠 plan sizing 或操盤者判斷）

### 7.8 為什麼 strategy-vocab.ts 集中
- 相同概念標籤（看多/看空/中性、允許送單/需審視/封鎖、可策略執行/僅供參考/資料不足、策略篩選/紙上交易/真倉執行）會在 4 個 surface 出現（/ideas / /runs list / /runs detail / /portfolio context card）
- 未來改一處，4 處同步；避免 label drift

---

## 8. 部署 / Deployment

### 8.1 Pipeline
```
git push main
    ↓
CI workflow（typecheck + build + test + smoke）
    ↓ workflow_run: success
Deploy to Railway（matrix: web / api / worker 並行）
```

### 8.2 Production URLs
- web: `https://web-production-7896c.up.railway.app`
- api: `https://api-production-8f08.up.railway.app`

### 8.3 緊急指令
- `railway up --service <web|api|worker> --ci` — 手動部署
- `railway deployment list --service <name>` — 查最近部署
- GitHub UI → Actions → Deploy to Railway → Run workflow → 選 service

### 8.4 服務拓撲
- `web` — Next.js 15 standalone
- `api` — Hono + `pnpm start:api:railway`（啟動前跑 migration）
- `worker` — background queue runner
- `pg` — postgres:16-alpine
- `cache` — redis:7-alpine

---

## 9. 資料品質警告（重要）

Production workspace `primary-desk` 的 seed 狀態（2026-04-16 盤點）：

- **1736 間公司，其中 1734 間的 `exposure` 都是預設 `{volume:1, asp:1, margin:1, capacity:1, narrative:1}`**（bulk import 佔位值，非實際評分）
- 只有 2 間有實評：`2330 台積電`（全 3，也是佔位）、`3081 聯亞`（4/5/3/4/5 實際手動評過）
- Signals / Plans / Reviews / Briefs 大多是測試資料
- CompanyGraph：TSMC (2330) 有 346 inbound / 80 edges；大部分公司無 graph 資料

**UI 已處理（commit `0b6f657`）：**
- 公司詳細頁：exposure 五欄一致時顯示「尚未評分」徽章
- 公司列表：曝險欄一致顯示「未評分」而非 `1/1/1/1/1`
- 供應鏈關係 card：summary 全 0 顯示「尚無供應鏈關係或關鍵詞數據」

**推論規則：** 看到整欄一致的評分/計數，**預設當佔位未校正處理**，不要以為是真實訊號。

**已修 mojibake：** 公司 3081.TW `name` 與對應 signal 曾因 BIG5→Latin1→UTF-8 雙重編碼損壞，已 PATCH 回。

---

## 10. 視覺識別

**定調（2026-04-16 用戶明確反饋「像 AI 做的模板太泛用」後確立）：CRT 賽博終端 × 日系盤中台。**

- **色票**：`--phosphor: #7FFF4C` + `--amber: #FFA726`；KPI 數字、eyebrow、section header 都 `text-shadow` 發光
- **HUD 角括號**：`.hud-frame` 類；左上磷光、右下琥珀
- **ASCII 分節**：`.ascii-head` 類；格式 `[01] 核心指標 · CORE METRICS` 左右帶虛線
- **活體跑馬燈**：`ticker-tape.tsx` 常駐 status-bar，30s 刷新
- **CRT 掃描線**：`.page-frame::before` 極淡 overlay
- **Block sparkline**：`lib/block-spark.ts` 把數列轉 `▁▂▃▄▅▆▇█`
- **一次性 boot 動畫**：首訪觸發

**新增 UI 原則：**
- 預設套 `.hud-frame` + `.ascii-head`
- KPI 數字預設磷光色，警示才切 `tone="warn"` / `"bear"`
- 避免圓角柔和陰影（會退回 AI template 質感）

**Badge 色系：**
- 綠（phosphor）：strategy_ready / allow / bullish
- 黃（amber）：reference_only / review / neutral
- 紅：insufficient / block / bearish
- 藍/dim：ACCT layer；STRAT = amber；SYM = phosphor；SESS = amber

---

## 11. 測試 / QA

- **單一 test 檔**：`tests/ci.test.ts`（~67 tests，全 deterministic、fixture-driven）
- **smoke**：`scripts/smoke-api.ts` — boot API 實打幾個 endpoint
- **verify:execution**：`apps/api/src/broker/verify-execution-lane.ts` — CLI 跑 end-to-end execution flow（local + live 兩模式）
- 沒有 unit vs integration 分檔；一支 test 檔用 describe/it 分群
- **不寫 mock-heavy 測試**；broker 用 paper in-mem、quote 用 paper source、風控用實 resolver 跑
- **Strategy backend live 可驗證**：除了 `verify:execution` 外，strategy backend（ideas v1.1 + runs v1.2/v1.3）也已經到「live 可驗證」程度，只是還沒正式整理成像 execution 一樣的固定 verify 入口。

---

## 12. Claude + Codex 協作模型

**注意**：repo commits 作者都顯示 `qazabc159-blip`（因為兩個 AI 都透過用戶的 Git 身份 push）。Lane 歸屬要**看 commit message prefix + 動到的檔案**來判斷，不能靠 git author。

**最新 lane 擴張**：目前 Codex lane 已經從 market-data 往 strategy backend 延伸到 `/strategy/ideas` 與 `/strategy/runs`；Claude lane 則延伸到 `/ideas`、`/runs` 與 `/portfolio` 的前端 consume / handoff。

**Lane 合併（2026-04-20 晚）**：用戶宣告 Codex lane 由 Claude 接手。下列 §12.1–§12.3 為歷史紀錄，說明現有檔案的原作者與邊界慣例的歷史脈絡；新工作不再區分 lane，Claude 可自由跨全部檔案。Merge SOP 與「選擇性 staging」的紀律仍保留（避免誤提 WIP），但不再需要為了避開 contracts 層衝突做 mirror type 這類規避動作。

### 12.1 Lane 歸屬表（歷史實證）

| Lane | 主要負責檔案 | 代表 commit prefix | 代表 commits |
|---|---|---|---|
| **Claude** | `apps/web/**`（UI / pages / components / lib）、`apps/api/src/risk-engine.ts`、`packages/contracts/src/risk.ts`、`apps/api/src/broker/paper-broker*.ts`、`apps/api/src/broker/execution-events-store.ts` | `feat(web): ...`、`feat(portfolio): ...`、`feat(risk): ...`、`feat(broker): persist ...` | `b5b70d6` 4 層風控、`8f61dad` /ideas、`68dbda6` /runs、`601c509` handoff、`6de238e` query 回填、`c534f31` order ticket、`ef87890` risk CRUD UI |
| **Codex** | `apps/api/src/market-data.ts`、`apps/api/src/market-data-store.ts`、`apps/api/src/strategy-engine.ts`、`apps/api/src/strategy-runs-store.ts`、`apps/api/src/broker/execution-gate.ts`、`apps/api/src/broker/trading-service.ts`、`apps/api/src/tradingview-webhook-guard.ts`、`packages/contracts/src/marketData.ts`、`packages/contracts/src/strategy.ts`、`packages/contracts/src/broker.ts` | `feat(execution): ...`、`feat(strategy): ...`、`feat: add market data ...`、`chore(execution): ...` | `c32a259` TradingView ingestion、`33b39cc` source policy、`6e9efb8` effective-quotes、`3a82180` quoteGate contract、`3a4efe5` strategy ideas、`22382bb` quality-aware、`0c0c624` run persistence |
| **Shared / co-owned** | `apps/api/src/server.ts`（路由註冊，兩邊都加）、`apps/web/lib/api.ts`（雙邊 client helpers） | — | 兩邊都動，但 line regions 幾乎不重疊 |

### 12.2 Lane 邊界慣例

- **不主動動對方 lane 的檔**；若一定要跨（例如 risk-engine 需要 strategy 的新 field），先 `git fetch` 看對方是否已 push
- **Contract 變動最敏感**：
  - `contracts/src/marketData.ts` → **Codex 專屬**，Claude 要消費就用本地 mirror type（`apps/web/lib/api.ts` 就有 mirror，commit `cfd1cca`）
  - `contracts/src/risk.ts` → **Claude 專屬**
  - `contracts/src/strategy.ts` → **Codex 專屬**
  - `contracts/src/broker.ts` → **Codex 定契約，Claude 實作 paper broker**
- **commit 選擇性 staging**：`git add <specific files>`，避免把對方 WIP 混進
- **Merge SOP**（雙方同時在跑時）：`git fetch` → 看對方是否 push → 若有，`git stash` → `git pull --ff` → `git stash pop`（期望 auto-merge；衝突通常出現在 `server.ts` 路由註冊區或 `web/lib/api.ts` helper 集中區）

### 12.3 典型事故與收尾

- **2026-04-20 Phase 2 事故**：Codex 推的 strategy-ideas polish（`22382bb` + `ed6a0e6`）**順手帶上 Phase 2 的 2 個 risk tests 但沒帶 impl**（Claude 的 impl 當時還 uncommitted），CI 紅一整晚。收尾 SOP：`git reset` → 已等於 origin 的 4 個 strategy-lane 檔 `git checkout HEAD --` → `git stash` server.ts → `git pull --ff` → `git stash pop`（auto-merge 因 Codex 改 `/strategy/ideas` handler、Claude 改 risk imports + `/risk/*-limits` endpoints，line regions 不重疊）→ commit Phase 2 impl

- **2026-04-16 Railway webhook 失效**：非 AI 事故，但雙 lane 都因此無感地推了一整天沒上線。原 SOP：信任 Railway GitHub App。新 SOP：走 GHA workflow（`f6f84a0`）。

### 12.4 使用者介入度

- 用戶偏好**自主執行**，不喜歡每步都問
- 但**不可逆 / 跨系統 / 有風險**操作（force push、drop table、改 CI config、打真 broker、amend published commits）**仍要先確認**
- 「綠 bar + push + 簡報 1–2 句」是預設 cadence
- **Phase 1 execution lane 於 2026-04-19 用戶宣告 closed**：不開 KGI adapter、不再動 execution verify / quoteContext / timeline 收尾。後續 execution 相關改動需用戶明確重啟才做。

---

## 13. 記憶體 / 持久化狀態

- **memory mode**：`apps/domain` 的 repo 實作切 in-mem，所有 state 跑在記憶體；啟動時空白
- **database mode**：同樣 repo 介面，背後接 Drizzle + Postgres
- 兩者 API 相同，`DATABASE_URL` 環境變數切換
- Paper broker 自己有 `paper_broker_state` JSONB snapshot table 做重啟還原
- Execution events 持久化到 `execution_events` table

---

## 14. 關鍵路由一覽

### 14.1 Web routes（Next.js App Router）
| Path | 用途 |
|---|---|
| `/` | 總覽（主題火力排名 Top 6 等） |
| `/themes` | 主題戰區（火力排名 vs 清單雙檢視） |
| `/companies` | 公司資料庫 |
| `/companies/duplicates` | 重複偵測診斷 |
| `/signals` | 訊號雷達 |
| `/ideas` | 策略推薦（live API + URL query 預填） |
| `/runs` | 策略歷史 list |
| `/runs/[id]` | 策略歷史 detail（query snapshot + items 快照 + CTA 回 /ideas 或 /portfolio） |
| `/plans` | 交易計畫 |
| `/portfolio` | 持倉 + 下單台 + 4 層風控 + Kill Switch + Execution Timeline |
| `/reviews` | 交易檢討 |
| `/briefs` | 每日簡報 |
| `/drafts` | OpenAlice 草稿審核 |
| `/ops` | 系統戰情（4 tab） |

### 14.2 API routes（Hono，~100+ endpoints）

格式：`method path  [owner lane]`

**Market Data（Codex lane）**：
```
GET  /api/v1/market-data/providers
GET  /api/v1/market-data/policy
GET  /api/v1/market-data/symbols
GET  /api/v1/market-data/quotes
GET  /api/v1/market-data/resolve
GET  /api/v1/market-data/effective-quotes
GET  /api/v1/market-data/consumer-summary
GET  /api/v1/market-data/selection-summary
GET  /api/v1/market-data/decision-summary
GET  /api/v1/market-data/history
GET  /api/v1/market-data/history/diagnostics
GET  /api/v1/market-data/bars
GET  /api/v1/market-data/bars/diagnostics
POST /api/v1/market-data/manual-quotes
POST /api/v1/market-data/paper-quotes
GET  /api/v1/market-data/overview
POST /api/v1/tradingview/webhook       (guarded by tradingview-webhook-guard)
```

**Strategy（Codex lane）**：
```
GET  /api/v1/strategy/ideas
POST /api/v1/strategy/runs
GET  /api/v1/strategy/runs
GET  /api/v1/strategy/runs/:id
```

**Risk（Claude lane，4 層）**：
```
GET  /api/v1/risk/limits               (account layer, legacy alias)
POST /api/v1/risk/limits
GET  /api/v1/risk/effective-limits     (merged view with sourceLayer)
GET  /api/v1/risk/kill-switch
POST /api/v1/risk/kill-switch
POST /api/v1/risk/checks
GET/POST/DELETE /api/v1/risk/strategy-limits
GET/POST/DELETE /api/v1/risk/symbol-limits
```

**Trading（Claude lane；orders 路徑經 Codex gate）**：
```
GET  /api/v1/trading/accounts
GET  /api/v1/trading/balance
GET  /api/v1/trading/positions
GET  /api/v1/trading/orders
POST /api/v1/trading/orders            (→ risk → gate → broker)
POST /api/v1/trading/orders/preview    (dry-run, commit:false)
POST /api/v1/trading/orders/cancel     (→ gate replay originalQuoteContext)
GET  /api/v1/trading/status
GET  /api/v1/trading/events            (hydrate from execution_events table)
GET  /api/v1/trading/stream            (SSE live)
```

**Research Core（Wave 1–2 年代，Claude/Codex 共享）**：
```
GET/POST/PATCH/DELETE /api/v1/themes/*
GET  /api/v1/themes/:id/graph
GET  /api/v1/theme-graph/stats | /search | /export | /rankings
GET/POST/PATCH /api/v1/companies/*
GET  /api/v1/companies/:id/relations | /keywords | /graph
GET  /api/v1/companies/duplicates | /merge-preview
POST /api/v1/companies/merge
GET  /api/v1/company-graph/stats | /search
GET/POST/PATCH /api/v1/signals/*
GET/POST/PATCH /api/v1/plans/*
GET/POST/PATCH /api/v1/reviews/*
GET/POST/PATCH /api/v1/briefs/*
```

**Ops / Audit**：
```
GET  /api/v1/ops/snapshot
GET  /api/v1/ops/trends
GET  /api/v1/audit-logs
GET  /api/v1/audit-logs/summary
GET  /api/v1/audit-logs/export
GET  /api/v1/event-history
GET  /api/v1/event-history/summary
GET  /api/v1/event-history/export
```

**OpenAlice bridge / drafts**：
```
GET/POST/PATCH /api/v1/drafts/*
```

**Session / health**：
```
GET  /
GET  /health
GET  /api/v1/session
```

### 14.3 全域快捷鍵
- `⌘K` / `Ctrl+K` — Command palette（主題 / 公司 / 頁面 fuzzy 搜）

---

## 15. 命令速查

```bash
# 開發
pnpm dev                # web + api + worker 同時跑（turbo --parallel）
pnpm --filter @iuf-trading-room/web dev

# 綠 bar
pnpm typecheck
pnpm build
pnpm test
pnpm smoke

# DB
pnpm migrate            # 啟動 postgres 後跑 drizzle migrations
pnpm db:generate        # 產 migration SQL
pnpm db:push            # 直接 push schema（開發）

# Execution verify
pnpm verify:execution:local   # 本地 end-to-end
pnpm verify:execution:live    # 打 Railway production

# Seed
pnpm sync:tw-coverage
pnpm sync:tw-coverage:graph
```

---

## 16. 給讀這份 briefing 的 LLM 的提示

1. **看到 file:line 引用時，先驗證**。memory/briefing 可能過期。改動前用 `grep`/`read` 確認符號仍存在。
2. **語言：繁體中文**。所有 UI 新文案、commit message 的人類可讀部分、與用戶對話都用繁中。Commit subject 可英文（慣例）。
3. **Lane 意識**：跑任務前想一下這屬於 Claude lane 還是 Codex lane。跨 lane 改動要先看 contracts 是否會變，並先 `git fetch` 看對方是否已 push。
4. **Order path 不能繞開**：任何新 order 路徑都要經過 `runRiskCheck` → `evaluateExecutionGate` → broker。Execution gate 的 `quoteContext` 必須持久化到 order + fill。Cancel 要 replay `originalQuoteContext`。
5. **Market Data 消費**：Web / Claude lane 想用 quotes 時，優先用 `getEffectiveMarketQuotes`（或對應的 summary endpoint），不要自己 pick source。想在 web 端用 contract type 時，優先在 `apps/web/lib/api.ts` 做本地 mirror type，避免改 `packages/contracts/src/marketData.ts`（那是 Codex lane）。
6. **雙軸思考（quality vs decision）**：新推薦類 feature 要同時想資料面（`quality.grade`）和行情面（`marketData.decision`）兩個判準。
7. **資料品質警覺**：看到 `exposure = {1,1,1,1,1}` 或任何整欄一致值，預設是佔位。
8. **HUD 視覺**：新 panel 套 `.hud-frame` + `.ascii-head`；KPI 磷光色；避免圓角柔和風。
9. **測試**：deterministic、fixture-driven；不 mock database，用 memory repo；全部測試集中在 `tests/ci.test.ts`。
10. **部署**：push → CI → Railway GHA，不要再依賴 Railway 內建 webhook。
11. **對用戶**：短訊息、避免 emoji（除非用戶要求）、做完再來一句總結、可逆操作自主執行、不可逆動作要確認。
12. **Phase 1 execution lane 於 2026-04-19 closed**：不要再主動動 KGI adapter / execution verify / quoteContext 相關檔，除非用戶明確重啟。

---

*Briefing 基底版本：2026-04-20；後續狀態以上方 §0.1 Delta Update 為準。最新 live 狀態至少已涵蓋：market-data overview quality rollup、strategy ideas v1.1、strategy runs v1.2/v1.3、execution live verify 入口。*
