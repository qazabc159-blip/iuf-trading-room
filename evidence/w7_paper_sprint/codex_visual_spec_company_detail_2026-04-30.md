# Codex Visual Spec — 公司詳情頁全 panel 視覺骨架

**Date**: 2026-04-30
**Owner**: Codex (per `feedback_jim_codex_split_2026-04-29` — codex=視覺/UI 元件)
**Author**: Elva
**Trigger**: 楊董 verbatim「就是 codex 在做而已」+「資訊新聞財報三表月營收法人三大融資券股利期權 tick 即時這一大堆 沒有一個前端 ui 的空格展示要放在哪？」

**目的**: 提供 codex 一份**完整可執行**的視覺骨架 spec，codex 直接寫 Component 不接 API（API binding 是 Jim 的 lane）。

---

## 1. 整體頁面結構

**Path**: `apps/web/app/companies/[symbol]/page.tsx`
**Tech**: Next.js 15 App Router Server Component + Tailwind + 既有 RADAR design tokens

### 1.1 Layout 骨架（從上到下）

```
┌──────────────────────────────────────────────────────────────────┐
│ <Header />  既有 site header + breadcrumb （不動）                │
├──────────────────────────────────────────────────────────────────┤
│ <CompanyHeroBar />  ← 1 列 sticky                                  │
│   股號 · 公司名 · 市場 · chainPosition · beneficiaryTier badge      │
│   即時報價 · 漲跌 · 漲跌幅 · 成交量 · 大時段 (今日/昨/週/月)         │
├─────────────────┬────────────────────────────────────────────────┤
│ Left Column     │ Right Column (sidebar 360px)                    │
│ (flex-1)        │                                                 │
│                 │ <PaperOrderPanel />  paper 下單台 (sticky)       │
│ <OhlcvChart />  │   買/賣 toggle / 限/市價 / 數量 / 限價 /         │
│  K 線 + Volume  │   委託效期 / Preview button / Submit button     │
│  + interval tab │   "PAPER ONLY" 紅 banner                        │
│  (1d/1w/5m...)  │                                                 │
│                 │ <SourceStatusCard />  資料來源狀態               │
│                 │   FinMind: ON/OFF · KGI: ON/OFF · 最後更新時間    │
├─────────────────┤                                                 │
│ <CompanyInfoPanel />  公司基本資料                                 │
│   雙欄 dl  名稱(中英)/股號/市場/國別                                │
│   chainPosition badge / beneficiaryTier badge                     │
│   notes (markdown)                                                │
│   exposure 5 維 mini-bar                                          │
│   validation 3 dim status pill                                    │
├──────────────────────────────────────────────────────────────────┤
│ <Tabs>  橫向 tab，預設展開全部 (web) 或單 tab (mobile)              │
│   ├ 財報 ──────────────────────────────────────────────────────  │
│   │  <FinancialsPanel />                                          │
│   │    sub-tabs: 季報 / 年報 / 月營收 / 股利                       │
│   │    季報: 8 季表格 (revenue / 毛利率 / 營益率 / EPS / YoY%)     │
│   │    月營收: 24 個月柱狀 + sparkline                             │
│   │    股利: 5 年表 (除息日/現金/股票)                              │
│   ├ 籌碼 ──────────────────────────────────────────────────────  │
│   │  <ChipsPanel />                                               │
│   │    sub-tabs: 三大法人 / 融資融券 / 大戶持股                    │
│   │    三大法人: 30天柱狀 (外資/投信/自營分色)                      │
│   │    融資融券: 餘額曲線 + 增減                                   │
│   ├ 消息 ──────────────────────────────────────────────────────  │
│   │  <AnnouncementsPanel />                                       │
│   │    重大訊息 list (date + title + 類別 badge + collapsible)    │
│   │    + 公司治理公告 sub-section                                  │
│   ├ 期權 ──────────────────────────────────────────────────────  │
│   │  <DerivativesPanel />  (placeholder — W7 D7 補)               │
│   ├ Tick ──────────────────────────────────────────────────────  │
│   │  <TickStreamPanel />  (placeholder — KGI live 接通後啟用)      │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Mobile responsive

- 整頁 stacked vertical，sidebar 變底部 sticky bar
- Tabs 橫向滑動
- HeroBar 收成 2 列

---

## 2. 各 Component spec

### 2.1 `<CompanyHeroBar bars={...} company={...} quote={...} />`

**File**: `apps/web/app/companies/[symbol]/CompanyHeroBar.tsx`
**Mode**: Client Component (sticky top)
**Props**:
```ts
interface CompanyHeroBarProps {
  company: Company;            // contracts shape (id/ticker/name/market/...)
  quote: {
    last: number | null;
    change: number | null;
    changePercent: number | null;
    volume: number | null;
    asOf: string | null;       // ISO timestamp
    source: "kgi" | "finmind" | "mock" | null;
  } | null;
}
```
**Visual**:
- 整列高 64px sticky，bg `--night` semi-transparent + backdrop-blur
- Left: 股號 (font-mono 1.5rem) · 公司名 (1rem) · market badge
- Right: last price (font-mono 1.5rem) · change% pill (red↑ / green↓ — TW convention) · volume (1rem dim) · "as of {asOf}" (0.75rem dim)
- Source badge: 右下角 (FINMIND-ADJ / KGI-ORIGIN / MOCK)

### 2.2 `<OhlcvCandlestickChart bars={...} interval={...} />`

**File**: `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx` (既有，PR #36)
**改動**:
- 新增 interval tab: `1d` / `1w` / `1mo` / `5min` / `tick`（預設 `1d`）
- 加 source badge (KGI-ORIGIN / FINMIND-ADJ / MOCK / STALE)
- 加 last bar tooltip on hover
- 高 320px → 提到 420px

### 2.3 `<PaperOrderPanel symbol={...} latestPrice={...} />`

**File**: `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`
**Mode**: Client Component (sticky right column 360px wide)
**Visual**:
- Top banner: 紅底白字「⚠ PAPER TRADING — 模擬，未送任何券商」(sticky)
- Form fields:
  - 買 / 賣 toggle (segmented control, red/green TW convention)
  - 委託類別: 限價 / 市價 (radio)
  - 數量 (張): number input + step 1 + min 1
  - 限價: number input (限價時顯示，市價隱藏) + 預填 latestPrice
  - 委託效期: ROD (預設) / IOC / FOK (radio)
- Buttons:
  - **Preview** (next to Submit) → POST `/api/v1/paper/orders/preview` → 顯示 PreviewPane
  - **Submit Paper** (red) → POST `/api/v1/paper/orders/submit`
  - 兩個 button 中間有 "Reset" (link-style)
- PreviewPane (Submit 前必跑):
  - guards 列表 (RiskCheckResult — 顯示通過/未通過 + reason)
  - sizing breakdown (預估金額 / 預估手續費 / 預估稅 / 淨投入)
  - blocked reason (若 blocked=true, 紅字顯示 + Submit disabled)
- Footnote: "下單台僅 paper 模式 · /order/create 永久 409 hard-line"

### 2.4 `<SourceStatusCard sources={...} />`

**File**: `apps/web/app/companies/[symbol]/SourceStatusCard.tsx`
**Mode**: Client Component
**Visual**:
- 卡片 width 360px（sidebar 內），padding 12px
- 列出每個資料源 status:
  - FinMind: 🟢 ON · 600/hr quota · 最後更新 {time}
  - KGI: 🟡 PARTIAL (quote ON / position OFF) · 最後更新 {time}
  - TWSE OpenAPI: 🟢 ON · 最後拉 {time}
  - Redis cache: 🟢 ON · hit rate {%}
- Click row → 展開 mini diagnostic（last error / queue depth）
- 後端 endpoint: `GET /api/v1/source/status`

### 2.5 `<CompanyInfoPanel company={...} />`

**File**: `apps/web/app/companies/[symbol]/CompanyInfoPanel.tsx`
**Mode**: Server Component (no fetch — props from parent)
**Visual**:
- 雙欄 `<dl>` grid (md:grid-cols-2)
- Rows:
  - 公司名稱: {name} ({nameEn or "—"})
  - 股號: {ticker}
  - 市場: {market} ({country})
  - chainPosition: {chainPosition} (badge)
  - beneficiaryTier: {beneficiaryTier} (Core/Direct/Indirect/Observation badge 4 色)
- Below grid:
  - **Notes**: markdown render (react-markdown or @uiw/react-md-editor preview-mode)
  - **Exposure breakdown** (5 維): 5 個 mini horizontal bar (1-5 分):
    - Volume / ASP / Margin / Capacity / Narrative
  - **Validation**: 3 column status pill:
    - capitalFlow / consensus / relativeStrength → 顏色 by status (positive=green / pending=yellow / negative=red)

### 2.6 `<FinancialsPanel symbol={...} />`

**File**: `apps/web/app/companies/[symbol]/FinancialsPanel.tsx`
**Mode**: Client Component (fetch on mount)
**Sub-tabs**: 季報 / 年報 / 月營收 / 股利
**Endpoints**:
- `GET /api/v1/companies/:id/financials?period=Q&limit=8` (季)
- `GET /api/v1/companies/:id/financials?period=Y&limit=5` (年)
- `GET /api/v1/companies/:id/revenue?limit=24` (月營收)
- `GET /api/v1/companies/:id/dividend?years=5`
**Visual**:
- 季報 sub-tab:
  - 水平表格 8 列（每列 1 季）：
    - 期間 (e.g., 2025Q4) / 營收 / 毛利率 % / 營益率 % / 稅後 EPS / YoY %
  - hover 列高亮
- 年報 sub-tab: 同上但 5 年
- 月營收: 24 月柱狀（recharts BarChart）+ sparkline 趨勢線
- 股利:
  - 列表：除息日 / 現金股利 / 股票股利 / 股利率 %
- Empty/error states:
  - API 404 → "FinMind 整合中（預計 W7 D5）" placeholder card
  - API 200 但 array empty → "尚無 {季/年/月/股利} 資料"
  - API 500 → "資料來源異常 - 已記錄"

### 2.7 `<ChipsPanel symbol={...} />`

**File**: `apps/web/app/companies/[symbol]/ChipsPanel.tsx`
**Mode**: Client Component
**Sub-tabs**: 三大法人 / 融資融券 / 大戶持股 (placeholder)
**Endpoints**:
- `GET /api/v1/companies/:id/chips?days=30`
- (大戶持股 W7 D6 補)
**Visual**:
- 三大法人 sub-tab:
  - 30 天柱狀圖（recharts）：x = date, 3 series (外資 / 投信 / 自營) 分色 (blue / orange / purple)
  - 下方累計表格 (30天累計買賣超: 外資 +X張 / 投信 +Y張 / 自營 +Z張)
- 融資融券 sub-tab:
  - 雙線圖：融資餘額（藍）/ 融券餘額（紅）
  - 下方表格：當日增減 / 30天累計

### 2.8 `<AnnouncementsPanel symbol={...} />`

**File**: `apps/web/app/companies/[symbol]/AnnouncementsPanel.tsx`
**Mode**: Client Component
**Endpoints**: `GET /api/v1/companies/:id/announcements?days=30`
**Visual**:
- List rows:
  - Date (font-mono) · 類別 badge (重大訊息/公司治理/ESG) · 標題 (truncate) · "查看" link
  - Click → expand inline (collapsible)
- 類別 badge 4 色:
  - 重大訊息 = red
  - 公司治理 = blue
  - ESG = green
  - 除權息 = yellow
- 30 day filter: 7d / 30d / 90d (top right)

### 2.9 `<DerivativesPanel />` (placeholder — W7 D7)

**File**: `apps/web/app/companies/[symbol]/DerivativesPanel.tsx`
**Visual**: 大字「期權資料整合中 — W7 D7 補完」+ ico-clock

### 2.10 `<TickStreamPanel />` (placeholder — gated on KGI live)

**File**: `apps/web/app/companies/[symbol]/TickStreamPanel.tsx`
**Visual**: 大字「Tick 即時 stream 待 KGI live 接通 + Market Agent EC2 部署完成後啟用」+ ico-radio

---

## 3. Design tokens（必用）

從既有 `apps/web/app/globals.css` 拿（不要新加）：

- 顏色:
  - `--night` (背景 dark)
  - `--night-mid` / `--night-rule` / `--night-rule-strong` (灰階)
  - `--tw-up` (紅 / 漲) / `--tw-dn` (綠 / 跌) — **台股慣例不要反**
  - `--accent` (主色 hover / active)
- 字型:
  - `--font-mono` (數字/股號)
  - `--font-sans` (主體文字)
- 間距: 4px / 8px / 12px / 16px / 24px / 32px (rem 值已 var)
- Badge classes: `.badge`, `.badge-red`, `.badge-green`, `.badge-yellow`, `.badge-blue`

**禁止**:
- 不准新增第三套色彩 / 字級
- 不准 inline style 大量 hex code
- 不准 import 新動畫庫（既有 framer-motion 可用）
- 不准引入 emoji icon（用 lucide-react 既有 icon）

---

## 4. Stop-line

- ✅ NO `/order/create` call — PaperOrderPanel 只 hit `/api/v1/paper/orders/*`
- ✅ NO TradingView import / wrapper / data feed
- ✅ NO KGI SDK import in frontend
- ✅ NO secret 寫死 (FINMIND_API_TOKEN / KGI_PASSWORD / OPENAI_API_KEY 全 backend env)
- ✅ NO 新增「AI 字眼 / 太花俏動畫」(per `jim_v0_7_0_spec`)
- ✅ NO 改全站主軸 layout / header / nav (per 楊董 verbatim「整體設計很滿意」)

---

## 5. Codex 交付要求

1. **9 個新 Component 檔** (CompanyHeroBar / SourceStatusCard / CompanyInfoPanel / FinancialsPanel / ChipsPanel / AnnouncementsPanel / DerivativesPanel / TickStreamPanel / 加 PaperOrderPanel)
2. 每個 Component **接 mock props**（dummy data hardcode 在 component file 內）— 不接真 API
3. `apps/web/app/companies/[symbol]/page.tsx` 整合到一頁，import 全部 panel + pass mock props
4. 全部 typecheck 過 (`pnpm -r typecheck`)
5. lint 過
6. 不寫 unit test（codex 視覺 lane，e2e 由 Bruce 視覺 smoke）
7. PR title: `feat(web): companies/[symbol] 9-panel visual skeleton (mock props) [DRAFT]`
8. PR body: screenshot manifest（每個 panel 1 張）— 上傳 base64 或描述

## 6. 後續 cutover 計畫

1. Codex 出 PR-Vis-1（9-panel 視覺骨架，mock props）→ DRAFT
2. Bruce 視覺 smoke + Pete review
3. 楊董 ACK 視覺骨架 → squash merge
4. **Jim 接手**：rebase PR #36，把 mock props 換成真 fetch（Server Component getCompany* + Client fetch 各 panel endpoint）
5. Jason FinMind/TWSE adapter PR-H1+PR-H4 merge → endpoint 通
6. Jim PR #36 v2 production smoke → squash merge
7. 公司頁全活

---

## 7. 派工指示給楊董

把這份 spec 整份貼給 codex（CLI 或 web 都可）。不要刪簡 — codex 需要全部 context。
codex 完成後 push 到新 branch `codex/visual-9panel-2026-04-30` + 開 DRAFT PR。
我這邊 background agent 繼續 Lane H/G/EC2，不重疊。

**Status**: SPEC COMPLETE，等楊董丟 codex 開工。
